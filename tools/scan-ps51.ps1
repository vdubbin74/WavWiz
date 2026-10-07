<#
 Scans every SHIPPED PowerShell script (installer/scripts, build scripts that ship) for syntax / cmdlet parameters that Windows PowerShell 5.1 does not have
 (ternary, ??, && ||, -AsHashtable, -Parallel, -AsByteStream, ...). PSScriptAnalyzer with PSUseCompatibleSyntax (5.1) and PSUseCompatibleCommands against the Windows PowerShell 5.1 profiles.
 Run under pwsh 7:  pwsh -NoProfile -File tools/scan-ps51.ps1      exit 0 = no findings.   It cannot see .NET-Core-only API calls; a grep below covers the usual ones.
#>
$repo = Split-Path $PSScriptRoot -Parent
Import-Module PSScriptAnalyzer -ErrorAction Stop
$files = @(Get-ChildItem (Join-Path $repo 'installer/scripts/*.ps1'))
$prof = (Get-ChildItem (Join-Path (Get-Module PSScriptAnalyzer -ListAvailable | Select-Object -First 1).ModuleBase 'compatibility_profiles') -Filter *.json).BaseName
$win51 = @($prof | Where-Object { $_ -match '^win-' -and $_ -match '_5\.1\.' })
$settings = @{ IncludeRules = @('PSUseCompatibleSyntax', 'PSUseCompatibleCommands'); Rules = @{
        PSUseCompatibleSyntax = @{ Enable = $true; TargetVersions = @('5.1') }
        PSUseCompatibleCommands = @{ Enable = $true; TargetProfiles = $win51 } } }
$n = 0
foreach ($f in $files) { foreach ($x in @(Invoke-ScriptAnalyzer -Path $f.FullName -Settings $settings)) { $n++; '{0}:{1} [{2}] {3}' -f $f.Name, $x.Line, $x.RuleName, $x.Message } }
# .NET Core-only calls that do not exist in .NET Framework 4.x (PowerShell 5.1): ArgumentList.Add on ProcessStartInfo, Process.Kill($true), Path.Join, string.Contains(char), [Convert]::ToHexString ...
$bad = '\.ArgumentList\.Add\(|Path\]::Join\(|ToHexString|\.Kill\(\$true\)(?!\s*\}?\s*catch)|\bnew\(\)|-AsHashtable|\?\?|\?\.|-Parallel'
foreach ($f in $files) {
    $ln = 0
    foreach ($line in Get-Content -LiteralPath $f.FullName) {
        $ln++
        if ($line -match '^\s*#') { continue }
        if ($line -match $bad -and $line -notmatch 'try \{ \$Process\.Kill\(\$true\) \}') { $n++; '{0}:{1} [NetCoreOnly] {2}' -f $f.Name, $ln, $line.Trim() }
    }
}
"scanned $($files.Count) files against $($win51.Count) Windows PowerShell 5.1 profiles: $n finding(s)"
if ($n -gt 0) { exit 1 } else { exit 0 }
