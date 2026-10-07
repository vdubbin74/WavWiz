# Shared helpers for the WavWiz installer scripts (dot-sourced by setup.ps1 and the step scripts). Windows PowerShell 5.1 compatible.
# Hard rules learned from installer failures seen in an earlier project (docs/LESSONS-INSTALLER.md):
#   - nothing here ever waits for a keypress; every native command and every WMI/CIM/network call has a time limit and a log line
#   - no window is shown from the hidden setup process (see Show-NoticeOrSave: separate visible process, time limits, file fallback)
#   - "non-interactive" is detected in four independent ways; the variable that holds it is NOT called $NonInteractive (script parameter name clash)
#   - secrets are never written to install.log or onto a command line
Set-StrictMode -Version Latest

# TEST-ONLY seam: the pwsh tests set WAVWIZ_TEST_HOST=shim to run the real scripts on Linux against fake sc/icacls/netsh tools. Never set by the installer.
function Test-TestHost { return ($env:WAVWIZ_TEST_HOST -eq 'shim') }
function Test-IsWindows { if (Test-TestHost) { return $true }; return ($PSVersionTable.PSEdition -eq 'Desktop') -or ($IsWindows -eq $true) }
function Test-IsAdmin {
    if (Test-TestHost) { return $true }
    if (-not (Test-IsWindows)) { return $false }
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Stop-Setup([string]$m) {
    if (Get-Variable -Name WavWizThrowOnStop -Scope Global -ErrorAction SilentlyContinue) { throw "FAILED: $m" }
    Write-Host "FAILED: $m"; exit 1
}

# A failure message that says WHERE: the failing statement plus the script frames with file:line and their source text.
function Get-ErrorWhere($err) {
    $parts = New-Object System.Collections.Generic.List[string]
    try {
        $ii = $err.InvocationInfo
        if ($ii -and $ii.ScriptName) { $t = ("$($ii.Line)").Trim(); $parts.Add(('failing statement: {0}:{1}: {2}' -f [IO.Path]::GetFileName($ii.ScriptName), $ii.ScriptLineNumber, $t)) }
    } catch { }
    try {
        $n = 0
        foreach ($fr in @(("$($err.ScriptStackTrace)") -split "`r?`n")) {
            $m = [regex]::Match($fr, '^at (?<fn>.+?), (?<file>.+?): line (?<ln>\d+)\s*$')
            if (-not $m.Success) { continue }
            $txt = ''
            try { $f = $m.Groups['file'].Value; if (Test-Path -LiteralPath $f) { $txt = ([string](@(Get-Content -LiteralPath $f -TotalCount ([int]$m.Groups['ln'].Value))[-1])).Trim() } } catch { }
            $parts.Add(('  called from {0} ({1}:{2}): {3}' -f $m.Groups['fn'].Value, [IO.Path]::GetFileName($m.Groups['file'].Value), $m.Groups['ln'].Value, $txt))
            $n++; if ($n -ge 4) { break }
        }
    } catch { }
    return ($parts -join "`n")
}

# Config files are written BOM-less on every PowerShell (Windows PowerShell 5.1's "Set-Content -Encoding utf8" writes a BOM).
function Write-Utf8NoBom([string]$Path, [string]$Text) { [IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false))) }
function Read-TextFile([string]$Path) { return ([IO.File]::ReadAllText($Path)).TrimStart([char]0xFEFF) }

# ---- install log + steps (C:\ProgramData\WavWiz\install.log). Never write secrets here.
$script:InstallLog = $null; $script:CurrentStep = ''; $script:CurrentStepStart = $null
function Get-WavWizDataRoot { $pd = $env:ProgramData; if (-not $pd) { $pd = 'C:\ProgramData' }; return (Join-Path $pd 'WavWiz') }
# 0.1.2: rename unison.db → wavwiz.db on upgrade (library + password kept). Idempotent.
function Rename-WavWizLibraryDb([string]$DataDir) {
    if (-not $DataDir) { return }
    $neu = Join-Path $DataDir 'wavwiz.db'; $old = Join-Path $DataDir 'unison.db'
    if ((Test-Path -LiteralPath $neu) -or -not (Test-Path -LiteralPath $old)) { return }
    try {
        Move-Item -LiteralPath $old -Destination $neu -Force
        foreach ($s in '-wal', '-shm') {
            $os = $old + $s; $ns = $neu + $s
            if ((Test-Path -LiteralPath $os) -and -not (Test-Path -LiteralPath $ns)) { Move-Item -LiteralPath $os -Destination $ns -Force }
        }
        Say "Renamed library database to wavwiz.db (your music library and password were kept)."
    } catch { Write-InstallLog ("Rename-WavWizLibraryDb: " + $_.Exception.Message) }
}
function Get-StepFile { return (Join-Path (Get-WavWizDataRoot) 'current-step.txt') }
function Start-InstallLog {
    $dir = Get-WavWizDataRoot
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $script:InstallLog = Join-Path $dir 'install.log'
    try { if ((Test-Path -LiteralPath $script:InstallLog) -and ((Get-Item -LiteralPath $script:InstallLog).Length -gt 2MB)) { Move-Item -LiteralPath $script:InstallLog -Destination ($script:InstallLog + '.old') -Force } } catch { }
}
function Write-InstallLog([string]$m) { if ($script:InstallLog) { try { Add-Content -Path $script:InstallLog -Value ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $m) } catch { } } }
function Say([string]$m) { Write-Host $m; Write-InstallLog $m }
function Set-Step([string]$Name) {
    if ($script:CurrentStep) { Write-InstallLog ("STEP< {0} ({1} ms)" -f $script:CurrentStep, [int]((Get-Date) - $script:CurrentStepStart).TotalMilliseconds) }
    $script:CurrentStep = $Name; $script:CurrentStepStart = Get-Date
    Write-InstallLog ("STEP> {0}" -f $Name)
    try { Write-Utf8NoBom (Get-StepFile) $Name } catch { }
}
function Complete-Step { if ($script:CurrentStep) { Write-InstallLog ("STEP< {0} ({1} ms)" -f $script:CurrentStep, [int]((Get-Date) - $script:CurrentStepStart).TotalMilliseconds); $script:CurrentStep = '' } }
function Get-LastStep { try { $f = Get-StepFile; if (Test-Path -LiteralPath $f) { return (Read-TextFile $f).Trim() } } catch { }; return '' }

# ---- non-interactive: ANY of four signals. NOT named $NonInteractive (would alias the scripts' own -NonInteractive parameter).
$script:WavWizNoPrompt = ($env:WAVWIZ_NONINTERACTIVE -eq '1')
function Test-HostNonInteractive {
    try { if (-not [Environment]::UserInteractive) { return $true } } catch { }
    try {
        foreach ($a in [Environment]::GetCommandLineArgs()) {
            if ($a -match '^[-/](noni|noninteractive)$') { return $true }
            if ($a -match '^[-/](file|f|command|c|encodedcommand|ec|e)$') { break }
        }
    } catch { }
    return $false
}
function Test-NonInteractive {
    if ($script:WavWizNoPrompt) { return $true }
    if ($env:WAVWIZ_NONINTERACTIVE -eq '1') { return $true }
    return (Test-HostNonInteractive)
}
function Set-NonInteractive([bool]$On = $true) { $script:WavWizNoPrompt = $On; if ($On) { $env:WAVWIZ_NONINTERACTIVE = '1' } }
function Write-AssumedDefault([string]$Question, [string]$Default) { Write-InstallLog ('non-interactive: assumed {0} for "{1}"' -f $Default, $Question) }
function Confirm-YesNo([string]$q, [bool]$default = $false) {
    $d = if ($default) { 'yes' } else { 'no' }
    if (Test-NonInteractive) { Write-AssumedDefault $q $d; return $default }
    $a = $null
    try { $a = Read-Host ("$q " + $(if ($default) { '[Y/n]' } else { '[y/N]' })) } catch { Write-AssumedDefault $q $d; return $default }
    if ([string]::IsNullOrWhiteSpace($a)) { return $default }
    return $a.Trim().ToLowerInvariant().StartsWith('y')
}

# ---- command-line quoting (CommandLineToArgvW rules) and native commands
function ConvertTo-WinArg([AllowEmptyString()][string]$Arg) {
    if ($null -eq $Arg) { $Arg = '' }
    if ($Arg.Length -gt 0 -and $Arg -notmatch '[\s"]') { return $Arg }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append([char]34); $bs = 0
    foreach ($ch in $Arg.ToCharArray()) {
        if ($ch -eq [char]92) { $bs++ }
        elseif ($ch -eq [char]34) { [void]$sb.Append([char]92, $bs * 2 + 1); [void]$sb.Append([char]34); $bs = 0 }
        else { if ($bs -gt 0) { [void]$sb.Append([char]92, $bs); $bs = 0 }; [void]$sb.Append($ch) }
    }
    if ($bs -gt 0) { [void]$sb.Append([char]92, $bs * 2) }
    [void]$sb.Append([char]34)
    return $sb.ToString()
}
function Join-WinArgs([AllowEmptyCollection()][string[]]$ArgList) {
    if (-not $ArgList -or $ArgList.Count -eq 0) { return '' }
    return (@($ArgList | ForEach-Object { ConvertTo-WinArg $_ }) -join ' ')
}
function Get-SystemTool([string]$Name) {
    if ((Test-TestHost) -and $env:WAVWIZ_TEST_SHIMDIR) { $shim = Join-Path $env:WAVWIZ_TEST_SHIMDIR $Name; if (Test-Path -LiteralPath $shim) { return $shim } }
    $root = $env:SystemRoot; if (-not $root) { $root = 'C:\Windows' }
    $p = Join-Path (Join-Path $root 'System32') $Name
    if (Test-Path -LiteralPath $p) { return $p }
    return $Name
}
function Stop-ProcessTree($Process) {
    if (-not $Process) { return }
    try {
        if ((Test-IsWindows) -and -not (Test-TestHost)) {
            $q = New-Object System.Diagnostics.ProcessStartInfo; $q.FileName = (Get-SystemTool 'taskkill.exe'); $q.Arguments = "/PID $($Process.Id) /T /F"; $q.UseShellExecute = $false; $q.CreateNoWindow = $true; $q.RedirectStandardOutput = $true; $q.RedirectStandardError = $true
            $k = [System.Diagnostics.Process]::Start($q); [void]$k.StandardOutput.ReadToEndAsync(); [void]$k.StandardError.ReadToEndAsync(); [void]$k.WaitForExit(15000)
        }
    } catch { }
    try { $Process.Kill($true) } catch { try { $Process.Kill() } catch { } }
}
# Runs a native program with an exact argument list, captures stdout+stderr, enforces a time limit (kills the process tree), closes its stdin at once (nothing can wait for a key).
# Logs "RUN ..." and the result. Secrets go only through -StdinText (never logged). Throws with command line + exit code + output unless -AllowFail.
function Invoke-Native {
    param([Parameter(Mandatory)][string]$File, [string[]]$ArgList = @(), [string]$Label = '', [switch]$AllowFail, [string]$StdinText = $null, [int]$TimeoutSec = 120)
    $hasStdin = $PSBoundParameters.ContainsKey('StdinText')
    $line = Join-WinArgs $ArgList
    $shown = ('"' + $File + '" ' + $line).Trim()
    $what = if ($Label) { $Label } else { [IO.Path]::GetFileName($File) }
    Write-InstallLog ("RUN [$what] $shown" + $(if ($hasStdin) { '   (stdin supplied, not logged)' } else { '' }) + "   (timeout $TimeoutSec s)")
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $File; $psi.Arguments = $line; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.RedirectStandardInput = $true
    try { $psi.EnvironmentVariables['WAVWIZ_NONINTERACTIVE'] = '1' } catch { }
    $p = New-Object System.Diagnostics.Process; $p.StartInfo = $psi
    try { [void]$p.Start() } catch { $m = "$what could not be started: $($_.Exception.Message)`n  command: $shown"; Write-InstallLog $m; throw $m }
    $so = $p.StandardOutput.ReadToEndAsync(); $se = $p.StandardError.ReadToEndAsync()
    if ($hasStdin) { $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($StdinText + "`n"); try { $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length); $p.StandardInput.BaseStream.Flush() } catch { } }
    try { $p.StandardInput.Close() } catch { }
    if (-not $p.WaitForExit($TimeoutSec * 1000)) { Stop-ProcessTree $p; $m = "$what did not finish within $TimeoutSec s and was stopped.`n  command: $shown"; Write-InstallLog $m; throw $m }
    $p.WaitForExit()
    $out = (($so.Result + $se.Result) -replace '\s+$', ''); $code = $p.ExitCode; $p.Dispose()
    if ($hasStdin) { $out = '(output withheld because a secret was supplied on stdin)' }
    Write-InstallLog ("     -> exit $code" + $(if ($out) { ": " + (($out -split "`r?`n") -join ' | ') } else { '' }))
    $r = [pscustomobject]@{ ExitCode = $code; Output = $out; CommandLine = $shown }
    if ($code -ne 0 -and -not $AllowFail) { throw "$what failed (exit code $code).`n  command: $shown`n  output : $(if ($out) { $out } else { '(none)' })" }
    return $r
}
# A self-contained script block (cmdlets / .NET only - not functions from this file) in its own runspace with a hard time limit. For anything WMI/CIM/network that can block for minutes.
function Invoke-WithTimeout {
    param([Parameter(Mandatory)][scriptblock]$ScriptBlock, [object[]]$ArgumentList = @(), [int]$TimeoutSec = 20, [string]$Name = 'operation')
    $ps = [powershell]::Create()
    try {
        [void]$ps.AddScript($ScriptBlock.ToString())
        foreach ($a in $ArgumentList) { [void]$ps.AddArgument($a) }
        Write-InstallLog "CALL [$Name] (limit $TimeoutSec s)"
        $ar = $ps.BeginInvoke()
        if (-not $ar.AsyncWaitHandle.WaitOne($TimeoutSec * 1000)) {
            Write-InstallLog "TIMEOUT: [$Name] did not finish within $TimeoutSec s; abandoned and skipped."
            try { [void]$ps.BeginStop($null, $null) } catch { }
            return [pscustomobject]@{ TimedOut = $true; Failed = $true; Error = "$Name did not finish within $TimeoutSec s"; Value = @() }
        }
        $val = @(); $err = ''
        try { $val = @($ps.EndInvoke($ar)) } catch { $err = $_.Exception.Message }
        if ($err) { Write-InstallLog "CALL [$Name] failed: $err" } else { Write-InstallLog "CALL [$Name] done" }
        try { $ps.Dispose() } catch { }
        return [pscustomobject]@{ TimedOut = $false; Failed = [bool]$err; Error = $err; Value = $val }
    } catch { return [pscustomobject]@{ TimedOut = $false; Failed = $true; Error = $_.Exception.Message; Value = @() } }
}

# ---- step scripts run in a CHILD powershell.exe with a time limit (params as JSON on stdin; run-step.ps1 is the wrapper)
function Get-WindowsPowerShellExe { if ((Test-TestHost) -and $env:WAVWIZ_TEST_POWERSHELL) { return $env:WAVWIZ_TEST_POWERSHELL }; $r = $env:SystemRoot; if (-not $r) { $r = 'C:\Windows' }; return (Join-Path $r 'System32\WindowsPowerShell\v1.0\powershell.exe') }
function Invoke-SubScript {
    param([Parameter(Mandatory)][string]$Script, [hashtable]$Params = @{}, [int]$TimeoutSec = 180, [string]$Label = '', [string]$PowerShellExe = '', [string]$Wrapper = '')
    if (-not $PowerShellExe) { $PowerShellExe = Get-WindowsPowerShellExe }
    if (-not $Wrapper) { $Wrapper = Join-Path $PSScriptRoot 'run-step.ps1' }
    $what = if ($Label) { $Label } else { [IO.Path]::GetFileName($Script) }
    $argList = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $Wrapper, '-Script', $Script)
    $shown = ('"' + $PowerShellExe + '" ' + (Join-WinArgs $argList)).Trim()
    $paramText = @($Params.Keys | Sort-Object | ForEach-Object { "$_=$($Params[$_])" }) -join ' '
    Write-InstallLog ("RUN-STEP [$what] $shown   params: $paramText   (timeout $TimeoutSec s)")
    $json = (@{ p = $Params } | ConvertTo-Json -Compress -Depth 4)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $PowerShellExe; $psi.Arguments = (Join-WinArgs $argList); $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.RedirectStandardInput = $true
    try { $psi.EnvironmentVariables['WAVWIZ_NONINTERACTIVE'] = '1' } catch { }
    $p = New-Object System.Diagnostics.Process; $p.StartInfo = $psi
    try { [void]$p.Start() } catch { $m = "$what could not be started: $($_.Exception.Message)`n  command: $shown"; Write-InstallLog $m; throw $m }
    $so = $p.StandardOutput.ReadToEndAsync(); $se = $p.StandardError.ReadToEndAsync()
    $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($json + "`n")
    try { $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length); $p.StandardInput.BaseStream.Flush() } catch { }
    try { $p.StandardInput.Close() } catch { }
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while (-not $p.WaitForExit(1000)) {
        if ((Get-LastStep) -like 'USER:*') { $deadline = (Get-Date).AddSeconds($TimeoutSec); continue }
        if ((Get-Date) -gt $deadline) {
            $last = Get-LastStep
            Stop-ProcessTree $p
            $m = "$what did not finish within $TimeoutSec s and was stopped (killed with its child processes).`n  last step: $(if ($last) { $last } else { '(unknown)' })`n  See $(Join-Path (Get-WavWizDataRoot) 'install.log') - the last STEP> line shows where it was stuck. Nothing is lost: it is safe to run the installer again."
            Write-InstallLog $m; throw $m
        }
    }
    $p.WaitForExit()
    $text = $so.Result + "`n" + $se.Result; $code = $p.ExitCode; $p.Dispose()
    $objs = New-Object System.Collections.Generic.List[object]; $errMsg = ''; $shownLines = New-Object System.Collections.Generic.List[string]
    foreach ($l in ($text -split "`r?`n")) {
        if ($l.StartsWith('@@UN@@ ')) { try { $objs.Add(($l.Substring(7) | ConvertFrom-Json)) } catch { } }
        elseif ($l.StartsWith('@@UN-ERROR@@ ')) { $errMsg = $l.Substring(13).Replace('<NL>', "`n") }
        elseif ($l.Trim()) { $shownLines.Add($l) }
    }
    Write-InstallLog "     -> $what exit $code"
    if ($code -ne 0) {
        if (-not $errMsg) { $errMsg = "$what failed (exit code $code).`n  output: " + ((@($shownLines) | Select-Object -Last 15) -join ' | ') }
        throw ($errMsg -replace '^FAILED:\s*', '')
    }
    return [pscustomobject]@{ ExitCode = $code; Objects = $objs.ToArray(); Output = (@($shownLines) -join "`n") }
}

# ---- Windows service (sc.exe; no WMI/CIM) ----
$script:ServiceName = 'WavWizServer'
$script:FirewallNames = @('WavWiz Server (web, audio, clock)')
function Get-ServiceBinPath([string]$Exe, [string[]]$ExeArgs = @()) {
    $parts = @('"' + $Exe + '"')
    foreach ($a in $ExeArgs) { $parts += (ConvertTo-WinArg $a) }
    return ($parts -join ' ')
}
function Invoke-Sc([string]$Label, [string[]]$ArgList, [switch]$AllowFail) { return (Invoke-Native -File (Get-SystemTool 'sc.exe') -ArgList $ArgList -Label ("sc.exe " + $ArgList[0] + " (" + $Label + ")") -AllowFail:$AllowFail -TimeoutSec 60) }
function Test-ServiceExists([string]$Name) { $r = Invoke-Sc 'query' @('query', $Name) -AllowFail; return ($r.ExitCode -eq 0) }
function Get-ServiceState([string]$Name) {
    $r = Invoke-Sc 'query state' @('query', $Name) -AllowFail
    if ($r.ExitCode -ne 0) { return 'missing' }
    $m = [regex]::Match($r.Output, 'STATE\s*:\s*\d+\s+(?<s>[A-Z_]+)')
    if ($m.Success) { return $m.Groups['s'].Value } else { return 'unknown' }
}
function Wait-ServiceState([string]$Name, [string]$Want, [int]$TimeoutSec = 30) {
    $end = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $end) { if ((Get-ServiceState $Name) -eq $Want) { return $true }; Start-Sleep -Milliseconds 700 }
    return ((Get-ServiceState $Name) -eq $Want)
}

# ---- firewall (netsh advfirewall: no CIM, bounded). Rules are Private-profile, local-subnet only, scoped to the server program. Delete-then-add = idempotent.
function Set-ServerFirewall([string]$Exe, [int[]]$TcpPorts, [int[]]$UdpPorts) {
    $net = Get-SystemTool 'netsh.exe'; $name = $script:FirewallNames[0]
    [void](Invoke-Native -File $net -ArgList @('advfirewall', 'firewall', 'delete', 'rule', "name=$name") -Label 'netsh delete old rule' -AllowFail -TimeoutSec 30)
    [void](Invoke-Native -File $net -ArgList @('advfirewall', 'firewall', 'delete', 'rule', "name=$name (UDP)") -Label 'netsh delete old UDP rule' -AllowFail -TimeoutSec 30)
    [void](Invoke-Native -File $net -ArgList @('advfirewall', 'firewall', 'add', 'rule', "name=$name", 'dir=in', 'action=allow', 'protocol=TCP', ('localport=' + ($TcpPorts -join ',')), 'profile=private', 'remoteip=localsubnet', "program=$Exe", 'enable=yes') -Label 'netsh add TCP rule' -TimeoutSec 30)
    [void](Invoke-Native -File $net -ArgList @('advfirewall', 'firewall', 'add', 'rule', "name=$name (UDP)", 'dir=in', 'action=allow', 'protocol=UDP', ('localport=' + ($UdpPorts -join ',')), 'profile=private', 'remoteip=localsubnet', "program=$Exe", 'enable=yes') -Label 'netsh add UDP rule' -TimeoutSec 30)
}
function Get-ServerUdpPorts($Config) {
    # clock always; discovery (UDP 47803 'where is WavWiz?' + mDNS 5353) unless the owner switched it off in server.json (discovery: false)
    $ports = New-Object System.Collections.Generic.List[int]
    $ports.Add([int]$Config['clockPort'])
    $off = $Config.Contains('discovery') -and ("$($Config['discovery'])" -eq 'False' -or "$($Config['discovery'])" -eq 'false')
    if (-not $off) {
        $dp = 47803; if ($Config.Contains('discoveryPort') -and [int]$Config['discoveryPort'] -gt 0) { $dp = [int]$Config['discoveryPort'] }
        $ports.Add($dp); $ports.Add(5353)
    }
    return ,$ports.ToArray()
}
# 0.1.1: AirPlay receiver (RTSP TCP + RTP/control/timing UDP on ports it picks) and Spotify Connect (librespot zeroconf TCP + its own mDNS on UDP 5353).
# Same style: Private profile, local subnet only, each rule scoped to that one bundled program. Delete-then-add = idempotent.
$script:ReceiverFirewallNames = @('WavWiz AirPlay receiver', 'WavWiz AirPlay receiver (UDP)', 'WavWiz Spotify Connect', 'WavWiz Spotify Connect (mDNS)')
function Set-ReceiverFirewall([string]$ServerExe, $Config) {
    $net = Get-SystemTool 'netsh.exe'; $rdir = Join-Path (Split-Path -Parent $ServerExe) 'receivers'
    $ap = 47804; if ($Config.Contains('airPlayPort') -and [int]$Config['airPlayPort'] -gt 0) { $ap = [int]$Config['airPlayPort'] }
    $sp = 47805; if ($Config.Contains('spotifyPort') -and [int]$Config['spotifyPort'] -gt 0) { $sp = [int]$Config['spotifyPort'] }
    foreach ($n in $script:ReceiverFirewallNames) { [void](Invoke-Native -File $net -ArgList @('advfirewall', 'firewall', 'delete', 'rule', "name=$n") -Label 'netsh delete old receiver rule' -AllowFail -TimeoutSec 30) }
    $airplay = Join-Path $rdir 'wavwiz-airplay.exe'; $librespot = Join-Path $rdir 'librespot.exe'
    $common = @('dir=in', 'action=allow', 'profile=private', 'remoteip=localsubnet', 'enable=yes')
    [void](Invoke-Native -File $net -ArgList (@('advfirewall', 'firewall', 'add', 'rule', ('name=' + $script:ReceiverFirewallNames[0]), 'protocol=TCP', "localport=$ap", "program=$airplay") + $common) -Label 'netsh add AirPlay TCP rule' -TimeoutSec 30)
    [void](Invoke-Native -File $net -ArgList (@('advfirewall', 'firewall', 'add', 'rule', ('name=' + $script:ReceiverFirewallNames[1]), 'protocol=UDP', "program=$airplay") + $common) -Label 'netsh add AirPlay UDP rule' -TimeoutSec 30)
    [void](Invoke-Native -File $net -ArgList (@('advfirewall', 'firewall', 'add', 'rule', ('name=' + $script:ReceiverFirewallNames[2]), 'protocol=TCP', "localport=$sp", "program=$librespot") + $common) -Label 'netsh add Spotify Connect rule' -TimeoutSec 30)
    [void](Invoke-Native -File $net -ArgList (@('advfirewall', 'firewall', 'add', 'rule', ('name=' + $script:ReceiverFirewallNames[3]), 'protocol=UDP', 'localport=5353', "program=$librespot") + $common) -Label 'netsh add Spotify Connect mDNS rule' -TimeoutSec 30)
}
function Remove-ServerFirewall {
    $net = Get-SystemTool 'netsh.exe'; $name = $script:FirewallNames[0]
    foreach ($n in @($name, "$name (UDP)") + $script:ReceiverFirewallNames) { [void](Invoke-Native -File $net -ArgList @('advfirewall', 'firewall', 'delete', 'rule', "name=$n") -Label 'netsh delete rule' -AllowFail -TimeoutSec 30) }
}

# ---- files and ACLs
function Remove-FileShredded([string]$Path) {
    try { if (Test-Path -LiteralPath $Path) { $len = (Get-Item -LiteralPath $Path).Length; if ($len -gt 0 -and $len -lt 1MB) { [IO.File]::WriteAllBytes($Path, (New-Object byte[] $len)) }; Remove-Item -LiteralPath $Path -Force } } catch { }
}
function Protect-FileForCurrentUser([string]$Path) {
    try {
        $me = [Environment]::UserDomainName + '\' + [Environment]::UserName
        $r = Invoke-Native -File (Get-SystemTool 'icacls.exe') -ArgList @($Path, '/inheritance:r', '/grant:r', ($me + ':(F)'), '*S-1-5-32-544:(F)') -Label 'icacls restrict file' -AllowFail -TimeoutSec 30
        return ($r.ExitCode -eq 0)
    } catch { return $false }
}
function Grant-ServiceDataAccess([string]$Dir) {
    # LocalService (S-1-5-19) needs to write the database, logs and certificates. Only ADDS a grant: inherited access (the player reads player-defaults.json) stays.
    [void](Invoke-Native -File (Get-SystemTool 'icacls.exe') -ArgList @($Dir, '/grant', '*S-1-5-19:(OI)(CI)M', '/T', '/C', '/Q') -Label 'icacls grant LocalService on data folder' -TimeoutSec 120)
}

# ---- network address choice
$script:LanCandidateScript = {
    $out = New-Object System.Collections.Generic.List[object]
    foreach ($ni in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
        $props = $ni.GetIPProperties()
        $gw = (@($props.GatewayAddresses | Where-Object { $_.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and $_.Address.ToString() -ne '0.0.0.0' })).Count -gt 0
        foreach ($ua in $props.UnicastAddresses) {
            if ($ua.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) {
                $out.Add([pscustomobject]@{ Name = "$($ni.Name)"; Description = "$($ni.Description)"; Status = "$($ni.OperationalStatus)"; Type = "$($ni.NetworkInterfaceType)"; HasGateway = $gw; Ip = $ua.Address.ToString() })
            }
        }
    }
    $out.ToArray()
}
function Test-PrivateIPv4([string]$Ip) { return [bool]($Ip -match '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)') }
function Test-IPv4([string]$Ip) {
    if ($Ip -notmatch '^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$') { return $false }
    foreach ($i in 1..4) { if ([int]$Matches[$i] -gt 255) { return $false } }
    return $true
}
# Pure: picks the address from candidate facts. Up, not loopback/tunnel/link-local; a default gateway wins, then non-virtual, then RFC1918, then Ethernet/Wi-Fi. Returns '' when nothing qualifies.
function Select-LanIPv4([object[]]$Candidates) {
    $virt = 'Hyper-V|vEthernet|VirtualBox|VMware|Virtual|TAP-|Npcap|Loopback|WSL|Bluetooth|VPN|Tailscale|ZeroTier|Docker|TeamViewer|Wintun|WireGuard|Miniport|Pseudo'
    $rows = @()
    foreach ($c in @($Candidates)) {
        if (-not $c) { continue }
        if ("$($c.Status)" -ne 'Up' -or "$($c.Type)" -in 'Loopback', 'Tunnel') { continue }
        $ip = "$($c.Ip)"
        if (-not (Test-IPv4 $ip) -or $ip -match '^(127\.|169\.254\.|0\.|22[4-9]\.|23\d\.|24\d\.|25\d\.)') { continue }
        $score = 0
        if ($c.HasGateway) { $score += 100 }
        if ("$($c.Name) $($c.Description)" -notmatch $virt) { $score += 50 }
        if (Test-PrivateIPv4 $ip) { $score += 20 }
        if ("$($c.Type)" -in 'Ethernet', 'Wireless80211', 'GigabitEthernet') { $score += 10 }
        $rows += [pscustomobject]@{ Score = $score; Ip = $ip }
    }
    if ($rows.Count -eq 0) { return '' }
    return [string](@($rows | Sort-Object -Property @{ Expression = 'Score'; Descending = $true }, @{ Expression = 'Ip'; Descending = $false })[0].Ip)
}
function Get-LanIPv4([int]$TimeoutSec = 10) {
    if ((Test-TestHost) -and $env:WAVWIZ_TEST_LANIP) { return $env:WAVWIZ_TEST_LANIP }
    try {
        $r = Invoke-WithTimeout -ScriptBlock $script:LanCandidateScript -TimeoutSec $TimeoutSec -Name 'LAN address detection (NetworkInterface)'
        if ($r.TimedOut -or $r.Failed) { Write-InstallLog "LAN address detection gave up: $($r.Error)"; return '' }
        $ip = Select-LanIPv4 @($r.Value)
        Write-InstallLog ("LAN address detection: " + $(if ($ip) { $ip } else { '(none found)' }))
        return $ip
    } catch { Write-InstallLog "LAN address detection failed: $($_.Exception.Message)"; return '' }
}

# ---- server.json (merge, never clobber). Keys the user or the app changed are kept; the installer only fills what is missing or what it was explicitly told.
function ConvertTo-HashtableDeep($o) {
    if ($null -eq $o) { return $null }
    if ($o -is [System.Management.Automation.PSCustomObject]) { $h = [ordered]@{}; foreach ($p in $o.PSObject.Properties) { $h[$p.Name] = ConvertTo-HashtableDeep $p.Value }; return $h }
    if ($o -is [System.Collections.IEnumerable] -and $o -isnot [string]) { return ,@($o | ForEach-Object { ConvertTo-HashtableDeep $_ }) }
    return $o
}
function Get-ServerConfigPlan {
    param([string]$ExistingJson, [string]$LanIp, [string]$FfmpegPath, [int]$HttpPort, [int]$HttpsPort, [int]$AudioPort, [int]$ClockPort)
    $notes = New-Object System.Collections.Generic.List[string]; $cfg = [ordered]@{}; $existing = $false; $changed = $false
    if ($ExistingJson -and $ExistingJson.Trim()) {
        try { $cfg = ConvertTo-HashtableDeep (($ExistingJson.TrimStart([char]0xFEFF)) | ConvertFrom-Json); $existing = $true } catch { throw "server.json exists but is not valid JSON ($($_.Exception.Message)); it was left untouched. Fix or delete it, then run the installer again." }
        if ($null -eq $cfg) { $cfg = [ordered]@{} }
    }
    $has = { param($k) $cfg.Contains($k) -and $null -ne $cfg[$k] -and "$($cfg[$k])" -ne '' }
    # bind address: never 0.0.0.0 (the user must opt in by editing server.json themselves); an explicit -LanIp wins, an existing valid address is kept
    if ($LanIp) {
        if ($LanIp -eq '0.0.0.0' -or -not (Test-IPv4 $LanIp)) { throw "The address '$LanIp' is not a usable single IPv4 address (0.0.0.0 'all interfaces' is never set by the installer)." }
        if ((& $has 'bindAddress') -and $cfg['bindAddress'] -ne $LanIp) { $notes.Add("The listening address changed from $($cfg['bindAddress']) to $LanIp. If you had created the phone certificate (Settings > Phone & HTTPS), create it again - it is tied to the address.") }
        if (-not (& $has 'bindAddress') -or $cfg['bindAddress'] -ne $LanIp) { $cfg['bindAddress'] = $LanIp; $changed = $true }
    } elseif (-not (& $has 'bindAddress')) {
        $cfg['bindAddress'] = '127.0.0.1'; $changed = $true
        $notes.Add('No home-network address was found, so WavWiz listens on this PC only (127.0.0.1). Phones and other PCs cannot connect until you set the address: run the installer again (Repair) or edit bindAddress in server.json and restart the WavWiz service.')
    }
    foreach ($kv in @(@('httpPort', $HttpPort), @('httpsPort', $HttpsPort), @('audioPort', $AudioPort), @('clockPort', $ClockPort))) {
        if ($kv[1] -gt 0 -and -not (& $has $kv[0])) { $cfg[$kv[0]] = $kv[1]; $changed = $true }
    }
    if ($FfmpegPath) {
        $cur = $(if (& $has 'ffmpegPath') { [string]$cfg['ffmpegPath'] } else { '' })
        $curOk = $cur -and (Test-Path -LiteralPath $cur)
        if (-not $curOk) { $cfg['ffmpegPath'] = $FfmpegPath; $changed = $true; if ($cur) { $notes.Add("ffmpegPath in server.json ($cur) did not exist; it now points at the ffmpeg that ships with WavWiz.") } }
    }
    return [pscustomobject]@{ Config = $cfg; Existing = $existing; Changed = $changed; Notes = $notes.ToArray() }
}
function Test-HttpReady([string]$Url, [int]$TimeoutSec = 40) {
    if ((Test-TestHost) -and $env:WAVWIZ_TEST_PROBE_URL) { $Url = $env:WAVWIZ_TEST_PROBE_URL }
    if ((Test-TestHost) -and $env:WAVWIZ_TEST_PROBE_TIMEOUT) { $TimeoutSec = [int]$env:WAVWIZ_TEST_PROBE_TIMEOUT }
    $end = (Get-Date).AddSeconds($TimeoutSec); $last = ''
    while ((Get-Date) -lt $end) {
        try {
            $rq = [System.Net.HttpWebRequest]::Create($Url); $rq.Timeout = 3000; $rq.ReadWriteTimeout = 3000; $rq.Proxy = $null
            $rs = $rq.GetResponse(); $code = [int]$rs.StatusCode; $rs.Close()
            if ($code -ge 200 -and $code -lt 500) { return [pscustomobject]@{ Ok = $true; Detail = "HTTP $code" } }
        } catch [System.Net.WebException] { $last = $_.Exception.Message; try { if ($_.Exception.Response) { $c = [int]$_.Exception.Response.StatusCode; if ($c -ge 200 -and $c -lt 500) { return [pscustomobject]@{ Ok = $true; Detail = "HTTP $c" } } } } catch { } }
        catch { $last = $_.Exception.Message }
        Start-Sleep -Milliseconds 800
    }
    return [pscustomobject]@{ Ok = $false; Detail = $last }
}

# ---- showing something to the person (1.0.4 lesson). A WinForms window from the hidden setup process inherits "hidden" and the setup then waits for it forever.
#      Now: a SEPARATE powershell.exe (-STA, normal window style) shows the text. The parent waits at most ShownTimeoutSec for it to report that it is REALLY visible and at most
#      AckTimeoutSec for the person. On any failure the text goes to a file in the installing user's own folder, access limited to that user + Administrators.
#      The text travels in a user-only temp file that is shredded at once - never in install.log and never on a command line. Currently the installer shows no secrets (the admin
#      password is chosen by the person on the first-run page); this is the tested mechanism for anything sensitive added later.
function Get-NoticeFallbackDir {
    if ((Test-TestHost) -and $env:WAVWIZ_TEST_FALLBACKDIR) { return $env:WAVWIZ_TEST_FALLBACKDIR }
    foreach ($kind in 'Desktop', 'MyDocuments') { try { $d = [Environment]::GetFolderPath($kind); if ($d -and (Test-Path -LiteralPath $d)) { return $d } } catch { } }
    try { return [Environment]::GetFolderPath('UserProfile') } catch { return [IO.Path]::GetTempPath() }
}
function Show-NoticeOrSave {
    param([string[]]$Lines, [string]$Title, [string]$ChildScript, [string]$PowerShellExe = '', [int]$ShownTimeoutSec = 45, [int]$AckTimeoutSec = 600, [string]$FallbackDir = '', [string]$FallbackName = 'WavWiz-SAVE-THEN-DELETE.txt')
    $result = [pscustomobject]@{ Mode = 'none'; Path = ''; Reason = ''; Restricted = $false }
    $tmp = [IO.Path]::GetTempPath(); $id = [guid]::NewGuid().ToString('N').Substring(0, 12)
    $transport = Join-Path $tmp "wavwiz-notice-$id.tmp"; $shownFile = Join-Path $tmp "wavwiz-notice-$id.shown"; $ackFile = Join-Path $tmp "wavwiz-notice-$id.ack"
    $child = $null; $reason = ''
    try {
        if (-not $PowerShellExe) { $PowerShellExe = Get-WindowsPowerShellExe }
        if (-not (Test-Path -LiteralPath $ChildScript)) { throw 'show-notice.ps1 was not found' }
        New-Item -ItemType File -Path $transport -Force | Out-Null
        [void](Protect-FileForCurrentUser $transport)
        Write-Utf8NoBom $transport ($Title + "`r`n" + ($Lines -join "`r`n`r`n"))
        $hostArgs = @('-NoProfile'); if ($PSVersionTable.PSEdition -eq 'Desktop') { $hostArgs += '-STA' }
        $argLine = Join-WinArgs ($hostArgs + @('-ExecutionPolicy', 'Bypass', '-File', $ChildScript, '-TextFile', $transport, '-ShownFile', $shownFile, '-AckFile', $ackFile))
        $sp = @{ FilePath = $PowerShellExe; ArgumentList = $argLine; PassThru = $true }
        if ($PSVersionTable.PSEdition -eq 'Desktop') { $sp.WindowStyle = 'Normal' }
        $child = Start-Process @sp
        Write-InstallLog "notice window: started in its own process (visible within $ShownTimeoutSec s, then up to $AckTimeoutSec s for the person)"
        $end = (Get-Date).AddSeconds($ShownTimeoutSec)
        while (-not (Test-Path -LiteralPath $shownFile) -and -not $child.HasExited -and (Get-Date) -lt $end) { Start-Sleep -Milliseconds 250 }
        if (-not (Test-Path -LiteralPath $shownFile)) { throw "the window did not appear (waited up to $ShownTimeoutSec s)" }
        Set-Step 'USER: a window with information for you is open - read it and click OK (10 minute limit)'
        $end = (Get-Date).AddSeconds($AckTimeoutSec)
        while (-not $child.HasExited -and (Get-Date) -lt $end) { Start-Sleep -Milliseconds 400 }
        if (-not $child.HasExited) { throw "no confirmation within $AckTimeoutSec s" }
        if (-not (Test-Path -LiteralPath $ackFile)) { throw 'the window was closed without confirming' }
        $result.Mode = 'window'
    } catch { $reason = $_.Exception.Message }
    finally {
        try { if ($child -and -not $child.HasExited) { Stop-ProcessTree $child } } catch { }
        Remove-FileShredded $transport
        foreach ($f in $shownFile, $ackFile) { try { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue } catch { } }
    }
    if ($result.Mode -eq 'window') { Write-InstallLog 'notice window: confirmed by the person (content not logged)'; return $result }
    $result.Reason = $reason
    try {
        $dir = if ($FallbackDir) { $FallbackDir } else { Get-NoticeFallbackDir }
        $path = Join-Path $dir $FallbackName
        Remove-FileShredded $path
        New-Item -ItemType File -Path $path -Force | Out-Null
        $restricted = Protect-FileForCurrentUser $path
        Write-Utf8NoBom $path ("$Title ($(Get-Date -Format s))`r`nRead it, keep what you need, then DELETE this file.`r`n`r`n" + ($Lines -join "`r`n`r`n") + "`r`n")
        $result.Mode = 'file'; $result.Path = $path; $result.Restricted = $restricted
        Write-InstallLog "notice window unavailable ($reason); text saved to $path (access limited to you and Administrators: $restricted; content not logged)"
    } catch { $result.Mode = 'failed'; $result.Reason = "$reason; saving to a file failed: $($_.Exception.Message)"; Write-InstallLog "notice could not be shown or saved: $($result.Reason)" }
    return $result
}

# ---- pre-flight (pure checks; nothing is touched). Returns Problems (stop) and Notes.
function Get-PreflightReport([string]$Root, [string]$Role) {
    $problems = New-Object System.Collections.Generic.List[string]; $notes = New-Object System.Collections.Generic.List[string]
    if ($Role -in 'server', 'both') {
        $d = Join-Path $Root 'Server'
        foreach ($rel in 'wavwiz-server.exe', 'ffmpeg\ffmpeg.exe', 'wwwroot\index.html') { if (-not (Test-Path -LiteralPath (Join-Path $d $rel))) { $problems.Add("missing from the install: Server\$rel (the copy step did not finish, or antivirus removed it)") } }
    }
    if ($Role -in 'player', 'both') {
        if (-not (Test-Path -LiteralPath (Join-Path (Join-Path $Root 'Player') 'wavwiz-player.exe'))) { $problems.Add('missing from the install: Player\wavwiz-player.exe') }
    }
    if ($Root -match '[^\x00-\x7F]') { $notes.Add('The install folder contains non-English characters; WavWiz supports that, but if anything fails please choose a plain folder such as C:\Program Files\WavWiz.') }
    return [pscustomobject]@{ Problems = $problems.ToArray(); Notes = $notes.ToArray() }
}

# ---- 0.0.3: in-place upgrade from "Unison" (0.0.1 / 0.0.2) to WavWiz -------------------------------------------------------------------------------------------
# Unison 0.0.x used the names: service UnisonServer, folder %ProgramData%\Unison, firewall rules "Unison Server (web, audio, clock)" (+ " (UDP)"), Run value UnisonPlayer,
# install folder ...\Unison with its own Inno uninstall entry. WavWiz is a NEW installer identity, so Setup cannot upgrade in place by itself: this function moves everything over.
# Rules: (1) nothing the person owns is ever deleted before it is safely in its new place; (2) every step is best-effort and logged; (3) running it again changes nothing;
# (4) the database, certificates, tokens, settings, admin password and library stay exactly as they were (certificates keep legacy names such as unison-root-ca.crt; 0.1.2 renames unison.db → wavwiz.db).
$script:LegacyServiceName = 'UnisonServer'
$script:LegacyFirewallNames = @('Unison Server (web, audio, clock)')
$script:LegacyUninstallSubKey = 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{B5C2D7E1-4F3A-4B8E-9C61-554E49534F4E}_is1'
$script:RunSubKey = 'SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
function Get-LegacyDataRoot { $pd = $env:ProgramData; if (-not $pd) { $pd = 'C:\ProgramData' }; return (Join-Path $pd 'Unison') }

# machine registry access: the real registry on Windows; a tiny text file ($WAVWIZ_TEST_STATE\registry.txt, lines "subkey|name|value") under the test shim
function Get-RegFile { return (Join-Path $env:WAVWIZ_TEST_STATE 'registry.txt') }
function Read-RegLines { $f = Get-RegFile; if (Test-Path -LiteralPath $f) { return @(Get-Content -LiteralPath $f) } else { return @() } }
function Get-MachineRegValue([string]$SubKey, [string]$Name) {
    if (Test-TestHost) {
        foreach ($l in (Read-RegLines)) { $p = $l -split '\|', 3; if ($p.Count -eq 3 -and $p[0] -eq $SubKey -and $p[1] -eq $Name) { return $p[2] } }
        return $null
    }
    try {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
        $k = $base.OpenSubKey($SubKey); if ($null -eq $k) { return $null }
        try { $v = $k.GetValue($Name); if ($null -eq $v) { return $null } else { return [string]$v } } finally { $k.Close() }
    } catch { return $null }
}
function Test-MachineRegKey([string]$SubKey) {
    if (Test-TestHost) { foreach ($l in (Read-RegLines)) { if (($l -split '\|', 3)[0] -eq $SubKey) { return $true } }; return $false }
    try {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
        $k = $base.OpenSubKey($SubKey); if ($null -eq $k) { return $false }; $k.Close(); return $true
    } catch { return $false }
}
function Remove-MachineRegValue([string]$SubKey, [string]$Name) {
    if (Test-TestHost) { $keep = @(Read-RegLines | Where-Object { $p = $_ -split '\|', 3; -not ($p[0] -eq $SubKey -and $p[1] -eq $Name) }); Set-Content -LiteralPath (Get-RegFile) -Value $keep; return }
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
    $k = $base.OpenSubKey($SubKey, $true); if ($null -ne $k) { try { $k.DeleteValue($Name, $false) } finally { $k.Close() } }
}
function Remove-MachineRegKey([string]$SubKey) {
    if (Test-TestHost) { $keep = @(Read-RegLines | Where-Object { ($_ -split '\|', 3)[0] -ne $SubKey }); Set-Content -LiteralPath (Get-RegFile) -Value $keep; return }
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
    $base.DeleteSubKeyTree($SubKey, $false)
}

# is this folder really an old Unison install (and not, say, the new install or a folder the person happens to have)?
function Test-LegacyInstallDir([string]$Dir, [string]$NewRoot) {
    if (-not $Dir -or -not (Test-Path -LiteralPath $Dir -PathType Container)) { return $false }
    $full = [IO.Path]::GetFullPath($Dir).TrimEnd('\', '/')
    if ($NewRoot -and ($full -eq [IO.Path]::GetFullPath($NewRoot).TrimEnd('\', '/'))) { return $false }
    if ($full.Length -le 3) { return $false }
    foreach ($m in 'unins000.exe', 'Server\unison-server.exe', 'Server/unison-server.exe', 'Player\unison-player.exe', 'Player/unison-player.exe') { if (Test-Path -LiteralPath (Join-Path $Dir $m)) { return $true } }
    return $false
}

# Moves everything in $From into $To without overwriting: a name that already exists in $To is kept there and the old one is renamed "<name>.from-unison".
function Merge-LegacyFolder([string]$From, [string]$To) {
    $moved = 0; $renamed = 0
    New-Item -ItemType Directory -Force -Path $To | Out-Null
    foreach ($item in @(Get-ChildItem -LiteralPath $From -Force)) {
        $dest = Join-Path $To $item.Name
        if (Test-Path -LiteralPath $dest) {
            if ($item.PSIsContainer) {
                [void](Merge-LegacyFolder -From $item.FullName -To $dest)   # sub-folders (logs\, artcache\) are merged the same way
                continue
            }
            $dest = $dest + '.from-unison'; $i = 1; while (Test-Path -LiteralPath $dest) { $i++; $dest = (Join-Path $To $item.Name) + '.from-unison' + $i }
            $renamed++
        }
        Move-Item -LiteralPath $item.FullName -Destination $dest -Force
        $moved++
    }
    if (@(Get-ChildItem -LiteralPath $From -Force).Count -eq 0) { Remove-Item -LiteralPath $From -Force }
    return [pscustomobject]@{ Moved = $moved; Renamed = $renamed }
}

function Test-LegacyPresent([string]$NewRoot) {
    if (Test-ServiceExists $script:LegacyServiceName) { return $true }
    if (Test-Path -LiteralPath (Get-LegacyDataRoot) -PathType Container) { return $true }
    if (Test-MachineRegKey $script:LegacyUninstallSubKey) { return $true }
    if ($null -ne (Get-MachineRegValue $script:RunSubKey 'UnisonPlayer')) { return $true }
    return $false
}

function Invoke-LegacyMigration {
    [CmdletBinding()]
    param([string]$NewRoot = '')
    $notes = New-Object System.Collections.Generic.List[string]
    if (-not (Test-LegacyPresent $NewRoot)) { Say 'Upgrade check: no earlier "Unison" installation found (nothing to migrate).'; return [pscustomobject]@{ Found = $false; Notes = $notes.ToArray() } }
    Say 'Upgrade: an earlier "Unison" installation was found. Moving it to WavWiz (your music library, settings, administrator password and paired players are kept).'
    $oldDir = Get-MachineRegValue $script:LegacyUninstallSubKey 'InstallLocation'
    if ($oldDir) { $oldDir = $oldDir.TrimEnd('\') }

    # 1. the old service and programs
    try {
        Set-Step 'upgrade: stopping the old Unison service'
        if (Test-ServiceExists $script:LegacyServiceName) {
            if ((Get-ServiceState $script:LegacyServiceName) -ne 'STOPPED') { [void](Invoke-Sc 'stop legacy' @('stop', $script:LegacyServiceName) -AllowFail); [void](Wait-ServiceState $script:LegacyServiceName 'STOPPED' 40) }
            [void](Invoke-Sc 'delete legacy' @('delete', $script:LegacyServiceName) -AllowFail); Say 'Old service UnisonServer removed.'
        }
        foreach ($exe in 'unison-server.exe', 'unison-player.exe') { [void](Invoke-Native -File (Get-SystemTool 'taskkill.exe') -ArgList @('/F', '/IM', $exe) -Label "taskkill $exe" -AllowFail -TimeoutSec 30) }
        Start-Sleep -Milliseconds 400
    } catch { $notes.Add("Could not fully stop the old Unison service: $($_.Exception.Message)"); Say $notes[$notes.Count - 1] }

    # 2. the old firewall rules (the new ones are added by the server install)
    try {
        Set-Step 'upgrade: removing the old firewall rules'
        $net = Get-SystemTool 'netsh.exe'
        foreach ($n in $script:LegacyFirewallNames) { foreach ($rn in @($n, "$n (UDP)")) { [void](Invoke-Native -File $net -ArgList @('advfirewall', 'firewall', 'delete', 'rule', "name=$rn") -Label 'netsh delete legacy rule' -AllowFail -TimeoutSec 30) } }
        Say 'Old Unison firewall rules removed.'
    } catch { $notes.Add("Could not remove the old firewall rules: $($_.Exception.Message)"); Say $notes[$notes.Count - 1] }

    # 3. the old autostart entry (the all-users one; each user's own entry is replaced by the new player when it starts)
    try { Remove-MachineRegValue $script:RunSubKey 'UnisonPlayer' } catch { Say "Could not remove the old autostart entry: $($_.Exception.Message)" }

    # 4. the data folder: %ProgramData%\Unison -> %ProgramData%\WavWiz (moved, not copied; merged if WavWiz already has files)
    $legacyData = Get-LegacyDataRoot; $newData = Get-WavWizDataRoot
    if (Test-Path -LiteralPath $legacyData -PathType Container) {
        Set-Step 'upgrade: moving your data from the Unison folder to the WavWiz folder'
        if ((Test-Path -LiteralPath (Join-Path $legacyData 'unison.db')) -and (Test-Path -LiteralPath (Join-Path $newData 'unison.db'))) {
            $m = "Both $legacyData and $newData contain a library database. The one in $newData is used; the old folder was left untouched in case you need it."
            $notes.Add($m); Say $m
        } else {
            try {
                $r = Merge-LegacyFolder -From $legacyData -To $newData
                Say ("Data moved: {0} item(s) from {1} to {2}{3}." -f $r.Moved, $legacyData, $newData, $(if ($r.Renamed) { " ($($r.Renamed) file(s) with the same name were kept as *.from-unison" + ')' } else { '' }))
            } catch {
                throw ("Could not move your WavWiz data from $legacyData to $newData : $($_.Exception.Message)`r`nNothing was deleted. Close any program that is using files in that folder (for example a text editor or a backup tool) and run the installer again.")
            }
        }
    } else { Say 'No Unison data folder to move (already moved, or none was created).' }

    # 5. the old program folder, its shortcuts and its uninstall entry (the data is already safe in the new folder)
    try {
        Set-Step 'upgrade: removing the old Unison program files'
        $cands = New-Object System.Collections.Generic.List[string]
        if ($oldDir) { $cands.Add($oldDir) }
        $pf = $env:ProgramFiles; if ($pf) { $cands.Add((Join-Path $pf 'Unison')) }
        $seen = @{}
        foreach ($d in $cands) {
            if ($seen.ContainsKey($d)) { continue }; $seen[$d] = $true
            if (Test-LegacyInstallDir $d $NewRoot) { Remove-Item -LiteralPath $d -Recurse -Force; Say "Old program folder removed: $d" }
            elseif (Test-Path -LiteralPath $d) { Say "Left alone (does not look like an old Unison install, or it is the new install folder): $d" }
        }
        $pd = $env:ProgramData; if (-not $pd) { $pd = 'C:\ProgramData' }
        $menu = Join-Path $pd 'Microsoft\Windows\Start Menu\Programs\Unison (BETA)'
        if (Test-Path -LiteralPath $menu -PathType Container) { Remove-Item -LiteralPath $menu -Recurse -Force; Say 'Old Start-menu group removed.' }
        $pub = $env:PUBLIC; if (-not $pub) { $pub = 'C:\Users\Public' }
        foreach ($lnk in (Join-Path $pub 'Desktop\Unison web page (BETA).url')) { if (Test-Path -LiteralPath $lnk) { Remove-Item -LiteralPath $lnk -Force } }
        if (Test-MachineRegKey $script:LegacyUninstallSubKey) { Remove-MachineRegKey $script:LegacyUninstallSubKey; Say 'Old "Unison" entry removed from Apps & features.' }
    } catch { $notes.Add("Could not remove some old Unison files: $($_.Exception.Message)"); Say $notes[$notes.Count - 1] }

    Say 'Upgrade from Unison finished.'
    return [pscustomobject]@{ Found = $true; Notes = $notes.ToArray() }
}
