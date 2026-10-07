; WavWiz (BETA) installer. Compile:  ISCC /DAppVersion=0.0.4 /DDistDir=<dist> /DRepoDir=<repo> /DOutDir=<out> installer\WavWiz.iss   (build\make-installer.ps1 does this; works under Wine)
; FULL self-contained installer only: the target PCs have no .NET. There is no slim / framework-dependent variant.
#ifndef AppVersion
  #define AppVersion "0.1.3"
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
; New identity for WavWiz (the old Unison one ends ...554E49534F4E). The earlier Unison install is moved over by scripts\setup.ps1 (Invoke-LegacyMigration).
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
WizardImageFile={#RepoDir}\installer\wizard-large-164.bmp,{#RepoDir}\installer\wizard-large-246.bmp,{#RepoDir}\installer\wizard-large-328.bmp
WizardSmallImageFile={#RepoDir}\installer\wizard-small-55.bmp,{#RepoDir}\installer\wizard-small-83.bmp,{#RepoDir}\installer\wizard-small-110.bmp
InfoBeforeFile={#RepoDir}\installer\info-before.txt
Compression=lzma2/max
SolidCompression=yes
LZMAUseSeparateProcess=yes
CloseApplications=yes
CloseApplicationsFilter=wavwiz-player.exe
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

[Registry]
; All-users autostart for the player (removed on uninstall). The player also has its own per-user switch (tray menu).
Root: HKLM; Subkey: "SOFTWARE\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "WavWizPlayer"; ValueData: """{app}\Player\wavwiz-player.exe"" --autostart"; Flags: uninsdeletevalue; Tasks: autostart; Components: player

[Icons]
Name: "{group}\WavWiz Player (BETA)"; Filename: "{app}\Player\wavwiz-player.exe"; IconFilename: "{app}\wavwiz.ico"; Components: player
Name: "{group}\WavWiz logs and settings folder"; Filename: "{commonappdata}\WavWiz"
Name: "{group}\What next (read me first)"; Filename: "{app}\docs\FIRST-RUN.txt"; IconFilename: "{app}\wavwiz.ico"
Name: "{group}\Uninstall WavWiz (BETA)"; Filename: "{uninstallexe}"; IconFilename: "{app}\wavwiz.ico"

[Run]
Filename: "{code:FirstRunUrl}"; Description: "Open WavWiz in my browser to finish set-up (choose the administrator password)"; Flags: postinstall shellexec skipifsilent; Check: HasFirstRun
Filename: "{app}\Player\wavwiz-player.exe"; Description: "Start WavWiz Player now"; Flags: postinstall nowait skipifsilent; Components: player
Filename: "{app}\docs\FIRST-RUN.txt"; Description: "Read the plain-language ""what next"" page"; Flags: postinstall shellexec skipifsilent unchecked

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\scripts\uninstall.ps1"" -Root ""{app}"" -Purge 0"; Flags: runhidden waituntilterminated; RunOnceId: "WavWizUninstKeep"; Check: not UninstPurge
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\scripts\uninstall.ps1"" -Root ""{app}"" -Purge 1"; Flags: runhidden waituntilterminated; RunOnceId: "WavWizUninstPurge"; Check: UninstPurge

[UninstallDelete]
Type: files; Name: "{app}\docs\FIRST-RUN.txt"
Type: files; Name: "{group}\WavWiz web page (BETA).url"
Type: files; Name: "{autodesktop}\WavWiz web page (BETA).url"
Type: dirifempty; Name: "{app}\scripts"
Type: dirifempty; Name: "{app}"

[Code]
var
  NetPage, HostPage: TWizardPage;
  LanEdit, HostEdit: TNewEdit;
  LanDetected: Boolean;
  SetupFailed: Boolean;
  UninstPurgeFlag: Boolean;

function GetTickCount: LongWord; external 'GetTickCount@kernel32.dll stdcall';

function UnisonInstalled: Boolean;
begin
  Result := RegKeyExists(HKLM64, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{B5C2D7E1-4F3A-4B8E-9C61-554E49534F4E}_is1') or DirExists(ExpandConstant('{commonappdata}\Unison'));
end;

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
  if not LoadStringFromFile(ExpandConstant('{commonappdata}\WavWiz\server.json'), A) then
    if not LoadStringFromFile(ExpandConstant('{commonappdata}\Unison\server.json'), A) then Exit;      { upgrading from Unison 0.0.x: its address is offered again }
  S := String(A); P := Pos('"bindAddress"', S); if P = 0 then Exit;
  S := Copy(S, P + 13, 200); P := Pos('"', S); if P = 0 then Exit;
  S := Copy(S, P + 1, 200); Q := Pos('"', S); if Q = 0 then Exit;
  Result := Copy(S, 1, Q - 1);
  if not IsIPv4(Result) then Result := '';
end;

function FirstRunUrl(Param: String): String;
var A: AnsiString;
begin
  Result := '';
  if LoadStringFromFile(ExpandConstant('{commonappdata}\WavWiz\first-run-url.txt'), A) then Result := Trim(String(A));
end;
function HasFirstRun: Boolean; begin Result := FirstRunUrl('') <> ''; end;

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

procedure DetectLan;
var Exe, OutFile, Why, Last: String; Code: Integer; A: AnsiString;
begin
  if LanDetected then Exit;
  LanDetected := True;
  if ExistingBindAddress <> '' then begin LanEdit.Text := ExistingBindAddress; Exit; end;
  if LanEdit.Text <> '' then Exit;
  try
    ExtractTemporaryFile('lib.ps1'); ExtractTemporaryFile('detect-lan.ps1');
    OutFile := ExpandConstant('{tmp}\wavwiz-lan.txt');
    DeleteFile(OutFile);
    Exe := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
    { 12 s at most, hidden, never waits for input; failure just leaves the box empty }
    Exec(Exe, '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + QuoteArg(ExpandConstant('{tmp}\detect-lan.ps1')) + ' -OutFile ' + QuoteArg(OutFile), '', SW_HIDE, ewNoWait, Code);
    Code := 0;
    while (Code < 24) and (not FileExists(OutFile)) do begin Sleep(500); Code := Code + 1; end;
    if FileExists(OutFile) then
      if LoadStringFromFile(OutFile, A) then if IsIPv4(Trim(String(A))) then LanEdit.Text := Trim(String(A));
  except
    { detection is a convenience only }
  end;
end;

procedure InitializeWizard;
var L: TNewStaticText;
begin
  NetPage := CreateCustomPage(wpSelectComponents, 'Home-network address (BETA)', 'Which address should the WavWiz server listen on?');
  L := TNewStaticText.Create(NetPage); L.Parent := NetPage.Surface; L.WordWrap := True; L.AutoSize := False; L.SetBounds(0, 0, NetPage.SurfaceWidth, ScaleY(96));
  L.Caption := 'Phones and other PCs reach WavWiz at this PC''s home-network address, usually like 192.168.1.20. WavWiz listens ONLY on the address you choose here - never on "all interfaces" - and only answers devices on your own network.' + #13#10#13#10 +
               'The box is filled in automatically when the address can be found. If it is empty or wrong, type the address of this PC (see Windows Settings > Network). 127.0.0.1 means "this PC only": phones then cannot connect.';
  LanEdit := TNewEdit.Create(NetPage); LanEdit.Parent := NetPage.Surface; LanEdit.SetBounds(0, ScaleY(110), ScaleX(200), ScaleY(23));
  HostPage := CreateCustomPage(NetPage.ID, 'Where is the WavWiz server? (BETA)', 'WavWiz Player needs the address of the PC that runs WavWiz Server.');
  L := TNewStaticText.Create(HostPage); L.Parent := HostPage.Surface; L.WordWrap := True; L.AutoSize := False; L.SetBounds(0, 0, HostPage.SurfaceWidth, ScaleY(70));
  L.Caption := 'Enter the home-network address (for example 192.168.1.20) or the name of the PC that has WavWiz Server installed. You can leave it empty and enter it later in the player (tray icon > Server).';
  HostEdit := TNewEdit.Create(HostPage); HostEdit.Parent := HostPage.Surface; HostEdit.SetBounds(0, ScaleY(80), ScaleX(260), ScaleY(23));
  { command-line seeds (silent installs): /LANIP=192.168.1.20  /SERVERHOST=192.168.1.20 }
  LanEdit.Text := Trim(ExpandConstant('{param:LANIP|}'));
  HostEdit.Text := Trim(ExpandConstant('{param:SERVERHOST|}'));
  WizardForm.WelcomeLabel2.Caption := WizardForm.WelcomeLabel2.Caption + #13#10#13#10 + 'This is a BETA version ({#AppVersion}).';
  if UnisonInstalled then
    WizardForm.WelcomeLabel2.Caption := WizardForm.WelcomeLabel2.Caption + #13#10#13#10 + 'The app is now called WavWiz (it was Unison). An earlier Unison installation was found: Setup will upgrade it and keep your music library, settings, administrator password and paired players. PCs that still run the old Unison Player keep working until you update them.';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if PageID = NetPage.ID then Result := not WantServer;
  if PageID = HostPage.ID then Result := WantServer or (not WantPlayer);
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = NetPage.ID then
  begin
    WizardForm.NextButton.Enabled := False;
    WizardForm.Update;
    DetectLan;
    WizardForm.NextButton.Enabled := True;
  end;
  if CurPageID = wpFinished then
  begin
    if SetupFailed then WizardForm.FinishedLabel.Caption := WizardForm.FinishedLabel.Caption + #13#10#13#10 + 'Setup did not finish cleanly. The log is C:\ProgramData\WavWiz\install.log';
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
    V := Trim(LanEdit.Text);
    if V = '' then
    begin
      if SuppressibleMsgBox('No address was entered. WavWiz will then listen on this PC only (127.0.0.1) and phones cannot connect until you set an address. Continue anyway?', mbConfirmation, MB_YESNO, IDYES) <> IDYES then Result := False;
    end
    else if (V = '0.0.0.0') or (not IsIPv4(V)) then
    begin
      SuppressibleMsgBox('Please enter one IPv4 address such as 192.168.1.20. "0.0.0.0" (all interfaces) is not offered by this installer.', mbError, MB_OK, IDOK); Result := False;
    end;
  end;
  if CurPageID = HostPage.ID then
  begin
    V := Trim(HostEdit.Text);
    if (V <> '') and (not IsHostName(V)) then begin SuppressibleMsgBox('That does not look like an address or PC name. Use letters, digits, dots and dashes only.', mbError, MB_OK, IDOK); Result := False; end;
  end;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := 'WavWiz (BETA) {#AppVersion}' + NewLine + NewLine + MemoDirInfo + NewLine + NewLine + MemoComponentsInfo + NewLine + NewLine;
  if WantServer then Result := Result + 'Server will listen on: ' + IfThenStr(Trim(LanEdit.Text) = '', '127.0.0.1 (this PC only)', Trim(LanEdit.Text)) + NewLine + Space + 'Windows service "WavWiz Server (BETA)" + a private-network-only firewall rule' + NewLine + NewLine;
  if WantPlayer and (not WantServer) then Result := Result + 'Player will connect to: ' + IfThenStr(Trim(HostEdit.Text) = '', '(ask on first start)', Trim(HostEdit.Text)) + NewLine + NewLine;
  Result := Result + MemoTasksInfo;
end;

function FirstRunText: String;
begin
  Result := 'WavWiz (BETA) {#AppVersion} - what next' + #13#10#13#10 +
    '1. On the PC that runs WavWiz Server, open the web page (the last installer page offered it). Choose the administrator password there. Nothing was generated for you.' + #13#10 +
    '2. In Settings > Music folders add your music folder (a local drive or a network share the Windows service can read).' + #13#10 +
    '3. On each PC with speakers, start WavWiz Player. It finds this server by itself (it is listed as "WavWiz on <this PC>"); just type the 6-digit code from Settings > Pair a phone or a PC player. You never type an address, a scheme or a port. (If it is not listed, use "My server isn''t listed" and type only the address, like 192.168.1.20.)' + #13#10 +
    '   Each device has a Test sound button, and a Dropped / Buffering / Reconnecting indicator. Menu > Diagnostics explains problems in plain English.' + #13#10 +
    '4. For a phone: Settings > Phone & HTTPS, scan the QR code with the phone camera and follow the steps (about two minutes; the page checks that it worked). After that the phone can calibrate speakers and can also be a device itself (Menu > This phone as a device; on iPhone the sound stops when the screen locks).' + #13#10#13#10 +
    'New in 0.1.3: Graphic EQ visualizer replaces Lightning (a saved Lightning choice becomes Graphic EQ); every visualizer setting is a 0 to 100 slider (50 is the default) with a Quality setting (Auto/Low/High/Ultra), GPU particles and glow/streak/fringe/depth effects; reworked VU meters and Terrain; ReplayGain volume leveling and iTunes gapless; saved NAS logins (encrypted by Windows); receiver health and a network helper in Diagnostics. Upgrades 0.1.2 in place (library, admin password, paired players and settings are kept).' + #13#10 +
    'Logs and settings: C:\ProgramData\WavWiz (install.log, server.json, logs\). If this PC had Unison, its data was moved there.' + #13#10 +
    'This is a BETA. If something fails, install.log says what and where.' + #13#10;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var Code: Integer;
begin
  Result := '';
  { Repair / upgrade: ask the service to stop so its files can be replaced (setup.ps1 starts it again). Failure here is fine: the Restart Manager / file replace logic takes over. }
  if (not BoolParam('SKIPSETUP', False)) and FileExists(ExpandConstant('{app}\Server\wavwiz-server.exe')) then
  begin
    Exec(ExpandConstant('{sys}\sc.exe'), 'stop WavWizServer', '', SW_HIDE, ewWaitUntilTerminated, Code);
    Exec(ExpandConstant('{sys}\ping.exe'), '-n 5 127.0.0.1', '', SW_HIDE, ewWaitUntilTerminated, Code);
  end;
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
  if BoolParam('SKIPSETUP', False) then Exit;

  DoneFile := ExpandConstant('{commonappdata}\WavWiz\setup.done');
  ForceDirectories(ExpandConstant('{commonappdata}\WavWiz'));
  WizardForm.StatusLabel.Caption := 'Setting up WavWiz (service, firewall, settings)...';
  WizardForm.FileNameLabel.Caption := '';
  Exe := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  Params := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + QuoteArg(ExpandConstant('{app}\scripts\setup.ps1')) + ' -Root ' + QuoteArg(ExpandConstant('{app}')) + ' -Role ' + RoleCode + ' -SetupVersion {#AppVersion}';
  if WantServer then
  begin
    if Trim(LanEdit.Text) <> '' then Params := Params + ' -LanIp ' + Trim(LanEdit.Text);
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
