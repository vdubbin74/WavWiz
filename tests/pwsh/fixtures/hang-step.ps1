# TEST-ONLY step that never finishes (proves the child time limit kills it and reports the last step)
. (Join-Path (Split-Path $PSScriptRoot -Parent | Split-Path -Parent | Split-Path -Parent) 'installer/scripts/lib.ps1')
Start-InstallLog; Set-Step 'hang: waiting forever'; Start-Sleep -Seconds 120
