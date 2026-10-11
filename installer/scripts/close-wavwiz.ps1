<#
.SYNOPSIS  0.2.2 T11: closes a running WavWiz before the installer replaces its files (run by installer\WavWiz.iss PrepareToInstall, elevated, hidden).
           1) stops the WavWiz Server service (and ends its process if it does not stop in time),
           2) asks every WavWiz Player to exit (the Local\WavWizPlayer.Exit event, then WM_CLOSE), and ends the ones still running after -PlayerWaitSec,
           3) ends anything else still running from the install folder (AirPlay / Spotify receivers, ffmpeg),
           4) retries until no file in the install folder is locked (-LockRetrySec).
           Writes what was running to -StateFile (service=..., player=1) so the installer can start both again afterwards, and its exit code to -DoneFile as its last act.
           Exit 0 = closed (or nothing was running); 3 = something could not be closed (the reason is in close-error.txt and install.log). Windows PowerShell 5.1 compatible.
#>
[CmdletBinding()]
param([string]$Root = '', [string]$StateFile = '', [string]$DoneFile = '', [int]$ServiceWaitSec = 30, [int]$PlayerWaitSec = 8, [int]$LockRetrySec = 20)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
Set-NonInteractive $true
function Write-Done([int]$code) { if ($DoneFile) { try { [IO.File]::WriteAllText($DoneFile, [string]$code, (New-Object Text.UTF8Encoding($false))) } catch { } } }
$TestProcs = $(if ((Test-TestHost) -and $env:WAVWIZ_TEST_STATE) { Join-Path $env:WAVWIZ_TEST_STATE 'procs.txt' } else { '' })

# ---- processes: name, pid, path, session (the test host reads a fake process table: name|pid|path|session)
function Get-WavWizProcs([string]$Dir) {
    $list = New-Object System.Collections.Generic.List[object]
    if (Test-TestHost) {
        if ($TestProcs -and (Test-Path -LiteralPath $TestProcs)) {
            foreach ($l in @(Get-Content -LiteralPath $TestProcs)) { $p = $l -split '\|'; if ($p.Count -ge 4) { $list.Add([pscustomobject]@{ Name = $p[0]; Id = [int]$p[1]; Path = $p[2]; Session = [int]$p[3] }) } }
        }
    } else {
        $r = Invoke-WithTimeout -Name 'list processes (CIM)' -TimeoutSec 20 -ArgumentList @($Dir) -ScriptBlock {
            param($d) Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -ieq 'wavwiz-player.exe' -or $_.Name -ieq 'wavwiz-server.exe' -or ($d -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($d.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) } |
                ForEach-Object { [pscustomobject]@{ Name = $_.Name; Id = [int]$_.ProcessId; Path = [string]$_.ExecutablePath; Session = [int]$_.SessionId } } }
        if (-not $r.Failed) { foreach ($v in $r.Value) { $list.Add($v) } }
        else {
            foreach ($p in @(Get-Process -ErrorAction SilentlyContinue)) {
                $path = ''; try { $path = [string]$p.Path } catch { }
                if ($p.ProcessName -ieq 'wavwiz-player' -or $p.ProcessName -ieq 'wavwiz-server' -or ($Dir -and $path -and $path.StartsWith($Dir.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase))) {
                    $list.Add([pscustomobject]@{ Name = $p.ProcessName + '.exe'; Id = $p.Id; Path = $path; Session = $p.SessionId })
                }
            }
        }
    }
    return $list.ToArray()
}
function Get-Players([string]$Dir) { return @((Get-WavWizProcs $Dir) | Where-Object { $_.Name -ieq 'wavwiz-player.exe' }) }
function Stop-ById([int]$Id, [string]$Why) {
    Say ("Ending process {0} ({1})." -f $Id, $Why)
    [void](Invoke-Native -File (Get-SystemTool 'taskkill.exe') -ArgList @('/PID', [string]$Id, '/T', '/F') -Label 'taskkill (end process)' -AllowFail -TimeoutSec 20)
}
function Request-PlayerExit {
    if (Test-TestHost) {
        if ($env:WAVWIZ_TEST_PLAYER_GRACEFUL -eq '1' -and $TestProcs -and (Test-Path -LiteralPath $TestProcs)) { Set-Content -LiteralPath $TestProcs @(@(Get-Content -LiteralPath $TestProcs) | Where-Object { $_ -notlike 'wavwiz-player.exe|*' }) }
        Write-InstallLog 'asked the Player to exit (test host)'; return
    }
    # 0.2.2 Players listen for this event (this session); older Players get WM_CLOSE on their windows, then are ended after the wait
    try { $h = $null; if ([Threading.EventWaitHandle]::TryOpenExisting('Local\WavWizPlayer.Exit', [ref]$h)) { [void]$h.Set(); $h.Dispose(); Say 'Asked WavWiz Player to exit.' } } catch { Write-InstallLog ("exit event: " + $_.Exception.Message) }
    try { foreach ($p in @(Get-Process -Name 'wavwiz-player' -ErrorAction SilentlyContinue)) { try { [void]$p.CloseMainWindow() } catch { } } } catch { }
}
function Get-LockedFiles([string]$Dir) {
    $locked = New-Object System.Collections.Generic.List[string]
    if (-not $Dir -or -not (Test-Path -LiteralPath $Dir)) { return }
    foreach ($f in @(Get-ChildItem -LiteralPath $Dir -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in '.exe', '.dll' })) {
        $rel = $f.FullName.Substring($Dir.TrimEnd('\', '/').Length).TrimStart('\', '/')
        if ((Test-TestHost) -and $env:WAVWIZ_TEST_LOCKED -and ($env:WAVWIZ_TEST_LOCKED -split ';') -contains ($rel -replace '\\', '/')) { $locked.Add($rel); continue }
        try { $s = [IO.File]::Open($f.FullName, 'Open', 'ReadWrite', 'None'); $s.Dispose() } catch [IO.FileNotFoundException] { } catch { $locked.Add($rel) }
    }
    return $locked.ToArray()
}

try {
    Start-InstallLog
    Set-Step 'USER:Closing WavWiz...'
    Say "== WavWiz: closing the running app before the files are replaced ($(Get-Date -Format s)) root=$Root =="
    $svc = $script:ServiceName; $serviceWas = 'missing'; $playerWas = 0; $problems = New-Object System.Collections.Generic.List[string]

    # 1) the service
    if (Test-ServiceExists $svc) {
        $serviceWas = Get-ServiceState $svc
        Say "Service $svc is $serviceWas."
        if ($serviceWas -ne 'STOPPED') {
            Set-Step 'USER:Closing WavWiz... (stopping the WavWiz Server service)'
            [void](Invoke-Sc 'stop' @('stop', $svc) -AllowFail)
            if (-not (Wait-ServiceState $svc 'STOPPED' $ServiceWaitSec)) {
                Say "The service did not stop within $ServiceWaitSec s; ending its process."
                foreach ($p in @((Get-WavWizProcs $Root) | Where-Object { $_.Name -ieq 'wavwiz-server.exe' })) { Stop-ById $p.Id 'service did not stop' }
                if (-not (Wait-ServiceState $svc 'STOPPED' 10)) { $problems.Add("The WavWiz Server service did not stop (state: $(Get-ServiceState $svc)).") }
            } else { Say 'Service stopped.' }
        }
    } else { Say 'No WavWiz service on this PC.' }

    # 2) the Player(s): ask, wait, then end
    $players = @(Get-Players $Root)
    if ($players.Count -gt 0) {
        $me = 0; try { $me = [Diagnostics.Process]::GetCurrentProcess().SessionId } catch { }
        if (Test-TestHost) { $me = 1 }
        $playerWas = $(if (@($players | Where-Object { $_.Session -eq $me }).Count -gt 0) { 1 } else { 0 })
        Set-Step 'USER:Closing WavWiz... (closing WavWiz Player)'
        Say ("WavWiz Player is running ({0} process(es)); asking it to exit." -f $players.Count)
        Request-PlayerExit
        $end = (Get-Date).AddSeconds($PlayerWaitSec)
        while ((Get-Date) -lt $end -and @(Get-Players $Root).Count -gt 0) { Start-Sleep -Milliseconds 400 }
        foreach ($p in @(Get-Players $Root)) { Stop-ById $p.Id "Player did not exit within $PlayerWaitSec s" }
    } else { Say 'WavWiz Player is not running.' }

    # 3) + 4) leftovers from the install folder, and locked files (retried)
    Set-Step 'USER:Closing WavWiz... (checking that no file is in use)'
    $end = (Get-Date).AddSeconds($LockRetrySec); $locked = $null; $round = 0
    while ($true) {
        foreach ($p in @(Get-WavWizProcs $Root)) { Stop-ById $p.Id ("still running from the install folder: " + $p.Name) }
        $locked = @(Get-LockedFiles $Root)
        if ($locked.Count -eq 0) { break }
        $round++; if ($round -eq 1) { Say ("In use, retrying: " + (($locked | Select-Object -First 5) -join ', ')) }
        if ((Get-Date) -ge $end) { break }
        Start-Sleep -Milliseconds 1000
    }
    $left = @(Get-WavWizProcs $Root)
    if ($left.Count -gt 0) { $problems.Add("Still running: " + (($left | ForEach-Object { "$($_.Name) (process $($_.Id))" }) -join ', ')) }
    if ($locked.Count -gt 0) { $problems.Add("Files still in use after $LockRetrySec s: " + (($locked | Select-Object -First 5) -join ', ')) }

    if ($StateFile) { Write-Utf8NoBom $StateFile ("service=$serviceWas`r`nplayer=$playerWas`r`n") }
    Complete-Step
    if ($problems.Count -gt 0) {
        $m = ($problems -join "`r`n")
        Say ("CLOSE FAILED: " + $m)
        try { Write-Utf8NoBom (Join-Path (Get-WavWizDataRoot) 'close-error.txt') $m } catch { }
        Write-Done 3; exit 3
    }
    try { Remove-Item -LiteralPath (Join-Path (Get-WavWizDataRoot) 'close-error.txt') -Force -ErrorAction SilentlyContinue } catch { }
    Say 'WavWiz is closed; the files can be replaced.'
    Write-Done 0; exit 0
}
catch {
    $m = $_.Exception.Message
    Say ("CLOSE STEP ERROR: " + $m)
    try { Write-Utf8NoBom (Join-Path (Get-WavWizDataRoot) 'close-error.txt') $m } catch { }
    Write-Done 3; exit 3
}
