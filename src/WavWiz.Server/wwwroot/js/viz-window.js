import { Viz } from './viz.js';
const c = document.getElementById('c'), msg = document.getElementById('msg');
const v = new Viz(c, { onStatus: (k, t) => { if (k === 'error') { msg.hidden = false; msg.textContent = t; } else if (k === 'audible') msg.hidden = t === 'yes'; } });
v.start();
addEventListener('keydown', e => { if (e.key === 'n') v.next(); else if (e.key === 'p') v.prev(); else if (e.key === 'f') (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()); });
addEventListener('beforeunload', () => v.destroy());
