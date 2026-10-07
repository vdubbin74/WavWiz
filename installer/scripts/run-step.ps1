<#
.SYNOPSIS  Child-process wrapper used by setup.ps1 (via Invoke-SubScript in lib.ps1) to run a step script under a time limit.
           Reads ONE JSON document from STDIN: {"p":{plain parameters}}. Pipeline objects with a Kind (warning / notice) are returned as "@@UN@@ {json}" lines;
           a failure is returned as "@@UN-ERROR@@ message" (with file:line). The parent kills this process tree if it overruns. Windows PowerShell 5.1 compatible.
#>
param([Parameter(Mandatory)][string]$Script)
$ErrorActionPreference = 'Stop'
$env:WAVWIZ_NONINTERACTIVE = '1'          # ALWAYS non-interactive; also told through parameters, so no single binding path can switch it off
$global:WavWizThrowOnStop = $true
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }
function ConvertTo-ParamValue($v) {
    if ($v -is [string]) { if ($v -ceq 'True') { return $true }; if ($v -ceq 'False') { return $false }; return $v }
    if ($v -is [System.Management.Automation.PSCustomObject] -and $v.PSObject.Properties['IsPresent']) { return [bool]$v.IsPresent }
    return $v
}
function Get-FailureWhere($err) {
    $parts = New-Object System.Collections.Generic.List[string]
    try { $ii = $err.InvocationInfo; if ($ii -and $ii.ScriptName) { $parts.Add(('failing statement: {0}:{1}: {2}' -f [IO.Path]::GetFileName($ii.ScriptName), $ii.ScriptLineNumber, ("$($ii.Line)").Trim())) } } catch { }
    try {
        $n = 0
        foreach ($fr in @(("$($err.ScriptStackTrace)") -split "`r?`n")) {
            $m = [regex]::Match($fr, '^at (?<fn>.+?), (?<file>.+?): line (?<ln>\d+)\s*$')
            if (-not $m.Success) { continue }
            $txt = ''; try { $f = $m.Groups['file'].Value; if (Test-Path -LiteralPath $f) { $txt = ([string](@(Get-Content -LiteralPath $f -TotalCount ([int]$m.Groups['ln'].Value))[-1])).Trim() } } catch { }
            $parts.Add(('  called from {0} ({1}:{2}): {3}' -f $m.Groups['fn'].Value, [IO.Path]::GetFileName($m.Groups['file'].Value), $m.Groups['ln'].Value, $txt))
            $n++; if ($n -ge 4) { break }
        }
    } catch { }
    return ($parts -join "`n")
}
try {
    $reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), (New-Object System.Text.UTF8Encoding($false)))
    $raw = $reader.ReadToEnd()
    $splat = @{}
    if ($raw -and $raw.Trim()) {
        $cfg = $raw | ConvertFrom-Json
        if ($cfg.PSObject.Properties['p'] -and $cfg.p) { foreach ($pr in $cfg.p.PSObject.Properties) { $splat[$pr.Name] = (ConvertTo-ParamValue $pr.Value) } }
    }
    $raw = $null; $cfg = $null
    $res = @(& $Script @splat)
    foreach ($o in $res) { if ($o -is [pscustomobject] -and $o.PSObject.Properties['Kind']) { Write-Output ('@@UN@@ ' + ($o | ConvertTo-Json -Compress)) } }
    exit 0
} catch {
    $where = Get-FailureWhere $_
    $full = $_.Exception.Message
    if ($where) { $full = $full + "`n  step script: " + [IO.Path]::GetFileName($Script) + "`n  " + ($where -replace "`n", "`n  ") }
    Write-Output ('@@UN-ERROR@@ ' + ($full -replace '\r?\n', '<NL>'))
    exit 1
}
