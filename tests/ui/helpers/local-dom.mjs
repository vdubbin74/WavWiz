// Isolated shipped-module DOM harness. No running WavWiz service, account, or external requests.
// Run with Playwright installed (NODE_PATH may point at an existing installation).
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('../../../src/WavWiz.Server/wwwroot/', import.meta.url));
export async function localDom() {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="app"></div>'); return; }
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try { const bytes = await readFile(file); res.setHeader('Content-Type', ({ '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml' })[extname(file)] || 'application/octet-stream'); res.end(bytes); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  return { url, browser, async page(viewport = { width:390, height:600 }) {
    const context = await browser.newContext({ viewport, hasTouch: true });
    await context.route('**/*', route => new URL(route.request().url()).origin === url ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(5000); await page.goto(url); return page;
  }, async close() { await browser.close(); await new Promise(r => server.close(r)); } };
}
