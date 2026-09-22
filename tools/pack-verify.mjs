// Proves each packed version actually boots: nothing leaves the page, the
// console stays clean, art resolves, and the creative paints in both
// orientations. Static analysis cannot answer any of those.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium, devices } from 'playwright';

const ROOT = 'dist/packages';
const SHOTS = 'build/verify';
const SLUGS = ['stay-connected-run', 'run-from-bill-shock', 'one-stroke'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
};

/** Stands in for an ad container: the creative in an iframe, with the outer
 *  frame listening for anything it tries to say upstream. */
const HOST_PAGE = `<!DOCTYPE html><meta charset="utf-8"><title>container</title>
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style>
<script>
  window.__received = [];
  window.addEventListener('message', function (e) { window.__received.push(e.data); });
</script>
<iframe id="ad" src="/index.html"></iframe>`;

function serve(root) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    if (rel === '__host.html') {
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(HOST_PAGE);
      return;
    }
    const file = path.join(root, rel);
    if (!file.startsWith(path.resolve(root)) && !path.resolve(file).startsWith(path.resolve(root))) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/** A creative that failed to boot still screenshots as a plausible-looking
 *  blank, so count the nodes that carry the artwork instead. */
async function renderedNodes(page) {
  return page.evaluate(() => document.querySelectorAll('img, canvas, svg, [style*="background"]').length);
}

function shareOfViewport(el) {
  const r = el.getBoundingClientRect();
  const vw = innerWidth, vh = innerHeight;
  const covered = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0))
    * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
  return Math.round((covered / (vw * vh)) * 100);
}

/** Share of the viewport the stage covers. An ad is given the whole slot and
 *  should use it; all three versions used to scale a phone-shaped board to
 *  *fit*, which left a tablet mostly backdrop. getBoundingClientRect reflects
 *  the transform these boards are scaled with, so it measures what is painted. */
async function viewportFill(page) {
  return page.evaluate((fn) => {
    const share = eval(`(${fn})`);
    const el = document.querySelector('#stage, [data-hf-stage]');
    return el ? share(el) : null;
  }, shareOfViewport.toString());
}

/** Share of the viewport the *playfield* covers — the board, canvas or map the
 *  player actually touches.
 *
 *  A filling stage is not the same thing: One Stroke shipped a stage that
 *  covered the screen while the map inside it sat as a small centred card, so
 *  the check above passed while the game still looked unfinished on an iPad.
 *  Measured on the tablet frame only, since a landscape phone legitimately
 *  gives more of its height to the copy row. */
async function playfieldFill(page) {
  return page.evaluate((fn) => {
    const share = eval(`(${fn})`);
    let best = null;
    for (const sel of ['#panel', '#game-canvas-container', '[data-hf-stage]']) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const pct = share(el);
      if (best === null || pct > best) best = pct;
    }
    return best;
  }, shareOfViewport.toString());
}

async function verify(browser, slug) {
  const dir = path.join(ROOT, slug);
  const { server, port } = await serve(dir);
  const result = { slug, external: [], errors: [], shots: {} };

  try {
    for (const [label, device] of [
      ['portrait', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
      ['landscape', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
      ['tablet', devices['iPad (gen 7)']],
      // A tablet-sized viewport with a fine pointer, which is exactly how the
      // preview shell renders a tablet preset inside an iframe on a laptop.
      // Layout conditioned on pointer or hover breaks here and nowhere else.
      ['tablet-mouse', { viewport: { width: 834, height: 1194 }, hasTouch: false, isMobile: false }],
    ]) {
      const ctx = await browser.newContext({ ...device, userAgent: device.userAgent || undefined });
      const page = await ctx.newPage();

      page.on('console', (m) => {
        if (m.type() === 'error') result.errors.push(`${label}: ${m.text().slice(0, 160)}`);
      });
      page.on('pageerror', (e) => result.errors.push(`${label}: ${String(e).slice(0, 160)}`));
      page.on('request', (r) => {
        const url = r.url();
        if (url.startsWith(`http://127.0.0.1:${port}/`) || url.startsWith('data:') || url.startsWith('blob:')) return;
        result.external.push(`${label}: ${url.slice(0, 120)}`);
      });

      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
      await page.waitForTimeout(1200);
      // Playables gate on a first gesture; give them one and let a beat pass.
      await page.mouse.click(device.viewport.width / 2, device.viewport.height / 2);
      await page.waitForTimeout(1800);

      fs.mkdirSync(SHOTS, { recursive: true });
      const shot = path.join(SHOTS, `${slug}-${label}.png`);
      await page.screenshot({ path: shot });
      result.shots[label] = shot;
      result[`nodes_${label}`] = await renderedNodes(page);
      result[`fill_${label}`] = await viewportFill(page);
      result[`playfield_${label}`] = await playfieldFill(page);

      await ctx.close();
    }

    // Nothing may reach the container frame, in either direction.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/__host.html`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    // Probe the other direction too: the editor channel used to accept these.
    await page.evaluate(() => {
      const w = document.getElementById('ad').contentWindow;
      w.postMessage({ type: '__dc_theme', theme: 'dark' }, '*');
      w.postMessage({ type: '__dc_probe' }, '*');
    });
    await page.waitForTimeout(800);
    result.postedToHost = await page.evaluate(() => window.__received.map((m) => (m && m.type) || String(m)));

    // Control: prove the host is actually listening, so "nothing arrived" is
    // evidence of isolation rather than of a broken test.
    const ad = page.frames().find((f) => f !== page.mainFrame());
    await ad.evaluate(() => parent.postMessage({ type: '__control__' }, '*'));
    await page.waitForTimeout(400);
    result.hostListening = await page.evaluate(() => window.__received.some((m) => m && m.type === '__control__'));
    await ctx.close();
  } finally {
    server.close();
  }
  return result;
}

const browser = await chromium.launch();
const results = [];
for (const slug of SLUGS) results.push(await verify(browser, slug));
await browser.close();

let failed = false;
for (const r of results) {
  const FRAMES = ['portrait', 'landscape', 'tablet', 'tablet-mouse'];
  const fills = FRAMES.map((k) => r[`fill_${k}`]);
  const underfilled = fills.some((f) => f === null || f < 97);
  const playfields = ['tablet', 'tablet-mouse'].map((k) => r[`playfield_${k}`]);
  const smallPlayfield = playfields.some((p) => p === null || p < 55);
  const bad = r.external.length || r.errors.length || r.postedToHost.length
    || !r.hostListening || Object.values(r.shots).length !== FRAMES.length
    || underfilled || smallPlayfield;
  if (bad) failed = true;
  console.log(`\n${bad ? 'FAIL' : 'ok  '}  ${r.slug}`);
  console.log(`  visual nodes   portrait ${r.nodes_portrait}  landscape ${r.nodes_landscape}  tablet ${r.nodes_tablet}`);
  console.log(`  viewport fill  ${FRAMES.map((f, i) => `${f} ${fills[i]}%`).join('  ')}`
    + `${underfilled ? '  <- must be >= 97% on every frame' : ''}`);
  console.log(`  playfield      tablet ${playfields[0]}%  tablet-mouse ${playfields[1]}%`
    + `${smallPlayfield ? '  <- must be >= 55%; a filling stage can still hold a postage-stamp board' : ''}`);
  console.log(`  external reqs  ${r.external.length === 0 ? 'none' : ''}`);
  for (const e of [...new Set(r.external)]) console.log(`    ${e}`);
  console.log(`  console errors ${r.errors.length === 0 ? 'none' : ''}`);
  for (const e of [...new Set(r.errors)].slice(0, 6)) console.log(`    ${e}`);
  console.log(`  msgs to host   ${r.postedToHost.length === 0 ? 'none' : r.postedToHost.join(', ')}`
    + `  (host listening: ${r.hostListening ? 'yes' : 'NO — check is vacuous'})`);
}

fs.writeFileSync(path.join(SHOTS, 'verify-report.json'), JSON.stringify(results, null, 2));
console.log(`\nscreenshots in ${SHOTS}`);
if (failed) process.exit(1);
