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
function Get-StepFile { return (Join-Path (Get-WavWizDataRoot) 'current-step.txt') }
function Start-InstallLog([string]$Name = 'install.log') {
    $dir = Get-WavWizDataRoot
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $script:InstallLog = Join-Path $dir $Name
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

# Fresh installs use Local Service (least privilege). A reinstall keeps whatever account
# is already set, the same way bindAddress is preserved. Never silently reset to LocalService
# (or promote to LocalSystem).
$script:DefaultServiceAccount = 'NT AUTHORITY\LocalService'
function Get-ServiceAccount([string]$Name) {
    $r = Invoke-Sc 'query config' @('qc', $Name) -AllowFail
    if ($r.ExitCode -ne 0) { return $null }
    $m = [regex]::Match([string]$r.Output, 'SERVICE_START_NAME\s*:\s*(.+)')
    if (-not $m.Success) { return $null }
    $acct = $m.Groups[1].Value.Trim()
    if (-not $acct) { return $null }
    return $acct
}
# 0.7.0 item 3: sc qc prints "LocalSystem"; services.msc / other tools may have written ".\LocalSystem" or "NT AUTHORITY\SYSTEM".
function Test-LocalSystemAccount([string]$Account) {
    $a = ([string]$Account).Trim()
    return ($a -ieq 'LocalSystem' -or $a -ieq '.\LocalSystem' -or $a -ieq 'NT AUTHORITY\SYSTEM' -or $a -ieq 'SYSTEM')
}
# New installs: LocalService (least privilege). An upgrade keeps the account the service has (never forced).
# 0.7.0 item 3: -SwitchToLocalService (Setup checkbox, shown only for an existing LocalSystem service, default off) moves a LocalSystem
# service to LocalService; any other account (LocalService already, a user account, NetworkService) is still kept.
function Get-InstallServiceAccount([string]$Name, [bool]$Exists, [bool]$SwitchToLocalService = $false) {
    if ($Exists) {
        $acct = Get-ServiceAccount $Name
        if ($acct -and $SwitchToLocalService -and (Test-LocalSystemAccount $acct)) { return [pscustomobject]@{ Account = $script:DefaultServiceAccount; Action = 'switched'; From = $acct } }
        if ($acct) { return [pscustomobject]@{ Account = $acct; Action = 'preserved' } }
        Write-InstallLog 'service account was not readable from sc.exe qc; defaulting to LocalService'
    }
    return [pscustomobject]@{ Account = $script:DefaultServiceAccount; Action = 'default' }
}

# ---- firewall (netsh advfirewall: no CIM, bounded). Rules are Private-profile, local-subnet only, scoped to the server program. Delete-then-add = idempotent.
function Set-ServerFirewall([string]$Exe, [int[]]$TcpPorts, [int[]]$UdpPorts) {
    $net = Get-SystemTool 'netsh.exe'; $name = $script:FirewallNames[0]
    [void](Invoke-Native -File $net -ArgList @('advfirewall', 'firewall', 'delete', 'rule', "name=$name") -Label 'netsh delete old rule' -AllowFail -TimeoutSec 30)
    [void](Invoke-Native -File $net -ArgList @('advfirewall', 'firewall', 'delete', 'rule', "name=$name (UDP)") -Label 'netsh delete old UDP rule' -AllowFail -TimeoutSec 30)
    [void](Invoke-Native -File $net -ArgList @('advfirewall', 'firewall', 'add', 'rule', "name=$name", 'dir=in', 'action=allow', 'protocol=TCP', ('localport=' + ($TcpPorts -join ',')), 'profile=private', 'remoteip=localsubnet', "program=$Exe", 'enable=yes') -Label 'netsh add TCP rule' -TimeoutSec 30)
    [void](Invoke-Native -File $net -ArgList @('advfirewall', 'firewall', 'add', 'rule', "name=$name (UDP)", 'dir=in', 'action=allow', 'protocol=UDP', ('localport=' + ($UdpPorts -join ',')), 'profile=private', 'remoteip=localsubnet', "program=$Exe", 'enable=yes') -Label 'netsh add UDP rule' -TimeoutSec 30)
}
# F268: all-networks choice -> one extra web rule for Tailscale/VPN peers (100.64.0.0/10), scoped to the server program and its web ports.
$script:VpnFirewallName = 'WavWiz Server (Tailscale/VPN web)'
# F268b: a wildcard bind (0.0.0.0 / ::) is a LISTEN address, never a host to connect to.
function Test-WildcardBind([string]$Bind) { return ($Bind.Trim('[', ']') -in @('0.0.0.0', '::')) }
# local readiness probes on this PC: wildcard -> 127.0.0.1 (the server listens there too)
function Get-ProbeHost([string]$Bind) { if (Test-WildcardBind $Bind) { return '127.0.0.1' }; return $Bind }
# what a person / another PC / the local player is told to connect to: wildcard -> this PC's LAN address (127.0.0.1 if none found)
function Get-ConnectHost([string]$Bind) { if (Test-WildcardBind $Bind) { $ip = ''; try { $ip = Get-LanIPv4 10 } catch { }; if ($ip) { return $ip }; return '127.0.0.1' }; return $Bind }
function Test-AllNetworksConfig($Config) { return ([string]$Config['bindAddress'] -in @('0.0.0.0', '::', '[::]')) }
function Set-ServerVpnFirewall([string]$Exe, [int[]]$TcpPorts, [bool]$Enable) {
    $net = Get-SystemTool 'netsh.exe'
    [void](Invoke-Native -File $net -ArgList @('advfirewall', 'firewall', 'delete', 'rule', "name=$($script:VpnFirewallName)") -Label 'netsh delete old Tailscale/VPN rule' -AllowFail -TimeoutSec 30)
    if ($Enable) { [void](Invoke-Native -File $net -ArgList @('advfirewall', 'firewall', 'add', 'rule', "name=$($script:VpnFirewallName)", 'dir=in', 'action=allow', 'protocol=TCP', ('localport=' + ($TcpPorts -join ',')), 'profile=private,public', 'remoteip=100.64.0.0/10', "program=$Exe", 'enable=yes') -Label 'netsh add Tailscale/VPN rule' -TimeoutSec 30) }
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
# 0.4.9 fix: the TCP rules are program-only (any port) - the per-zone receivers (0.4.0) use their own RTSP / zeroconf ports, which a
# localport=47804 / 47805 rule blocked; shairplay's UDP audio / control / timing ports are random, so UDP was already program-only.
$script:ReceiverFirewallNames = @('WavWiz AirPlay receiver', 'WavWiz AirPlay receiver (UDP)', 'WavWiz Spotify Connect', 'WavWiz Spotify Connect (mDNS)')
function Set-ReceiverFirewall([string]$ServerExe, $Config) {
    $net = Get-SystemTool 'netsh.exe'; $rdir = Join-Path (Split-Path -Parent $ServerExe) 'receivers'
    foreach ($n in $script:ReceiverFirewallNames) { [void](Invoke-Native -File $net -ArgList @('advfirewall', 'firewall', 'delete', 'rule', "name=$n") -Label 'netsh delete old receiver rule' -AllowFail -TimeoutSec 30) }
    $airplay = Join-Path $rdir 'wavwiz-airplay.exe'; $librespot = Join-Path $rdir 'librespot.exe'
    $common = @('dir=in', 'action=allow', 'profile=private', 'remoteip=localsubnet', 'enable=yes')
    [void](Invoke-Native -File $net -ArgList (@('advfirewall', 'firewall', 'add', 'rule', ('name=' + $script:ReceiverFirewallNames[0]), 'protocol=TCP', "program=$airplay") + $common) -Label 'netsh add AirPlay TCP rule' -TimeoutSec 30)
    [void](Invoke-Native -File $net -ArgList (@('advfirewall', 'firewall', 'add', 'rule', ('name=' + $script:ReceiverFirewallNames[1]), 'protocol=UDP', "program=$airplay") + $common) -Label 'netsh add AirPlay UDP rule' -TimeoutSec 30)
    [void](Invoke-Native -File $net -ArgList (@('advfirewall', 'firewall', 'add', 'rule', ('name=' + $script:ReceiverFirewallNames[2]), 'protocol=TCP', "program=$librespot") + $common) -Label 'netsh add Spotify Connect rule' -TimeoutSec 30)
    [void](Invoke-Native -File $net -ArgList (@('advfirewall', 'firewall', 'add', 'rule', ('name=' + $script:ReceiverFirewallNames[3]), 'protocol=UDP', 'localport=5353', "program=$librespot") + $common) -Label 'netsh add Spotify Connect mDNS rule' -TimeoutSec 30)
}
# 0.6.8-#14g: OPT-IN rules for sending to AirPlay speakers (AirPlay 2 needs PTP on the fixed UDP ports 319-320; the AirPlay 1/2 audio,
# control and timing ports are ephemeral). Same style: Private profile, local subnet only, scoped to the server program. Delete-then-add
# = idempotent; not chosen -> the rules are removed. The two older hand-made rules from Settings > AirPlay speakers are replaced.
$script:AirPlayOutFirewallNames = @('WavWiz AirPlay speakers (PTP)', 'WavWiz AirPlay speakers (audio)')
$script:AirPlayOutLegacyNames = @('WavWiz AirPlay PTP', 'WavWiz AirPlay audio')
function Set-AirPlayOutFirewall([string]$Exe, [bool]$Enable) {
    $net = Get-SystemTool 'netsh.exe'
    foreach ($n in $script:AirPlayOutFirewallNames) { [void](Invoke-Native -File $net -ArgList @('advfirewall', 'firewall', 'delete', 'rule', "name=$n") -Label 'netsh delete old AirPlay speakers rule' -AllowFail -TimeoutSec 30) }
    if (-not $Enable) { return }
    foreach ($n in $script:AirPlayOutLegacyNames) { [void](Invoke-Native -File $net -ArgList @('advfirewall', 'firewall', 'delete', 'rule', "name=$n") -Label 'netsh delete hand-made AirPlay rule' -AllowFail -TimeoutSec 30) }
    $common = @('dir=in', 'action=allow', 'profile=private', 'remoteip=localsubnet', "program=$Exe", 'enable=yes')
    [void](Invoke-Native -File $net -ArgList (@('advfirewall', 'firewall', 'add', 'rule', ('name=' + $script:AirPlayOutFirewallNames[0]), 'protocol=UDP', 'localport=319-320') + $common) -Label 'netsh add AirPlay speakers PTP rule' -TimeoutSec 30)
    [void](Invoke-Native -File $net -ArgList (@('advfirewall', 'firewall', 'add', 'rule', ('name=' + $script:AirPlayOutFirewallNames[1]), 'protocol=UDP') + $common) -Label 'netsh add AirPlay speakers audio rule' -TimeoutSec 30)
}
function Remove-ServerFirewall {
    $net = Get-SystemTool 'netsh.exe'; $name = $script:FirewallNames[0]
    foreach ($n in @($name, "$name (UDP)", $script:VpnFirewallName) + $script:ReceiverFirewallNames + $script:AirPlayOutFirewallNames + $script:AirPlayOutLegacyNames) { [void](Invoke-Native -File $net -ArgList @('advfirewall', 'firewall', 'delete', 'rule', "name=$n") -Label 'netsh delete rule' -AllowFail -TimeoutSec 30) }
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

# ---- CD-ROM read access for NT SERVICE\WavWizServer (least privilege; not LocalSystem) ----
# Opening \\.\E: checks the CD-ROM device object's DACL (\Device\CdRomN). By default that
# DACL allows Administrators and Interactive Users (and System), not LocalService; SetNamedSecurityInfo
# on the live object does not survive reboot. Class security (SPCRP_SECURITY_SDS on the CDROM setup
# class {4d36e965-e325-11ce-bfc1-08002be10318}) is persistent and applies to new instances (replug).
# The per-service SID is only in the process token when sidtype is unrestricted (default is none).
$script:CdromClassGuid = '4d36e965-e325-11ce-bfc1-08002be10318'
$script:CdromAccessRights = 'GR'
# Fallback DACL used only when the class has no Security value and no live device SDDL can be read.
# Matches the Vista+ IMAPI default: System + Administrators + Interactive Users (read/write/execute).
$script:CdromClassSecurityFallback = 'D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGWGX;;;IU)'
$script:CdromSecurityRegKey = 'SOFTWARE\WavWiz'
$script:CdromSecurityBackupName = 'CdromClassSecurityBackup'
$script:CdromSecurityBaseName = 'CdromClassSecurityBase'
$script:CdromSecurityUnset = 'UNSET'

# S-1-5-80 + SHA-1(UTF-16LE uppercase service name) as five little-endian DWORDs (per-service SID).
function Get-WavWizServiceSid([string]$ServiceName = $script:ServiceName) {
    $sha = [Security.Cryptography.SHA1]::Create()
    try {
        $hash = $sha.ComputeHash([Text.Encoding]::Unicode.GetBytes($ServiceName.ToUpperInvariant()))
        $ids = New-Object string[] 5
        for ($i = 0; $i -lt 5; $i++) { $ids[$i] = [BitConverter]::ToUInt32($hash, $i * 4).ToString() }
        return 'S-1-5-80-' + ($ids -join '-')
    } finally { $sha.Dispose() }
}

function Get-SddlAllowAcesForSid([string]$Sddl, [string]$Sid) {
    $list = New-Object System.Collections.Generic.List[string]
    if ([string]::IsNullOrWhiteSpace($Sddl) -or [string]::IsNullOrWhiteSpace($Sid)) { return ,$list.ToArray() }
    $rx = [regex]('\(A;[^;]*;[^;]*;[^;]*;[^;]*;' + [regex]::Escape($Sid) + '(?:;[^)]*)?\)')
    foreach ($m in $rx.Matches($Sddl)) { $list.Add($m.Value) }
    return ,$list.ToArray()
}
function Test-SddlAllowsSid([string]$Sddl, [string]$Sid) {
    if ([string]::IsNullOrWhiteSpace($Sddl) -or [string]::IsNullOrWhiteSpace($Sid)) { return $false }
    return [regex]::IsMatch($Sddl, '\(A;[^;]*;[^;]*;[^;]*;[^;]*;' + [regex]::Escape($Sid) + '(?:;[^)]*)?\)')
}
function Test-SddlEmptyDacl([string]$Sddl) {
    if ([string]::IsNullOrWhiteSpace($Sddl)) { return $true }
    return -not [regex]::IsMatch($Sddl, '\([A-Z]+;')
}
function Add-SddlAllowAce([string]$Sddl, [string]$Sid, [string]$Rights = 'GR') {
    if (Test-SddlAllowsSid $Sddl $Sid) { return $Sddl }
    $ace = '(A;;' + $Rights + ';;;' + $Sid + ')'
    $base = $Sddl
    if ([string]::IsNullOrWhiteSpace($base)) { $base = $script:CdromClassSecurityFallback }
    $dm = [regex]::Match($base, 'D:')
    if ($dm.Success) {
        $sacl = $base.IndexOf('S:', $dm.Index)
        if ($sacl -ge 0) { return $base.Substring(0, $sacl) + $ace + $base.Substring($sacl) }
        return $base + $ace
    }
    return $base + 'D:P' + $ace
}
function Remove-SddlAllowAce([string]$Sddl, [string]$Sid) {
    if ([string]::IsNullOrWhiteSpace($Sddl)) { return $Sddl }
    $out = $Sddl
    foreach ($a in (Get-SddlAllowAcesForSid $Sddl $Sid)) { $out = $out.Replace($a, '') }
    return $out
}

# Pure: decide the class SDDL to write and whether to record a first-time backup.
function Get-CdromClassGrantPlan {
    param([string]$ClassSddl, [string]$LiveSddl, [string]$ExistingBackup, [string]$Sid)
    $classSet = -not [string]::IsNullOrWhiteSpace($ClassSddl)
    if ($classSet) {
        $base = Remove-SddlAllowAce $ClassSddl $Sid
        if (Test-SddlEmptyDacl $base) { $base = $script:CdromClassSecurityFallback }
    } elseif (-not [string]::IsNullOrWhiteSpace($LiveSddl)) {
        $base = Remove-SddlAllowAce $LiveSddl $Sid
        if (Test-SddlEmptyDacl $base) { $base = $script:CdromClassSecurityFallback }
    } else {
        $base = $script:CdromClassSecurityFallback
    }
    $newSddl = Add-SddlAllowAce $base $Sid
    $already = $classSet -and (Test-SddlAllowsSid $ClassSddl $Sid)
    $backup = $ExistingBackup
    $writeBackup = [string]::IsNullOrWhiteSpace($ExistingBackup)
    if ($writeBackup) {
        if (-not $classSet) { $backup = $script:CdromSecurityUnset }
        elseif ($already) {
            $without = Remove-SddlAllowAce $ClassSddl $Sid
            if (Test-SddlEmptyDacl $without) { $backup = $script:CdromSecurityUnset } else { $backup = $without }
        } else { $backup = $ClassSddl }
    }
    return [pscustomobject]@{ Base = $base; NewSddl = $newSddl; Backup = $backup; WriteBackup = $writeBackup; WriteClass = (-not $already); AlreadyGranted = $already }
}

# Pure: on uninstall, drop only our ACE and restore a previously-unset class Security value when we can.
function Get-CdromClassRevokePlan {
    param([string]$ClassSddl, [string]$Backup, [string]$Base, [string]$Sid)
    $without = Remove-SddlAllowAce $ClassSddl $Sid
    $clear = $false
    $restore = $null
    if ($Backup -eq $script:CdromSecurityUnset) {
        if ((Test-SddlEmptyDacl $without) -or ($Base -and $without -eq $Base) -or $without -eq $script:CdromClassSecurityFallback) { $clear = $true }
        else { $restore = $without }
    } elseif ($Backup) {
        if (Test-SddlEmptyDacl $without) { $restore = $Backup } else { $restore = $without }
    } else {
        if (Test-SddlEmptyDacl $without) { $clear = $true } else { $restore = $without }
    }
    if ([string]::IsNullOrWhiteSpace($ClassSddl) -and $clear) { $restore = $null }
    return [pscustomobject]@{ ClearClass = $clear; NewSddl = $restore; RemoveBackup = $true }
}

function Get-ServiceSidType([string]$Name = $script:ServiceName) {
    $r = Invoke-Sc 'query sidtype' @('qsidtype', $Name) -AllowFail
    if ($r.ExitCode -ne 0) { return 'missing' }
    $t = [string]$r.Output
    if ($t -match 'UNRESTRICTED') { return 'UNRESTRICTED' }
    if ($t -match 'RESTRICTED') { return 'RESTRICTED' }
    if ($t -match '\bNONE\b') { return 'NONE' }
    return 'unknown'
}
function Set-WavWizServiceSidType([string]$Name = $script:ServiceName) {
    [void](Invoke-Sc 'sidtype unrestricted' @('sidtype', $Name, 'unrestricted'))
    $got = Get-ServiceSidType $Name
    Write-InstallLog ("service SID type for {0}: {1} (NT SERVICE\{0} is in the process token only when this is UNRESTRICTED; default is NONE). Microsoft documents that the change takes effect the next time the system is started; it is also applied when the service process is created." -f $Name, $got)
    if ($got -ne 'UNRESTRICTED') { Write-InstallLog ("warning: expected SERVICE SID TYPE UNRESTRICTED, got $got") }
    return $got
}

function Initialize-WavWizCdromApi {
    if (Test-TestHost) { return }
    if ('WavWiz.CdromSec' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
namespace WavWiz {
  public static class CdromSec {
    public const int SPCRP_SECURITY_SDS = 24;
    public const uint DACL_SECURITY_INFORMATION = 4;
    public const uint OWNER_SECURITY_INFORMATION = 1;
    public const uint GROUP_SECURITY_INFORMATION = 2;
    public const int SE_FILE_OBJECT = 1;
    public const uint SDDL_REVISION_1 = 1;
    public const int ERROR_INSUFFICIENT_BUFFER = 122;

    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool SetupDiGetClassRegistryPropertyW(ref Guid ClassGuid, uint Property, IntPtr PropertyRegDataType, byte[] PropertyBuffer, uint PropertyBufferSize, out uint RequiredSize, string MachineName, IntPtr Reserved);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool SetupDiSetClassRegistryPropertyW(ref Guid ClassGuid, uint Property, byte[] PropertyBuffer, uint PropertyBufferSize, string MachineName, IntPtr Reserved);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint GetNamedSecurityInfoW(string pObjectName, int ObjectType, uint SecurityInfo, IntPtr ppsidOwner, IntPtr ppsidGroup, IntPtr ppDacl, IntPtr ppSacl, out IntPtr ppSecurityDescriptor);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint SetNamedSecurityInfoW(string pObjectName, int ObjectType, uint SecurityInfo, IntPtr psidOwner, IntPtr psidGroup, IntPtr pDacl, IntPtr pSacl);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool ConvertSecurityDescriptorToStringSecurityDescriptorW(IntPtr SecurityDescriptor, uint RequestedStringSDRevision, uint SecurityInformation, out IntPtr StringSecurityDescriptor, out uint StringSecurityDescriptorLen);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string StringSecurityDescriptor, uint StringSDRevision, out IntPtr SecurityDescriptor, IntPtr SecurityDescriptorSize);
    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool GetSecurityDescriptorDacl(IntPtr pSecurityDescriptor, out bool lpbDaclPresent, out IntPtr pDacl, out bool lpbDaclDefaulted);
    [DllImport("kernel32.dll")]
    public static extern IntPtr LocalFree(IntPtr hMem);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint QueryDosDeviceW(string lpDeviceName, StringBuilder lpTargetPath, int ucchMax);

    public static string GetClassSecuritySds(Guid classGuid) {
      uint needed = 0;
      Guid g = classGuid;
      bool ok = SetupDiGetClassRegistryPropertyW(ref g, (uint)SPCRP_SECURITY_SDS, IntPtr.Zero, null, 0, out needed, null, IntPtr.Zero);
      int err = Marshal.GetLastWin32Error();
      if (!ok && err != ERROR_INSUFFICIENT_BUFFER) return null;
      if (needed == 0) return null;
      byte[] buf = new byte[needed];
      if (!SetupDiGetClassRegistryPropertyW(ref g, (uint)SPCRP_SECURITY_SDS, IntPtr.Zero, buf, needed, out needed, null, IntPtr.Zero))
        throw new Win32Exception(Marshal.GetLastWin32Error(), "SetupDiGetClassRegistryProperty SECURITY_SDS");
      return Encoding.Unicode.GetString(buf).TrimEnd('\0');
    }
    public static void SetClassSecuritySds(Guid classGuid, string sddl) {
      Guid g = classGuid;
      if (string.IsNullOrEmpty(sddl)) {
        if (!SetupDiSetClassRegistryPropertyW(ref g, (uint)SPCRP_SECURITY_SDS, null, 0, null, IntPtr.Zero))
          throw new Win32Exception(Marshal.GetLastWin32Error(), "SetupDiSetClassRegistryProperty SECURITY_SDS clear");
        return;
      }
      byte[] buf = Encoding.Unicode.GetBytes(sddl + '\0');
      if (!SetupDiSetClassRegistryPropertyW(ref g, (uint)SPCRP_SECURITY_SDS, buf, (uint)buf.Length, null, IntPtr.Zero))
        throw new Win32Exception(Marshal.GetLastWin32Error(), "SetupDiSetClassRegistryProperty SECURITY_SDS write");
    }
    public static string GetNamedSddl(string path) {
      IntPtr psd;
      uint r = GetNamedSecurityInfoW(path, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, out psd);
      if (r != 0) throw new Win32Exception((int)r, "GetNamedSecurityInfo " + path);
      try {
        IntPtr s; uint len;
        if (!ConvertSecurityDescriptorToStringSecurityDescriptorW(psd, SDDL_REVISION_1, OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION, out s, out len))
          throw new Win32Exception(Marshal.GetLastWin32Error(), "ConvertSecurityDescriptorToStringSecurityDescriptor");
        try { return Marshal.PtrToStringUni(s); }
        finally { LocalFree(s); }
      } finally { LocalFree(psd); }
    }
    public static void SetNamedSddlDacl(string path, string sddl) {
      IntPtr psd;
      if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, SDDL_REVISION_1, out psd, IntPtr.Zero))
        throw new Win32Exception(Marshal.GetLastWin32Error(), "ConvertStringSecurityDescriptorToSecurityDescriptor");
      try {
        bool present, defd; IntPtr dacl;
        if (!GetSecurityDescriptorDacl(psd, out present, out dacl, out defd))
          throw new Win32Exception(Marshal.GetLastWin32Error(), "GetSecurityDescriptorDacl");
        uint r = SetNamedSecurityInfoW(path, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, IntPtr.Zero, IntPtr.Zero, dacl, IntPtr.Zero);
        if (r != 0) throw new Win32Exception((int)r, "SetNamedSecurityInfo " + path);
      } finally { LocalFree(psd); }
    }
    public static bool DosDeviceExists(string name) {
      StringBuilder sb = new StringBuilder(1024);
      return QueryDosDeviceW(name, sb, sb.Capacity) != 0;
    }
  }
}
'@
}

function Get-CdromLiveStateFile { return (Join-Path $env:WAVWIZ_TEST_STATE 'cdrom-live.txt') }
function Get-CdromClassStateFile { return (Join-Path $env:WAVWIZ_TEST_STATE 'cdrom-class-sds.txt') }

function Get-CdromClassSecuritySds {
    if (Test-TestHost) {
        $f = Get-CdromClassStateFile
        if (-not (Test-Path -LiteralPath $f)) { return $null }
        $t = ([IO.File]::ReadAllText($f)).Trim()
        if (-not $t) { return $null }
        return $t
    }
    Initialize-WavWizCdromApi
    return [WavWiz.CdromSec]::GetClassSecuritySds([guid]$script:CdromClassGuid)
}
function Set-CdromClassSecuritySds([AllowNull()][string]$Sddl) {
    if (Test-TestHost) {
        $f = Get-CdromClassStateFile
        if ([string]::IsNullOrEmpty($Sddl)) { if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force }; return }
        Write-Utf8NoBom $f $Sddl
        return
    }
    Initialize-WavWizCdromApi
    [WavWiz.CdromSec]::SetClassSecuritySds([guid]$script:CdromClassGuid, $Sddl)
}

function Get-CdromDevicePaths {
    $paths = New-Object System.Collections.Generic.List[string]
    if (Test-TestHost) {
        $f = Get-CdromLiveStateFile
        if (Test-Path -LiteralPath $f) {
            foreach ($l in @(Get-Content -LiteralPath $f)) {
                $p = ($l -split '\|', 2)[0]
                if ($p -and -not $paths.Contains($p)) { $paths.Add($p) }
            }
        }
        return ,$paths.ToArray()
    }
    Initialize-WavWizCdromApi
    try {
        foreach ($d in [IO.DriveInfo]::GetDrives()) {
            if ($d.DriveType -eq [IO.DriveType]::CDRom) {
                $p = '\\.\' + $d.Name.TrimEnd('\')
                if (-not $paths.Contains($p)) { $paths.Add($p) }
            }
        }
    } catch { }
    for ($i = 0; $i -le 15; $i++) {
        $n = 'CdRom' + $i
        try {
            if ([WavWiz.CdromSec]::DosDeviceExists($n)) {
                $p = '\\.\' + $n
                if (-not $paths.Contains($p)) { $paths.Add($p) }
            }
        } catch { }
    }
    return ,$paths.ToArray()
}

function Get-CdromObjectSddl([string]$Path) {
    if (Test-TestHost) {
        $f = Get-CdromLiveStateFile
        if (Test-Path -LiteralPath $f) {
            foreach ($l in @(Get-Content -LiteralPath $f)) {
                $parts = $l -split '\|', 2
                if ($parts.Count -eq 2 -and $parts[0] -eq $Path) { return $parts[1] }
            }
        }
        return $null
    }
    Initialize-WavWizCdromApi
    return [WavWiz.CdromSec]::GetNamedSddl($Path)
}
function Set-CdromObjectSddl([string]$Path, [string]$Sddl) {
    if (Test-TestHost) {
        $f = Get-CdromLiveStateFile
        $keep = @()
        if (Test-Path -LiteralPath $f) {
            foreach ($l in @(Get-Content -LiteralPath $f)) {
                $parts = $l -split '\|', 2
                if ($parts.Count -ge 1 -and $parts[0] -ne $Path) { $keep += $l }
            }
        }
        $keep += ($Path + '|' + $Sddl)
        Write-Utf8NoBom $f (($keep -join "`n") + "`n")
        return
    }
    Initialize-WavWizCdromApi
    [WavWiz.CdromSec]::SetNamedSddlDacl($Path, $Sddl)
}

function Grant-WavWizCdromAccess {
    $sid = Get-WavWizServiceSid
    Write-InstallLog ("CD-ROM access: granting GENERIC_READ to NT SERVICE\{0} ({1}) on the CDROM class and any live CD-ROM devices" -f $script:ServiceName, $sid)
    $alloc = Get-MachineRegValue 'SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' 'AllocateCDRoms'
    $allocShown = $(if ($null -eq $alloc -or $alloc -eq '') { '(not set; default is Disabled)' } else { $alloc })
    Write-InstallLog ("AllocateCDRoms (Devices: Restrict CD-ROM access to locally logged-on user only): " + $allocShown)
    if ($alloc -eq '1') { Say 'NOTE: the policy "Devices: Restrict CD-ROM access to locally logged-on user only" is enabled. A service may still be unable to read CDs while someone is logged on at the console.' }

    $class = Get-CdromClassSecuritySds
    $liveSddl = $null
    $livePaths = @(Get-CdromDevicePaths)
    foreach ($p in $livePaths) {
        try {
            $s = Get-CdromObjectSddl $p
            Write-InstallLog ("CD-ROM live SDDL {0}: {1}" -f $p, $s)
            if (-not $liveSddl -and $s) { $liveSddl = $s }
        } catch { Write-InstallLog ("CD-ROM live read {0}: {1}" -f $p, $_.Exception.Message) }
    }
    $existingBackup = Get-MachineRegValue $script:CdromSecurityRegKey $script:CdromSecurityBackupName
    $plan = Get-CdromClassGrantPlan -ClassSddl $class -LiveSddl $liveSddl -ExistingBackup $existingBackup -Sid $sid
    if ($plan.WriteBackup) {
        Set-MachineRegValue $script:CdromSecurityRegKey $script:CdromSecurityBackupName $plan.Backup
        Set-MachineRegValue $script:CdromSecurityRegKey $script:CdromSecurityBaseName $plan.Base
        Write-InstallLog ("CD-ROM class security backup: " + $plan.Backup)
        Write-InstallLog ("CD-ROM class security base: " + $plan.Base)
    }
    if ($plan.WriteClass) {
        Set-CdromClassSecuritySds $plan.NewSddl
        Write-InstallLog ("CD-ROM class security written: " + $plan.NewSddl)
        Say 'Granted the WavWiz service read access to CD-ROM drives (kept until uninstall).'
    } else {
        Write-InstallLog 'CD-ROM class security already includes the WavWiz service SID; left as-is.'
    }
    foreach ($p in $livePaths) {
        try {
            $cur = Get-CdromObjectSddl $p
            $neu = Add-SddlAllowAce $cur $sid
            if ($neu -ne $cur) {
                Set-CdromObjectSddl $p $neu
                Write-InstallLog ("CD-ROM live grant {0}: {1}" -f $p, $neu)
            } else { Write-InstallLog ("CD-ROM live already granted: " + $p) }
        } catch { Write-InstallLog ("CD-ROM live grant {0} failed: {1}" -f $p, $_.Exception.Message) }
    }
}

function Revoke-WavWizCdromAccess {
    try {
        $sid = Get-WavWizServiceSid
        $class = $null
        try { $class = Get-CdromClassSecuritySds } catch { Write-InstallLog ("CD-ROM class read on uninstall: " + $_.Exception.Message) }
        $backup = Get-MachineRegValue $script:CdromSecurityRegKey $script:CdromSecurityBackupName
        $base = Get-MachineRegValue $script:CdromSecurityRegKey $script:CdromSecurityBaseName
        $plan = Get-CdromClassRevokePlan -ClassSddl $class -Backup $backup -Base $base -Sid $sid
        if ($plan.ClearClass) {
            Set-CdromClassSecuritySds $null
            Write-InstallLog 'CD-ROM class security restored (value removed; it was not set before WavWiz).'
        } elseif ($null -ne $plan.NewSddl) {
            Set-CdromClassSecuritySds $plan.NewSddl
            Write-InstallLog ("CD-ROM class security restored: " + $plan.NewSddl)
        } else {
            Write-InstallLog 'CD-ROM class security: nothing to revoke.'
        }
        foreach ($p in @(Get-CdromDevicePaths)) {
            try {
                $cur = Get-CdromObjectSddl $p
                $neu = Remove-SddlAllowAce $cur $sid
                if ($neu -ne $cur) { Set-CdromObjectSddl $p $neu; Write-InstallLog ("CD-ROM live revoke: " + $p) }
            } catch { Write-InstallLog ("CD-ROM live revoke {0} failed: {1}" -f $p, $_.Exception.Message) }
        }
        try { Remove-MachineRegValue $script:CdromSecurityRegKey $script:CdromSecurityBackupName } catch { }
        try { Remove-MachineRegValue $script:CdromSecurityRegKey $script:CdromSecurityBaseName } catch { }
        Say 'Removed the WavWiz service CD-ROM read grant.'
    } catch { Write-InstallLog ("Revoke-WavWizCdromAccess: " + $_.Exception.Message) }
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
    param([string]$ExistingJson, [string]$LanIp, [string]$FfmpegPath, [int]$HttpPort, [int]$HttpsPort, [int]$AudioPort, [int]$ClockPort, [switch]$AllInterfaces)
    $notes = New-Object System.Collections.Generic.List[string]; $cfg = [ordered]@{}; $existing = $false; $changed = $false
    if ($ExistingJson -and $ExistingJson.Trim()) {
        try { $cfg = ConvertTo-HashtableDeep (($ExistingJson.TrimStart([char]0xFEFF)) | ConvertFrom-Json); $existing = $true } catch { throw "server.json exists but is not valid JSON ($($_.Exception.Message)); it was left untouched. Fix or delete it, then run the installer again." }
        if ($null -eq $cfg) { $cfg = [ordered]@{} }
    }
    $has = { param($k) $cfg.Contains($k) -and $null -ne $cfg[$k] -and "$($cfg[$k])" -ne '' }
    # bind address: 0.0.0.0 only via -AllInterfaces (the wizard's explicit all-networks choice, F268); an opt-in in server.json is preserved when -LanIp is omitted.
    # Explicit -LanIp (a single usable IPv4) may override. Missing/invalid existing bind is handled safely (loopback), never widened to all-interfaces or a guessed LAN here.
    $bindAction = 'none'
    $prevBind = $(if (& $has 'bindAddress') { [string]$cfg['bindAddress'] } else { '' })
    $prevBindOk = $prevBind -and (Test-IPv4 $prevBind)   # includes opted-in 0.0.0.0
    if ($AllInterfaces) {
        # F268: the wizard's 'Home network + Tailscale/VPN (all networks)' choice. Only ever from that explicit choice (or a preserved
        # existing all-networks bind); never from LAN detection. Adds the Tailscale/CGNAT range to extraAllowedSubnets when missing.
        $isAll = ($prevBind -eq '0.0.0.0') -and ("$($cfg['allowAllInterfaces'])" -eq 'True')
        if ($prevBind -ne '0.0.0.0') { $cfg['bindAddress'] = '0.0.0.0'; $changed = $true }
        if ("$($cfg['allowAllInterfaces'])" -ne 'True') { $cfg['allowAllInterfaces'] = $true; $changed = $true }
        $subs = @(); if ($cfg.Contains('extraAllowedSubnets') -and $null -ne $cfg['extraAllowedSubnets']) { $subs = @($cfg['extraAllowedSubnets']) }
        if (-not ($subs -contains '100.64.0.0/10')) { $cfg['extraAllowedSubnets'] = @($subs + '100.64.0.0/10'); $changed = $true }
        if ($isAll -or ($prevBind -eq '0.0.0.0')) { $bindAction = 'preserved' }
        elseif ($prevBindOk) {
            $bindAction = 'changed'
            $notes.Add("The server now listens on the home network + Tailscale/VPN (all networks) instead of only $prevBind. If you had created the phone certificate (Settings > Phone & HTTPS), create it again - it is tied to the address.")
        } else { $bindAction = 'set' }
    } elseif ($LanIp) {
        if ($LanIp -eq '0.0.0.0' -or -not (Test-IPv4 $LanIp)) { throw "The address '$LanIp' is not a usable single IPv4 address (0.0.0.0 'all interfaces' is never set by the installer)." }
        if ($prevBindOk -and $prevBind -eq $LanIp) {
            $bindAction = 'preserved'
        } elseif ($prevBindOk -and $prevBind -ne $LanIp) {
            $notes.Add("The listening address changed from $prevBind to $LanIp. If you had created the phone certificate (Settings > Phone & HTTPS), create it again - it is tied to the address.")
            $cfg['bindAddress'] = $LanIp; $changed = $true; $bindAction = 'changed'
        } else {
            $cfg['bindAddress'] = $LanIp; $changed = $true; $bindAction = 'set'
        }
    } elseif ($prevBindOk) {
        $bindAction = 'preserved'
    } elseif ($prevBind) {
        # invalid/non-IPv4 existing value: do not keep garbage and do not invent a LAN or 0.0.0.0
        $cfg['bindAddress'] = '127.0.0.1'; $changed = $true; $bindAction = 'repaired-loopback'
        $notes.Add("bindAddress in server.json ('$prevBind') was not a usable IPv4 address, so WavWiz listens on this PC only (127.0.0.1) until you set a home-network address (Repair) or edit server.json.")
    } else {
        $cfg['bindAddress'] = '127.0.0.1'; $changed = $true; $bindAction = 'set-loopback'
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
    return [pscustomobject]@{ Config = $cfg; Existing = $existing; Changed = $changed; Notes = $notes.ToArray(); BindAction = $bindAction; PreviousBindAddress = $prevBind }
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
function Set-MachineRegValue([string]$SubKey, [string]$Name, [string]$Value) {
    if (Test-TestHost) {
        $keep = @(Read-RegLines | Where-Object { $p = $_ -split '\|', 3; -not ($p.Count -ge 2 -and $p[0] -eq $SubKey -and $p[1] -eq $Name) })
        $keep += ($SubKey + '|' + $Name + '|' + $Value)
        $f = Get-RegFile; $d = Split-Path -Parent $f
        if ($d -and -not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
        Set-Content -LiteralPath $f -Value $keep
        return
    }
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
    $k = $base.CreateSubKey($SubKey)
    try { $k.SetValue($Name, $Value, [Microsoft.Win32.RegistryValueKind]::String) } finally { $k.Close() }
}

# ---- F173: only ONE Apps & features entry. Stray WavWiz uninstall keys with another AppId (HKLM 64/32 + HKCU) are removed on install/upgrade. ----
$script:WavWizAppKey = '{B5C2D7E1-4F3A-4B8E-9C61-57415657495A}_is1'
$script:UninstallRoot = 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
function Test-StrayWavWizArp([string]$KeyName, [string]$DisplayName) {
    if ($KeyName -ieq $script:WavWizAppKey) { return $false }
    return [bool]($DisplayName -match '^\s*WavWiz(\s|$|\()')
}
function Remove-StrayWavWizArp {
    $removed = New-Object System.Collections.Generic.List[string]
    if (Test-TestHost) {
        $lines = @(Read-RegLines); $keys = @{}
        foreach ($l in $lines) { $p = $l -split '\|', 3; if ($p.Count -eq 3 -and $p[0] -like ($script:UninstallRoot + '\*')) { $k = $p[0].Substring($script:UninstallRoot.Length + 1); if (-not $keys.ContainsKey($k)) { $keys[$k] = '' }; if ($p[1] -eq 'DisplayName') { $keys[$k] = $p[2] } } }
        foreach ($k in @($keys.Keys)) { if (Test-StrayWavWizArp $k $keys[$k]) { Remove-MachineRegKey ($script:UninstallRoot + '\' + $k); $removed.Add('HKLM\' + $k) } }
    } else {
        $views = @(
            @{ Hive = [Microsoft.Win32.RegistryHive]::LocalMachine; View = [Microsoft.Win32.RegistryView]::Registry64; Tag = 'HKLM64' },
            @{ Hive = [Microsoft.Win32.RegistryHive]::LocalMachine; View = [Microsoft.Win32.RegistryView]::Registry32; Tag = 'HKLM32' },
            @{ Hive = [Microsoft.Win32.RegistryHive]::CurrentUser; View = [Microsoft.Win32.RegistryView]::Registry64; Tag = 'HKCU64' },
            @{ Hive = [Microsoft.Win32.RegistryHive]::CurrentUser; View = [Microsoft.Win32.RegistryView]::Registry32; Tag = 'HKCU32' })
        foreach ($v in $views) {
            try {
                $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($v.Hive, $v.View); $root = $base.OpenSubKey($script:UninstallRoot, $true); if ($null -eq $root) { continue }
                try {
                    foreach ($k in @($root.GetSubKeyNames())) {
                        $dn = ''; try { $sk = $root.OpenSubKey($k); if ($null -ne $sk) { $dn = [string]$sk.GetValue('DisplayName'); $sk.Close() } } catch { }
                        if (Test-StrayWavWizArp $k $dn) { try { $root.DeleteSubKeyTree($k, $false); $removed.Add($v.Tag + '\' + $k) } catch { Write-InstallLog ("ARP scrub: could not remove {0}\{1}: {2}" -f $v.Tag, $k, $_.Exception.Message) } }
                    }
                } finally { $root.Close() }
            } catch { Write-InstallLog ("ARP scrub: {0} skipped: {1}" -f $v.Tag, $_.Exception.Message) }
        }
    }
    foreach ($r in $removed) { Say ("Removed a stray Apps & features entry: " + $r) }
    return $removed.ToArray()
}

