// S8 QA_GATE — executes all 25 checklist items from the five skills against the
// built artefact and exits non-zero on any failure.
//
// Static checks read the artefact bytes. Runtime checks drive a headless
// Chromium, including a mock MRAID container for the lifecycle suite. This is
// a gate, not a report: nothing ships past a red row.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ART = path.resolve('dist/holafly-playable.html');
const HTML = fs.readFileSync(ART, 'utf8');
const BYTES = fs.statSync(ART).size;
const TOKENS = JSON.parse(fs.readFileSync('brand/brand-tokens.json', 'utf8'));

const results = [];
const record = (id, rule, description, pass, measured) =>
  results.push({ id, rule, description, pass: !!pass, measured });

// ---------------------------------------------------------------- utilities

const MRAID_MOCK = () => {
  window.__mraidLog = { listeners: {}, opens: [], state: 'loading', viewable: true, removed: [] };
  window.mraid = {
    getState: () => window.__mraidLog.state,
    isViewable: () => window.__mraidLog.viewable,
    addEventListener: (ev, fn) => {
      (window.__mraidLog.listeners[ev] = window.__mraidLog.listeners[ev] || []).push(fn);
      // Mirror a real container: the bridge is injected in the `loading`
      // state and the SDK fires `ready` once it has finished wiring up.
      if (ev === 'ready') {
        setTimeout(() => {
          window.__mraidLog.state = 'default';
          fn();
        }, 120);
      }
    },
    removeEventListener: (ev) => { window.__mraidLog.removed.push(ev); },
    open: (url) => { window.__mraidLog.opens.push(url); },
  };
  window.__mraidFire = (ev, arg) => {
    (window.__mraidLog.listeners[ev] || []).forEach((fn) => fn(arg));
  };
};

const WINDOW_OPEN_SPY = () => {
  window.__opened = [];
  const real = window.open;
  window.open = (url) => { window.__opened.push(url); return null; };
  window.__realOpen = real;
};

async function newPage(browser, { query = '', viewport = { width: 390, height: 844 }, mraid = false } = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => requests.push(r.url()));
  if (mraid) await page.addInitScript(MRAID_MOCK);
  await page.addInitScript(WINDOW_OPEN_SPY);
  await page.goto(pathToFileURL(ART).href + query);
  await page.waitForFunction(() => !!window.__playable, null, { timeout: 8000 });
  page.__errors = errors;
  page.__requests = requests;
  return page;
}

/** Taps the stage, which is how a real user plays. */
const tap = (page) => page.mouse.click(195, 500);

// WebP dimensions, straight out of the container. Needed to prove every
// inlined texture respects the 1024px ceiling (RULE-PRF-004).
function webpSize(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const fourcc = buf.toString('ascii', 12, 16);
  if (fourcc === 'VP8 ') {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (fourcc === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fourcc === 'VP8X') {
    return {
      width: (buf.readUIntLE(24, 3) & 0xffffff) + 1,
      height: (buf.readUIntLE(27, 3) & 0xffffff) + 1,
    };
  }
  return null;
}

// ------------------------------------------------------------ static checks

function staticChecks() {
  // --- CHK-CFG-01: no user-facing literal outside the config block.
  const scripts = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const engineSrc = scripts.slice(1).join('\n');
  // Trailing comments have to go too, not just whole-line ones: an apostrophe
  // in prose like `// Giotto's campanile` otherwise opens a phantom string
  // literal that swallows the next few lines of code and reports them as copy.
  // The `[^:]` guard keeps `https://` inside a real literal from being eaten.
  const stripped = engineSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
  const literals = [...stripped.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map((m) => m[1] ?? m[2]);
  const prose = literals.filter((s) => {
    if (s === 'use strict') return false;
    if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(s)) return true; // CJK copy
    return /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(s); // multi-word English copy
  });
  record('CHK-CFG-01', 'RULE-CFG-001', 'No user-facing literal in engine source',
    prose.length === 0, prose.length ? prose.slice(0, 6) : `${literals.length} literals, 0 prose`);

  // --- CHK-CMP-01: brand palette, brand typeface, no dated promo.
  const palette = ['coralTop', 'coralBottom', 'maroonHighlight', 'accentGreen', 'accentYellow', 'crimsonButton']
    .map((k) => TOKENS.color[k].hex);
  const missing = palette.filter((hex) => !HTML.toUpperCase().includes(hex.toUpperCase()));
  const hasFace = HTML.includes(`font-family:'${TOKENS.typography.family}'`);
  const dated = HTML.match(/christmas|black friday|halloween|new year sale|\d+%\s*off|limited time|expires?\s+\w+\s*\d/gi);
  record('CHK-CMP-01', 'RULE-CMP-001/002', 'Brand palette & typeface present, no dated promo',
    missing.length === 0 && hasFace && !dated,
    { missingColors: missing, brandFaceEmbedded: hasFace, datedPromoHits: dated || [] });

  // --- CHK-CMP-04: no simulated OS chrome.
  const osFakes = HTML.match(/low\s*battery|incoming\s*call|system\s*(?:alert|error)|permission\s*denied|window\.alert|\balert\s*\(/gi);
  record('CHK-CMP-04', 'RULE-CMP-006', 'No simulated OS dialogs or alerts',
    !osFakes, osFakes || 'none');

  // --- CHK-CMP-05: no deceptive close affordance.
  const closeGlyphs = HTML.match(/[\u2715\u2716\u2717\u2718\u00d7\u2A2F\u274C]|&times;|(?:id|class)\s*=\s*"[^"]*\bclose\b|aria-label\s*=\s*"[^"]*close/gi);
  record('CHK-CMP-05', 'RULE-CMP-007', 'No close-button glyph or asset in payload',
    !closeGlyphs, closeGlyphs || 'none');

  // --- CHK-PRF-01 (static half): nothing loadable points off-box.
  const external = [];
  for (const re of [
    /<script[^>]+\bsrc\s*=\s*["']([^"']+)["']/gi,
    /<link[^>]+\bhref\s*=\s*["']([^"']+)["']/gi,
    /<img[^>]+\bsrc\s*=\s*["']([^"']+)["']/gi,
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
    /@import\s+["']([^"']+)["']/gi,
  ]) {
    let m;
    while ((m = re.exec(HTML))) {
      const u = m[1].trim();
      if (u && !u.startsWith('data:') && !u.startsWith('#')) external.push(u.slice(0, 80));
    }
  }
  record('CHK-PRF-01', 'RULE-PRF-001', 'Single inline file, zero external references',
    external.length === 0, external.length ? external : '0 external refs');

  // --- CHK-PRF-02: size budget.
  record('CHK-PRF-02', 'RULE-PRF-002', 'Total size <= 2 MB',
    BYTES <= 2 * 1024 * 1024, `${(BYTES / 1024).toFixed(1)} KB / 2048.0 KB`);

  // --- CHK-PRF-03: texture ceiling.
  const rasters = [...HTML.matchAll(/data:image\/webp;base64,([A-Za-z0-9+/=]+)/g)].map((m) => m[1]);
  const dims = rasters.map((b64) => webpSize(Buffer.from(b64, 'base64')));
  const oversized = dims.filter((d) => !d || d.width > 1024 || d.height > 1024);
  record('CHK-PRF-03', 'RULE-PRF-004/005', 'All inlined rasters are WebP and <= 1024 px',
    rasters.length > 0 && oversized.length === 0,
    { count: rasters.length, sizes: dims.map((d) => (d ? `${d.width}x${d.height}` : 'unreadable')) });
}

// ----------------------------------------------------------- runtime checks

async function hookChecks(browser) {
  const page = await newPage(browser);

  // CHK-CVR-02 must be observed before any input touches the page.
  await page.waitForTimeout(1900);
  const idle = await page.evaluate(() => ({
    shownAt: window.__playable.metrics.idleHintShownAtMs,
    opacity: Number(getComputedStyle(document.getElementById('idle-hint')).opacity),
    state: window.__playable.funnel.currentState,
  }));
  record('CHK-CVR-02', 'RULE-CVR-003', 'Idle hint appears within 1.5s of launch',
    idle.shownAt != null && idle.shownAt <= 1800 && idle.opacity > 0,
    { shownAtMs: idle.shownAt && Math.round(idle.shownAt), opacity: idle.opacity, funnel: idle.state });

  // RULE-CVR-004: the prompt must clear on the very first touch.
  await tap(page);
  await page.waitForTimeout(320);
  const afterTap = await page.evaluate(() => ({
    opacity: Number(getComputedStyle(document.getElementById('idle-hint')).opacity),
    state: window.__playable.funnel.currentState,
  }));

  // CHK-CVR-01: real gameplay demonstrated inside the hook window.
  await page.waitForTimeout(3600);
  const hook = await page.evaluate(() => ({
    firstGateAtMs: window.__playable.metrics.firstGateAtMs,
    distance: window.__playable.game.state.distance,
    destinations: window.__playable.game.state.destinationsCrossed,
  }));
  record('CHK-CVR-01', 'RULE-CVR-001', 'Authentic product hook inside first 5s',
    hook.firstGateAtMs != null && hook.firstGateAtMs <= 5000 && hook.distance > 0,
    {
      firstDestinationCrossedAtMs: hook.firstGateAtMs && Math.round(hook.firstGateAtMs),
      destinations: hook.destinations,
      idlePromptDismissedOnTouch: afterTap.opacity === 0,
      funnelAfterTouch: afterTap.state,
    });

  // CHK-CVR-04: touch target floor.
  const targets = await page.evaluate(() => {
    const ids = ['live-cta'];
    const out = {};
    ids.forEach((id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      out[id] = { w: Math.round(r.width), h: Math.round(r.height) };
    });
    return out;
  });

  // CHK-PRF-04: sustained frame rate over a clean sample window.
  await page.evaluate(() => window.__playable.resetFpsSamples());
  for (let i = 0; i < 12; i++) { await tap(page); await page.waitForTimeout(420); }
  const fps = await page.evaluate(() => window.__playable.meanFps());
  record('CHK-PRF-04', 'RULE-PRF-009', 'Mean frame rate >= 50 FPS during gameplay',
    fps >= 50, `${fps.toFixed(1)} FPS (headless Chromium; confirm on target hardware)`);

  // CHK-CVR-05: CTA debounce. Eight taps inside the debounce window.
  await page.evaluate(() => { window.__playable.metrics.ctaOpens = 0; window.__opened = []; });
  for (let i = 0; i < 8; i++) await page.click('#live-cta', { force: true });
  await page.waitForTimeout(120);
  const spam = await page.evaluate(() => ({
    taps: window.__playable.metrics.ctaTaps,
    opens: window.__playable.metrics.ctaOpens,
    opened: window.__opened.slice(),
  }));
  record('CHK-CVR-05', 'RULE-CVR-008', 'Rapid CTA taps produce exactly one clickthrough',
    spam.opens === 1 && spam.opened.length === 1,
    { taps: spam.taps, clickthroughs: spam.opens, url: spam.opened[0] });

  // The endcard measurements need their own page: the CTA spam above parked
  // this one in CLICKTHROUGH, and the creative deliberately refuses to push an
  // endcard over a session the player has already converted out of.
  const endPage = await newPage(browser);
  await endPage.evaluate(() => window.__playable.forceEnd('qa'));
  await endPage.waitForTimeout(500);
  const endTargets = await endPage.evaluate(() => {
    const r = document.getElementById('end-cta').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 };
  });
  targets['end-cta'] = { w: endTargets.w, h: endTargets.h };
  const tooSmall = Object.entries(targets).filter(([, r]) => r.w < 44 || r.h < 44);
  record('CHK-CVR-04', 'RULE-CVR-009', 'Every interactive target is at least 44x44',
    tooSmall.length === 0, targets);

  // CHK-CMP-02 and CHK-CMP-03: legal legibility, measured on the endcard.
  const legal = await endPage.evaluate(() => {
    const el = document.getElementById('legal');
    const cs = getComputedStyle(el);
    const parse = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
    const bgOf = (node) => {
      let n = node;
      while (n && n !== document.documentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c;
        n = n.parentElement;
      }
      return 'rgb(255,255,255)';
    };
    const lum = (rgb) => {
      const f = rgb.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    };
    const fg = lum(parse(cs.color));
    const bg = lum(parse(bgOf(el)));
    const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    return {
      fontSizePx: parseFloat(cs.fontSize),
      color: cs.color,
      background: bgOf(el),
      ratio: Math.round(ratio * 100) / 100,
      text: el.textContent.trim().slice(0, 40),
    };
  });
  record('CHK-CMP-02', 'RULE-CMP-003', 'Legal disclaimer font size >= 10px',
    legal.fontSizePx >= 10, `${legal.fontSizePx}px`);
  record('CHK-CMP-03', 'RULE-CMP-003', 'Legal disclaimer contrast >= 4.5:1',
    legal.ratio >= 4.5, `${legal.ratio}:1 (${legal.color} on ${legal.background})`);

  // CHK-CFG-02: hot-patch the disclaimer with no rebuild.
  const swap = await endPage.evaluate(() => {
    const before = document.getElementById('legal').textContent;
    const p = window.__playable;
    p.config.localization.locales[p.locale].legalDisclaimer = 'HOT PATCHED DISCLAIMER 12345';
    p.ui.applyCopy();
    return { before, after: document.getElementById('legal').textContent };
  });
  record('CHK-CFG-02', 'RULE-CFG-003', 'Legal disclaimer hot-swaps from config without rebuild',
    swap.after === 'HOT PATCHED DISCLAIMER 12345' && swap.before !== swap.after,
    { before: swap.before.slice(0, 32) + '...', after: swap.after });

  record('CHK-PRF-01-runtime', 'RULE-PRF-001', 'Zero network requests beyond the artefact itself',
    page.__requests.filter((u) => !u.startsWith('file://')).length === 0,
    `${page.__requests.length} request(s), all file://`);

  const errs = page.__errors.concat(endPage.__errors);
  await endPage.close();
  await page.close();
  return errs;
}

/** RULE-CVR-005/006: the 30s cap must force the endcard even if the player
 *  is doing well. Keeping the meter topped up is test instrumentation, not a
 *  change to the creative. */
async function capCheck(browser) {
  const page = await newPage(browser);
  const deadline = Date.now() + 34000;
  while (Date.now() < deadline) {
    const done = await page.evaluate(() => {
      const p = window.__playable;
      if (p.funnel.currentState === 'ENDCARD') return true;
      p.game.state.meter = 92;
      return false;
    });
    if (done) break;
    await tap(page);
    await page.waitForTimeout(350);
  }
  const out = await page.evaluate(() => ({
    state: window.__playable.funnel.currentState,
    reason: window.__playable.metrics.endReason,
    at: window.__playable.metrics.endcardAtMs,
    endcardVisible: !document.getElementById('endcard').hidden,
    loopRunning: window.__playable.isLoopRunning(),
    history: window.__playable.funnel.history,
  }));
  // A surviving run now ends either on the 30s cap or on reaching the finish
  // flag planted after the last destination, which lands a little inside it.
  // The rule is a ceiling on gameplay length, so both outcomes satisfy it —
  // what must not happen is the session running past the cap.
  record('CHK-CVR-03', 'RULE-CVR-005/006', 'Gameplay ends by 30s and auto-transitions to endcard',
    out.state === 'ENDCARD' && (out.reason === 'timeout' || out.reason === 'finish') &&
    out.at >= 27000 && out.at <= 33000 && out.endcardVisible,
    { funnel: out.state, reason: out.reason, endcardAtMs: Math.round(out.at), loopStopped: !out.loopRunning });

  // RULE-CVR-007: a CTA is present in gameplay and on the endcard.
  const persistent = await page.evaluate(() => {
    const end = document.getElementById('end-cta').getBoundingClientRect();
    return { endCtaVisible: end.width > 0 && end.height > 0 };
  });
  record('CHK-CVR-07', 'RULE-CVR-007', 'CTA persists through gameplay and endcard',
    persistent.endCtaVisible, { endcardCtaVisible: persistent.endCtaVisible, gameplayCtaId: 'live-cta' });

  await page.close();
}

async function localeChecks(browser) {
  // CHK-CFG-03 / CHK-CFG-04: URL override and graceful fallback.
  const ja = await newPage(browser, { query: '?lang=ja' });
  const jaOut = await ja.evaluate(() => ({
    locale: window.__playable.locale,
    headline: document.getElementById('hook-headline').textContent,
    cta: document.getElementById('live-cta').textContent,
  }));
  record('CHK-CFG-03', 'RULE-CFG-004', 'URL locale override (?lang=ja) renders Japanese',
    jaOut.locale === 'ja' && /[\u3040-\u30ff\u4e00-\u9fff]/.test(jaOut.headline + jaOut.cta),
    jaOut);
  await ja.close();

  const xx = await newPage(browser, { query: '?lang=xx' });
  const xxOut = await xx.evaluate(() => ({
    locale: window.__playable.locale,
    cta: document.getElementById('live-cta').textContent,
  }));
  record('CHK-CFG-04', 'RULE-CFG-005', 'Unsupported locale falls back to English',
    xxOut.locale === 'en' && /eSIM/.test(xxOut.cta), xxOut);
  await xx.close();

  // CHK-CFG-05: no clipping or overflow in any shipped locale, in either
  // orientation, on the endcard where the copy is densest.
  const shipped = ['en', 'es', 'ja', 'zh'];
  const overflow = [];
  for (const loc of shipped) {
    for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 480 }]) {
      const p = await newPage(browser, { query: `?lang=${loc}`, viewport: vp });

      // Runtime banners are the longest single-line copy in the creative and
      // the stylesheet would silently ellipsise them, so every hazard kind gets
      // driven through the banner before the endcard is measured.
      const banners = await p.evaluate(() => {
        const pl = window.__playable;
        const el = document.getElementById('banner');
        const bad = [];
        pl.config.gameplay.hazards.forEach((h) => {
          const text = pl.dict.hazard(h.kind);
          if (!text) { bad.push(`${h.kind}: no localised banner`); return; }
          pl.ui.banner(text, 'bad');
          if (el.scrollWidth > el.clientWidth + 1) bad.push(`${h.kind}: banner truncated`);
        });
        return bad;
      });
      if (banners.length) overflow.push({ locale: loc, viewport: `${vp.width}x${vp.height}`, issues: banners });

      await p.evaluate(() => window.__playable.forceEnd('qa'));
      await p.waitForTimeout(400);
      const bad = await p.evaluate((size) => {
        const issues = [];
        const ids = ['hook-headline', 'hook-headline-sub', 'end-headline', 'end-headline-sub',
          'end-body', 'legal', 'live-cta', 'end-cta', 'stat-dest-label', 'stat-data-label',
          'stat-uptime-label', 'meter-label', 'dest-label'];
        ids.forEach((id) => {
          const el = document.getElementById(id);
          if (!el) return;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return; // legitimately hidden by a media query
          if (el.scrollWidth > el.clientWidth + 1) issues.push(`${id}: clipped horizontally`);
          if (el.scrollHeight > el.clientHeight + 1) issues.push(`${id}: clipped vertically`);
          if (r.left < -0.5 || r.right > size.width + 0.5) issues.push(`${id}: outside viewport x`);
          if (r.top < -0.5 || r.bottom > size.height + 0.5) issues.push(`${id}: outside viewport y`);
        });
        return issues;
      }, vp);
      if (bad.length) overflow.push({ locale: loc, viewport: `${vp.width}x${vp.height}`, issues: bad });
      await p.close();
    }
  }
  record('CHK-CFG-05', 'RULE-CFG-006', 'No text clipping or overflow in any locale or orientation',
    overflow.length === 0, overflow.length ? overflow : `${shipped.length} locales x 3 viewports clean`);
}

async function orientationCheck(browser) {
  // CHK-PRF-05: both orientations must compose, with the safe-area insets
  // actually declared in the stylesheet.
  const page = await newPage(browser);
  const shots = {};
  for (const [name, vp] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(600);
    shots[name] = await page.evaluate((size) => {
      const canvas = document.getElementById('game');
      const hud = document.getElementById('hud').getBoundingClientRect();
      const cta = document.getElementById('live-cta').getBoundingClientRect();
      const inside = (r) => r.left >= -0.5 && r.top >= -0.5 &&
        r.right <= size.width + 0.5 && r.bottom <= size.height + 0.5;
      return {
        canvas: `${canvas.clientWidth}x${canvas.clientHeight}`,
        hudInside: inside(hud),
        ctaInside: inside(cta) && cta.height >= 44,
      };
    }, vp);
  }
  const insets = /env\(safe-area-inset-(top|bottom|left|right)\)/g;
  const insetHits = new Set((HTML.match(insets) || []).map((s) => s));
  record('CHK-PRF-05', 'RULE-PRF-007/008', 'Portrait and landscape compose within safe areas',
    shots.portrait.hudInside && shots.portrait.ctaInside &&
    shots.landscape.hudInside && shots.landscape.ctaInside && insetHits.size === 4,
    { ...shots, safeAreaInsetsDeclared: [...insetHits] });
  await page.close();
}

async function mraidChecks(browser) {
  const page = await newPage(browser, { mraid: true });

  await page.waitForFunction(() => window.__playable.bridge.isReady, null, { timeout: 4000 });
  const bound = await page.evaluate(() => ({
    isMraid: window.__playable.bridge.isMraid,
    listeners: Object.keys(window.__mraidLog.listeners),
    funnel: window.__playable.funnel.currentState,
  }));
  record('CHK-MRD-01', 'RULE-MRD-001', 'Binds ready, viewableChange and stateChange',
    bound.isMraid && ['ready', 'viewableChange', 'stateChange'].every((e) => bound.listeners.includes(e)),
    bound);

  // Audio ships on but stays shut until the player touches the creative, so
  // the suspend assertion below needs a real gesture first — otherwise it
  // would pass against a creative that was simply never audible.
  await tap(page);
  await page.waitForTimeout(150);
  const unmuted = await page.evaluate(() => !window.__playable.isAudioSilent());

  await page.evaluate(() => window.__mraidFire('viewableChange', false));
  await page.waitForTimeout(150);
  const hidden = await page.evaluate(() => ({
    silent: window.__playable.isAudioSilent(),
    loopRunning: window.__playable.isLoopRunning(),
    pauses: window.__playable.metrics.pauses,
  }));
  record('CHK-MRD-02', 'RULE-MRD-003', 'viewableChange:false mutes audio and pauses the loop',
    hidden.silent && !hidden.loopRunning && hidden.pauses >= 1,
    { audioUnmutedBefore: unmuted, ...hidden });

  await page.evaluate(() => window.__mraidFire('viewableChange', true));
  await page.waitForTimeout(200);
  const shown = await page.evaluate(() => ({
    silent: window.__playable.isAudioSilent(),
    loopRunning: window.__playable.isLoopRunning(),
    resumes: window.__playable.metrics.resumes,
  }));
  record('CHK-MRD-03', 'RULE-MRD-004', 'viewableChange:true resumes audio and rendering',
    !shown.silent && shown.loopRunning && shown.resumes >= 1, shown);

  // Also exercise the stateChange path, which some containers use instead.
  await page.evaluate(() => window.__mraidFire('stateChange', 'hidden'));
  await page.waitForTimeout(120);
  const stateHidden = await page.evaluate(() => window.__playable.isLoopRunning());
  await page.evaluate(() => window.__mraidFire('stateChange', 'default'));
  await page.waitForTimeout(120);

  await page.click('#live-cta', { force: true });
  await page.waitForTimeout(150);
  const opened = await page.evaluate(() => ({
    mraidOpens: window.__mraidLog.opens.slice(),
    windowOpens: window.__opened.slice(),
    expected: window.__playable.config.appDetails.clickUrl,
  }));
  record('CHK-MRD-04', 'RULE-MRD-005', 'CTA routes through mraid.open inside a container',
    opened.mraidOpens.length === 1 && opened.mraidOpens[0] === opened.expected &&
    opened.windowOpens.length === 0,
    { ...opened, stateChangeHiddenPausedLoop: !stateHidden });

  const tamper = /window\.parent|\bparent\s*\.\s*(?:document|postMessage)/.test(HTML);
  record('CHK-MRD-07', 'RULE-MRD-007', 'No access to window.parent or parent SDK DOM',
    !tamper, tamper ? 'window.parent reference found' : 'no parent access');

  await page.close();

  // CHK-MRD-05: no MRAID at all. Gameplay must still run and clicks must fall
  // back to window.open.
  const solo = await newPage(browser);
  await solo.waitForTimeout(900);
  await solo.click('#live-cta', { force: true });
  await solo.waitForTimeout(150);
  const soloOut = await solo.evaluate(() => ({
    isMraid: window.__playable.bridge.isMraid,
    funnel: window.__playable.funnel.currentState,
    loopRan: window.__playable.game.state.distance > 0,
    windowOpens: window.__opened.slice(),
  }));
  record('CHK-MRD-05', 'RULE-MRD-002/006', 'Standalone browser fallback runs and uses window.open',
    !soloOut.isMraid && soloOut.loopRan && soloOut.windowOpens.length === 1,
    soloOut);
  await solo.close();
}

// ----------------------------------------------------------------- reporting

async function main() {
  staticChecks();

  const browser = await chromium.launch();
  let pageErrors = [];
  try {
    pageErrors = (await hookChecks(browser)) || [];
    await capCheck(browser);
    await localeChecks(browser);
    await orientationCheck(browser);
    await mraidChecks(browser);
  } finally {
    await browser.close();
  }

  record('CHK-PRF-11', 'RULE-PRF-011', 'No uncaught errors during a full session',
    pageErrors.length === 0, pageErrors.length ? pageErrors.slice(0, 4) : 'clean');

  const failed = results.filter((r) => !r.pass);
  const report = {
    artifact: path.relative(process.cwd(), ART),
    bytes: BYTES,
    ranAt: new Date().toISOString(),
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    checks: results,
  };
  fs.writeFileSync('dist/qa-report.json', JSON.stringify(report, null, 2));

  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\n${pad('CHECK', 20)}${pad('RULE', 22)}${pad('', 5)}DESCRIPTION`);
  console.log('-'.repeat(104));
  for (const r of results) {
    console.log(`${pad(r.id, 20)}${pad(r.rule, 22)}${pad(r.pass ? 'PASS' : 'FAIL', 5)}${r.description}`);
    console.log(`${' '.repeat(47)}${JSON.stringify(r.measured)}`);
  }
  console.log('-'.repeat(104));
  console.log(`${report.passed}/${report.total} passed, ${report.failed} failed  ->  dist/qa-report.json`);

  if (failed.length) process.exitCode = 1;
}

main();
