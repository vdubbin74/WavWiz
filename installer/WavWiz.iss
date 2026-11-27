; WavWiz (BETA) installer. Compile:  ISCC /DAppVersion=0.0.4 /DDistDir=<dist> /DRepoDir=<repo> /DOutDir=<out> installer\WavWiz.iss   (build\make-installer.ps1 does this; works under Wine)
; FULL self-contained installer only: the target PCs have no .NET. There is no slim / framework-dependent variant.
#ifndef AppVersion
  #define AppVersion "0.7.3"
#endif
#ifndef RepoDir
  #define RepoDir ".."
#endif
#ifndef DistDir
  #define DistDir RepoDir + "\dist"
#endif
#ifndef OutDir
  #define OutDir DistDir + "\release"
#endif

[Setup]
AppId={{B5C2D7E1-4F3A-4B8E-9C61-57415657495A}
AppName=WavWiz (BETA)
AppVersion={#AppVersion}
AppVerName=WavWiz (BETA) {#AppVersion}
AppPublisher=WavWiz
VersionInfoVersion={#AppVersion}
VersionInfoCompany=WavWiz
VersionInfoDescription=WavWiz (BETA) Setup
VersionInfoProductName=WavWiz (BETA)
DefaultDirName={autopf}\WavWiz
DefaultGroupName=WavWiz (BETA)
DisableProgramGroupPage=yes
DisableWelcomePage=no
UsePreviousAppDir=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#OutDir}
OutputBaseFilename=WavWiz-Setup-{#AppVersion}
SetupIconFile={#RepoDir}\assets\logo\wavwiz.ico
UninstallDisplayIcon={app}\wavwiz.ico
UninstallDisplayName=WavWiz (BETA)
WizardStyle=modern
; 0.6.9 #17: 140 % (docs: 100-150, default 120) so the component / task check-list captions and the Network page fit at 200 % scaling
WizardSizePercent=140
WizardImageFile={#RepoDir}\installer\wizard-large-164.bmp,{#RepoDir}\installer\wizard-large-246.bmp,{#RepoDir}\installer\wizard-large-328.bmp
WizardSmallImageFile={#RepoDir}\installer\wizard-small-55.bmp,{#RepoDir}\installer\wizard-small-83.bmp,{#RepoDir}\installer\wizard-small-110.bmp
InfoBeforeFile={#RepoDir}\installer\info-before.txt
Compression=lzma2/max
SolidCompression=yes
LZMAUseSeparateProcess=yes
CloseApplications=yes
CloseApplicationsFilter=wavwiz-player.exe,wavwiz-server.exe,ffmpeg.exe
RestartApplications=no
RestartIfNeededByRun=no
SetupLogging=no
ShowLanguageDialog=no
UninstallLogMode=append

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Components]
Name: "server"; Description: "WavWiz Server (the PC that holds your music; runs as a Windows service)"; Types: full custom; Flags: checkablealone
Name: "player"; Description: "WavWiz Player (a PC with speakers; can be the same PC)"; Types: full custom; Flags: checkablealone

[Tasks]
Name: "autostart"; Description: "Start WavWiz Player when I sign in to Windows"; GroupDescription: "Player:"; Components: player
Name: "desktopicon"; Description: "Create a desktop shortcut for the WavWiz web page"; GroupDescription: "Extras:"; Flags: unchecked; Components: server
; F122: Player desktop shortcut (checked by default)
Name: "playerdesktop"; Description: "Create a desktop shortcut for WavWiz Player"; GroupDescription: "Extras:"; Components: player

[Files]
Source: "{#DistDir}\server\*"; DestDir: "{app}\Server"; Excludes: "*.pdb"; Flags: recursesubdirs ignoreversion; Components: server
Source: "{#DistDir}\player\*"; DestDir: "{app}\Player"; Excludes: "*.pdb"; Flags: recursesubdirs ignoreversion; Components: player
Source: "{#RepoDir}\installer\scripts\*.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "{#RepoDir}\docs\*.md"; DestDir: "{app}\docs"; Flags: ignoreversion
Source: "{#RepoDir}\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#DistDir}\licenses\*"; DestDir: "{app}\licenses"; Flags: recursesubdirs ignoreversion
Source: "{#DistDir}\BUILD-INFO.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoDir}\assets\logo\wavwiz.ico"; DestDir: "{app}"; Flags: ignoreversion
; wizard-time LAN address detection: extracted to the Setup temp folder
Source: "{#RepoDir}\installer\scripts\lib.ps1"; Flags: dontcopy
Source: "{#RepoDir}\installer\scripts\detect-lan.ps1"; Flags: dontcopy
Source: "{#RepoDir}\installer\scripts\netprofile.ps1"; Flags: dontcopy
; 0.2.2 T11: closes a running WavWiz (service, Player, receivers) before the files are replaced
Source: "{#RepoDir}\installer\scripts\close-wavwiz.ps1"; Flags: dontcopy

[Registry]
; All-users autostart for the player (removed on uninstall). The player also has its own per-user switch (tray menu).
Root: HKLM; Subkey: "SOFTWARE\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "WavWizPlayer"; ValueData: """{app}\Player\wavwiz-player.exe"" --autostart"; Flags: uninsdeletevalue; Tasks: autostart; Components: player

[Icons]
Name: "{group}\WavWiz Player (BETA)"; Filename: "{app}\Player\wavwiz-player.exe"; IconFilename: "{app}\wavwiz.ico"; Components: player
Name: "{autodesktop}\WavWiz Player (BETA)"; Filename: "{app}\Player\wavwiz-player.exe"; IconFilename: "{app}\wavwiz.ico"; Tasks: playerdesktop; Components: player
Name: "{group}\WavWiz logs and settings folder"; Filename: "{commonappdata}\WavWiz"
Name: "{group}\What next (read me first)"; Filename: "{app}\docs\FIRST-RUN.txt"; IconFilename: "{app}\wavwiz.ico"
Name: "{group}\Uninstall WavWiz (BETA)"; Filename: "{uninstallexe}"; IconFilename: "{app}\wavwiz.ico"

[Run]
; F121: Player first for set-up when the Player is installed; the browser is optional
Filename: "{app}\Player\wavwiz-player.exe"; Description: "{code:PlayerRunDesc}"; Flags: postinstall nowait skipifsilent runasoriginaluser; Components: player; Check: WantPlayer
Filename: "{code:FirstRunUrl}"; Description: "Open WavWiz in my browser instead"; Flags: postinstall shellexec skipifsilent unchecked; Check: HasFirstRun and WantPlayer
Filename: "{code:FirstRunUrl}"; Description: "Open WavWiz in my browser to finish set-up (choose the administrator password)"; Flags: postinstall shellexec skipifsilent; Check: HasFirstRun and not WantPlayer
; F122: offer the official WebView2 evergreen bootstrapper when it is missing (user opens it; never silent)
Filename: "https://go.microsoft.com/fwlink/p/?LinkId=2124703"; Description: "Download Microsoft Edge WebView2 (recommended for WavWiz Player)"; Flags: postinstall shellexec skipifsilent; Components: player; Check: WantPlayer and WebView2Missing
Filename: "{app}\docs\FIRST-RUN.txt"; Description: "Read the plain-language ""what next"" page"; Flags: postinstall shellexec skipifsilent unchecked

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\scripts\uninstall.ps1"" -Root ""{app}"" -Purge 0"; Flags: runhidden waituntilterminated; RunOnceId: "WavWizUninstKeep"; Check: not UninstPurge
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\scripts\uninstall.ps1"" -Root ""{app}"" -Purge 1"; Flags: runhidden waituntilterminated; RunOnceId: "WavWizUninstPurge"; Check: UninstPurge

[UninstallDelete]
Type: files; Name: "{app}\docs\FIRST-RUN.txt"
Type: files; Name: "{group}\WavWiz web page (BETA).url"
Type: files; Name: "{autodesktop}\WavWiz web page (BETA).url"
; F173: the whole install folder goes (after uninstall.ps1 stopped the service and every process); ProgramData\WavWiz is NOT touched here
Type: filesandordirs; Name: "{app}"
; F173: Start Menu group + desktop shortcuts, whatever Inno's own log missed (older installs, renamed links)
Type: filesandordirs; Name: "{group}"
Type: filesandordirs; Name: "{commonprograms}\WavWiz (BETA)"
Type: files; Name: "{commondesktop}\WavWiz Player (BETA).lnk"
Type: files; Name: "{commondesktop}\WavWiz web page (BETA).url"
Type: files; Name: "{userdesktop}\WavWiz Player (BETA).lnk"
Type: files; Name: "{userdesktop}\WavWiz web page (BETA).url"

[Code]
var
  NetPage, HostPage: TWizardPage;
  LanEdit, HostEdit: TNewEdit;
  LanDetected: Boolean;
  { F257/F268: listening choice (LanOnlyRadio = home network only, AllIfRadio = home network + Tailscale/VPN, SpecRadio = advanced
    specific address in LanEdit) is separate from the connection URL (ConnUrlLabel, read-only) }
  AllIfRadio, LanOnlyRadio, SpecRadio: TNewRadioButton;
  AirPlayOutCheck: TNewCheckBox; { 0.6.8-#14g: opt-in firewall rules for sending to AirPlay speakers }
  SvcPage: TWizardPage; LimitedSvcCheck: TNewCheckBox; { 0.7.0 item 3: offered only when the existing service runs as LocalSystem }
  ConnUrlLabel: TNewStaticText;
  DetectedLanIp: String;
  ExistingBindSeeded: String; { bind already in server.json when DetectLan seeded the box; empty = fresh install }
  SetupFailed: Boolean;
  UninstPurgeFlag: Boolean;
  UninstNeedsReboot: Boolean; { F173 }
  { 0.2.2 T11: what was running before setup closed it (started again after the install) }
  PrivTip: TNewStaticText;
  { F273: network type of the connected networks (netprofile.ps1 -> network-status.txt). NetCat '' = unknown (no answer: no card). }
  NetCat, NetName, NetKind: String;
  NetWarn: TPanel; NetWarnText: TNewStaticText; NetWarnBtn: TNewButton;   { Network page: short red bar }
  FinBuilt, FinSkipped: Boolean;   { Finish page: Skip for now lasts for that page }
  FinCard: TPanel; FinTitle, FinSteps, FinRow, FinLater, FinWait, FinSkip: TNewStaticText; FinOpenBtn, FinCheckBtn, FinFixBtn: TNewButton;
  ServiceWasRunning, PlayerWasRunning, PlayerRestartedFlag: Boolean;
  CloseFailure: String;

function GetTickCount: LongWord; external 'GetTickCount@kernel32.dll stdcall';

function IfThenStr(Cond: Boolean; const A, B: String): String;
begin
  if Cond then Result := A else Result := B;
end;

function SwitchPresent(const Name: String): Boolean;
var I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), '/' + Name) = 0 then begin Result := True; Exit; end;
end;

function BoolParam(const Name: String; Default: Boolean): Boolean;
var V: String;
begin
  V := ExpandConstant('{param:' + Name + '|}');
  if V = '' then Result := Default else Result := (V = '1') or (CompareText(V, 'yes') = 0) or (CompareText(V, 'true') = 0);
end;

function QuoteArg(const S: String): String;
begin
  { trailing backslashes before the closing quote would escape it: double them }
  Result := S;
  while (Length(Result) > 0) and (Result[Length(Result)] = '\') do Delete(Result, Length(Result), 1);
  Result := '"' + Result + '"';
end;

function IsDigits(const S: String): Boolean;
var I: Integer;
begin
  Result := Length(S) > 0;
  for I := 1 to Length(S) do if (S[I] < '0') or (S[I] > '9') then Result := False;
end;

function IsIPv4(const S: String): Boolean;
var Rest, Part: String; N, P: Integer;
begin
  Result := False; Rest := S; N := 0;
  while Rest <> '' do
  begin
    P := Pos('.', Rest);
    if P = 0 then begin Part := Rest; Rest := ''; end else begin Part := Copy(Rest, 1, P - 1); Rest := Copy(Rest, P + 1, Length(Rest)); if Rest = '' then Exit; end;
    if (not IsDigits(Part)) or (Length(Part) > 3) or (StrToIntDef(Part, 999) > 255) then Exit;
    N := N + 1;
  end;
  Result := N = 4;
end;

function IsHostName(const S: String): Boolean;
var I: Integer; C: Char;
begin
  Result := (Length(S) > 0) and (Length(S) < 254);
  for I := 1 to Length(S) do
  begin
    C := S[I];
    if not (((C >= 'a') and (C <= 'z')) or ((C >= 'A') and (C <= 'Z')) or ((C >= '0') and (C <= '9')) or (C = '.') or (C = '-')) then Result := False;
  end;
  if Result and ((S[1] = '.') or (S[1] = '-') or (S[Length(S)] = '.') or (S[Length(S)] = '-')) then Result := False;
end;

function WantServer: Boolean; begin Result := WizardIsComponentSelected('server'); end;
function WantPlayer: Boolean; begin Result := WizardIsComponentSelected('player'); end;
function RoleCode: String;
begin
  if WantServer and WantPlayer then Result := 'both' else if WantServer then Result := 'server' else Result := 'player';
end;

{ The address already chosen in an existing server.json (a Repair/upgrade offers it again). Looks for  "bindAddress": "x.x.x.x"  without a JSON parser. }
function ExistingBindAddress: String;
var A: AnsiString; S: String; P, Q: Integer;
begin
  Result := '';
  if not LoadStringFromFile(ExpandConstant('{commonappdata}\WavWiz\server.json'), A) then Exit;
  S := String(A); P := Pos('"bindAddress"', S); if P = 0 then Exit;
  S := Copy(S, P + 13, 200); P := Pos('"', S); if P = 0 then Exit;
  S := Copy(S, P + 1, 200); Q := Pos('"', S); if Q = 0 then Exit;
  Result := Copy(S, 1, Q - 1);
  if not IsIPv4(Result) then Result := '';
end;

{ F257-A R2: HTTPS port for the read-only connection URL. Upgrade: the saved "httpsPort" from server.json, '' when it cannot be read
  (then no full URL is shown). Fresh install (no server.json): setup.ps1's default 47443. }
function ExistingHttpsPort: String;
var A: AnsiString; S: String; P, I, N: Integer;
begin
  Result := '';
  if not LoadStringFromFile(ExpandConstant('{commonappdata}\WavWiz\server.json'), A) then begin Result := '47443'; Exit; end;
  S := String(A); P := Pos('"httpsPort"', S); if P = 0 then Exit;
  S := Copy(S, P + 11, 40); P := Pos(':', S); if P = 0 then Exit;
  S := Trim(Copy(S, P + 1, 40)); I := 1;
  while (I <= Length(S)) and (S[I] >= '0') and (S[I] <= '9') do I := I + 1;
  N := StrToIntDef(Copy(S, 1, I - 1), 0);
  if (N >= 1) and (N <= 65535) then Result := IntToStr(N);
end;

{ F257-A R2: full https URL only when both the address and the port are known, else '' }
function ConnUrl(Ip: String): String;
var Port: String;
begin
  Result := ''; Port := ExistingHttpsPort;
  if (Ip <> '') and (Port <> '') then Result := 'https://' + Ip + ':' + Port;
end;

{ F122: WebView2 runtime check (registry, same keys as install-player.ps1) + flag file written by install-player.ps1 }
function WebView2Missing: Boolean;
var K, Pv: String;
begin
  if FileExists(ExpandConstant('{commonappdata}\WavWiz\webview2-missing.txt')) then begin Result := True; Exit; end;
  K := 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  Result := True;
  if RegQueryStringValue(HKLM32, K, 'pv', Pv) then if (Pv <> '') and (Pv <> '0.0.0.0') then Result := False;
  if Result and IsWin64 then if RegQueryStringValue(HKLM64, K, 'pv', Pv) then if (Pv <> '') and (Pv <> '0.0.0.0') then Result := False;
  if Result then if RegQueryStringValue(HKCU, K, 'pv', Pv) then if (Pv <> '') and (Pv <> '0.0.0.0') then Result := False;
end;

function FirstRunUrl(Param: String): String;
var A: AnsiString;
begin
  Result := '';
  if LoadStringFromFile(ExpandConstant('{commonappdata}\WavWiz\first-run-url.txt'), A) then Result := Trim(String(A));
end;
function HasFirstRun: Boolean; begin Result := FirstRunUrl('') <> ''; end;

{ ---------------- F273: network type (replaces the old registry profile scan, which listed every network the PC ever joined) ---------------- }
function NetField(const Line: String; N: Integer): String;
var S: String; I, P: Integer;
begin
  S := Line; Result := '';
  for I := 0 to N do
  begin
    P := Pos('|', S);
    if P = 0 then begin if I = N then Result := S else Result := ''; Exit; end;
    if I = N then begin Result := Copy(S, 1, P - 1); Exit; end;
    S := Copy(S, P + 1, Length(S));
  end;
end;

{ network-status.txt: one line per connected network, category|name|kind|ifIndex|ipv4|isWavWizAdapter. The isWavWizAdapter=1 line decides. }
procedure ReadNetStatus;
var Lines: TArrayOfString; I: Integer;
begin
  NetCat := ''; NetName := ''; NetKind := '';
  if not LoadStringsFromFile(ExpandConstant('{commonappdata}\WavWiz\network-status.txt'), Lines) then Exit;
  for I := 0 to GetArrayLength(Lines) - 1 do
    if Trim(NetField(Lines[I], 5)) = '1' then
    begin
      NetCat := Lowercase(Trim(NetField(Lines[I], 0))); NetName := Trim(NetField(Lines[I], 1)); NetKind := Trim(NetField(Lines[I], 2));
      if (NetCat <> 'public') and (NetCat <> 'private') and (NetCat <> 'domain') then NetCat := '';
      if NetName = '' then NetName := 'your network';
      Exit;
    end;
end;

{ Runs netprofile.ps1 hidden, bounded (10 s inside the script, 12 s here), then reads the result. Failure = unknown (no card). Never blocks setup. }
function RunNetProfile(const Bind: String): Boolean;
var Exe, DoneFile: String; Code, N: Integer;
begin
  Result := False;
  try
    ExtractTemporaryFile('lib.ps1'); ExtractTemporaryFile('netprofile.ps1');
    ForceDirectories(ExpandConstant('{commonappdata}\WavWiz'));
    DoneFile := ExpandConstant('{tmp}\wavwiz-netprofile.done'); DeleteFile(DoneFile);
    Exe := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
    if Exec(Exe, '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + QuoteArg(ExpandConstant('{tmp}\netprofile.ps1')) + IfThenStr(Bind <> '', ' -Bind ' + Bind, '') + ' -DoneFile ' + QuoteArg(DoneFile), '', SW_HIDE, ewNoWait, Code) then
    begin
      N := 0;
      while (N < 24) and (not FileExists(DoneFile)) do begin Sleep(500); N := N + 1; end;
    end;
  except
    Log('F273: network type check could not run: ' + GetExceptionMessage);
  end;
  ReadNetStatus;
  Result := NetCat <> '';
  Log('F273: network type = ' + IfThenStr(NetCat = '', 'unknown', NetCat + ' "' + NetName + '" (' + NetKind + ')'));
end;

{ The only Windows Settings pages Setup opens (the same allowlist as the app). }
function NetSettingsUri: String;
begin
  if NetKind = 'Wi-Fi' then Result := 'ms-settings:network-wifi'
  else if NetKind = 'Ethernet' then Result := 'ms-settings:network-ethernet'
  else Result := 'ms-settings:network-status';
end;

{ Opens in the signed-in user's own session, not the elevated one. }
procedure OpenNetSettingsClick(Sender: TObject);
var Code: Integer;
begin
  if not ShellExecAsOriginalUser('open', NetSettingsUri, '', '', SW_SHOWNORMAL, ewNoWait, Code) then Log('F273: could not open ' + NetSettingsUri + ': ' + SysErrorMessage(Code));
end;

{ Starts a PowerShell script WITHOUT waiting for the process and polls two files instead: DoneFile (the script writes its exit code there as its last act) and current-step.txt.
  The wizard shows the step and can never wait forever: it gives up when the script has not started within StartLimitMs or has not finished within TotalLimitMs. }
function ExecPolled(const Exe, Params, DoneFile: String; StartLimitMs, TotalLimitMs: Integer; ShowSteps: Boolean; var ExitCode: Integer; var Why, LastStep: String): Boolean;
var Waited: Integer; Started: Boolean; Step: String; A: AnsiString; StepFile: String; T0, Tick: LongWord; PingCode: Integer;
begin
  Result := False; ExitCode := -1; Why := ''; LastStep := '';
  StepFile := ExpandConstant('{commonappdata}\WavWiz\current-step.txt');
  DeleteFile(DoneFile); DeleteFile(StepFile);
  if not Exec(Exe, Params, '', SW_HIDE, ewNoWait, ExitCode) then
  begin
    Why := 'Windows PowerShell could not be started (' + SysErrorMessage(ExitCode) + ').';
    Exit;
  end;
  Waited := 0; Started := False; T0 := GetTickCount;
  while Waited < TotalLimitMs do
  begin
    if FileExists(DoneFile) then
    begin
      if LoadStringFromFile(DoneFile, A) then ExitCode := StrToIntDef(Trim(String(A)), 1) else ExitCode := 1;
      Result := True;
      Exit;
    end;
    if FileExists(StepFile) then
      if LoadStringFromFile(StepFile, A) then
      begin
        Started := True;
        Step := Trim(String(A));
        if Step <> LastStep then
        begin
          LastStep := Step;
          if ShowSteps and (not WizardSilent) then
          begin
            if Copy(Step, 1, 5) = 'USER:' then WizardForm.StatusLabel.Caption := Trim(Copy(Step, 6, 400))
            else WizardForm.StatusLabel.Caption := 'Setting up WavWiz: ' + Step;
            WizardForm.StatusLabel.Update;
          end;
        end;
        if Copy(Step, 1, 5) = 'USER:' then T0 := GetTickCount;
      end;
    if (not Started) and (Integer(GetTickCount - T0) >= StartLimitMs) then
    begin
      Why := 'The setup script did not even start within ' + IntToStr(StartLimitMs div 1000) + ' seconds.';
      Exit;
    end;
    { wait about a second WITH the message loop running (Exec ... ewWaitUntilTerminated pumps messages), so the wizard stays responsive }
    Tick := GetTickCount;
    if not Exec(ExpandConstant('{sys}\ping.exe'), '-n 2 127.0.0.1', '', SW_HIDE, ewWaitUntilTerminated, PingCode) then Sleep(1000);
    if (GetTickCount - Tick) < 200 then Sleep(500);
    Waited := Integer(GetTickCount - T0);
  end;
  Why := 'The setup script did not finish within ' + IntToStr(TotalLimitMs div 1000) + ' seconds.';
end;

{ F257: run detect-lan.ps1 once (convenience only); returns '' when nothing usable was found }
function RunLanDetect: String;
var Exe, OutFile: String; Code: Integer; A: AnsiString;
begin
  Result := '';
  try
    ExtractTemporaryFile('lib.ps1'); ExtractTemporaryFile('detect-lan.ps1');
    OutFile := ExpandConstant('{tmp}\wavwiz-lan.txt');
    DeleteFile(OutFile);
    Exe := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
    { 12 s at most, hidden, never waits for input; failure just leaves the result empty }
    Exec(Exe, '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + QuoteArg(ExpandConstant('{tmp}\detect-lan.ps1')) + ' -OutFile ' + QuoteArg(OutFile), '', SW_HIDE, ewNoWait, Code);
    Code := 0;
    while (Code < 24) and (not FileExists(OutFile)) do begin Sleep(500); Code := Code + 1; end;
    if FileExists(OutFile) then
      if LoadStringFromFile(OutFile, A) then if IsIPv4(Trim(String(A))) then Result := Trim(String(A));
  except
    { detection is a convenience only }
  end;
end;

{ F268: True when the 'Home network + Tailscale/VPN (all networks)' choice is selected (bindAddress 0.0.0.0 + allowAllInterfaces). }
function KeepAllInterfaces: Boolean;
begin
  Result := AllIfRadio.Checked;
end;

{ F268: the address that will be passed to setup.ps1 for the non-wildcard choices ('' = this PC only / 127.0.0.1) }
function ChosenLanAddress: String;
begin
  if LanOnlyRadio.Checked then Result := DetectedLanIp else Result := Trim(LanEdit.Text);
end;

{ F257: read-only connection URL, shown separately from the listening interface. Never an editable 0.0.0.0. }
procedure UpdateNetChoice;
var U: String;
begin
  LanEdit.Enabled := SpecRadio.Checked;
  if DetectedLanIp <> '' then
    LanOnlyRadio.Caption := 'Home network only (recommended) - this PC: ' + DetectedLanIp
  else
    LanOnlyRadio.Caption := 'Home network only (recommended) - address not found, use Advanced below';
  U := '';
  if KeepAllInterfaces then U := DetectedLanIp
  else if IsIPv4(ChosenLanAddress) and (ChosenLanAddress <> '127.0.0.1') then U := ChosenLanAddress;
  if ConnUrl(U) <> '' then
    ConnUrlLabel.Caption := 'Phones on your home network connect at:  ' + ConnUrl(U) + '   (read-only, for information)'
  else if KeepAllInterfaces then
    ConnUrlLabel.Caption := 'Phones connect at this PC''s home-network address (see WavWiz Settings > Devices > Phone & HTTPS for the exact link). This does not change what the server listens on.'
  else
    ConnUrlLabel.Caption := '';
end;

procedure NetChoiceClick(Sender: TObject);
begin
  if SpecRadio.Checked and (Trim(LanEdit.Text) = '') then LanEdit.Text := DetectedLanIp;
  UpdateNetChoice;
end;

procedure LanEditChange(Sender: TObject);
begin
  UpdateNetChoice;
end;

{ F268: preselect the choice. Upgrade: match the existing server.json (0.0.0.0 -> all networks; the detected LAN address -> home
  network only; any other address -> Advanced with that address). The detected LAN address NEVER replaces an existing 0.0.0.0 unless
  the person picks 'Home network only'. Fresh: home network only. /LANIP=x (silent) -> Advanced x; /NETWORK=all|home picks a choice. }
procedure DetectLan;
var Cli, Net: String;
begin
  if LanDetected then Exit;
  LanDetected := True;
  Cli := Trim(LanEdit.Text);
  Net := Lowercase(Trim(ExpandConstant('{param:NETWORK|}')));
  ExistingBindSeeded := ExistingBindAddress;
  if (not WizardSilent) or (ExistingBindSeeded = '') or ((Cli = '') and (Net = 'home')) then DetectedLanIp := RunLanDetect;
  if Cli = '0.0.0.0' then begin Cli := ''; LanEdit.Text := ''; if Net = '' then Net := 'all'; end;
  if Net = 'all' then AllIfRadio.Checked := True
  else if Cli <> '' then SpecRadio.Checked := True
  else if (Net = 'home') and (DetectedLanIp <> '') then LanOnlyRadio.Checked := True
  else if ExistingBindSeeded = '0.0.0.0' then AllIfRadio.Checked := True
  else if ExistingBindSeeded <> '' then
  begin
    if (DetectedLanIp <> '') and (CompareText(ExistingBindSeeded, DetectedLanIp) = 0) then LanOnlyRadio.Checked := True
    else begin LanEdit.Text := ExistingBindSeeded; SpecRadio.Checked := True; end;
  end
  else if DetectedLanIp <> '' then LanOnlyRadio.Checked := True
  else SpecRadio.Checked := True;
  UpdateNetChoice;
end;

procedure InitializeWizard;
var L, ApNote: TNewStaticText; Y, W: Integer;
begin
  NetPage := CreateCustomPage(wpSelectComponents, 'Network access (BETA)', 'Which devices may reach the WavWiz server?');
  { 0.6.9 #17: the Network page flows top to bottom from each control's real height (TNewStaticText.AdjustHeight) instead of fixed 100 % offsets,
    so nothing is clipped or overlapped at 200 % scaling; option rows are ScaleY(20) tall (the check / radio glyph plus text), and the long AirPlay
    caption is split into a short check box caption and a wrapping note under it (TNewCheckBox has no WordWrap in Inno Setup). }
  W := NetPage.SurfaceWidth;
  L := TNewStaticText.Create(NetPage); L.Parent := NetPage.Surface; L.WordWrap := True; L.AutoSize := False; L.SetBounds(0, 0, W, ScaleY(56));
  L.Caption := 'Phones and other PCs on your home network always work. Choose the second option if you also want to reach WavWiz from your phone through Tailscale or another VPN when you are away. An upgrade keeps the setting you already have.';
  L.AdjustHeight; Y := L.Top + L.Height + ScaleY(6);
  { F268: two plain choices (+ an advanced escape); the all-networks choice never shows an address }
  LanOnlyRadio := TNewRadioButton.Create(NetPage); LanOnlyRadio.Parent := NetPage.Surface; LanOnlyRadio.SetBounds(0, Y, W, ScaleY(20)); Y := Y + ScaleY(23);
  LanOnlyRadio.Caption := 'Home network only (recommended)'; LanOnlyRadio.OnClick := @NetChoiceClick;
  AllIfRadio := TNewRadioButton.Create(NetPage); AllIfRadio.Parent := NetPage.Surface; AllIfRadio.SetBounds(0, Y, W, ScaleY(20)); Y := Y + ScaleY(27);
  AllIfRadio.Caption := 'Home network + Tailscale/VPN (all networks)'; AllIfRadio.OnClick := @NetChoiceClick;
  SpecRadio := TNewRadioButton.Create(NetPage); SpecRadio.Parent := NetPage.Surface; SpecRadio.SetBounds(0, Y, W, ScaleY(20)); Y := Y + ScaleY(22);
  SpecRadio.Caption := 'Advanced: a specific address (127.0.0.1 = this PC only):'; SpecRadio.OnClick := @NetChoiceClick;
  LanEdit := TNewEdit.Create(NetPage); LanEdit.Parent := NetPage.Surface; LanEdit.SetBounds(ScaleX(18), Y, ScaleX(200), ScaleY(23)); LanEdit.OnChange := @LanEditChange; Y := Y + ScaleY(29);
  ConnUrlLabel := TNewStaticText.Create(NetPage); ConnUrlLabel.Parent := NetPage.Surface; ConnUrlLabel.WordWrap := True; ConnUrlLabel.AutoSize := False; ConnUrlLabel.SetBounds(0, Y, W, ScaleY(30)); ConnUrlLabel.Caption := ''; Y := Y + ScaleY(32);
  { F122: Private-network tip (static) + amber warning when a Public profile is found }
  { 0.6.8-#14g: opt-in, remembered on reinstall (previous-data), /AIRPLAYOUT=1|0 for silent installs }
  AirPlayOutCheck := TNewCheckBox.Create(NetPage); AirPlayOutCheck.Parent := NetPage.Surface; AirPlayOutCheck.SetBounds(0, Y, W, ScaleY(20)); Y := Y + ScaleY(21);
  AirPlayOutCheck.Caption := 'Allow AirPlay speakers through the firewall';
  AirPlayOutCheck.Checked := Trim(ExpandConstant('{param:AIRPLAYOUT|' + GetPreviousData('AirPlayOut', '0') + '}')) = '1';
  ApNote := TNewStaticText.Create(NetPage); ApNote.Parent := NetPage.Surface; ApNote.WordWrap := True; ApNote.AutoSize := False; ApNote.SetBounds(ScaleX(18), Y, W - ScaleX(18), ScaleY(14));
  ApNote.Caption := 'AirPlay 2 timing (UDP 319-320) is always allowed on the home network. Tick this for extra AirPlay audio UDP ports.'; ApNote.FocusControl := AirPlayOutCheck; ApNote.AdjustHeight; Y := ApNote.Top + ApNote.Height + ScaleY(8);
  PrivTip := TNewStaticText.Create(NetPage); PrivTip.Parent := NetPage.Surface; PrivTip.WordWrap := True; PrivTip.AutoSize := False; PrivTip.SetBounds(0, Y, W, NetPage.SurfaceHeight - Y); { F257-A R1: fills the rest of the page at any DPI }
  PrivTip.Caption := 'Tip: Windows should list this Wi-Fi/Ethernet as Private (not Public), or phones and discovery may fail.';
  { F273: short red bar instead of the tip when the network WavWiz uses is Public (the full 3 steps are on the Finish page) }
  NetWarn := TPanel.Create(NetPage); NetWarn.Parent := NetPage.Surface; NetWarn.BevelOuter := bvNone; NetWarn.ParentBackground := False; NetWarn.Color := $1C1CB8; { BGR: dark red }
  NetWarn.SetBounds(0, Y, W, ScaleY(62)); NetWarn.Visible := False;
  NetWarnText := TNewStaticText.Create(NetPage); NetWarnText.Parent := NetWarn; NetWarnText.WordWrap := True; NetWarnText.AutoSize := False;
  NetWarnText.SetBounds(ScaleX(8), ScaleY(5), W - ScaleX(168), ScaleY(52)); NetWarnText.Font.Color := clWhite; NetWarnText.Font.Style := [fsBold];
  NetWarnBtn := TNewButton.Create(NetPage); NetWarnBtn.Parent := NetWarn; NetWarnBtn.SetBounds(W - ScaleX(152), ScaleY(17), ScaleX(144), ScaleY(26));
  NetWarnBtn.Caption := 'Open network settings'; NetWarnBtn.OnClick := @OpenNetSettingsClick;
  { 0.7.0 item 3: an upgrade keeps the service account; a LocalSystem service may switch to Local Service (default off, /LIMITEDSERVICE=1) }
  SvcPage := CreateCustomPage(NetPage.ID, 'Service account (BETA)', 'WavWiz Server currently runs as LocalSystem (full control of this PC).');
  L := TNewStaticText.Create(SvcPage); L.Parent := SvcPage.Surface; L.WordWrap := True; L.AutoSize := False; L.SetBounds(0, 0, SvcPage.SurfaceWidth, ScaleY(84));
  L.Caption := 'New installations run WavWiz Server as Local Service, a limited account that can still read CDs and its own data. Your existing service runs as LocalSystem. You can switch it now, or keep it as it is.';
  LimitedSvcCheck := TNewCheckBox.Create(SvcPage); LimitedSvcCheck.Parent := SvcPage.Surface; LimitedSvcCheck.SetBounds(0, ScaleY(90), SvcPage.SurfaceWidth, ScaleY(17));
  LimitedSvcCheck.Caption := 'Switch WavWiz Server to Local Service (recommended)';
  LimitedSvcCheck.Checked := Trim(ExpandConstant('{param:LIMITEDSERVICE|0}')) = '1';
  L := TNewStaticText.Create(SvcPage); L.Parent := SvcPage.Surface; L.WordWrap := True; L.AutoSize := False; L.SetBounds(0, ScaleY(116), SvcPage.SurfaceWidth, SvcPage.SurfaceHeight - ScaleY(116));
  L.Caption := 'After switching: saved network-share logins, remote-library passwords and the remote-access certificate password have to be entered again (Windows ties them to the service account). Music folders inside your user profile may need access for the service; Help > Diagnostics lists any folder it cannot read and how to allow it.';
  HostPage := CreateCustomPage(SvcPage.ID, 'Where is the WavWiz server? (BETA)', 'WavWiz Player needs the address of the PC that runs WavWiz Server.');
  L := TNewStaticText.Create(HostPage); L.Parent := HostPage.Surface; L.WordWrap := True; L.AutoSize := False; L.SetBounds(0, 0, HostPage.SurfaceWidth, ScaleY(70));
  L.Caption := 'Enter the home-network address (for example 192.168.1.20) or the name of the PC that has WavWiz Server installed. You can leave it empty and enter it later in the player (tray icon > Server).';
  L.AdjustHeight;   { 0.6.9 #17 }
  HostEdit := TNewEdit.Create(HostPage); HostEdit.Parent := HostPage.Surface; HostEdit.SetBounds(0, L.Top + L.Height + ScaleY(10), ScaleX(260), ScaleY(23));
  { command-line seeds (silent installs): /LANIP=192.168.1.20  /SERVERHOST=192.168.1.20 }
  LanEdit.Text := Trim(ExpandConstant('{param:LANIP|}'));
  HostEdit.Text := Trim(ExpandConstant('{param:SERVERHOST|}'));
  WizardForm.WelcomeLabel2.Caption := WizardForm.WelcomeLabel2.Caption + #13#10#13#10 + 'This is a BETA version ({#AppVersion}).';
end;

{ 0.7.0 item 3: the existing WavWiz Server service's account (services key ObjectName; sc qc prints the same value) }
function ServiceRunsAsLocalSystem: Boolean;
var A: String;
begin
  Result := False;
  if RegQueryStringValue(HKLM, 'SYSTEM\CurrentControlSet\Services\WavWizServer', 'ObjectName', A) then
  begin
    A := Trim(A);
    Result := (CompareText(A, 'LocalSystem') = 0) or (CompareText(A, '.\LocalSystem') = 0) or (CompareText(A, 'NT AUTHORITY\SYSTEM') = 0) or (CompareText(A, 'SYSTEM') = 0);
  end;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if PageID = NetPage.ID then Result := not WantServer;
  if PageID = SvcPage.ID then Result := (not WantServer) or (not ServiceRunsAsLocalSystem);   { 0.7.0 item 3 }
  if PageID = HostPage.ID then Result := WantServer or (not WantPlayer);
end;

{ ---------------- F273: Finish page = the what-next checklist, "Check your network" first ----------------
  1 Check your network (Private = green row; Public = high-contrast card with the 3 steps, Open network settings, Check again; Domain = info card;
  unknown = plain row). 2-4 Open WavWiz on this PC / on your phone / add speakers - dimmed while Public under "Fix your network first - Skip for now".
  The Run check boxes keep their state and Finish always works: Setup never blocks on the network. }
procedure LayoutFinish; forward;

procedure FinCheckClick(Sender: TObject);
begin
  FinCheckBtn.Caption := 'Checking...'; FinCheckBtn.Enabled := False; WizardForm.Update;
  RunNetProfile(ExistingBindAddress);
  FinCheckBtn.Caption := 'Check again'; FinCheckBtn.Enabled := True;
  LayoutFinish;
end;

procedure FinSkipClick(Sender: TObject);
begin
  FinSkipped := True; LayoutFinish;
end;

procedure FinFixClick(Sender: TObject);
begin
  FinSkipped := False; LayoutFinish;
end;

function FinLabel(Parent: TWinControl; Bold: Boolean): TNewStaticText;
begin
  Result := TNewStaticText.Create(WizardForm); Result.Parent := Parent; Result.WordWrap := True; Result.AutoSize := False;
  if Bold then Result.Font.Style := [fsBold];
end;

function FinButton(Parent: TWinControl; const Caption: String; Click: TNotifyEvent): TNewButton;
begin
  Result := TNewButton.Create(WizardForm); Result.Parent := Parent; Result.Caption := Caption; Result.OnClick := Click;
end;

procedure LayoutFinish;
var Y, W, CY, CW, I: Integer; Pub, Wait, Upgrade: Boolean; Addr: String; Lbl: TNewStaticText;
begin
  Lbl := WizardForm.FinishedLabel; W := Lbl.Width;
  if not FinBuilt then
  begin
    FinBuilt := True;
    FinCard := TPanel.Create(WizardForm); FinCard.Parent := Lbl.Parent; FinCard.BevelOuter := bvNone; FinCard.ParentBackground := False;
    FinTitle := FinLabel(FinCard, True); FinSteps := FinLabel(FinCard, False);
    FinOpenBtn := FinButton(FinCard, 'Open network settings', @OpenNetSettingsClick);
    FinCheckBtn := FinButton(FinCard, 'Check again', @FinCheckClick);
    FinFixBtn := FinButton(FinCard, 'Fix', @FinFixClick);
    FinRow := FinLabel(Lbl.Parent, True); FinLater := FinLabel(Lbl.Parent, False); FinWait := FinLabel(Lbl.Parent, False);
    FinSkip := FinLabel(Lbl.Parent, False); FinSkip.WordWrap := False; FinSkip.AutoSize := True; FinSkip.Caption := 'Skip for now';
    FinSkip.Font.Style := [fsUnderline]; FinSkip.Font.Color := $CC6600; { BGR: link blue } FinSkip.Cursor := crHand; FinSkip.OnClick := @FinSkipClick;
  end;
  Pub := NetCat = 'public'; Wait := Pub and (not FinSkipped); Upgrade := ExistingBindSeeded <> '';
  Lbl.Caption := 'WavWiz is installed. What next:'; Lbl.AdjustHeight;
  Y := Lbl.Top + Lbl.Height + ScaleY(6);
  CW := W - ScaleX(16);
  FinCard.Visible := False; FinRow.Visible := False; FinOpenBtn.Visible := False; FinCheckBtn.Visible := False; FinFixBtn.Visible := False; FinSteps.Visible := False;
  if Pub and (not FinSkipped) then
  begin
    { high contrast: amber fill, near-black text (AA well above 4.5:1), the same look as the app's card }
    FinCard.Color := $20B0FF; FinCard.Visible := True; FinCard.SetBounds(Lbl.Left, Y, W, ScaleY(40));
    FinTitle.Font.Color := $00101A; FinSteps.Font.Color := $00101A;
    FinTitle.SetBounds(ScaleX(8), ScaleY(6), CW, ScaleY(30));
    FinTitle.Caption := '1. ' + #$26A0 + ' Your network "' + NetName + '" is set to Public, so phones and other devices can''t find WavWiz.'; FinTitle.AdjustHeight;
    CY := FinTitle.Top + FinTitle.Height + ScaleY(3);
    FinSteps.Visible := True; FinSteps.SetBounds(ScaleX(8), CY, CW, ScaleY(60));
    FinSteps.Caption := 'Switch it to Private (only on your own home network):' + #13#10 +
      '   1. Click Open network settings.' + #13#10 +
      IfThenStr(NetKind = 'Ethernet', '   2. Click Ethernet.', '   2. Click your network ("' + NetName + '").') + #13#10 +
      '   3. Under Network profile type, choose Private.' + #13#10 +
      'If Windows asks for an administrator, sign in with one.';
    FinSteps.AdjustHeight; CY := FinSteps.Top + FinSteps.Height + ScaleY(5);
    FinOpenBtn.Visible := True; FinOpenBtn.SetBounds(ScaleX(8), CY, ScaleX(150), ScaleY(24)); FinOpenBtn.Default := False;
    FinCheckBtn.Visible := True; FinCheckBtn.SetBounds(ScaleX(166), CY, ScaleX(96), ScaleY(24));
    FinCard.Height := CY + ScaleY(30);
    Y := FinCard.Top + FinCard.Height + ScaleY(6);
  end
  else if Pub then
  begin
    { Skip for now: one red row, never hidden }
    FinCard.Color := $CCD2FF; FinCard.Visible := True; FinCard.SetBounds(Lbl.Left, Y, W, ScaleY(30));
    FinTitle.Font.Color := $00084A; FinTitle.SetBounds(ScaleX(8), ScaleY(7), CW - ScaleX(60), ScaleY(18));
    FinTitle.Caption := '1. ' + #$26A0 + ' Network is Public: phones won''t connect.';
    FinFixBtn.Visible := True; FinFixBtn.SetBounds(W - ScaleX(58), ScaleY(3), ScaleX(50), ScaleY(24));
    Y := FinCard.Top + FinCard.Height + ScaleY(6);
  end
  else if NetCat = 'domain' then
  begin
    FinCard.Color := $FFE3CF; FinCard.Visible := True; FinCard.SetBounds(Lbl.Left, Y, W, ScaleY(40));
    FinTitle.Font.Color := $30180A; FinTitle.SetBounds(ScaleX(8), ScaleY(6), CW, ScaleY(30));
    FinTitle.Caption := '1. This PC is on a work (domain) network, so phones may not find WavWiz. Ask whoever manages this PC.'; FinTitle.AdjustHeight;
    FinCard.Height := FinTitle.Height + ScaleY(12);
    Y := FinCard.Top + FinCard.Height + ScaleY(6);
  end
  else
  begin
    FinRow.Visible := True; FinRow.SetBounds(Lbl.Left, Y, W, ScaleY(30));
    if NetCat = 'private' then begin FinRow.Font.Color := $1E7A1E; FinRow.Font.Style := [fsBold]; FinRow.Caption := '1. ' + #$2713 + ' Your network "' + NetName + '" is Private. Phones can connect.'; end
    else begin FinRow.Font.Color := clWindowText; FinRow.Font.Style := []; FinRow.Caption := '1. Couldn''t check your network type. If your phone can''t connect, make sure Windows has it set to Private.'; end;
    FinRow.AdjustHeight; Y := FinRow.Top + FinRow.Height + ScaleY(6);
  end;
  { steps 2-4 (an upgrade on a Private network: the compact green row only) }
  Addr := FirstRunUrl(''); if Addr = '' then Addr := 'http://' + IfThenStr(DetectedLanIp <> '', DetectedLanIp, '<this PC>') + ':47800';
  FinLater.Visible := not (Upgrade and (NetCat = 'private'));
  FinLater.Caption := '2. Open WavWiz on this PC and choose your admin password.' + #13#10 + '3. Open it on your phone: ' + Addr + #13#10 + '4. Add your speakers in Devices.';
  FinLater.SetBounds(Lbl.Left, Y, W, ScaleY(48)); FinLater.AdjustHeight; FinLater.Enabled := not Wait;
  if FinLater.Visible then Y := FinLater.Top + FinLater.Height + ScaleY(4);
  FinWait.Visible := Wait; FinSkip.Visible := Wait;
  if Wait then
  begin
    FinWait.Caption := 'Fix your network first  ' + #$00B7 + ' '; FinWait.WordWrap := False; FinWait.AutoSize := True; FinWait.Left := Lbl.Left; FinWait.Top := Y; FinWait.Font.Style := [fsBold];
    FinSkip.Left := FinWait.Left + FinWait.Width + ScaleX(2); FinSkip.Top := Y;
    Y := Y + FinWait.Height + ScaleY(6);
  end;
  { the Run check boxes: grayed while Public (they keep their checked state; Finish still runs them) }
  WizardForm.RunList.Top := Y; WizardForm.RunList.Height := WizardForm.RunList.Parent.ClientHeight - Y - ScaleY(4);
  WizardForm.RunList.Enabled := not Wait;
  if Pub then
    for I := 0 to WizardForm.RunList.Items.Count - 1 do
      if Pos('what next', Lowercase(WizardForm.RunList.ItemCaption[I])) > 0 then WizardForm.RunList.Checked[I] := True;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = NetPage.ID then
  begin
    WizardForm.NextButton.Enabled := False;
    WizardForm.Update;
    DetectLan;
    { F273: the CONNECTED network that WavWiz will use (netprofile.ps1), not every saved profile. Setup never changes it; Next always works. }
    RunNetProfile(DetectedLanIp);
    NetWarn.Visible := NetCat = 'public'; PrivTip.Visible := not NetWarn.Visible;
    if NetWarn.Visible then
    begin
      Log('NOTE: the network "' + NetName + '" is Public. WavWiz needs Private for phones and discovery. Setup does not change it.');
      NetWarnText.Caption := #$26A0 + ' Your network "' + NetName + '" is set to Public, so phones and other devices can''t find WavWiz. The last page of Setup shows how to switch it to Private.';
    end;
    WizardForm.NextButton.Enabled := True;
  end;
  if CurPageID = wpFinished then
  begin
    if SetupFailed then WizardForm.FinishedLabel.Caption := WizardForm.FinishedLabel.Caption + #13#10#13#10 + 'Setup did not finish cleanly. The log is C:\ProgramData\WavWiz\install.log'
    else if WantServer and (not WizardSilent) then begin ReadNetStatus; LayoutFinish; end;   { F273: the what-next checklist, network first }
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var V: String;
begin
  Result := True;
  if CurPageID = wpSelectComponents then
    if (not WantServer) and (not WantPlayer) then begin SuppressibleMsgBox('Choose at least one part to install.', mbError, MB_OK, IDOK); Result := False; Exit; end;
  if CurPageID = NetPage.ID then
  begin
    if KeepAllInterfaces then Exit; { F268: all networks; no address to validate or show }
    if LanOnlyRadio.Checked then
    begin
      if DetectedLanIp = '' then
      begin
        SuppressibleMsgBox('This PC''s home-network address could not be found. Choose "Advanced" and type it (see Windows Settings > Network), or choose "Home network + Tailscale/VPN".', mbError, MB_OK, IDOK);
        Result := False;
      end;
      Exit;
    end;
    V := Trim(LanEdit.Text);
    if V = '' then
    begin
      if SuppressibleMsgBox('No address was entered. WavWiz will then listen on this PC only (127.0.0.1) and phones cannot connect until you set an address. Continue anyway?', mbConfirmation, MB_YESNO, IDYES) <> IDYES then Result := False;
    end
    else if V = '0.0.0.0' then
    begin
      { F268: typed 0.0.0.0 = the 'Home network + Tailscale/VPN (all networks)' choice }
      LanEdit.Text := ''; AllIfRadio.Checked := True; UpdateNetChoice;
    end
    else if not IsIPv4(V) then
    begin
      SuppressibleMsgBox('Please enter one IPv4 address such as 192.168.1.20.', mbError, MB_OK, IDOK); Result := False;
    end;
  end;
  if CurPageID = HostPage.ID then
  begin
    V := Trim(HostEdit.Text);
    if (V <> '') and (not IsHostName(V)) then begin SuppressibleMsgBox('That does not look like an address or PC name. Use letters, digits, dots and dashes only.', mbError, MB_OK, IDOK); Result := False; end;
  end;
end;

{ 0.6.8-#14g: remember the AirPlay speakers firewall choice for the next install }
procedure RegisterPreviousData(PreviousDataKey: Integer);
begin
  if AirPlayOutCheck.Checked then SetPreviousData(PreviousDataKey, 'AirPlayOut', '1') else SetPreviousData(PreviousDataKey, 'AirPlayOut', '0');
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := 'WavWiz (BETA) {#AppVersion}' + NewLine + NewLine + MemoDirInfo + NewLine + NewLine + MemoComponentsInfo + NewLine + NewLine;
  if WantServer and KeepAllInterfaces then Result := Result + 'Network access: Home network + Tailscale/VPN (all networks)' + NewLine + Space + IfThenStr(ConnUrl(DetectedLanIp) = '', 'Connect link: see WavWiz Settings > Devices > Phone & HTTPS', 'Connect at ' + ConnUrl(DetectedLanIp)) + NewLine + NewLine
  else if WantServer then Result := Result + 'Network access: ' + IfThenStr(LanOnlyRadio.Checked, 'Home network only (' + ChosenLanAddress + ')', IfThenStr(ChosenLanAddress = '', '127.0.0.1 (this PC only)', ChosenLanAddress)) + NewLine + Space + 'Windows service "WavWiz Server (BETA)" + a private-network-only firewall rule' + NewLine + NewLine;
  if WantServer then Result := Result + 'Firewall: AirPlay 2 timing (UDP 319-320) on the home network' + IfThenStr(AirPlayOutCheck.Checked, ' + extra AirPlay audio UDP ports', '') + NewLine + NewLine;   { 0.6.8-#14g / 0.7.0 t1930 }
  if WantServer and ServiceRunsAsLocalSystem then Result := Result + 'Service account: ' + IfThenStr(LimitedSvcCheck.Checked, 'switch from LocalSystem to Local Service', 'keep LocalSystem') + NewLine + NewLine;   { 0.7.0 item 3 }
  if WantPlayer and (not WantServer) then Result := Result + 'Player will connect to: ' + IfThenStr(Trim(HostEdit.Text) = '', '(ask on first start)', Trim(HostEdit.Text)) + NewLine + NewLine;
  Result := Result + MemoTasksInfo;
end;

function FirstRunText: String;
begin
  { F273: the same four steps as the Finish page and the app's Getting started; step 1 = Check your network }
  Result := 'WavWiz (BETA) {#AppVersion} - what next' + #13#10#13#10 +
    '1. Check your network. Windows must have your home network set to Private, or phones and other PCs cannot find WavWiz (its firewall rules only open on Private networks). To switch it (only on your own home network):' + #13#10 +
    '   a. Open Windows Settings > Network & internet.' + #13#10 +
    '   b. Click your Wi-Fi network (or Ethernet).' + #13#10 +
    '   c. Under "Network profile type", choose Private. If Windows asks for an administrator, sign in with one.' + #13#10 +
    '   On a work (domain) PC you usually cannot change this: ask whoever manages the PC.' + #13#10 +
    '2. Open WavWiz on this PC (WavWiz Player, or the web page the last installer page offered) and choose the administrator password. Nothing was generated for you. Getting started then walks you through the rest: your music folder, a speaker, a test sound.' + #13#10 +
    '3. Open it on your phone: scan the QR code in Getting started, or type this PC''s address (like http://192.168.1.20:47800) in the phone''s browser. For calibrating with the phone microphone, also follow Settings > Devices > Phone & HTTPS. A phone can also play as a speaker itself (Devices > Phone role…).' + #13#10 +
    '4. Add your speakers in Devices. On each PC with speakers, start WavWiz Player: it finds this server by itself. Press Connect and approve it on any screen signed in as administrator (check the 4-digit code), or type the 6-digit code from Settings > Devices > Pair a phone or a PC player.' + #13#10#13#10 +
    'Each device has a Test sound button, and Menu > Diagnostics explains problems in plain English.' + #13#10 +
    'Logs and settings: C:\ProgramData\WavWiz (install.log, server.json, network-status.txt, logs\).' + #13#10 +
    'This is a BETA. If something fails, install.log says what and where.' + #13#10;
end;

function PlayerRestarted: Boolean; begin Result := PlayerRestartedFlag; end;

{ F121: finish-page Player wording (first run vs upgrade) }
function PlayerRunDesc(Param: String): String;
begin
  if HasFirstRun then Result := 'Open WavWiz Player to finish set-up (choose the administrator password)'
  else Result := 'Open WavWiz Player now';
end;

{ 0.2.2 T11: close a running WavWiz before any file is replaced. close-wavwiz.ps1 (hidden, elevated) stops the service, asks every Player to exit and
  ends it after a timeout, ends leftovers from the install folder (receivers, ffmpeg) and retries until no file is locked. The wizard shows a friendly
  "Closing WavWiz..." page meanwhile and never waits more than 2 minutes. If the script cannot run at all, sc stop + taskkill are the fallback and
  Inno's own Restart Manager / file-replace retries take over. Returns '' (go on) or the reason it truly could not close WavWiz. }
function CloseRunningWavWiz: String;
var
  Exe, Params, DoneFile, StateFile, StepFile, Step, LastStep: String; A: AnsiString;
  Code, PingCode: Integer; T0: LongWord; Finished: Boolean; Page: TOutputProgressWizardPage;
begin
  Result := ''; ServiceWasRunning := False; PlayerWasRunning := False;
  Page := nil;
  if not WizardSilent then
  begin
    Page := CreateOutputProgressPage('Closing WavWiz' + #$2026, 'If WavWiz is running, Setup closes it so its files can be updated. Whatever it closes starts again when Setup is done.');
    Page.SetText('Closing WavWiz' + #$2026, '');
    Page.ProgressBar.Style := npbstMarquee;
    Page.Show;
  end;
  try
    ExtractTemporaryFile('lib.ps1'); ExtractTemporaryFile('close-wavwiz.ps1');
    DoneFile := ExpandConstant('{tmp}\close.done'); StateFile := ExpandConstant('{tmp}\close.state');
    StepFile := ExpandConstant('{commonappdata}\WavWiz\current-step.txt');
    DeleteFile(DoneFile); DeleteFile(StateFile);
    Exe := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
    Params := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + QuoteArg(ExpandConstant('{tmp}\close-wavwiz.ps1')) + ' -Root ' + QuoteArg(ExpandConstant('{app}')) +
      ' -StateFile ' + QuoteArg(StateFile) + ' -DoneFile ' + QuoteArg(DoneFile);
    Finished := False; LastStep := '';
    if Exec(Exe, Params, '', SW_HIDE, ewNoWait, Code) then
    begin
      T0 := GetTickCount;
      while Integer(GetTickCount - T0) < 120000 do
      begin
        if FileExists(DoneFile) then begin Finished := True; Break; end;
        if (Page <> nil) and FileExists(StepFile) and LoadStringFromFile(StepFile, A) then
        begin
          Step := Trim(String(A));
          if (Step <> LastStep) and (Copy(Step, 1, 5) = 'USER:') then
          begin
            LastStep := Step; StringChangeEx(Step, '...', #$2026, True);
            Page.SetText(Trim(Copy(Step, 6, 400)), '');
          end;
        end;
        { about a second with the message loop running }
        if not Exec(ExpandConstant('{sys}\ping.exe'), '-n 2 127.0.0.1', '', SW_HIDE, ewWaitUntilTerminated, PingCode) then Sleep(1000);
      end;
    end;
    if Finished then
    begin
      if LoadStringFromFile(StateFile, A) then
      begin
        ServiceWasRunning := (Pos('service=RUNNING', String(A)) > 0) or (Pos('service=START_PENDING', String(A)) > 0) or (Pos('service=PAUSED', String(A)) > 0);
        PlayerWasRunning := Pos('player=1', String(A)) > 0;
      end;
      Code := 1; if LoadStringFromFile(DoneFile, A) then Code := StrToIntDef(Trim(String(A)), 1);
      if Code <> 0 then
      begin
        if LoadStringFromFile(ExpandConstant('{commonappdata}\WavWiz\close-error.txt'), A) then Result := Copy(Trim(String(A)), 1, 800) else Result := 'WavWiz could not be closed.';
      end;
    end
    else
    begin
      { the script did not run or did not finish: the plain fallback (the file-replace step retries locked files on its own) }
      Log('close-wavwiz.ps1 did not finish; falling back to sc stop + taskkill');
      Exec(ExpandConstant('{sys}\sc.exe'), 'stop WavWizServer', '', SW_HIDE, ewWaitUntilTerminated, Code);
      Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM wavwiz-player.exe /T /F', '', SW_HIDE, ewWaitUntilTerminated, Code);
      Exec(ExpandConstant('{sys}\ping.exe'), '-n 5 127.0.0.1', '', SW_HIDE, ewWaitUntilTerminated, Code);
    end;
  finally
    if Page <> nil then Page.Hide;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  { F273: silent installs get no dialog; setup.ps1 writes network-status.txt and logs the network type to install.log }
  Result := '';
  { 0.2.2 T11: always close a running WavWiz first (not only the service): an open Player or receiver locks its files. /NOCLOSE skips it (tests). }
  if (not BoolParam('NOCLOSE', False)) and (DirExists(ExpandConstant('{app}')) or RegKeyExists(HKLM64, 'SYSTEM\CurrentControlSet\Services\WavWizServer')) then
  begin
    CloseFailure := CloseRunningWavWiz;
    if CloseFailure <> '' then
      Result := 'Setup could not close WavWiz, so nothing was changed:' + #13#10#13#10 + CloseFailure + #13#10#13#10 +
        'Close WavWiz Player (right-click its tray icon > Exit), or restart Windows, then run Setup again. Details: C:\ProgramData\WavWiz\install.log';
  end;
end;

{ 0.2.2 T11: start again what setup closed. The service: setup.ps1 starts it when the server part was installed; otherwise it is started here.
  The Player: started as the signed-in (not elevated) user, in the tray as before (--background), also in a silent install. }
procedure RestartClosedWavWiz;
var Code: Integer;
begin
  if ServiceWasRunning and ((not WantServer) or BoolParam('SKIPSETUP', False)) and (not BoolParam('NOSTART', False)) then
    Exec(ExpandConstant('{sys}\sc.exe'), 'start WavWizServer', '', SW_HIDE, ewWaitUntilTerminated, Code);
  if PlayerWasRunning and WantPlayer and FileExists(ExpandConstant('{app}\Player\wavwiz-player.exe')) then
    if ExecAsOriginalUser(ExpandConstant('{app}\Player\wavwiz-player.exe'), '--background', ExpandConstant('{app}\Player'), SW_SHOWNORMAL, ewNoWait, Code) then
      PlayerRestartedFlag := True
    else Log('could not start WavWiz Player again: ' + SysErrorMessage(Code));
end;

procedure MakeUrlShortcut(const Path, Url: String);
begin
  SetIniString('InternetShortcut', 'URL', Url, Path);
  SetIniString('InternetShortcut', 'IconFile', ExpandConstant('{app}\wavwiz.ico'), Path);
  SetIniString('InternetShortcut', 'IconIndex', '0', Path);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Exe, Params, ErrText, DoneFile, Why, LastStep: String; ErrAnsi, PidAnsi: AnsiString;
  Code, KillCode, OpenCode: Integer;
begin
  if CurStep <> ssPostInstall then Exit;
  SaveStringToFile(ExpandConstant('{app}\docs\FIRST-RUN.txt'), AnsiString(FirstRunText), False);
  if BoolParam('SKIPSETUP', False) then begin RestartClosedWavWiz; Exit; end;

  DoneFile := ExpandConstant('{commonappdata}\WavWiz\setup.done');
  ForceDirectories(ExpandConstant('{commonappdata}\WavWiz'));
  WizardForm.StatusLabel.Caption := 'Setting up WavWiz (service, firewall, settings)...';
  WizardForm.FileNameLabel.Caption := '';
  Exe := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  Params := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + QuoteArg(ExpandConstant('{app}\scripts\setup.ps1')) + ' -Root ' + QuoteArg(ExpandConstant('{app}')) + ' -Role ' + RoleCode + ' -SetupVersion {#AppVersion}';
  if WantServer then
  begin
    { F268: all networks -> -AllInterfaces 1 (setup.ps1 keeps an existing 0.0.0.0 byte-for-byte, or sets 0.0.0.0 + allowAllInterfaces).
      Otherwise omit -LanIp when the chosen address equals the existing bind (preserve), pass it when fresh/changed, and pass
      127.0.0.1 for a confirmed-blank Advanced box. The detected LAN address is only passed when 'Home network only' is selected. }
    { make sure the saved bind was read even if the network page never ran (silent upgrade) }
    DetectLan;
    if KeepAllInterfaces then
    begin
      Log('F268: network choice = Home network + Tailscale/VPN (all networks)');
      Params := Params + ' -AllInterfaces 1';
    end
    else if ChosenLanAddress = '' then
      Params := Params + ' -LanIp 127.0.0.1'
    else if (ExistingBindSeeded = '') or (CompareText(ChosenLanAddress, ExistingBindSeeded) <> 0) then
      Params := Params + ' -LanIp ' + ChosenLanAddress;
    if AirPlayOutCheck.Checked then Params := Params + ' -AirPlayOut 1';   { 0.6.8-#14g }
    if ServiceRunsAsLocalSystem and LimitedSvcCheck.Checked then Params := Params + ' -SwitchToLocalService 1';   { 0.7.0 item 3 }
  end
  else if Trim(HostEdit.Text) <> '' then Params := Params + ' -ServerHost ' + Trim(HostEdit.Text);
  if WizardSilent then Params := Params + ' -NoDialog 1';
  if BoolParam('NOSTART', False) then Params := Params + ' -NoStart 1';
  Params := Params + ' -DoneFile ' + QuoteArg(DoneFile);

  if (not ExecPolled(Exe, Params, DoneFile, 90000, 600000, True, Code, Why, LastStep)) or (Code <> 0) then
  begin
    SetupFailed := True;
    ErrText := '';
    if Why <> '' then
    begin
      { the script hung or never reported back: stop it (and its children) so nothing keeps running behind the wizard }
      if LoadStringFromFile(ExpandConstant('{commonappdata}\WavWiz\setup.pid'), PidAnsi) then
        Exec(ExpandConstant('{sys}\taskkill.exe'), '/PID ' + Trim(String(PidAnsi)) + ' /T /F', '', SW_HIDE, ewWaitUntilTerminated, KillCode);
      ErrText := Why + #13#10 + 'Last step it reported: ' + LastStep;
    end
    else if LoadStringFromFile(ExpandConstant('{commonappdata}\WavWiz\last-setup-error.txt'), ErrAnsi) then ErrText := Copy(String(ErrAnsi), 1, 2400);
    SuppressibleMsgBox('WavWiz was copied, but the final setup step did not finish cleanly' + IfThenStr(Why <> '', ' (it stopped answering and was ended).', ' (exit code ' + IntToStr(Code) + ').') + #13#10#13#10 +
      ErrText + #13#10#13#10 +
      'The same text, with every command that ran and every STEP, is in this file:' + #13#10 +
      '    C:\ProgramData\WavWiz\install.log' + #13#10 +
      'To open its folder: press Win+R, paste  C:\ProgramData\WavWiz  and press Enter. Please send install.log if you ask for help.' + #13#10 +
      'Nothing is lost: it is safe to run this installer again after fixing what it says.', mbError, MB_OK, IDOK);
    if SuppressibleMsgBox('Open the folder with install.log now?', mbConfirmation, MB_YESNO, IDNO) = IDYES then
      ShellExec('open', 'C:\ProgramData\WavWiz', '', '', SW_SHOWNORMAL, ewNoWait, OpenCode);
  end
  else
  begin
    if HasFirstRun then
    begin
      MakeUrlShortcut(ExpandConstant('{group}\WavWiz web page (BETA).url'), FirstRunUrl(''));
      if WizardIsTaskSelected('desktopicon') then MakeUrlShortcut(ExpandConstant('{autodesktop}\WavWiz web page (BETA).url'), FirstRunUrl(''));
    end;
    if LoadStringFromFile(ExpandConstant('{commonappdata}\WavWiz\setup-notices.txt'), ErrAnsi) then
  begin
    { notices (nothing secret) are shown by the wizard itself, not by the hidden script }
    SuppressibleMsgBox('Please read:' + #13#10#13#10 + Copy(String(ErrAnsi), 1, 1800), mbInformation, MB_OK, IDOK);
  end;
  end;
  RestartClosedWavWiz;      { 0.2.2 T11: also after a failed setup step, so the Player is never left closed }
end;

{ 0.2.1 F16: Inno returns 0 whenever the files were copied, even if the final setup step (service, firewall, settings) failed or hung.
  Inno calls this only when it would return 0; a non-zero result becomes the process exit code, so a silent install reports the failure.
  9 = files copied, but the setup step failed or stopped answering (details in C:\ProgramData\WavWiz\install.log). }
function GetCustomSetupExitCode: Integer;
begin
  if SetupFailed then Result := 9 else Result := 0;
end;

{ ---------------------------------------------------------------- uninstall }
function InitializeUninstall: Boolean;
begin
  Result := True;
  UninstPurgeFlag := BoolParam('PURGE', False);
  if not UninstPurgeFlag then
    UninstPurgeFlag := SuppressibleMsgBox('WavWiz (BETA) will be removed.' + #13#10#13#10 +
      'Also DELETE your WavWiz data (settings, library database, logs, certificates and the paired devices)?' + #13#10 +
      'Choose No to keep it - recommended if you might reinstall. Your music files are never touched.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2, IDNO) = IDYES;
end;

function UninstPurge: Boolean; begin Result := UninstPurgeFlag; end;

{ F173: after Inno removed its files: belt-and-braces delete of the install folder (only when it really is the WavWiz folder), the stable ARP key in every view,
  and a CLEAR message when something stays locked until a restart (never a silent hang). }
procedure WriteUninstLog(const M: String);
begin
  ForceDirectories(ExpandConstant('{commonappdata}\WavWiz'));
  SaveStringToFile(ExpandConstant('{commonappdata}\WavWiz\uninstall.log'), GetDateTimeString('yyyy-mm-dd hh:nn:ss', '-', ':') + ' ' + M + #13#10, True);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var App, K: String; Code: Integer;
begin
  App := ExpandConstant('{app}');
  if CurUninstallStep = usUninstall then
  begin
    { fallback in case uninstall.ps1 could not run: stop the service and end every WavWiz process before files are deleted }
    Exec(ExpandConstant('{sys}\sc.exe'), 'stop WavWizServer', '', SW_HIDE, ewWaitUntilTerminated, Code);
    Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM wavwiz-player.exe /T /F', '', SW_HIDE, ewWaitUntilTerminated, Code);
    Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM wavwiz-server.exe /T /F', '', SW_HIDE, ewWaitUntilTerminated, Code);
    Exec(ExpandConstant('{sys}\sc.exe'), 'delete WavWizServer', '', SW_HIDE, ewWaitUntilTerminated, Code);
    WriteUninstLog('inno: service stopped/deleted and processes ended (fallback)');
  end;
  if CurUninstallStep = usPostUninstall then
  begin
    K := 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{B5C2D7E1-4F3A-4B8E-9C61-57415657495A}_is1';
    RegDeleteKeyIncludingSubkeys(HKLM64, K); RegDeleteKeyIncludingSubkeys(HKLM32, K); RegDeleteKeyIncludingSubkeys(HKCU64, K); RegDeleteKeyIncludingSubkeys(HKCU32, K);
    if DirExists(App) and (CompareText(ExtractFileName(RemoveBackslashUnlessRoot(App)), 'WavWiz') = 0) then DelTree(App, True, True, True);
    if DirExists(App) and (FileExists(App + '\Server\wavwiz-server.exe') or FileExists(App + '\Player\wavwiz-player.exe') or FileExists(App + '\Server\WavWiz.Server.dll')) then
    begin
      UninstNeedsReboot := True;
      WriteUninstLog('inno: some files in ' + App + ' are still in use; a restart is needed to finish');
      SuppressibleMsgBox('WavWiz (BETA) was removed from Apps & features, but some files in' + #13#10 + App + #13#10 +
        'are still in use. Restart Windows to finish removing them.', mbInformation, MB_OK, IDOK);
    end
    else
      WriteUninstLog('inno: uninstall finished; ' + App + ' removed');
  end;
end;

function UninstallNeedRestart: Boolean;
begin
  Result := UninstNeedsReboot;
end;

