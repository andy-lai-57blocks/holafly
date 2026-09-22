// Drives Bill Shock to its endcard and shoots it at several aspects. The
// component exposes its instance on window.__bs, so the round can be ended
// directly instead of waiting out the timer.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';

const TAG = process.env.TAG || 'before';
const OUT = `build/endcard/${TAG}`;
const FRAMES = [
  { id: 'phone-portrait', w: 390, h: 844 },
  { id: 'ipad-portrait', w: 820, h: 1180 },
  { id: 'ipad-landscape', w: 1180, h: 820 },
  { id: 'phone-landscape', w: 844, h: 390 },
];

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function serve(root) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    fs.readFile(path.join(root, rel), (err, buf) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(rel)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

fs.mkdirSync(OUT, { recursive: true });
const { server, port } = await serve('dist/packages/run-from-bill-shock');
const browser = await chromium.launch();

for (const f of FRAMES) {
  const ctx = await browser.newContext({
    viewport: { width: f.w, height: f.h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.mouse.click(f.w / 2, f.h * 0.6);
  await page.waitForTimeout(700);

  await page.evaluate(() => { if (window.__bs) window.__bs.rescue(); });
  await page.waitForTimeout(2600);

  const m = await page.evaluate(() => {
    const bs = window.__bs;
    const card = bs && bs.R.endcard.current;
    const inner = bs && bs.R.ecInner.current;
    if (!card) return null;
    const cr = card.getBoundingClientRect(), ir = inner.getBoundingClientRect();
    return {
      phase: bs.g && bs.g.phase,
      board: `${bs.w}x${bs.h}`,
      cardCss: `${Math.round(parseFloat(card.style.width) || 0)}x${Math.round(parseFloat(card.style.height) || 0)}`,
      cardPx: `${Math.round(cr.width)}x${Math.round(cr.height)}`,
      innerPx: `${Math.round(ir.width)}x${Math.round(ir.height)}`,
      pct: Math.round((Math.min(cr.width, innerWidth) * Math.min(cr.height, innerHeight)) / (innerWidth * innerHeight) * 100),
    };
  });

  await page.screenshot({ path: `${OUT}/${f.id}.png` });
  console.log(`  ${f.id.padEnd(16)} board ${String(m && m.board).padEnd(9)} phase ${String(m && m.phase).padEnd(7)}`
    + ` endcard css ${String(m && m.cardCss).padEnd(10)} 实际 ${String(m && m.cardPx).padEnd(11)} 占屏 ${m && m.pct}%`);
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\nshots -> ${OUT}/`);
