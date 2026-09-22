// Runs the house rules against all three packaged versions at once, so the
// concepts can be compared on the same evidence instead of on impressions.
//
// Only rules that can be measured are asserted here; anything needing a human
// eye (brand fidelity, expired offers) is left to review and reported as such.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';

const ROOT = 'dist/packages';
const SLUGS = ['stay-connected-run', 'run-from-bill-shock', 'one-stroke'];

const SIZE_BUDGET = 2 * 1024 * 1024;   // RULE-PRF-002
const BOOTSTRAP_BUDGET = 200 * 1024;   // RULE-PRF-003
const MAX_TEXTURE = 1024;              // RULE-PRF-004
const MIN_FPS = 50;                    // RULE-PRF-009
const MAX_FCP_MS = 800;                // RULE-PRF-010
const MIN_LEGAL_PX = 10;               // RULE-CMP-003

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

/** Pretends to be an ad container so the creative's SDK path is the one under
 *  test, and records everything it asks the container to do. */
const MRAID_STUB = `
  window.__mraidLog = { listeners: [], opens: [] };
  window.mraid = {
    getState: () => 'default',
    isViewable: () => true,
    getPlacementType: () => 'interstitial',
    addEventListener: (ev) => { window.__mraidLog.listeners.push(ev); },
    removeEventListener: () => {},
    open: (url) => { window.__mraidLog.opens.push(url); },
    useCustomClose: () => {},
    getVersion: () => '3.0',
  };
  window.__windowOpens = [];
  window.open = (url) => { window.__windowOpens.push(url); return null; };
`;

async function probe(slug) {
  const dir = path.join(ROOT, slug);
  const { server, port } = await serve(dir);
  const files = Object.fromEntries(fs.readdirSync(dir).map((f) => [f, fs.statSync(path.join(dir, f)).size]));
  const r = { slug, files, total: Object.values(files).reduce((a, b) => a + b, 0) };

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    });
    await ctx.addInitScript(MRAID_STUB);
    const page = await ctx.newPage();

    r.external = [];
    r.errors = [];
    page.on('request', (q) => {
      const u = q.url();
      if (!u.startsWith(`http://127.0.0.1:${port}/`) && !u.startsWith('data:') && !u.startsWith('blob:')) r.external.push(u);
    });
    page.on('pageerror', (e) => r.errors.push(String(e).slice(0, 120)));

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForTimeout(1500);

    // RULE-PRF-010 — first contentful paint off the performance timeline.
    // A framework boot can push this well past the poll, so wait for the entry
    // rather than sampling once and recording a misleading blank.
    r.fcp = await page.evaluate(() => new Promise((res) => {
      const read = () => performance.getEntriesByName('first-contentful-paint')[0];
      if (read()) return res(Math.round(read().startTime));
      const timer = setInterval(() => {
        if (read()) { clearInterval(timer); res(Math.round(read().startTime)); }
      }, 100);
      setTimeout(() => { clearInterval(timer); res(read() ? Math.round(read().startTime) : null); }, 6000);
    }));

    // RULE-PRF-004/005 — decode every payload in assets.js for real dimensions.
    r.textures = await page.evaluate(async () => {
      const all = [...(window.ASSETS?.images || []), ...(window.ASSETS?.atlases || []).map((a, i) => ({ name: 'atlas' + i, url: a.image }))];
      const out = [];
      for (const a of all) {
        if (!a.url) continue;
        const fmt = (a.url.match(/^data:image\/([a-z+]+)/) || [, '?'])[1];
        const dims = await new Promise((res) => {
          const img = new Image();
          img.onload = () => res([img.naturalWidth, img.naturalHeight]);
          img.onerror = () => res([0, 0]);
          img.src = a.url;
        });
        out.push({ name: a.name, fmt, w: dims[0], h: dims[1] });
      }
      return out;
    });

    r.hasPlayableConfig = await page.evaluate(() => !!window.PlayableConfig);

    // RULE-PRF-008 — safe-area insets have to appear in the shipped CSS.
    // Match the function call, not a bare `env(x)`: these are routinely written
    // with a fallback, as in env(safe-area-inset-bottom, 0px).
    const css = fs.readFileSync(path.join(dir, 'index.css'), 'utf8');
    r.safeArea = (css.match(/env\(\s*safe-area-inset-[a-z]+/g) || []).length;

    // Give it a gesture, then watch the loop. RULE-PRF-009.
    await page.mouse.click(195, 500);
    await page.waitForTimeout(600);
    r.fps = await page.evaluate(() => new Promise((res) => {
      let frames = 0;
      const start = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - start < 2000) requestAnimationFrame(tick);
        else res(Math.round((frames * 1000) / (performance.now() - start)));
      };
      requestAnimationFrame(tick);
    }));

    // RULE-CMP-003 — the legal line has to stay legible. Find it by the text
    // the config actually ships rather than by guessing at its wording.
    r.legalPx = await page.evaluate(() => {
      const strings = Object.keys(window.CONFIG?.I18?.strings || {});
      const legal = strings.find((s) => /trademark|illustrat|in-app purchase|terms|disclaim/i.test(s));
      if (!legal) return null;
      const needle = legal.slice(0, 30);
      const el = [...document.querySelectorAll('*')]
        .find((n) => !n.children.length && (n.textContent || '').includes(needle));
      if (!el) return 'in-config-not-rendered';
      return Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10;
    });

    // RULE-MRD-001/005 — what did it actually say to the container?
    await page.waitForTimeout(1200);
    r.mraidListeners = await page.evaluate(() => [...new Set(window.__mraidLog.listeners)]);

    // Click the real CTA, identified by the label in config, and note whether
    // it is a plain anchor — those bypass the SDK and get eaten by containers.
    r.cta = await page.evaluate(() => {
      const strings = Object.keys(window.CONFIG?.I18?.strings || {});
      const label = strings.find((s) => /^(get|claim|shop|buy|try)\b/i.test(s)) || 'Holafly eSIM';
      const needle = label.slice(0, 18).toLowerCase();
      const el = [...document.querySelectorAll('a, button, [role="button"], [class*="cta" i]')]
        .find((n) => (n.textContent || '').toLowerCase().includes(needle));
      if (!el) return { found: false };
      const anchor = el.closest('a[href]');
      const info = {
        found: true, label,
        bareHref: anchor ? anchor.getAttribute('href') : null,
        target: anchor ? anchor.getAttribute('target') : null,
      };
      el.click();
      return info;
    });
    await page.waitForTimeout(600);
    r.ctaFound = r.cta.found;
    r.mraidOpens = await page.evaluate(() => window.__mraidLog.opens.length);
    r.windowOpens = await page.evaluate(() => window.__windowOpens.length);

    await ctx.close();

    // RULE-CFG-004 — locale override from the query string.
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p2 = await ctx2.newPage();
    await p2.goto(`http://127.0.0.1:${port}/?lang=es`, { waitUntil: 'load' });
    await p2.waitForTimeout(1200);
    r.localeSwitch = await p2.evaluate(() => {
      const t = document.body.innerText || '';
      return /Sigue conectado|Consigue|Donde vayas|Conecta/i.test(t);
    });
    r.localesInConfig = await p2.evaluate(() => {
      const s = window.CONFIG?.I18?.strings || {};
      const first = Object.values(s)[0] || {};
      return Object.keys(first);
    });
    await ctx2.close();
  } finally {
    await browser.close();
    server.close();
  }
  return r;
}

// ------------------------------------------------------------------- report

const results = [];
for (const slug of SLUGS) results.push(await probe(slug));

const kb = (n) => (n / 1024).toFixed(0) + 'K';
const mark = (v) => (v === true ? 'pass' : v === false ? 'FAIL' : v === null ? ' — ' : String(v));

const rows = [
  ['RULE-PRF-001', 'single .html file', (r) => Object.keys(r.files).filter((f) => f.endsWith('.html')).length === 1 && Object.keys(r.files).length === 1],
  ['RULE-PRF-001', 'zero external requests', (r) => r.external.length === 0],
  ['RULE-PRF-002', `total <= 2MB`, (r) => `${kb(r.total)} ${r.total <= SIZE_BUDGET ? 'pass' : 'FAIL'}`],
  ['RULE-PRF-003', 'non-JS bootstrap <= 200K', (r) => {
    const b = (r.files['index.html'] || 0) + (r.files['index.css'] || 0);
    return `${kb(b)} ${b <= BOOTSTRAP_BUDGET ? 'pass' : 'FAIL'}`;
  }],
  ['RULE-PRF-004', 'texture <= 1024px', (r) => {
    const over = r.textures.filter((t) => t.w > MAX_TEXTURE || t.h > MAX_TEXTURE);
    return over.length ? `FAIL ${over.map((t) => `${t.name} ${t.w}x${t.h}`).join(',')}` : 'pass';
  }],
  ['RULE-PRF-005', 'WebP/SVG only', (r) => {
    const bad = r.textures.filter((t) => !['webp', 'svg+xml'].includes(t.fmt));
    return bad.length ? `FAIL ${bad.map((t) => t.fmt).join(',')}` : 'pass';
  }],
  ['RULE-PRF-008', 'safe-area insets in CSS', (r) => (r.safeArea > 0 ? `pass (${r.safeArea})` : 'FAIL')],
  ['RULE-PRF-009', `fps >= ${MIN_FPS}`, (r) => `${r.fps} ${r.fps >= MIN_FPS ? 'pass' : 'FAIL'}`],
  ['RULE-PRF-010', `FCP < ${MAX_FCP_MS}ms`, (r) => (r.fcp === null ? ' — ' : `${r.fcp}ms ${r.fcp < MAX_FCP_MS ? 'pass' : 'FAIL'}`)],
  ['RULE-PRF-011', 'no uncaught errors', (r) => r.errors.length === 0],
  ['RULE-CFG-002', 'window.PlayableConfig', (r) => r.hasPlayableConfig],
  ['RULE-CFG-003', 'locales in config', (r) => (r.localesInConfig.length ? r.localesInConfig.join('/') : 'FAIL none')],
  ['RULE-CFG-004', '?lang= override', (r) => r.localeSwitch],
  ['RULE-CMP-003', `legal >= ${MIN_LEGAL_PX}px`, (r) => (
    r.legalPx === null ? 'FAIL not in config'
      : typeof r.legalPx === 'string' ? `FAIL ${r.legalPx}`
        : `${r.legalPx}px ${r.legalPx >= MIN_LEGAL_PX ? 'pass' : 'FAIL'}`)],
  ['RULE-MRD-001', 'binds viewable/state', (r) => (r.mraidListeners.length ? r.mraidListeners.join(',') : 'FAIL none')],
  ['RULE-MRD-005', 'CTA via mraid.open', (r) => (
    !r.ctaFound ? 'FAIL no CTA found'
      : r.mraidOpens > 0 ? 'pass'
        : r.cta.bareHref ? `FAIL bare href target=${r.cta.target}` : `FAIL (no open call)`)],
];

const w = [14, 26, 24, 24, 24];
const head = ['RULE', 'check', ...SLUGS];
console.log('\n' + head.map((h, i) => h.padEnd(w[i])).join(''));
console.log(w.map((n) => '-'.repeat(n - 1)).join(' '));

let fails = 0;
for (const [rule, label, fn] of rows) {
  const cells = results.map((r) => {
    const v = mark(fn(r));
    if (/FAIL/.test(v)) fails++;
    return v;
  });
  console.log([rule, label, ...cells].map((c, i) => String(c).padEnd(w[i])).join(''));
}

console.log(`\n${fails} failing cell(s) across ${SLUGS.length} versions`);
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/compliance.json', JSON.stringify(results, null, 2));
console.log('detail -> build/compliance.json');
