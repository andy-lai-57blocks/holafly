// Captures the packaged versions at tablet sizes, where a phone-shaped stage
// shows up as letterboxing. Reports the fraction of the viewport the creative
// actually covers so the gap is a number, not a judgement call.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';

const SLUGS = process.argv.slice(2).length ? process.argv.slice(2) : ['run-from-bill-shock', 'one-stroke', 'stay-connected-run'];
const TAG = process.env.TAG || 'before';
const OUT = `build/ipad/${TAG}`;

const FRAMES = [
  { id: 'ipad-portrait', w: 820, h: 1180 },
  { id: 'ipad-landscape', w: 1180, h: 820 },
  { id: 'phone-portrait', w: 390, h: 844 },
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
const browser = await chromium.launch();

for (const slug of SLUGS) {
  const { server, port } = await serve(path.join('dist/packages', slug));
  for (const f of FRAMES) {
    const ctx = await browser.newContext({
      viewport: { width: f.w, height: f.h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForTimeout(2600);

    // What share of the viewport does the creative's own stage cover?
    const cover = await page.evaluate(() => {
      const vw = innerWidth, vh = innerHeight;
      const cands = [...document.querySelectorAll('.stage, [class*="stage"], body > div, body > div > div')];
      let best = 0, box = null;
      for (const el of cands) {
        const r = el.getBoundingClientRect();
        const bg = getComputedStyle(el).backgroundImage !== 'none' || getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)';
        if (!bg) continue;
        const a = Math.min(r.width, vw) * Math.min(r.height, vh);
        if (a > best) { best = a; box = { w: Math.round(r.width), h: Math.round(r.height) }; }
      }
      return { pct: Math.round((best / (vw * vh)) * 100), box, vw, vh };
    });

    await page.screenshot({ path: `${OUT}/${slug}__${f.id}.png` });
    console.log(`  ${slug.padEnd(20)} ${f.id.padEnd(16)} viewport ${cover.vw}x${cover.vh}  stage ${cover.box ? cover.box.w + 'x' + cover.box.h : '?'}  覆盖 ${cover.pct}%`);
    await ctx.close();
  }
  server.close();
}

await browser.close();
console.log(`\nshots -> ${OUT}/`);
