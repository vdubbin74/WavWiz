// 0.7.0 item 4: static Parallel Flow icons (favicon, PWA / home-screen, About fallback, Windows .ico for the Player exe + installer).
// Static files cannot follow the live theme, so they use the default theme (Midnight Neon) EXACTLY as the app paints its wordmark:
// TOP wave = the 'Wav' color (--accent-text), BOTTOM wave = the 'Wiz' color (--accent2-text), tile = --bg, all read from theme.js
// (PRESETS + derive), never hard-coded. 0.7.0 t1694u: "The colors should align with the theme" -> Midnight Neon top = #F9663A, not raw #FF3C00.
// Change the theme definition (or THEME_ID) and re-run; the in-app emblem (wwwroot/js/logo.js) uses the same two variables live.
// 0.7.0 t1933: also writes the six Inno Setup wizard bitmaps (installer/wizard-large-*.bmp and wizard-small-*.bmp) from the same
// SVG master and theme colors: tall banners get a dark --bg field, the emblem centered in the upper area, the WavWiz wordmark
// in the app font (weight 800, system-ui / Segoe UI / Roboto) when a face is available, and the orange/teal footer stripe;
// small images are the emblem on a dark --bg tile. 24-bit BMP, no alpha, exact Inno pixel sizes.
// Dev tool only (not shipped). Needs Playwright's Chromium:  node build/logo/make-icons.mjs [playwright-module-dir]
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
import zlib from 'node:zlib';
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const { chromium } = createRequire(path.resolve(process.argv[2] || '/workspace/f262-tools') + '/')('playwright');
const { emblemSvg } = await import(path.join(repo, 'src/WavWiz.Server/wwwroot/js/logo.js'));
const theme = await import(path.join(repo, 'src/WavWiz.Server/wwwroot/js/theme.js'));
export const THEME_ID = theme.DEFAULT_THEME_ID;                 // 'default' = Midnight Neon
const vars = theme.derive({ ...theme.PRESETS[THEME_ID], preset: THEME_ID });
/** The wordmark's own colors: .wm-wav = --accent-text, .wm-wiz = --accent2-text (app.css). */
export const COLORS = { top: vars['--accent-text'], bottom: vars['--accent2-text'] };
export const BG = vars['--bg'];                                 // home-screen tiles
console.log(`icons: theme ${THEME_ID} top(Wav) ${COLORS.top} bottom(Wiz) ${COLORS.bottom} tile ${BG}`);
const web = path.join(repo, 'src/WavWiz.Server/wwwroot'), assets = path.join(web, 'assets'), logoDir = path.join(repo, 'assets/logo');
const svg = emblemSvg({ cls: 'e', colors: COLORS });

const b = await chromium.launch(); const page = await b.newPage();
/** n x n PNG. tile: solid background square; scale: emblem size as a share of the tile (viewBox already has ~8% padding). */
async function png(n, { tile = false, scale = 1, radius = 0 } = {}) {
  await page.setViewportSize({ width: n, height: n });
  const e = Math.round(n * scale);
  await page.setContent(`<html><body style="margin:0;background:transparent"><div style="width:${n}px;height:${n}px;display:flex;align-items:center;justify-content:center;${tile ? `background:${BG};border-radius:${radius}px` : ''}">${svg.replace('class="e"', `class="e" width="${e}" height="${e}"`)}</div></body></html>`);
  return page.screenshot({ omitBackground: !tile || radius > 0, clip: { x: 0, y: 0, width: n, height: n } });
}
function ico(frames) {   // PNG-backed ICO (Vista+): ICONDIR + ICONDIRENTRY[] + PNG data
  const head = Buffer.alloc(6 + 16 * frames.length); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(frames.length, 4);
  let off = head.length; frames.forEach(([n, buf], i) => { const o = 6 + 16 * i; head.writeUInt8(n % 256, o); head.writeUInt8(n % 256, o + 1); head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6); head.writeUInt32LE(buf.length, o + 8); head.writeUInt32LE(off, o + 12); off += buf.length; });
  return Buffer.concat([head, ...frames.map(f => f[1])]);
}

/** Minimal 8-bit RGB/RGBA PNG decoder (Playwright screenshots) so wizard pages can be written as 24-bit BMPs with no extra package. */
function decodePng(buf) {
  if (buf[0] !== 0x89 || buf[1] !== 0x50) throw new Error('not png');
  let off = 8, w = 0, h = 0, depth, ctype;
  const ids = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const typ = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (typ === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; }
    else if (typ === 'IDAT') ids.push(data);
    else if (typ === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || (ctype !== 2 && ctype !== 6)) throw new Error(`unsupported png ${depth}/${ctype}`);
  const bpp = ctype === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(ids));
  const stride = w * bpp, out = Buffer.alloc(w * h * 4);
  let i = 0;
  const prev = Buffer.alloc(stride);
  const paeth = (a, c, d) => { const p = a + c - d, pa = Math.abs(p - a), pb = Math.abs(p - c), pc = Math.abs(p - d); return pa <= pb && pa <= pc ? a : pb <= pc ? c : d; };
  for (let y = 0; y < h; y++) {
    const filt = raw[i++], row = raw.subarray(i, i + stride); i += stride;
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, c = prev[x], d = x >= bpp ? prev[x - bpp] : 0;
      const v = row[x];
      cur[x] = (filt === 0 ? v : filt === 1 ? v + a : filt === 2 ? v + c : filt === 3 ? v + ((a + c) >> 1) : v + paeth(a, c, d)) & 255;
    }
    for (let x = 0; x < w; x++) {
      const s = x * bpp, dest = (y * w + x) * 4;
      out[dest] = cur[s]; out[dest + 1] = cur[s + 1]; out[dest + 2] = cur[s + 2]; out[dest + 3] = bpp === 4 ? cur[s + 3] : 255;
    }
    cur.copy(prev);
  }
  return { w, h, rgba: out };
}

/** 24-bit BI_RGB BMP (54-byte header, bottom-up rows padded to 4 bytes). Opaque: alpha is ignored. */
function encodeBmp24(w, h, rgba) {
  const row = (w * 3 + 3) & ~3, size = 54 + row * h, b = Buffer.alloc(size);
  b.writeUInt16LE(0x4D42, 0); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14); b.writeInt32LE(w, 18); b.writeInt32LE(h, 22);
  b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++) {
    const dest = 54 + (h - 1 - y) * row;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      b[dest + x * 3] = rgba[s + 2]; b[dest + x * 3 + 1] = rgba[s + 1]; b[dest + x * 3 + 2] = rgba[s];
    }
  }
  return b;
}

/** The app wordmark font stack (app.css .wordmark: 800 system-ui / Segoe UI / Roboto). A real sans file is embedded as a data URL
 *  (about:blank cannot load file:// fonts) so weight 800 renders; no double quotes, they would end the HTML style attribute. */
function wordmarkFontFace() {
  const faces = [
    'C:/Windows/Fonts/segoeuib.ttf',
    '/usr/share/fonts/truetype/sand-box/google/Roboto/Roboto-VariableFont_wdth,wght.ttf',
    '/usr/share/fonts/truetype/roboto/unhinted/RobotoTTF/Roboto-Black.ttf',
  ];
  const p = faces.find(f => fs.existsSync(f));
  if (!p) throw new Error('no sans wordmark font file found (Segoe UI Bold or Roboto)');
  const data = fs.readFileSync(p).toString('base64');
  return {
    file: p,
    css: `@font-face{font-family:wwWordmark;src:url(data:font/ttf;base64,${data}) format('truetype');font-weight:100 900;font-style:normal;font-display:block}`,
    family: `wwWordmark, system-ui, 'Segoe UI', Roboto, sans-serif`,
  };
}
const FACE = wordmarkFontFace();
console.log(`wizard wordmark font: ${FACE.file}`);

async function wizardBmp(w, h, { large }) {
  const face = FACE;
  const scale = w / 164;
  const stripe = large ? Math.max(1, Math.round(6 * (h / 314))) : 0;
  const emblemSize = large ? Math.round(w * 0.78) : Math.round(Math.min(w, h) * 0.9);
  const emblemTop = large ? Math.round(h * 0.12) : Math.round((h - emblemSize) / 2);
  const fontSize = Math.round(26 * scale);
  const tracking = (-0.5 * scale).toFixed(2);
  const gap = Math.round(10 * scale);
  const wmTop = emblemTop + emblemSize + gap;
  const wordmark = large
    ? `<div style="position:absolute;left:50%;top:${wmTop}px;transform:translateX(-50%);font:800 ${fontSize}px/1.05 ${face.family};letter-spacing:${tracking}px;white-space:nowrap">` +
      `<span style="color:${COLORS.top}">Wav</span><span style="color:${COLORS.bottom}">Wiz</span></div>`
    : '';
  const stripes = large
    ? `<div style="position:absolute;left:0;bottom:0;width:50%;height:${stripe}px;background:${COLORS.top}"></div>` +
      `<div style="position:absolute;right:0;bottom:0;width:50%;height:${stripe}px;background:${COLORS.bottom}"></div>`
    : '';
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><head><style>${face.css} html,body{margin:0;background:${BG}}</style></head>` +
    `<body><div style="position:relative;width:${w}px;height:${h}px;background:${BG};overflow:hidden">` +
    `<div style="position:absolute;left:50%;top:${emblemTop}px;transform:translateX(-50%);width:${emblemSize}px;height:${emblemSize}px">` +
    `${svg.replace('class="e"', `class="e" width="${emblemSize}" height="${emblemSize}"`)}</div>` +
    wordmark + stripes + `</div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const shot = await page.screenshot({ omitBackground: false, clip: { x: 0, y: 0, width: w, height: h } });
  const { w: pw, h: ph, rgba } = decodePng(shot);
  if (pw !== w || ph !== h) throw new Error(`wizard shot size ${pw}x${ph}, expected ${w}x${h}`);
  return encodeBmp24(w, h, rgba);
}

const out = {};
for (const n of [16, 32, 48, 64]) out[`logo-${n}.png`] = await png(n);                                   // transparent: tabs, small UI
for (const n of [128, 256]) out[`logo-${n}.png`] = await png(n, { tile: true, radius: Math.round(n * 0.18) });   // About fallback, desktop
for (const n of [152, 167, 180]) out[`logo-${n}.png`] = await png(n, { tile: true });                   // iOS home screen (iOS rounds it)
for (const n of [192, 512]) out[`logo-${n}.png`] = await png(n, { tile: true, radius: Math.round(n * 0.18) });   // PWA "any"
for (const n of [192, 512]) out[`logo-maskable-${n}.png`] = await png(n, { tile: true, scale: 0.8 });   // maskable: inside the 80 % safe zone
for (const [f, buf] of Object.entries(out)) fs.writeFileSync(path.join(assets, f), buf);
for (const f of ['apple-touch-icon.png', 'apple-touch-icon-precomposed.png']) fs.writeFileSync(path.join(web, f), out['logo-180.png']);   // iOS asks for these at the site root
fs.writeFileSync(path.join(web, 'favicon.ico'), ico([[16, out['logo-16.png']], [32, out['logo-32.png']], [48, out['logo-48.png']]]));
const win = []; for (const n of [16, 24, 32, 48, 64, 128, 256]) win.push([n, n <= 64 ? await png(n) : await png(n, { tile: true, radius: Math.round(n * 0.18) })]);
fs.writeFileSync(path.join(logoDir, 'wavwiz.ico'), ico(win));
for (const n of [16, 32, 48, 64, 128, 180, 256, 512]) fs.writeFileSync(path.join(logoDir, `wavwiz-${n}.png`), n <= 64 ? await png(n) : await png(n, { tile: true, radius: n === 180 ? 0 : Math.round(n * 0.18) }));
for (const n of [256, 512, 1024]) fs.writeFileSync(path.join(logoDir, `wavwiz-${n}-transparent.png`), await png(n));
fs.writeFileSync(path.join(logoDir, 'wavwiz-1024.png'), await png(1024, { tile: true, radius: 184 }));
fs.writeFileSync(path.join(logoDir, 'wavwiz-parallel-flow.svg'), emblemSvg({ cls: 'pf', title: 'WavWiz', colors: COLORS }) + '\n');

const inst = path.join(repo, 'installer');
for (const [w, h] of [[164, 314], [246, 471], [328, 628]]) {
  fs.writeFileSync(path.join(inst, `wizard-large-${w}.bmp`), await wizardBmp(w, h, { large: true }));
}
for (const s of [55, 83, 110]) {
  fs.writeFileSync(path.join(inst, `wizard-small-${s}.bmp`), await wizardBmp(s, s, { large: false }));
}
await b.close();
console.log('wrote', Object.keys(out).length + 2, 'web icons + favicon.ico, assets/logo/wavwiz.ico (16-256) and PNG masters, and 6 Inno wizard BMPs');
