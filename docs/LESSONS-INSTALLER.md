# Installer lessons (from failures seen in an earlier installer) and where WavWiz applies them

| Failure | Rule | WavWiz |
|---|---|---|
| Hidden `powershell.exe` showed a WinForms window and waited forever | UI only in a separate visible process with a "really shown" handshake, time limits and a file fallback | `show-notice.ps1` + `Show-NoticeOrSave` (tests: invisible / crash / closed / hang) |
| `Read-Host` in `-NonInteractive` threw | never prompt in setup; defaults are logged | `Confirm-YesNo`, four detection paths, `run-step.ps1` forces `WAVWIZ_NONINTERACTIVE=1` |
| `$script:NonInteractive` aliased the `-NonInteractive` parameter | never name a lib variable like a script parameter | `$script:WavWizNoPrompt`; a test greps for the clash |
| WMI/CIM cmdlets blocked for minutes | no CIM; .NET/`sc`/`netsh` with limits | `Invoke-Native`/`Invoke-WithTimeout`, LAN detection via NetworkInterface |
| Step hung with no clue where | every step logged, child killed at limit with last step | `Set-Step`, `Invoke-SubScript` |
| Unhelpful failure text | include command, exit code, file:line | `Get-ErrorWhere`, `run-step.ps1` |
| Config clobbered on re-run | merge, keep user keys, back up when changed | `Get-ServerConfigPlan` |
| BOM in config files | BOM-less writes | `Write-Utf8NoBom` |
| Script non-ASCII mangled by 5.1 | pure ASCII scripts | static test |
| Secrets in logs/command lines | stdin / user-only temp file / restricted ACL | `Invoke-Native -StdinText`, `Show-NoticeOrSave` |
