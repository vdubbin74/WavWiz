<#
.SYNOPSIS  Shows text in ONE visible window (started by Show-NoticeOrSave in lib.ps1 as its own powershell.exe, -STA, normal window style).
           Reads the text from -TextFile (a user-only temp file) and shreds it at once; writes -ShownFile when the window is REALLY visible and -AckFile when the person clicks OK.
           The text is never logged and never on a command line. Windows PowerShell 5.1 compatible.
#>
param([string]$TextFile = '', [string]$ShownFile = '', [string]$AckFile = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing
Add-Type -Namespace UN -Name Win -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);'
$text = [IO.File]::ReadAllText($TextFile).TrimStart([char]0xFEFF)
try { [IO.File]::WriteAllBytes($TextFile, (New-Object byte[] ([Math]::Max(1, $text.Length * 2)))); Remove-Item -LiteralPath $TextFile -Force } catch { }
$title = ($text -split "`r?`n")[0]; $rest = ($text -split "`r?`n", 2)[1]
$f = New-Object System.Windows.Forms.Form
$f.Text = 'WavWiz (BETA) - ' + $title; $f.StartPosition = 'CenterScreen'; $f.Width = 720; $f.Height = 420; $f.TopMost = $true; $f.ShowInTaskbar = $true
$f.MinimizeBox = $false; $f.MaximizeBox = $false; $f.ControlBox = $false; $f.FormBorderStyle = 'FixedDialog'
$box = New-Object System.Windows.Forms.TextBox
$box.Multiline = $true; $box.ReadOnly = $true; $box.ScrollBars = 'Vertical'; $box.Font = New-Object System.Drawing.Font('Consolas', 10); $box.SetBounds(12, 12, 680, 310); $box.Text = $rest; $text = $null; $box.Select(0, 0)
$copy = New-Object System.Windows.Forms.Button; $copy.Text = 'Copy all'; $copy.SetBounds(12, 336, 120, 32); $copy.Add_Click({ [System.Windows.Forms.Clipboard]::SetText($box.Text) })
$ok = New-Object System.Windows.Forms.Button; $ok.Text = 'OK, I have it'; $ok.SetBounds(530, 336, 162, 32); $ok.DialogResult = 'OK'
$ok.Add_Click({ try { [IO.File]::WriteAllText($AckFile, '1') } catch { } })
$f.AcceptButton = $ok; $f.Controls.AddRange(@($box, $copy, $ok))
# A window started by a hidden parent can inherit "hidden" from STARTUPINFO: force it visible, bring it to the front, and only then report that it is shown.
$f.Add_Shown({
        try {
            $f.WindowState = 'Normal'; [void][UN.Win]::ShowWindow($f.Handle, 1); $f.Activate(); [void][UN.Win]::SetForegroundWindow($f.Handle)
            if ([UN.Win]::IsWindowVisible($f.Handle)) { [IO.File]::WriteAllText($ShownFile, '1') }
        } catch { }
    })
[void]$f.ShowDialog(); $box.Text = ''; $f.Dispose()
exit 0
