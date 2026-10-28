// F122: installer polish
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '../..');
const iss = fs.readFileSync(path.join(root, 'installer/WavWiz.iss'), 'utf8');
const sec = (a, b) => iss.slice(iss.indexOf(a), iss.indexOf(b, iss.indexOf(a) + 1));
const tasks = sec('[Tasks]', '[Files]'), icons = sec('[Icons]', '[Run]'), run = sec('[Run]', '[UninstallRun]');
const pt = tasks.split('\n').find(l => l.includes('"playerdesktop"'));
assert(pt && /Components: player/.test(pt) && !/unchecked/.test(pt) && /WavWiz Player/.test(pt), 'playerdesktop task checked, player');
assert(/"desktopicon".*unchecked.*Components: server/.test(tasks), 'desktopicon unchanged');
const pi = icons.split('\n').find(l => l.includes('{autodesktop}'));
assert(pi && /wavwiz-player\.exe/.test(pi) && /Tasks: playerdesktop/.test(pi) && /wavwiz\.ico/.test(pi), 'desktop Player icon');
const info = fs.readFileSync(path.join(root, 'installer/info-before.txt'), 'utf8');
assert(!/0\.0\.x/.test(info) && /What it does/.test(info) && /never does/.test(info) && /gets installed/.test(info) && /SmartScreen/.test(info));
assert(/^[\x00-\x7f]*$/.test(info), 'info-before ASCII');
const wv = run.split('\n').find(l => l.startsWith('Filename') && l.includes('WebView2'));
assert(wv && /go\.microsoft\.com\/fwlink\/p\/\?LinkId=2124703/.test(wv) && /postinstall shellexec skipifsilent;/.test(wv) && !/unchecked/.test(wv) && /WantPlayer and WebView2Missing/.test(wv));
assert(/function WebView2Missing/.test(iss) && /webview2-missing\.txt/.test(iss));
assert(/webview2-missing\.txt/.test(fs.readFileSync(path.join(root, 'installer/scripts/install-player.ps1'), 'utf8')));
assert(/function PublicNetworkName/.test(iss) && /NetworkList\\Profiles/.test(iss) && /'Category'/.test(iss), 'registry Public detection');
assert(!/Get-Cim|Get-Wmi|NetConnectionProfile/i.test(iss), 'no CIM/WMI');
assert(/WizardSilent and WantServer/.test(iss) && /NOTE: Windows lists the network/.test(iss), 'silent logs NOTE');
assert(/Private \(not Public\)/.test(iss));
// F121 intact
assert(run.split('\n').some(l => /wavwiz-player\.exe/.test(l) && /Check: WantPlayer$/.test(l.trim()) && !/PlayerRestarted/.test(l)));
assert(run.split('\n').some(l => /browser instead/.test(l) && /unchecked/.test(l)));
console.log('ok f122 installer polish');
