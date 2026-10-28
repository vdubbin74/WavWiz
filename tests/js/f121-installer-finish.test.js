// F121: installer finish page — Player first for set-up
const fs = require('fs'), path = require('path'), assert = require('assert');
const iss = fs.readFileSync(path.join(__dirname, '../../installer/WavWiz.iss'), 'utf8');
const run = iss.slice(iss.indexOf('[Run]'), iss.indexOf('[UninstallRun]'));
const player = run.split('\n').find(l => l.includes('wavwiz-player.exe'));
assert(player && !/PlayerRestarted/.test(player), 'Player row has no PlayerRestarted gate');
assert(/Check: WantPlayer/.test(player) && !/--background|--autostart/.test(player), 'Player row: WantPlayer, no flags');
assert(/postinstall nowait skipifsilent runasoriginaluser/.test(player));
const instead = run.split('\n').find(l => l.includes('browser instead'));
assert(instead && /unchecked/.test(instead) && /HasFirstRun and WantPlayer/.test(instead), 'browser instead is unchecked when Player wanted');
const srv = run.split('\n').find(l => l.includes('browser to finish set-up'));
assert(srv && !/unchecked/.test(srv) && /HasFirstRun and not WantPlayer/.test(srv), 'server-only browser checked');
assert(iss.includes("'Open WavWiz Player to finish set-up (choose the administrator password)'"));
assert(iss.includes("'Open WavWiz Player now'"));
assert(/open WavWiz Player \(or the web page/.test(iss), 'FIRST-RUN step 1 mentions Player');
assert(/RestartClosedWavWiz/.test(iss) || /--background/.test(iss), 'tray restart kept');
console.log('ok f121 installer finish');
