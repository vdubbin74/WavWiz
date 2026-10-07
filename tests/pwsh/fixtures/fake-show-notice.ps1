# TEST-ONLY stand-in for installer\scripts\show-notice.ps1: behavior chosen by $env:UN_FAKE_NOTICE_MODE
param([string]$TextFile = '', [string]$ShownFile = '', [string]$AckFile = '')
$mode = $env:UN_FAKE_NOTICE_MODE
if (-not (Test-Path -LiteralPath $TextFile)) { exit 3 }
$null = Get-Content -LiteralPath $TextFile -Raw          # the real window reads the text and shreds the file
switch ($mode) {
    'invisible' { Start-Sleep -Seconds 25; exit 0 }                                   # a window that never becomes visible: never reports "shown"
    'crash' { exit 1 }                                                                # no display at all
    'hang-after-shown' { Set-Content $ShownFile '1'; Start-Sleep -Seconds 25; exit 0 }
    'closed-without-ack' { Set-Content $ShownFile '1'; Start-Sleep -Milliseconds 300; exit 0 }
    'ok' { Set-Content $ShownFile '1'; Start-Sleep -Milliseconds 300; Set-Content $AckFile '1'; exit 0 }
}
exit 2
