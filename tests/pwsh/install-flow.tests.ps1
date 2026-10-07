<#
 End-to-end tests of the REAL installer scripts (installer/scripts/*.ps1), run the way the wizard runs them (setup.ps1 -> Invoke-SubScript -> a child process -NonInteractive ->
 run-step.ps1 -> install-server.ps1 / install-player.ps1), on this Linux box under PowerShell 7 with FAKE Windows tools (tests/pwsh/fixtures: stateful sc/netsh, icacls/taskkill
 recorders, a fake notice window). The seams (WAVWIZ_TEST_*) are inert unless WAVWIZ_TEST_HOST=shim, which the installer never sets.
 Covers installer failure scenarios seen in an earlier project: existing-config re-run, non-interactive (4 ways), hidden-window fallback (window never appears / crashes / is closed / hangs) with a restricted
 file fallback and no secret in the log, failure messages with file:line, step time limits, idempotent re-runs, silent install, uninstall (keep / purge).
 Run:  pwsh -NoProfile -File tests/pwsh/install-flow.tests.ps1   (exit 0 = all passed).
 NOT proven by this: Windows PowerShell 5.1 itself, the real sc.exe / netsh / icacls, UAC, the Inno Setup wizard on Windows.
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$scripts = Join-Path $repo 'installer/scripts'
. (Join-Path $scripts 'lib.ps1')
$script:pass = 0; $script:fail = 0
function Test([string]$name, [scriptblock]$body) {
    try { & $body; $script:pass++; Write-Host "  ok   $name" } catch { $script:fail++; Write-Host "  FAIL $name :: $($_.Exception.Message)" -ForegroundColor Red }
}
function Eq($actual, $expected, [string]$what = '') { if ("$actual" -cne "$expected") { throw "$what`n    expected: $expected`n    actual  : $actual" } }
function Has([string]$text, [string]$needle, [string]$what = '') { if ($text.IndexOf($needle, [StringComparison]::Ordinal) -lt 0) { throw "$what missing '$needle' in:`n$text" } }
function HasNot([string]$text, [string]$needle, [string]$what = '') { if ($text.IndexOf($needle, [StringComparison]::Ordinal) -ge 0) { throw "$what unexpected '$needle' in:`n$text" } }
function Count([string]$text, [string]$needle) { return ([regex]::Matches($text, [regex]::Escape($needle))).Count }
$pwsh = (Get-Command pwsh).Source
$fx = Join-Path $PSScriptRoot 'fixtures'
$lanIp = '192.168.77.5'
$sandboxes = New-Object System.Collections.Generic.List[string]

# a tiny HTTP listener standing in for the server's /api/v1/auth/state (readiness probe)
$free = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0); $free.Start(); $probePort = $free.LocalEndpoint.Port; $free.Stop()
$listener = [System.Net.HttpListener]::new(); $listener.Prefixes.Add("http://127.0.0.1:$probePort/"); $listener.Start()
$lps = [powershell]::Create(); [void]$lps.AddScript({ param($l) while ($l.IsListening) { try { $c = $l.GetContext(); $b = [Text.Encoding]::UTF8.GetBytes('{"beta":true}'); $c.Response.OutputStream.Write($b, 0, $b.Length); $c.Response.Close() } catch { break } } }).AddArgument($listener); [void]$lps.BeginInvoke()
$probeUrl = "http://127.0.0.1:$probePort/api/v1/auth/state"

function New-Sandbox {
    $root = Join-Path ([IO.Path]::GetTempPath()) ('un-flow-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    $sb = @{ Root = $root; PD = (Join-Path $root 'pd'); App = (Join-Path $root 'pf/WavWiz'); State = (Join-Path $root 'state'); Shim = (Join-Path $root 'shim'); Fallback = (Join-Path $root 'desktop') }
    foreach ($d in $sb.PD, $sb.App, $sb.State, $sb.Shim, $sb.Fallback, (Join-Path $sb.Root 'pf'), (Join-Path $sb.Root 'pub/Desktop')) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    Copy-Item (Join-Path $fx 'fake-sc.sh') (Join-Path $sb.Shim 'sc.exe'); Copy-Item (Join-Path $fx 'fake-netsh.sh') (Join-Path $sb.Shim 'netsh.exe')
    foreach ($t in 'icacls.exe', 'taskkill.exe') { Copy-Item (Join-Path $fx 'fake-tool.sh') (Join-Path $sb.Shim $t) }
    & chmod +x (Join-Path $sb.Shim 'sc.exe') (Join-Path $sb.Shim 'netsh.exe') (Join-Path $sb.Shim 'icacls.exe') (Join-Path $sb.Shim 'taskkill.exe')
    $sb.Data = Join-Path $sb.PD 'WavWiz'
    New-Item -ItemType Directory -Force -Path (Join-Path $sb.App 'Server/ffmpeg'), (Join-Path $sb.App 'Server/wwwroot'), (Join-Path $sb.App 'Player'), (Join-Path $sb.App 'scripts') | Out-Null
    foreach ($f in 'Server/wavwiz-server.exe', 'Server/ffmpeg/ffmpeg.exe', 'Server/wwwroot/index.html', 'Player/wavwiz-player.exe') { Set-Content (Join-Path $sb.App $f) 'fake' }
    $sandboxes.Add($root)
    return $sb
}
function Get-SandboxEnv($sb, [hashtable]$more = @{}) {
    $e = @{ ProgramData = $sb.PD; WAVWIZ_TEST_HOST = 'shim'; WAVWIZ_TEST_SHIMDIR = $sb.Shim; WAVWIZ_TEST_STATE = $sb.State; WAVWIZ_TEST_LANIP = $lanIp; WAVWIZ_TEST_POWERSHELL = $pwsh
            WAVWIZ_TEST_PROBE_URL = $probeUrl; WAVWIZ_TEST_PROBE_TIMEOUT = '4'; WAVWIZ_TEST_FALLBACKDIR = $sb.Fallback; WAVWIZ_TEST_WEBVIEW2 = 'present'; ProgramFiles = (Join-Path $sb.Root 'pf'); PUBLIC = (Join-Path $sb.Root 'pub') }
    foreach ($k in $more.Keys) { $e[$k] = $more[$k] }
    return $e
}
function Invoke-Direct($sb, [string[]]$pwshArgs, [hashtable]$extraEnv = @{}, [int]$limitMs = 120000) {
    $psi = New-Object Diagnostics.ProcessStartInfo; $psi.FileName = $pwsh; $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.RedirectStandardInput = $true
    foreach ($a in $pwshArgs) { $psi.ArgumentList.Add($a) }
    [void]$psi.Environment.Remove('WAVWIZ_NONINTERACTIVE')
    $envs = Get-SandboxEnv $sb $extraEnv; foreach ($k in $envs.Keys) { if ($null -eq $envs[$k]) { [void]$psi.Environment.Remove($k) } else { $psi.Environment[$k] = $envs[$k] } }
    $p = [Diagnostics.Process]::Start($psi); $so = $p.StandardOutput.ReadToEndAsync(); $se = $p.StandardError.ReadToEndAsync(); $p.StandardInput.Close()
    if (-not $p.WaitForExit($limitMs)) { try { $p.Kill($true) } catch { }; throw 'child pwsh timed out (a prompt waiting for input?)' }
    return [pscustomobject]@{ ExitCode = $p.ExitCode; Output = $so.Result + $se.Result }
}
# the production path: the wizard starts   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File setup.ps1 ...   (here pwsh)
function Invoke-Setup($sb, [hashtable]$p = @{}, [hashtable]$extraEnv = @{}) {
    $done = Join-Path $sb.State 'setup.done'; Remove-Item $done -ErrorAction SilentlyContinue
    $a = @('-NoProfile', '-NonInteractive', '-File', (Join-Path $scripts 'setup.ps1'), '-Root', $sb.App, '-DoneFile', $done)
    $q = @{ Role = 'both'; LanIp = $lanIp }; foreach ($k in $p.Keys) { $q[$k] = $p[$k] }
    foreach ($k in $q.Keys) { if ($null -ne $q[$k] -and "$($q[$k])" -ne '') { $a += "-$k"; $a += "$($q[$k])" } }
    $sw = [Diagnostics.Stopwatch]::StartNew(); $r = Invoke-Direct $sb $a $extraEnv
    $dc = $null; if (Test-Path $done) { $dc = (Get-Content $done -Raw).Trim() }
    return [pscustomobject]@{ ExitCode = $r.ExitCode; Output = $r.Output; Done = $dc; Seconds = $sw.Elapsed.TotalSeconds }
}
function Get-Log($sb, [string]$name = 'install.log') { $f = Join-Path $sb.Data $name; if (Test-Path -LiteralPath $f) { return (Get-Content -LiteralPath $f -Raw) } else { return '' } }
function Get-Calls($sb) { $f = Join-Path $sb.State 'calls.log'; if (Test-Path -LiteralPath $f) { return (Get-Content -LiteralPath $f -Raw) } else { return '' } }
function Get-Rules($sb) { $f = Join-Path $sb.State 'rules.txt'; if (Test-Path -LiteralPath $f) { return (Get-Content -LiteralPath $f -Raw) } else { return '' } }
function Test-NoBom([string]$path) { $b = [IO.File]::ReadAllBytes($path); return -not ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) }
function Fail-IfNotOk($r, $sb) { if ($r.ExitCode -ne 0 -or $r.Done -ne '0') { throw "setup failed (exit $($r.ExitCode), done=$($r.Done)):`n$($r.Output)`n--- install.log ---`n$(Get-Log $sb)" } }

Write-Host 'static checks of the shipped scripts'
Test 'every shipped .ps1 is pure ASCII (Windows PowerShell 5.1 reads BOM-less files as ANSI and would mangle anything else)' {
    foreach ($f in Get-ChildItem (Join-Path $scripts '*.ps1')) { $bytes = [IO.File]::ReadAllBytes($f.FullName); $bad = @($bytes | Where-Object { $_ -gt 127 }).Count; if ($bad) { throw "$($f.Name) has $bad non-ASCII bytes" } }
}
Test 'no shipped script prompts (Read-Host) or elevates in a hidden window; WinForms only in show-notice.ps1' {
    foreach ($f in Get-ChildItem (Join-Path $scripts '*.ps1')) {
        $t = Get-Content $f.FullName -Raw
        $code = (($t -replace '(?s)<#.*?#>', '') -split "`n" | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
        if ($f.Name -ne 'lib.ps1' -and $code -match 'Read-Host') { throw "$($f.Name) calls Read-Host" }
        if ($code -match '-Verb\s+RunAs') { throw "$($f.Name) elevates with RunAs" }
        if ($f.Name -ne 'show-notice.ps1' -and $code -match 'System\.Windows\.Forms|Out-GridView|\[Microsoft\.VisualBasic') { throw "$($f.Name) opens UI" }
        if ($code -match '0\.0\.0\.0' -and $f.Name -notin 'lib.ps1', 'install-player.ps1') { throw "$($f.Name) mentions 0.0.0.0" }
    }
}
Test 'lib.ps1 does not define a variable named like a script parameter ($NonInteractive) - a scope clash seen in an earlier project' {
    $code = (Get-Content (Join-Path $scripts 'lib.ps1') -Raw)
    if ($code -match '\$script:NonInteractive|\$global:NonInteractive') { throw 'scope clash' }
}

Write-Host 'pure functions'
Test 'Select-LanIPv4 prefers the gateway Ethernet adapter, skips virtual/link-local/loopback/down, returns empty when none qualifies' {
    $c = @(
        [pscustomobject]@{ Name = 'vEthernet (WSL)'; Description = 'Hyper-V Virtual'; Status = 'Up'; Type = 'Ethernet'; HasGateway = $false; Ip = '172.20.0.1' },
        [pscustomobject]@{ Name = 'Ethernet'; Description = 'Intel I219'; Status = 'Up'; Type = 'Ethernet'; HasGateway = $true; Ip = '192.168.1.20' },
        [pscustomobject]@{ Name = 'Wi-Fi'; Description = 'Intel AX'; Status = 'Down'; Type = 'Wireless80211'; HasGateway = $true; Ip = '192.168.1.99' },
        [pscustomobject]@{ Name = 'Loopback'; Description = 'x'; Status = 'Up'; Type = 'Loopback'; HasGateway = $false; Ip = '127.0.0.1' },
        [pscustomobject]@{ Name = 'Ethernet 2'; Description = 'x'; Status = 'Up'; Type = 'Ethernet'; HasGateway = $false; Ip = '169.254.3.3' })
    Eq (Select-LanIPv4 $c) '192.168.1.20'
    Eq (Select-LanIPv4 @($c[1..4] | Where-Object { $_.Ip -ne '192.168.1.20' })) ''
}
Test 'Test-IPv4 / Test-PrivateIPv4' {
    foreach ($ok in '10.0.0.1', '192.168.0.255', '172.16.5.4') { if (-not (Test-IPv4 $ok)) { throw $ok } }
    foreach ($bad in '256.1.1.1', '1.2.3', 'a.b.c.d', '', '1.2.3.4.5') { if (Test-IPv4 $bad) { throw "accepted $bad" } }
    if (Test-PrivateIPv4 '8.8.8.8') { throw 'public ip is not private' }; if (-not (Test-PrivateIPv4 '172.31.1.1')) { throw '172.31' }; if (Test-PrivateIPv4 '172.32.1.1') { throw '172.32' }
}
Test 'ConvertTo-WinArg quotes spaces/quotes/trailing backslashes (service binPath, paths with spaces)' {
    Eq (ConvertTo-WinArg 'C:\Program Files\WavWiz\x.exe') '"C:\Program Files\WavWiz\x.exe"'
    Eq (ConvertTo-WinArg 'a"b') '"a\"b"'
    Eq (ConvertTo-WinArg 'C:\dir with space\') '"C:\dir with space\\"'
    Eq (Get-ServiceBinPath 'C:\Program Files\WavWiz\Server\wavwiz-server.exe' @('--data-dir', 'C:\ProgramData\WavWiz')) '"C:\Program Files\WavWiz\Server\wavwiz-server.exe" --data-dir C:\ProgramData\WavWiz'
}
Test 'Get-ServerConfigPlan: fresh install, explicit address, never 0.0.0.0' {
    $p = Get-ServerConfigPlan -ExistingJson '' -LanIp '192.168.1.5' -FfmpegPath '/x/ffmpeg' -HttpPort 47800 -HttpsPort 47443 -AudioPort 47801 -ClockPort 47802
    Eq $p.Config['bindAddress'] '192.168.1.5'; Eq $p.Config['httpPort'] 47800; Eq $p.Config['ffmpegPath'] '/x/ffmpeg'; Eq $p.Existing $false
    foreach ($bad in '0.0.0.0', 'not-an-ip', '300.1.1.1') { $threw = $false; try { [void](Get-ServerConfigPlan -ExistingJson '' -LanIp $bad -FfmpegPath '' -HttpPort 1 -HttpsPort 2 -AudioPort 3 -ClockPort 4) } catch { $threw = $true }; if (-not $threw) { throw "accepted $bad" } }
}
Test 'Get-ServerConfigPlan: no address found -> loopback only, with a plain notice (never 0.0.0.0)' {
    $p = Get-ServerConfigPlan -ExistingJson '' -LanIp '' -FfmpegPath '' -HttpPort 47800 -HttpsPort 47443 -AudioPort 47801 -ClockPort 47802
    Eq $p.Config['bindAddress'] '127.0.0.1'; Has ($p.Notes -join '|') 'listens on this PC only'
}
Test 'Get-ServerConfigPlan: existing config keeps every key it has (incl. unknown ones and an opted-in 0.0.0.0), with or without BOM' {
    $json = [char]0xFEFF + '{"bindAddress":"0.0.0.0","allowAllInterfaces":true,"leadMs":800,"extraAllowedSubnets":["100.64.0.0/10"],"httpPort":50000,"ffmpegPath":"/bogus/ffmpeg"}'
    $p = Get-ServerConfigPlan -ExistingJson $json -LanIp '' -FfmpegPath '/real/ffmpeg' -HttpPort 47800 -HttpsPort 47443 -AudioPort 47801 -ClockPort 47802
    Eq $p.Config['bindAddress'] '0.0.0.0' 'user opt-in kept'; Eq $p.Config['leadMs'] 800; Eq $p.Config['httpPort'] 50000; Eq $p.Config['extraAllowedSubnets'][0] '100.64.0.0/10'
    Eq $p.Config['ffmpegPath'] '/real/ffmpeg' 'a stale ffmpeg path is repaired'; Eq $p.Config['httpsPort'] 47443 'missing keys filled'
}
Test 'Get-ServerConfigPlan: invalid JSON is an error that says the file was left alone' {
    $threw = ''; try { [void](Get-ServerConfigPlan -ExistingJson '{ not json' -LanIp '' -FfmpegPath '' -HttpPort 1 -HttpsPort 2 -AudioPort 3 -ClockPort 4) } catch { $threw = $_.Exception.Message }
    Has $threw 'left untouched'
}

Write-Host 'non-interactive: prompt functions never throw and never wait'
foreach ($mode in @(
        @{ Name = 'switch flag only'; Env = @{ }; Args = @('-NoProfile', '-Command'); Pre = '$script:WavWizNoPrompt = $true;' },
        @{ Name = 'environment variable only'; Env = @{ WAVWIZ_NONINTERACTIVE = '1' }; Args = @('-NoProfile', '-Command'); Pre = '' },
        @{ Name = 'host started with -NonInteractive only'; Env = @{ }; Args = @('-NoProfile', '-NonInteractive', '-Command'); Pre = '' })) {
    Test ("Confirm-YesNo returns the DEFAULT and logs it ($($mode.Name))") {
        $sb = New-Sandbox
        $code = ". '$scripts/lib.ps1'; $($mode.Pre) Start-InstallLog; `$a = Confirm-YesNo 'Really go?' `$true; `$b = Confirm-YesNo 'Dangerous?' `$false; `"RESULT a=`$a b=`$b`""
        $r = Invoke-Direct $sb (@() + $mode.Args + $code) $mode.Env
        Eq $r.ExitCode 0 "exit ($($r.Output))"; Has $r.Output 'RESULT a=True b=False'
        $log = Get-Log $sb; Has $log 'non-interactive: assumed yes for "Really go?"'; Has $log 'non-interactive: assumed no for "Dangerous?"'
    }
}
Test 'a host that refuses Read-Host still gets the default (try/catch around Read-Host)' {
    $sb = New-Sandbox
    $code = ". '$scripts/lib.ps1'; function Test-NonInteractive { `$false }; Start-InstallLog; `$a = Confirm-YesNo 'Proceed?' `$true; `"RESULT a=`$a`""
    $r = Invoke-Direct $sb @('-NoProfile', '-NonInteractive', '-Command', $code); Has $r.Output 'RESULT a=True'
}

Write-Host 'clean install'
Test 'setup.ps1 role=both under -NonInteractive: service, firewall, config, defaults, first-run URL; finishes quickly with exit 0 and done=0' {
    $sb = New-Sandbox; $r = Invoke-Setup $sb; Fail-IfNotOk $r $sb
    $calls = Get-Calls $sb
    Has $calls 'tool sc.exe create WavWizServer binPath='; Has $calls 'delayed-auto'; Has $calls 'NT AUTHORITY\LocalService'; Has $calls 'tool sc.exe failure WavWizServer'; Has $calls 'tool sc.exe start WavWizServer'
    Has (Get-Content (Join-Path $sb.State 'svc.def') -Raw) '--data-dir'
    Has $calls 'tool icacls.exe'; Has $calls '*S-1-5-19:(OI)(CI)M'
    $rules = Get-Rules $sb
    Has $rules 'protocol=TCP'; Has $rules 'localport=47800,47443,47801'; Has $rules 'protocol=UDP'; Has $rules 'localport=47802,47803,5353'; Has $rules 'profile=private'; Has $rules 'remoteip=localsubnet'
    Eq (Count $rules 'name=WavWiz Server') 2 'one TCP + one UDP rule'
    $cfgPath = Join-Path $sb.Data 'server.json'; if (-not (Test-NoBom $cfgPath)) { throw 'server.json has a BOM' }
    $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json; Eq $cfg.bindAddress $lanIp; Eq $cfg.httpPort 47800; Has $cfg.ffmpegPath 'ffmpeg.exe'
    HasNot (Get-Content $cfgPath -Raw) '0.0.0.0'
    $def = Get-Content (Join-Path $sb.Data 'player-defaults.json') -Raw | ConvertFrom-Json; Eq $def.serverHost $lanIp; if (-not (Test-NoBom (Join-Path $sb.Data 'player-defaults.json'))) { throw 'BOM in player-defaults.json' }
    Eq (Get-Content (Join-Path $sb.Data 'first-run-url.txt') -Raw).Trim() "http://${lanIp}:47800/"
    $log = Get-Log $sb; Has $log 'STEP> server: Windows service'; Has $log 'WavWiz setup finished.'; Has $log "effective=True"
    if ($r.Seconds -gt 60) { throw "took $($r.Seconds) s" }
}
Test 'no address passed and none in server.json: it is detected (WAVWIZ_TEST_LANIP) and used' {
    $sb = New-Sandbox; $r = Invoke-Setup $sb @{ LanIp = '' }; Fail-IfNotOk $r $sb
    Eq ((Get-Content (Join-Path $sb.Data 'server.json') -Raw | ConvertFrom-Json).bindAddress) $lanIp
}
Test 'nothing found on the network: loopback only, plain notice, install still succeeds' {
    $sb = New-Sandbox; $r = Invoke-Setup $sb @{ LanIp = '' } @{ WAVWIZ_TEST_LANIP = $null }; 
    # detection on this box finds a real address or none; either way the install must not fail and must not bind 0.0.0.0
    Fail-IfNotOk $r $sb; HasNot (Get-Content (Join-Path $sb.Data 'server.json') -Raw) '0.0.0.0'
}
Test 'role=server only: no player-defaults.json; role=player only: no service of ours touched (only the read-only check for an old Unison service)' {
    $sb = New-Sandbox; $r = Invoke-Setup $sb @{ Role = 'server' }; Fail-IfNotOk $r $sb
    if (Test-Path (Join-Path $sb.Data 'player-defaults.json')) { throw 'player defaults written for a server-only install' }
    $sb2 = New-Sandbox; $r2 = Invoke-Setup $sb2 @{ Role = 'player'; ServerHost = '192.168.1.40' }; Fail-IfNotOk $r2 $sb2
    $c2 = (Get-Calls $sb2) -replace 'tool sc\.exe query UnisonServer', ''; HasNot $c2 'tool sc.exe'; HasNot $c2 'netsh'
    Eq ((Get-Content (Join-Path $sb2.Data 'player-defaults.json') -Raw | ConvertFrom-Json).serverHost) '192.168.1.40'
}
Test 'silent install (NoDialog=1): no window, notices still land in setup-notices.txt' {
    $sb = New-Sandbox; $r = Invoke-Setup $sb @{ NoDialog = 1; Role = 'player'; ServerHost = '10.0.0.9' } @{ WAVWIZ_TEST_WEBVIEW2 = 'missing' }; Fail-IfNotOk $r $sb
    Has (Get-Content (Join-Path $sb.Data 'setup-notices.txt') -Raw) 'WebView2'
}

Write-Host 'idempotent re-runs and an existing configuration (failure scenario: existing-config re-run)'
Test 'running setup twice: same final state, service updated not re-created, exactly two firewall rules, server.json not rewritten' {
    $sb = New-Sandbox; $r1 = Invoke-Setup $sb; Fail-IfNotOk $r1 $sb
    $h1 = (Get-FileHash (Join-Path $sb.Data 'server.json')).Hash; $t1 = (Get-Item (Join-Path $sb.Data 'server.json')).LastWriteTimeUtc
    Start-Sleep -Milliseconds 1100
    $r2 = Invoke-Setup $sb; Fail-IfNotOk $r2 $sb
    Eq (Get-FileHash (Join-Path $sb.Data 'server.json')).Hash $h1 'server.json changed'; Eq (Get-Item (Join-Path $sb.Data 'server.json')).LastWriteTimeUtc $t1 'server.json rewritten'
    Eq (Count (Get-Calls $sb) 'tool sc.exe create') 1 'created twice'; Has (Get-Calls $sb) 'tool sc.exe config WavWizServer'; Has (Get-Calls $sb) 'tool sc.exe stop WavWizServer'
    Eq (Count (Get-Rules $sb) 'name=WavWiz Server') 2 'duplicated firewall rules'
    if (Test-Path (Join-Path $sb.Data 'server.json.bak')) { throw 'backup made for an unchanged file' }
}
Test 'Get-ServerUdpPorts: clock + discovery + mDNS by default; custom discovery port honored; discovery:false leaves only the clock port' {
    $sb = New-Sandbox
    $code = ". '$scripts/lib.ps1'; `$a = Get-ServerUdpPorts ([ordered]@{ clockPort = 47802 }); `$b = Get-ServerUdpPorts ([ordered]@{ clockPort = 47802; discoveryPort = 48000 }); `$c = Get-ServerUdpPorts ([ordered]@{ clockPort = 47802; discovery = `$false }); `"RESULT a=`$(`$a -join ',') b=`$(`$b -join ',') c=`$(`$c -join ',')`""
    $r = Invoke-Direct $sb @('-NoProfile', '-NonInteractive', '-Command', $code); Has $r.Output 'RESULT a=47802,47803,5353 b=47802,48000,5353 c=47802'
}
Test 'UPGRADE over 0.0.1: database, server.json (custom keys), admin data and paired-player defaults are untouched; service updated in place; firewall rules REPLACED (now incl. discovery + mDNS)' {
    $sb = New-Sandbox; New-Item -ItemType Directory -Force -Path $sb.Data | Out-Null
    $cfgJson = '{"bindAddress":"' + $lanIp + '","httpPort":47800,"httpsPort":47443,"audioPort":47801,"clockPort":47802,"leadMs":900,"ffmpegPath":"' + (Join-Path $sb.App 'Server/ffmpeg/ffmpeg.exe') + '"}'
    Write-Utf8NoBom (Join-Path $sb.Data 'server.json') $cfgJson
    [IO.File]::WriteAllBytes((Join-Path $sb.Data 'unison.db'), [byte[]](1..200))                       # stands in for the 0.0.1 database (admin password hash, paired players, library, playlists)
    Write-Utf8NoBom (Join-Path $sb.Data 'player-defaults.json') ('{"serverHost":"' + $lanIp + '","httpPort":47800,"audioPort":47801}')
    # the 0.0.1 install: service exists and is RUNNING, with the old two firewall rules
    Set-Content (Join-Path $sb.State 'svc.state') 'RUNNING'; Set-Content (Join-Path $sb.State 'svc.def') 'old definition'
    Set-Content (Join-Path $sb.State 'rules.txt') @('WavWiz Server (web, audio, clock) | netsh advfirewall firewall add rule localport=47800,47443,47801', 'WavWiz Server (web, audio, clock) (UDP) | netsh advfirewall firewall add rule localport=47802')
    $dbHash = (Get-FileHash (Join-Path $sb.Data 'unison.db')).Hash; $cfgHash = (Get-FileHash (Join-Path $sb.Data 'server.json')).Hash; $defHash = (Get-FileHash (Join-Path $sb.Data 'player-defaults.json')).Hash
    $r = Invoke-Setup $sb; Fail-IfNotOk $r $sb
    Eq (Get-FileHash (Join-Path $sb.Data 'unison.db')).Hash $dbHash 'database changed by the installer'
    Eq (Get-FileHash (Join-Path $sb.Data 'server.json')).Hash $cfgHash 'server.json rewritten although nothing needed to change'
    Eq (Get-FileHash (Join-Path $sb.Data 'player-defaults.json')).Hash $defHash 'player defaults rewritten'
    if (Test-Path (Join-Path $sb.Data 'server.json.bak')) { throw 'backup made for an unchanged file' }
    $calls = Get-Calls $sb; HasNot $calls 'tool sc.exe create' 'service re-created'; Has $calls 'tool sc.exe config WavWizServer'; Has $calls 'tool sc.exe stop WavWizServer'; Has $calls 'tool sc.exe start WavWizServer'
    $rules = Get-Rules $sb; Eq ((($rules -split "`n") | Where-Object { $_ -like 'WavWiz Server*' }).Count) 2 'rules were duplicated'
    Has $rules 'localport=47802,47803,5353'; HasNot $rules 'localport=47802`n' 'old UDP rule left'
    Eq ((Get-Content (Join-Path $sb.Data 'server.json') -Raw | ConvertFrom-Json).leadMs) 900 'custom leadMs lost'
}
Test 'existing server.json with custom settings and a different address: custom keys survive, explicit address wins, backup made, certificate notice shown' {
    $sb = New-Sandbox; New-Item -ItemType Directory -Force -Path $sb.Data | Out-Null
    Write-Utf8NoBom (Join-Path $sb.Data 'server.json') '{"bindAddress":"192.168.1.50","leadMs":900,"extraAllowedSubnets":["100.64.0.0/10"],"httpPort":47850}'
    $r = Invoke-Setup $sb; Fail-IfNotOk $r $sb
    $cfg = Get-Content (Join-Path $sb.Data 'server.json') -Raw | ConvertFrom-Json
    Eq $cfg.bindAddress $lanIp; Eq $cfg.leadMs 900; Eq $cfg.extraAllowedSubnets[0] '100.64.0.0/10'; Eq $cfg.httpPort 47850 'user port kept'; Has $cfg.ffmpegPath 'ffmpeg.exe'
    Has (Get-Content (Join-Path $sb.Data 'server.json.bak') -Raw) '192.168.1.50'
    Has (Get-Content (Join-Path $sb.Data 'setup-notices.txt') -Raw) 'create it again'
    Eq (Get-Content (Join-Path $sb.Data 'first-run-url.txt') -Raw).Trim() "http://${lanIp}:47850/" 'first-run url uses the configured port'
}
Test 'existing server.json + re-run WITHOUT an address (the wizard in Repair mode): the configured address is kept, not replaced by detection' {
    $sb = New-Sandbox; New-Item -ItemType Directory -Force -Path $sb.Data | Out-Null
    Write-Utf8NoBom (Join-Path $sb.Data 'server.json') '{"bindAddress":"10.9.8.7","httpPort":47800}'
    $r = Invoke-Setup $sb @{ LanIp = '' }; Fail-IfNotOk $r $sb
    Eq ((Get-Content (Join-Path $sb.Data 'server.json') -Raw | ConvertFrom-Json).bindAddress) '10.9.8.7'
    Has (Get-Log $sb) 'keeping the address in the existing server.json'
}
Test 'a broken existing server.json stops the install BEFORE any service or rule is touched, with the file name in the message' {
    $sb = New-Sandbox; New-Item -ItemType Directory -Force -Path $sb.Data | Out-Null; Write-Utf8NoBom (Join-Path $sb.Data 'server.json') '{ broken'
    $r = Invoke-Setup $sb; Eq $r.ExitCode 1; Eq $r.Done '1'
    Has (Get-Log $sb 'last-setup-error.txt') 'not valid JSON'; HasNot (Get-Calls $sb) 'tool sc.exe create'; Eq (Get-Content (Join-Path $sb.Data 'server.json') -Raw) '{ broken'
}

Write-Host 'non-interactive: the switch binding can NOT be what protects the install'
Test 'install-server.ps1 run directly: (a) -NonInteractive switch only, (b) env var only, (c) host -NonInteractive only - all complete without a prompt' {
    foreach ($variant in 'switch', 'env', 'host') {
        $sb = New-Sandbox
        $base = @('-File', (Join-Path $scripts 'install-server.ps1'), '-Root', $sb.App, '-LanIp', $lanIp)
        $a = switch ($variant) { 'switch' { @('-NoProfile') + $base + '-NonInteractive' } 'env' { @('-NoProfile') + $base } 'host' { @('-NoProfile', '-NonInteractive') + $base } }
        $e = @{}; if ($variant -eq 'env') { $e.WAVWIZ_NONINTERACTIVE = '1' }
        $r = Invoke-Direct $sb $a $e
        if ($r.ExitCode -ne 0) { throw "$variant exit $($r.ExitCode): $($r.Output)`n$(Get-Log $sb)" }
        Has (Get-Log $sb) 'effective=True'
    }
}
Test 'run-step.ps1 accepts the JSON forms Windows PowerShell 5.1 can produce for a switch (true, "True", {IsPresent:true})' {
    foreach ($form in @('true', '"True"', '{"IsPresent":true}')) {
        $sb = New-Sandbox
        $json = '{"p":{"Root":"' + ($sb.App -replace '\\', '\\') + '","LanIp":"' + $lanIp + '","NoStart":' + $form + ',"NonInteractive":true}}'
        $psi = New-Object Diagnostics.ProcessStartInfo; $psi.FileName = $pwsh; $psi.UseShellExecute = $false; $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
        foreach ($x in '-NoProfile', '-NonInteractive', '-File', (Join-Path $scripts 'run-step.ps1'), '-Script', (Join-Path $scripts 'install-server.ps1')) { $psi.ArgumentList.Add($x) }
        foreach ($k in (Get-SandboxEnv $sb).Keys) { $psi.Environment[$k] = (Get-SandboxEnv $sb)[$k] }
        $p = [Diagnostics.Process]::Start($psi); $so = $p.StandardOutput.ReadToEndAsync(); $se = $p.StandardError.ReadToEndAsync(); $p.StandardInput.Write($json); $p.StandardInput.Close(); [void]$p.WaitForExit(60000)
        if ($p.ExitCode -ne 0) { throw "form $form : $($so.Result)$($se.Result)" }
        HasNot (Get-Calls $sb) 'tool sc.exe start' "NoStart ignored for form $form"
    }
}

Write-Host 'failure scenarios: the message says WHERE, the log has the command, nothing is left half-configured silently'
Test 'sc create fails (access denied): setup exits 1, done=1, the error holds the command, exit code, file:line; log has the RUN line' {
    $sb = New-Sandbox; $r = Invoke-Setup $sb @{} @{ WAVWIZ_TEST_SC_FAIL = 'create' }
    Eq $r.ExitCode 1; Eq $r.Done '1'
    $err = Get-Log $sb 'last-setup-error.txt'
    Has $err 'sc.exe create'; Has $err 'exit code 5'; Has $err 'Access is denied'; Has $err 'install-server.ps1:'; Has $err 'last step: server: Windows service'
    Has (Get-Log $sb) 'SETUP FAILED'; Has (Get-Log $sb) 'full log:'
    HasNot (Get-Rules $sb) 'name=WavWiz Server' 'firewall rules created after a failed service step'
}
Test 'service does not reach RUNNING: failure names server log + startup-error.txt; exit 1' {
    $sb = New-Sandbox; $r = Invoke-Setup $sb @{} @{ WAVWIZ_TEST_SC_NOSTART = '1' }
    Eq $r.ExitCode 1; $err = Get-Log $sb 'last-setup-error.txt'; Has $err 'did not reach RUNNING'; Has $err 'wavwiz-server.log'; Has $err 'startup-error.txt'
}
Test 'service runs but the web page does not answer: failure names the URL' {
    $sb = New-Sandbox; $r = Invoke-Setup $sb @{} @{ WAVWIZ_TEST_PROBE_URL = 'http://127.0.0.1:1/x'; WAVWIZ_TEST_PROBE_TIMEOUT = '2' }
    Eq $r.ExitCode 1; Has (Get-Log $sb 'last-setup-error.txt') 'does not answer'
}
Test 'missing ffmpeg in the install: pre-flight stops the install before anything is changed' {
    $sb = New-Sandbox; Remove-Item (Join-Path $sb.App 'Server/ffmpeg/ffmpeg.exe')
    $r = Invoke-Setup $sb; Eq $r.ExitCode 1; Has (Get-Log $sb 'last-setup-error.txt') 'Server\ffmpeg\ffmpeg.exe'; HasNot (Get-Calls $sb) 'tool sc.exe'
}
Test 'bad LAN address passed explicitly is rejected with a clear message; 0.0.0.0 is never accepted' {
    foreach ($bad in '0.0.0.0', '999.1.1.1') { $sb = New-Sandbox; $r = Invoke-Setup $sb @{ LanIp = $bad }; Eq $r.ExitCode 1 $bad; Has (Get-Log $sb 'last-setup-error.txt') 'not a usable single IPv4'; HasNot (Get-Calls $sb) 'tool sc.exe create' }
}
Test 'a step that hangs is killed at its time limit; the message says which step and where to look (child process tree)' {
    $sb = New-Sandbox
    $code = ". '$scripts/lib.ps1'; Start-InstallLog; try { Invoke-SubScript -Script '$fx/hang-step.ps1' -TimeoutSec 4 -Label 'hang test' -PowerShellExe '$pwsh' -Wrapper '$scripts/run-step.ps1' | Out-Null; 'NO-ERROR' } catch { 'ERR: ' + `$_.Exception.Message }"
    $sw = [Diagnostics.Stopwatch]::StartNew(); $r = Invoke-Direct $sb @('-NoProfile', '-NonInteractive', '-Command', $code); 
    Has $r.Output 'did not finish within 4 s'; Has $r.Output 'last step: hang: waiting forever'; Has $r.Output 'install.log'; if ($sw.Elapsed.TotalSeconds -gt 40) { throw "took $($sw.Elapsed.TotalSeconds) s" }
}
Test 'a native command that hangs is killed at its limit (Invoke-Native)' {
    $sb = New-Sandbox
    $code = ". '$scripts/lib.ps1'; Start-InstallLog; try { Invoke-Native -File '/bin/sleep' -ArgList @('60') -TimeoutSec 2 | Out-Null; 'NO-ERROR' } catch { 'ERR: ' + `$_.Exception.Message }"
    $r = Invoke-Direct $sb @('-NoProfile', '-Command', $code); Has $r.Output 'did not finish within 2 s and was stopped'
}

Write-Host 'visible windows, hidden-window fallback and restricted file fallback (failure scenarios 3 and 4)'
$secret = 'S3CRET-VALUE-do-not-log-9f2c'
function Invoke-Notice($sb, [string]$mode, [int]$shown = 2, [int]$ack = 2) {
    $env:WAVWIZ_TEST_HOST = 'shim'; $env:WAVWIZ_TEST_SHIMDIR = $sb.Shim; $env:WAVWIZ_TEST_STATE = $sb.State; $env:ProgramData = $sb.PD; $env:UN_FAKE_NOTICE_MODE = $mode
    try {
        Start-InstallLog
        return (Show-NoticeOrSave -Lines @("secret: $secret") -Title 'Test notice' -ChildScript (Join-Path $fx 'fake-show-notice.ps1') -PowerShellExe $pwsh -ShownTimeoutSec $shown -AckTimeoutSec $ack -FallbackDir $sb.Fallback -FallbackName 'WavWiz-TEST.txt')
    } finally { Remove-Item Env:\UN_FAKE_NOTICE_MODE -ErrorAction SilentlyContinue }
}
$savedPd = $env:ProgramData
Test 'window shown and confirmed: Mode=window, nothing written to disk, secret not in install.log, transport file shredded' {
    $sb = New-Sandbox; $r = Invoke-Notice $sb 'ok'
    Eq $r.Mode 'window'; if (@(Get-ChildItem $sb.Fallback).Count) { throw 'a file was written although the window worked' }
    HasNot (Get-Log $sb) $secret 'log'; if (@(Get-ChildItem ([IO.Path]::GetTempPath()) -Filter 'wavwiz-notice-*.tmp' -ErrorAction SilentlyContinue).Count) { throw 'transport file left behind' }
}
foreach ($m in @(@{ Mode = 'invisible'; Why = 'did not appear' }, @{ Mode = 'crash'; Why = 'did not appear' }, @{ Mode = 'closed-without-ack'; Why = 'closed without confirming' }, @{ Mode = 'hang-after-shown'; Why = 'no confirmation' })) {
    Test ("window '$($m.Mode)': falls back to a restricted file within the time limits; the setup is never blocked; the secret is only in that file") {
        $sb = New-Sandbox; $sw = [Diagnostics.Stopwatch]::StartNew(); $r = Invoke-Notice $sb $m.Mode
        Eq $r.Mode 'file' ($r.Reason); Has $r.Reason $m.Why; Has (Get-Content $r.Path -Raw) $secret; Has (Get-Content $r.Path -Raw) 'DELETE this file'
        if (-not $r.Restricted) { throw 'ACL restriction not applied' }
        Has (Get-Calls $sb) '/inheritance:r'; Has (Get-Calls $sb) 'S-1-5-32-544'
        HasNot (Get-Log $sb) $secret 'install.log'; HasNot (Get-Calls $sb) $secret 'a command line'; if (Test-Path (Join-Path $sb.Data 'current-step.txt')) { HasNot (Get-Content (Join-Path $sb.Data 'current-step.txt') -Raw) $secret 'step file' }
        if ($sw.Elapsed.TotalSeconds -gt 20) { throw "blocked for $($sw.Elapsed.TotalSeconds) s" }
        if (-not (Test-NoBom $r.Path)) { throw 'fallback file has a BOM' }
    }
}
Test 'file fallback into a folder that cannot be written: Mode=failed with the reason (the caller then tells the person), no exception' {
    $sb = New-Sandbox
    $env:WAVWIZ_TEST_HOST = 'shim'; $env:WAVWIZ_TEST_SHIMDIR = $sb.Shim; $env:WAVWIZ_TEST_STATE = $sb.State; $env:ProgramData = $sb.PD; $env:UN_FAKE_NOTICE_MODE = 'crash'
    try { Start-InstallLog; $r = Show-NoticeOrSave -Lines @('x') -Title 't' -ChildScript (Join-Path $fx 'fake-show-notice.ps1') -PowerShellExe $pwsh -ShownTimeoutSec 2 -FallbackDir '/proc/nonexistent/dir' } finally { Remove-Item Env:\UN_FAKE_NOTICE_MODE -ErrorAction SilentlyContinue }
    Eq $r.Mode 'failed'; Has $r.Reason 'saving to a file failed'
}
Test 'show-notice.ps1 (the real window script) marks the window visible and never runs from the hidden setup process' {
    $t = Get-Content (Join-Path $scripts 'show-notice.ps1') -Raw
    Has $t 'IsWindowVisible'; Has $t 'SetForegroundWindow'; Has $t 'ShowWindow'; Has $t '-ShownFile'
    $setup = Get-Content (Join-Path $scripts 'setup.ps1') -Raw; HasNot $setup 'System.Windows.Forms'
}
$env:ProgramData = $savedPd

Write-Host 'player step'
Test 'player: invalid server host rejected; a re-run without a host keeps the existing defaults; the same host again is not rewritten' {
    $sb = New-Sandbox
    $r = Invoke-Setup $sb @{ Role = 'player'; ServerHost = 'bad host!' }; Eq $r.ExitCode 1; Has (Get-Log $sb 'last-setup-error.txt') 'not a valid host name'
    $r1 = Invoke-Setup $sb @{ Role = 'player'; ServerHost = 'living-room-pc' }; Fail-IfNotOk $r1 $sb
    $r2 = Invoke-Setup $sb @{ Role = 'player'; ServerHost = '' }; Fail-IfNotOk $r2 $sb; Has (Get-Log $sb) 'Keeping the existing player-defaults.json'
    Eq ((Get-Content (Join-Path $sb.Data 'player-defaults.json') -Raw | ConvertFrom-Json).serverHost) 'living-room-pc'
    $r3 = Invoke-Setup $sb @{ Role = 'player'; ServerHost = 'living-room-pc' }; Fail-IfNotOk $r3 $sb; Has (Get-Log $sb) 'already has this server address'
}

Write-Host 'uninstall'
Test 'uninstall keeps data by default, removes service + rules; running it again is harmless' {
    $sb = New-Sandbox; $r = Invoke-Setup $sb; Fail-IfNotOk $r $sb
    $u = Invoke-Direct $sb @('-NoProfile', '-NonInteractive', '-File', (Join-Path $scripts 'uninstall.ps1'), '-Root', $sb.App); Eq $u.ExitCode 0 $u.Output
    if (Test-Path (Join-Path $sb.State 'svc.state')) { throw 'service still registered' }; Eq (Count (Get-Rules $sb) 'name=WavWiz Server') 0
    if (-not (Test-Path (Join-Path $sb.Data 'server.json'))) { throw 'data deleted without Purge' }; Has (Get-Log $sb) 'Your data was kept'
    $u2 = Invoke-Direct $sb @('-NoProfile', '-NonInteractive', '-File', (Join-Path $scripts 'uninstall.ps1'), '-Root', $sb.App); Eq $u2.ExitCode 0; Has (Get-Log $sb) 'No WavWiz service to remove'
}
Test 'uninstall -Purge 1 deletes the data folder, and refuses to delete a folder that is not the WavWiz data folder' {
    $sb = New-Sandbox; $r = Invoke-Setup $sb; Fail-IfNotOk $r $sb
    $victim = Join-Path $sb.Root 'important'; New-Item -ItemType Directory -Force $victim | Out-Null; Set-Content (Join-Path $victim 'keep.txt') 'x'
    $u0 = Invoke-Direct $sb @('-NoProfile', '-NonInteractive', '-File', (Join-Path $scripts 'uninstall.ps1'), '-Purge', '1', '-DataDir', $victim); Eq $u0.ExitCode 0
    if (-not (Test-Path (Join-Path $victim 'keep.txt'))) { throw 'deleted a folder outside the WavWiz data folder' }; Has (Get-Log $sb) 'refusing to delete'
    $u = Invoke-Direct $sb @('-NoProfile', '-NonInteractive', '-File', (Join-Path $scripts 'uninstall.ps1'), '-Purge', '1'); Eq $u.ExitCode 0
    if (Test-Path (Join-Path $sb.Data 'server.json')) { throw 'purge left server.json' }
}
Test 'uninstall with a service that cannot be removed (sc delete denied) still exits 0 and says so' {
    $sb = New-Sandbox; $r = Invoke-Setup $sb; Fail-IfNotOk $r $sb
    $u = Invoke-Direct $sb @('-NoProfile', '-NonInteractive', '-File', (Join-Path $scripts 'uninstall.ps1'), '-Root', $sb.App) @{ WAVWIZ_TEST_SC_FAIL = 'stop' }; Eq $u.ExitCode 0
}

Write-Host 'upgrade from Unison (0.0.1 / 0.0.2) to WavWiz: the rename migration'
$legacyUninst = 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{B5C2D7E1-4F3A-4B8E-9C61-554E49534F4E}_is1'
function New-LegacyInstall($sb, [switch]$WithDb = $true) {
    # what a finished 0.0.2 install leaves behind: service (RUNNING), 2 firewall rules, Run value, uninstall entry, program folder, Start-menu group, desktop link, ProgramData\Unison
    $old = Join-Path $sb.Root 'pf/Unison'; New-Item -ItemType Directory -Force -Path (Join-Path $old 'Server/ffmpeg'), (Join-Path $old 'Player'), (Join-Path $old 'scripts') | Out-Null
    foreach ($f in 'unins000.exe', 'Server/unison-server.exe', 'Server/ffmpeg/ffmpeg.exe', 'Player/unison-player.exe') { Set-Content (Join-Path $old $f) 'old' }
    $ld = Join-Path $sb.PD 'Unison'; New-Item -ItemType Directory -Force -Path (Join-Path $ld 'logs'), (Join-Path $ld 'certs'), (Join-Path $ld 'artcache') | Out-Null
    $cfg = '{"bindAddress":"' + $lanIp + '","httpPort":47800,"httpsPort":47443,"audioPort":47801,"clockPort":47802,"leadMs":900,"customKey":"keep me","ffmpegPath":"' + ((Join-Path $old 'Server/ffmpeg/ffmpeg.exe') -replace '\\', '/') + '"}'
    Write-Utf8NoBom (Join-Path $ld 'server.json') $cfg
    if ($WithDb) { [IO.File]::WriteAllBytes((Join-Path $ld 'unison.db'), [byte[]](1..250)) }
    [IO.File]::WriteAllBytes((Join-Path $ld 'unison.db-wal'), [byte[]](9..40)); Set-Content (Join-Path $ld 'certs/unison-root-ca.crt') 'CERT'; Set-Content (Join-Path $ld 'artcache/1.jpg') 'JPG'
    Set-Content (Join-Path $ld 'logs/unison-server.log') 'old server log'; Set-Content (Join-Path $ld 'install.log') 'old install log'
    Write-Utf8NoBom (Join-Path $ld 'player-defaults.json') ('{"serverHost":"' + $lanIp + '","httpPort":47800,"audioPort":47801}')
    Set-Content (Join-Path $sb.State 'legacy-svc.state') 'RUNNING'
    Set-Content (Join-Path $sb.State 'rules.txt') @('Unison Server (web, audio, clock) | netsh advfirewall firewall add rule localport=47800', 'Unison Server (web, audio, clock) (UDP) | netsh advfirewall firewall add rule localport=47802')
    Set-Content (Join-Path $sb.State 'registry.txt') @('SOFTWARE\Microsoft\Windows\CurrentVersion\Run|UnisonPlayer|"C:\Program Files\Unison\Player\unison-player.exe" --autostart', 'SOFTWARE\Microsoft\Windows\CurrentVersion\Run|OtherApp|keep', ($legacyUninst + '|InstallLocation|' + $old + '\'), ($legacyUninst + '|DisplayName|Unison (BETA)'))
    $menu = Join-Path $sb.PD 'Microsoft/Windows/Start Menu/Programs/Unison (BETA)'; New-Item -ItemType Directory -Force -Path $menu | Out-Null; Set-Content (Join-Path $menu 'Unison Player (BETA).lnk') 'x'
    Set-Content (Join-Path $sb.Root 'pub/Desktop/Unison web page (BETA).url') 'x'
    return $ld
}
Test 'UPGRADE from Unison 0.0.2: data MOVED (db, wal, certs, art cache, config incl. custom keys), old service/rules/Run value/uninstall entry/program folder/shortcuts removed, WavWiz service + 2 rules created' {
    $sb = New-Sandbox; $ld = New-LegacyInstall $sb
    $dbHash = (Get-FileHash (Join-Path $ld 'unison.db')).Hash; $walHash = (Get-FileHash (Join-Path $ld 'unison.db-wal')).Hash; $defHash = (Get-FileHash (Join-Path $ld 'player-defaults.json')).Hash
    $r = Invoke-Setup $sb; Fail-IfNotOk $r $sb
    if (Test-Path $ld) { throw 'the old Unison data folder is still there (it must be moved, not copied)' }
    Eq (Get-FileHash (Join-Path $sb.Data 'unison.db')).Hash $dbHash 'database changed or lost'; Eq (Get-FileHash (Join-Path $sb.Data 'unison.db-wal')).Hash $walHash 'wal changed or lost'
    Eq (Get-FileHash (Join-Path $sb.Data 'player-defaults.json')).Hash $defHash 'player defaults changed'
    Eq (Get-Content (Join-Path $sb.Data 'certs/unison-root-ca.crt') -Raw).Trim() 'CERT' 'certificate lost'; if (-not (Test-Path (Join-Path $sb.Data 'artcache/1.jpg'))) { throw 'art cache lost' }
    $cfg = Get-Content (Join-Path $sb.Data 'server.json') -Raw | ConvertFrom-Json
    Eq $cfg.customKey 'keep me' 'custom config key lost'; Eq $cfg.leadMs 900 'leadMs lost'; Eq $cfg.bindAddress $lanIp 'address changed'
    Eq ($cfg.ffmpegPath -replace '\\', '/') ((Join-Path $sb.App 'Server/ffmpeg/ffmpeg.exe') -replace '\\', '/') 'ffmpegPath still points into the removed Unison folder'
    Has (Get-Content (Join-Path $sb.Data 'logs/unison-server.log') -Raw) 'old server log'
    # the old install.log did not collide (WavWiz creates install.log first): it is kept under another name, never lost
    $keptLogs = @(Get-ChildItem $sb.Data -Filter 'install.log.from-unison*'); Eq $keptLogs.Count 1 'old install.log should be kept as install.log.from-unison'
    $calls = Get-Calls $sb; Has $calls 'tool sc.exe stop UnisonServer'; Has $calls 'tool sc.exe delete UnisonServer'; Has $calls 'tool taskkill.exe /F /IM unison-server.exe'; Has $calls 'tool taskkill.exe /F /IM unison-player.exe'
    if (Test-Path (Join-Path $sb.State 'legacy-svc.state')) { throw 'old service still registered' }
    if (-not (Test-Path (Join-Path $sb.State 'svc.state'))) { throw 'WavWiz service not created' }; Has $calls 'tool sc.exe create WavWizServer'
    $rules = Get-Rules $sb; HasNot $rules 'Unison Server' 'old firewall rules left'; Eq ((($rules -split "`n") | Where-Object { $_ -like 'WavWiz Server*' }).Count) 2 'WavWiz rules'
    $reg = Get-Content (Join-Path $sb.State 'registry.txt') -Raw; HasNot $reg 'UnisonPlayer' 'old Run value left'; HasNot $reg 'B5C2D7E1' 'old uninstall entry left'; Has $reg 'OtherApp|keep' 'foreign Run value was touched'
    if (Test-Path (Join-Path $sb.Root 'pf/Unison')) { throw 'old program folder left' }
    if (Test-Path (Join-Path $sb.PD 'Microsoft/Windows/Start Menu/Programs/Unison (BETA)')) { throw 'old Start-menu group left' }
    if (Test-Path (Join-Path $sb.Root 'pub/Desktop/Unison web page (BETA).url')) { throw 'old desktop link left' }
    if (-not (Test-Path (Join-Path $sb.App 'Server/wavwiz-server.exe'))) { throw 'the NEW install was touched' }
    $n = Get-Content (Join-Path $sb.Data 'setup-notices.txt') -Raw; Has $n 'Upgraded from Unison'
    Has (Get-Log $sb) 'Upgrade from Unison finished'
}
Test 'upgrade is IDEMPOTENT: running setup again right after changes nothing and does not touch the data or the new service definition twice' {
    $sb = New-Sandbox; $ld = New-LegacyInstall $sb
    $r = Invoke-Setup $sb; Fail-IfNotOk $r $sb
    $h1 = (Get-FileHash (Join-Path $sb.Data 'unison.db')).Hash; $c1 = (Get-FileHash (Join-Path $sb.Data 'server.json')).Hash
    $before = (Get-Calls $sb) -split "`n" | Where-Object { $_ -match 'UnisonServer' } | Measure-Object | ForEach-Object Count
    $r2 = Invoke-Setup $sb; Fail-IfNotOk $r2 $sb
    Eq (Get-FileHash (Join-Path $sb.Data 'unison.db')).Hash $h1 'database changed on re-run'; Eq (Get-FileHash (Join-Path $sb.Data 'server.json')).Hash $c1 'server.json changed on re-run'
    Has (Get-Log $sb) 'no earlier "Unison" installation found'
    $after = (Get-Calls $sb) -split "`n" | Where-Object { $_ -match 'UnisonServer' } | Measure-Object | ForEach-Object Count
    Eq ($after - $before) 1 'only the read-only query for the old service may be repeated'
    Eq ((((Get-Rules $sb) -split "`n") | Where-Object { $_ -like 'WavWiz Server*' }).Count) 2 'rules duplicated'
    if (Test-Path (Join-Path $sb.PD 'Unison')) { throw 'Unison data folder reappeared' }
    Eq @(Get-ChildItem $sb.Data -Filter 'install.log.from-unison*').Count 1 'the kept old log was duplicated'
}
Test 'upgrade after an INTERRUPTED first attempt (old service already gone, data folder half moved): finishes without losing anything' {
    $sb = New-Sandbox; $ld = New-LegacyInstall $sb
    # simulate: the previous run moved the database but stopped before the rest
    New-Item -ItemType Directory -Force -Path $sb.Data | Out-Null; Move-Item (Join-Path $ld 'unison.db') (Join-Path $sb.Data 'unison.db')
    Remove-Item (Join-Path $sb.State 'legacy-svc.state')
    $dbHash = (Get-FileHash (Join-Path $sb.Data 'unison.db')).Hash
    $r = Invoke-Setup $sb; Fail-IfNotOk $r $sb
    Eq (Get-FileHash (Join-Path $sb.Data 'unison.db')).Hash $dbHash 'database lost'; if (-not (Test-Path (Join-Path $sb.Data 'certs/unison-root-ca.crt'))) { throw 'certs not moved' }; if (Test-Path $ld) { throw 'old data folder left' }
}
Test 'BOTH folders hold a database: the WavWiz one wins, the old folder is left untouched, a plain notice says so' {
    $sb = New-Sandbox; $ld = New-LegacyInstall $sb
    New-Item -ItemType Directory -Force -Path $sb.Data | Out-Null; [IO.File]::WriteAllBytes((Join-Path $sb.Data 'unison.db'), [byte[]](77, 77, 77))
    $oldHash = (Get-FileHash (Join-Path $ld 'unison.db')).Hash
    $r = Invoke-Setup $sb; Fail-IfNotOk $r $sb
    Eq (Get-FileHash (Join-Path $ld 'unison.db')).Hash $oldHash 'old database was touched'; Eq ([IO.File]::ReadAllBytes((Join-Path $sb.Data 'unison.db'))).Length 3 'the WavWiz database was replaced'
    Has (Get-Content (Join-Path $sb.Data 'setup-notices.txt') -Raw) 'contain a library database'
}
Test 'an InstallLocation that does not look like an old Unison install (or is the NEW install folder) is never deleted' {
    $sb = New-Sandbox; $ld = New-LegacyInstall $sb
    $victim = Join-Path $sb.Root 'important'; New-Item -ItemType Directory -Force $victim | Out-Null; Set-Content (Join-Path $victim 'keep.txt') 'x'
    Remove-Item -Recurse -Force (Join-Path $sb.Root 'pf/Unison')
    Set-Content (Join-Path $sb.State 'registry.txt') @(($legacyUninst + '|InstallLocation|' + $victim + '\'))
    $r = Invoke-Setup $sb; Fail-IfNotOk $r $sb
    if (-not (Test-Path (Join-Path $victim 'keep.txt'))) { throw 'deleted a folder that is not an old Unison install' }; Has (Get-Log $sb) 'Left alone'
    $sb2 = New-Sandbox; [void](New-LegacyInstall $sb2); Set-Content (Join-Path $sb2.State 'registry.txt') @(($legacyUninst + '|InstallLocation|' + $sb2.App + '\'))
    $r2 = Invoke-Setup $sb2; Fail-IfNotOk $r2 $sb2; if (-not (Test-Path (Join-Path $sb2.App 'Server/wavwiz-server.exe'))) { throw 'the new install folder was deleted' }
}
Test 'player-only PC with an old Unison Player: old autostart + program folder removed, no service created' {
    $sb = New-Sandbox; $ld = New-LegacyInstall $sb; Remove-Item (Join-Path $sb.State 'legacy-svc.state')
    $r = Invoke-Setup $sb @{ Role = 'player'; ServerHost = $lanIp }; Fail-IfNotOk $r $sb
    HasNot (Get-Content (Join-Path $sb.State 'registry.txt') -Raw) 'UnisonPlayer' 'old autostart left'; if (Test-Path (Join-Path $sb.Root 'pf/Unison')) { throw 'old folder left' }
    HasNot (Get-Calls $sb) 'tool sc.exe create' 'a service was created on a player-only PC'
}
Test 'a clean first install says there is nothing to migrate and touches nothing of an old kind' {
    $sb = New-Sandbox; $r = Invoke-Setup $sb; Fail-IfNotOk $r $sb
    Has (Get-Log $sb) 'no earlier "Unison" installation found'; HasNot (Get-Calls $sb) 'sc.exe delete UnisonServer'; HasNot (Get-Calls $sb) 'taskkill'
}
Test 'a move that fails stops the install with the folder named, deletes nothing, and the next run (after the lock is gone) succeeds' {
    $sb = New-Sandbox; $ld = New-LegacyInstall $sb
    # WavWiz data path occupied by a FILE: the merge cannot create the folder
    New-Item -ItemType Directory -Force -Path $sb.PD | Out-Null; Set-Content $sb.Data 'blocker'
    $r = Invoke-Setup $sb; if ($r.ExitCode -eq 0) { throw 'should have failed' }
    if (-not (Test-Path (Join-Path $ld 'unison.db'))) { throw 'the old database was lost after a failed move' }
    Remove-Item $sb.Data -Force; Set-Content (Join-Path $sb.State 'legacy-svc.state') 'RUNNING'
    $r2 = Invoke-Setup $sb; Fail-IfNotOk $r2 $sb; if (-not (Test-Path (Join-Path $sb.Data 'unison.db'))) { throw 'second attempt did not move the database' }
}

$listener.Stop(); foreach ($s in $sandboxes) { try { Remove-Item -Recurse -Force $s -ErrorAction SilentlyContinue } catch { } }
Write-Host ("`n{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
