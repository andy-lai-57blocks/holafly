// Packs every version into the same five-file layout the live creative uses:
//
//   index.html   thin shell — markup only, loads the four siblings in order
//   index.css    every rule the creative needs
//   config.js    var CONFIG — store links, copy, app knobs (client-editable)
//   assets.js    var ASSETS — nine fixed buckets, every payload a data URI
//   app.js       the creative itself, prefixed with the package runtime
//
// Compression follows the same house style: rasters are WebP, vectors stay
// vector, fonts ship as woff2, and anything bulky-but-textual is deflated.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const OUT_ROOT = 'dist/packages';
const EXTRACT = 'build/extracted';
const WEBP_QUALITY = 90;

const read = (p) => fs.readFileSync(p, 'utf8');
const bin = (p) => fs.readFileSync(p);
const ensure = (d) => fs.mkdirSync(d, { recursive: true });
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

// ---------------------------------------------------------------- encoding

/** cwebp beats every pure-JS encoder badly enough to be worth the dependency;
 *  -alpha_q 100 keeps cut-out sprites from fringing. */
function toWebp(srcFile) {
  const out = srcFile.replace(/\.[a-z]+$/i, '.packed.webp');
  execFileSync('cwebp', ['-quiet', '-q', String(WEBP_QUALITY), '-alpha_q', '100', '-m', '6', srcFile, '-o', out]);
  const bytes = bin(out);
  fs.unlinkSync(out);
  return bytes;
}

function dataUri(mime, buf) {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/** Matches how the live package stores its editor payload: deflate, then
 *  base64. Worth it for anything textual over a few KB. */
function deflateUri(text) {
  return `data:application/deflate;base64,${zlib.deflateSync(Buffer.from(text, 'utf8'), { level: 9 }).toString('base64')}`;
}

// ------------------------------------------------------------ file writers

const ASSET_BUCKETS = ['atlases', 'images', 'fonts', 'textures', 'sounds', 'video', 'json', 'models', 'spine'];

/** The bucket list is fixed and always present, even when empty — consumers
 *  index into it without guarding. */
function assetsModule(parts) {
  const out = {};
  for (const key of ASSET_BUCKETS) {
    out[key] = parts[key] !== undefined ? parts[key] : (['json', 'models', 'spine'].includes(key) ? {} : []);
  }
  return `var ASSETS=${JSON.stringify(out)};\n`;
}

function configModule(cfg) {
  return `var CONFIG = ${JSON.stringify(cfg, null, 4)};\n`;
}

function indexHtml({ title, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <title>${title}</title>

    <meta charset="utf-8">
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
    <meta name="format-detection" content="telephone=no">

    <link rel="stylesheet" type="text/css" href="index.css"/>

    <script src="config.js"></script>
    <script src="assets.js"></script>
    <script src="app.js"></script>
</head>
<body>
${body || ''}
</body>
</html>
`;
}

// ----------------------------------------------------------------- copy

/** Flattens a nested locale dictionary into the flat, English-keyed shape the
 *  package format uses: { "Stay connected": { en: "...", es: "..." } }.
 *  Keying on the source text is what lets app.js keep readable literals. */
function flattenStrings(locales, base = 'en') {
  const strings = {};
  const walk = (node, pick) => {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string') {
        const key = v;
        strings[key] = strings[key] || {};
        for (const [loc, dict] of Object.entries(locales)) {
          const other = pick(dict, k);
          if (typeof other === 'string') strings[key][loc] = other;
        }
        out[k] = v;
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        walk(v, (dict, key) => (dict && dict[k] ? dict[k][key] : undefined));
      }
    }
    return out;
  };
  walk(locales[base], (dict, key) => (dict ? dict[key] : undefined));
  return strings;
}

// -------------------------------------------------------------- guardrails

/** A package that reaches the network at runtime is a blank creative in any
 *  container that sandboxes it, so the only tolerated refs are the four
 *  siblings index.html loads by name.
 *
 *  Markup and CSS are checked strictly: the browser acts on those before a
 *  line of our code runs. Scripts only get scanned for absolute URLs, and
 *  those are reported rather than fatal — a vendored bundle can carry a CDN
 *  constant on a branch it never takes. tools/pack-verify.mjs is what actually
 *  proves nothing leaves the page. */
function auditRefs(slug, files) {
  const allowed = new Set(['index.css', 'config.js', 'assets.js', 'app.js']);
  const fatal = [];
  const inert = [];
  const parsed = [
    /<script[^>]+\bsrc\s*=\s*["']([^"']+)["']/gi,
    /<link[^>]+\bhref\s*=\s*["']([^"']+)["']/gi,
    /<(?:img|video|audio|source|iframe|embed)[^>]+\bsrc\s*=\s*["']([^"']+)["']/gi,
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
    /@import\s+["']([^"']+)["']/gi,
  ];

  for (const [name, text] of Object.entries(files)) {
    if (name === 'assets.js') continue; // pure base64 payload, nothing loadable

    if (name.endsWith('.js')) {
      for (const m of text.matchAll(/["'`](https?:)?\/\/[^"'`\s]{4,}["'`]/g)) inert.push(`${name}: ${m[0].slice(1, 81)}`);
      continue;
    }

    // Comments are not loadable, and these sources carry examples in them.
    const live = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
    for (const re of parsed) {
      let m;
      while ((m = re.exec(live))) {
        const url = m[1].trim();
        if (!url || url.startsWith('data:') || url.startsWith('#') || url.startsWith('__')) continue;
        if (allowed.has(url)) continue;
        fatal.push(`${name}: ${url.slice(0, 100)}`);
      }
    }
  }

  if (fatal.length) throw new Error(`${slug} would fetch at parse time:\n  ${fatal.join('\n  ')}`);
  return inert;
}

function emit(slug, files) {
  const inert = auditRefs(slug, files);
  const dir = path.join(OUT_ROOT, slug);
  ensure(dir);
  const sizes = {};
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), text);
    sizes[name] = Buffer.byteLength(text);
  }
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  console.log(`\n${slug}  ->  ${dir}`);
  for (const name of ['index.html', 'index.css', 'config.js', 'assets.js', 'app.js']) {
    console.log(`  ${name.padEnd(12)} ${kb(sizes[name]).padStart(10)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(12)} ${kb(total).padStart(10)}`);
  if (inert.length) console.log(`  ${inert.length} URL literal(s) inside bundled JS — verified unreachable by pack-verify`);
  return { slug, dir, sizes, total, inertUrls: inert };
}

// ================================================= version 1: the runner

function packStayConnectedRun() {
  const slug = 'stay-connected-run';
  const manifest = JSON.parse(read('assets/manifest.json'));

  const src = read('src/config.js');
  const scope = {};
  new Function('window', src)(scope);
  const base = scope.PlayableConfig;

  const images = manifest.sprites
    .filter((s) => src.includes(`__ASSET_${s.name}__`))
    .map((s) => ({ name: s.name, url: dataUri('image/webp', bin(s.file)) }));

  const fonts = manifest.fonts.map((f) => ({
    name: `modern-era-${f.weight}`,
    url: dataUri('font/woff2', bin(f.file)),
  }));

  const family = JSON.parse(read('brand/brand-tokens.json')).typography.family;
  const fontFaces = manifest.fonts.map((f) => [
    '@font-face{',
    `font-family:'${family}';`,
    `font-style:normal;font-weight:${f.weight === 'bold' ? 700 : 500};font-display:block;`,
    `src:url(__FONT_modern-era-${f.weight}__) format('woff2');`,
    '}',
  ].join('')).join('');

  const config = {
    googlePlayUrl: base.appDetails.clickUrlByPlatform.android,
    appStoreUrl: base.appDetails.clickUrlByPlatform.ios,
    amazonAppstoreUrl: '',
    I18: { locale: 'en', strings: flattenStrings(base.localization.locales) },
    application: {
      showDebugInfo: false,
      tutorTime: base.gameplay.idleTimeoutMs,
      gameSeconds: Math.round(base.gameplay.maxGameplayDurationMs / 1000),
      variant: 'default',
    },
  };

  // Only the base dictionary is baked in; every literal is looked up through
  // CONFIG.I18 at runtime, so the other locales live in config.js alone.
  const baked = { ...base, localization: { defaultLocale: 'en', locales: { en: base.localization.locales.en } } };

  const bodyHtml = read('src/index.template.html')
    .match(/<body[^>]*>([\s\S]*)<\/body>/)[1]
    .replace(/<script>[\s\S]*?<\/script>/g, '')
    .trim();

  const adapter = `
/* stay-connected-run — bind the creative's own config object to CONFIG/ASSETS */
(function (window) {
  'use strict';
  var BAKED = ${JSON.stringify(baked)};
  var FONT_FACES = ${JSON.stringify(fontFaces)};

  var cfg = HF.resolve(BAKED, false);
  cfg.localization = { defaultLocale: HF.locale, locales: {} };
  cfg.localization.locales[HF.locale] = HF.resolve(BAKED.localization.locales.en, true);
  cfg.appDetails.clickUrl = HF.storeUrl();
  cfg.appDetails.clickUrlByPlatform = { ios: CONFIG.appStoreUrl, android: CONFIG.googlePlayUrl };
  if (HF.app.tutorTime) cfg.gameplay.idleTimeoutMs = HF.app.tutorTime;
  if (HF.app.gameSeconds) cfg.gameplay.maxGameplayDurationMs = HF.app.gameSeconds * 1000;

  window.PlayableConfig = cfg;
  HF.mountFonts(FONT_FACES);
})(window);
`;

  const sources = ['src/mraid-bridge.js', 'src/art.js', 'src/engine.js', 'src/ui.js', 'src/game.js', 'src/boot.js'];
  const appJs = [
    read('tools/pack-runtime.js'),
    adapter,
    ...sources.map((p) => `/* ${path.basename(p)} */\n${read(p)}`),
  ].join('\n;\n');

  return emit(slug, {
    'index.html': indexHtml({ title: base.appDetails.appName + ' — Stay Connected Run', body: bodyHtml }),
    'index.css': read('src/style.css'),
    'config.js': configModule(config),
    'assets.js': assetsModule({ images, fonts }),
    'app.js': appJs,
  });
}

// ============================================ version 2: run from bill shock

// The bundler stripped every filename in this version down to a uuid. Names
// recovered by reading where each one is used in the template.
/*  Make the Bill Shock board fill its container instead of letterboxing.
 *
 *  It was authored as a fixed 390x844 phone board and measure() scaled that
 *  box to *fit*, so on an iPad it sat as a rounded card covering about a third
 *  of the screen with dark bars around it.
 *
 *  Removing the cap is not enough on its own. In the shipped `light` theme the
 *  CSS road is drawn at opacity 0 — the road the player actually sees is baked
 *  into the cityBg photo, painted with background-size:cover. The lane maths
 *  was a set of fractions of the 390x844 box that happened to coincide with
 *  where `cover` lands that photo on a phone. Widen the box and the runner
 *  sprints off the painted road onto the pavement.
 *
 *  So the light-theme geometry is re-expressed against the photo's rendered
 *  rect (bx/by/bw/bh, recomputed in measure). The constants below are the
 *  authored fractions converted into that space using the phone as reference,
 *  which leaves phone output byte-identical and makes every other aspect
 *  ratio track the artwork. Non-light themes keep their box-relative maths:
 *  those draw their own road with percentage CSS, which already reflows.
 *
 *  Each substitution asserts it landed exactly once, so a re-exported
 *  creative fails the build rather than quietly shipping a broken playfield. */
function fitToContainer(src) {
  const BG_W = 941, BG_H = 1672;      // cityBg's intrinsic size
  const REF_W = 390, REF_H = 844;     // the board as authored
  const refScale = Math.max(REF_W / BG_W, REF_H / BG_H);
  const refBgW = BG_W * refScale;     // 475.0 — the photo overflows the phone's width
  const refBgX = (REF_W - refBgW) / 2;
  // A position given as a fraction of the box, restated as a fraction of the photo.
  const u = (frac) => +(((frac * REF_W) - refBgX) / refBgW).toFixed(5);
  // A width given as a fraction of the box, restated as a fraction of the photo.
  const du = (frac) => +((frac * REF_W) / refBgW).toFixed(5);

  const CX = `this.bx + this.bw * ${u(0.5)}`;
  const LANE_MIN = `this.bx + this.bw * ${u(0.1)}`;
  const LANE_MAX = `this.bx + this.bw * ${u(0.9)}`;
  const TX_MIN = `this.bx + this.bw * ${u(0.12)}`;
  const TX_MAX = `this.bx + this.bw * ${u(0.88)}`;

  const cuts = [
    {
      what: 'fit-to-contain sizing',
      find: `    const phone = vw < 560;
    let s;
    if (phone) {
      s = vw / 390;
      this.h = Math.max(600, Math.min(1100, Math.round(vh / s)));
    } else {
      s = Math.min(aw / 390, ah / 844) * 0.985;
      this.h = 844;
    }
    const hpx = this.h + 'px';
    if (st.style.height !== hpx) st.style.height = hpx;
    this.ec = Math.min(1, this.h / 844);
    this.rs = 1.91 * Math.max(0.85, Math.min(1, this.h / 844));`,
      put: `    // Fill the slot. The scale is taken from the width so art keeps a
    // sensible on-screen size, capped so that a tablet lays out more board
    // rather than magnifying a phone's worth of it; the board then takes
    // whatever width and height the container actually has.
    // The minimum board below has to be bought by easing the scale, not by
    // letting the board overflow: a phone held in landscape is under 400px
    // tall, and clamping the height there pushed half the board off-screen.
    let s = Math.min(Math.max(vw / 390, 0.6), 1.45);
    s = Math.min(s, aw / 390, ah / 560);
    this.w = Math.max(390, Math.round(aw / s));
    this.h = Math.max(560, Math.round(ah / s));
    const wpx = this.w + 'px', hpx = this.h + 'px';
    if (st.style.width !== wpx) st.style.width = wpx;
    if (st.style.height !== hpx) st.style.height = hpx;
    // Stable hook for pack-verify's fill check; the board has no class of its own.
    if (!st.dataset.hfStage) st.dataset.hfStage = '1';
    // Where background-size:cover actually puts the road photo. The light
    // theme's playfield is measured against this, not against the board.
    const bs = Math.max(this.w / ${BG_W}, this.h / ${BG_H});
    this.bw = ${BG_W} * bs; this.bh = ${BG_H} * bs;
    this.bx = (this.w - this.bw) / 2; this.by = (this.h - this.bh) / 2;
    this.ec = Math.min(1, this.h / 844);
    // Size the runner off the painted road's width so the two stay in
    // proportion, but hold it back by the board's height as well: a landscape
    // tablet has a very wide road and very little headroom, and scaling on
    // width alone there fills half the screen with the character.
    const byRoad = this.bw / ${refBgW.toFixed(1)}, byBoard = this.h / 844;
    this.rs = 1.91 * Math.max(0.85, Math.min(1.2, Math.min(byRoad, byBoard * 1.15)));`,
    },
    {
      what: 'phone-only square corners',
      find: `    const radius = phone ? '0px' : '26px';`,
      put: `    const radius = '0px';`,
    },
    {
      what: 'lane positions',
      find: `    const k = Math.max(0, Math.min(1, (y - this.h * 0.18) / (this.h * 0.62)));
    const half = this.w * (0.13 + 0.25 * k);
    const side = (lane - 0.5) / 0.3;
    const scaledOff = off * (0.45 + 0.55 * k);
    return Math.max(this.w * 0.1, Math.min(this.w * 0.9, this.w / 2 + side * half + scaledOff));`,
      put: `    const k = Math.max(0, Math.min(1, ((y - this.by) / this.bh - 0.18) / 0.62));
    const half = this.bw * (${du(0.13)} + ${du(0.25)} * k);
    const side = (lane - 0.5) / 0.3;
    const scaledOff = off * (0.45 + 0.55 * k);
    return Math.max(${LANE_MIN}, Math.min(${LANE_MAX}, ${CX} + side * half + scaledOff));`,
    },
    {
      // Dash *size* follows the painted road's perspective, so its depth is
      // read in photo space; where the dashes sit on screen stays board-space.
      what: 'dash depth',
      find: `      const k = Math.max(0, Math.min(1, (y - top) / (this.h - top)));`,
      put: `      const k = Math.max(0, Math.min(1, ((y - this.by) / this.bh - 0.25) / 0.75));`,
    },
    {
      what: 'dash x',
      find: `      el.style.transform = 'translate3d(' + (this.w / 2 - w / 2) + 'px,' + y + 'px,0)';`,
      put: `      el.style.transform = 'translate3d(' + (${CX} - w / 2) + 'px,' + y + 'px,0)';`,
    },
    {
      // The endcard was pinned to 390px wide with a matching max-width, and
      // the inner column's width/scale pair was rigged so the rendered width
      // came out at 390 whatever the board. On a landscape tablet that left
      // the panel covering under half the screen with the game still running
      // beside it. Now it spans the board and reflows into two columns.
      what: 'endcard layout',
      find: `  applyEndcard() {
    const e = this.R.endcard.current; if (!e) return;
    const hpx = (this.h || 844) + 'px';
    if (e.style.height !== hpx) e.style.height = hpx;
    const k = this.ec || 1;
    const inner = this.R.ecInner.current;
    if (inner) {
      const wpx = Math.round(390 / k) + 'px';
      if (inner.style.width !== wpx) inner.style.width = wpx;
      inner.style.transform = 'scale(' + k + ')';
    }
    const shown = this.g && this.g.phase === 'end';
    e.style.transform = shown ? 'translateY(0)' : 'translateY(101%)';
  }`,
      put: `  applyEndcard() {
    const e = this.R.endcard.current; if (!e) return;
    const wpx = this.w + 'px', hpx = this.h + 'px';
    if (e.style.width !== wpx) e.style.width = wpx;
    if (e.style.maxWidth !== 'none') e.style.maxWidth = 'none';
    if (e.style.height !== hpx) e.style.height = hpx;

    // Re-fitting forces a layout pass and measure() runs several times a
    // second, so only redo it when something that affects the fit changes:
    // the board size, or the card becoming visible. That second case matters
    // because the first fit happens at boot, before the webfont has loaded,
    // when the copy does not yet measure at its final height.
    const shown = this.g && this.g.phase === 'end';
    const inner = this.R.ecInner.current;
    const key = this.w + 'x' + this.h + (shown ? ':on' : ':off');
    if (inner && this.ecKey !== key) { this.ecKey = key; this.layoutEndcard(inner); }

    e.style.transform = shown ? 'translateY(0)' : 'translateY(101%)';
  }

  /*  Lay the endcard out at the board's full width, then scale it to fit the
   *  height. On a wide board the five content blocks split into two columns —
   *  headline and hero left, offer, stats and CTA right — because a single
   *  narrow column on a landscape tablet is mostly empty space.
   *
   *  The height is measured rather than derived from the board's aspect: the
   *  copy rewraps as the column widens, so the scale that fits depends on the
   *  width it is laid out at. A few passes settle it. */
  layoutEndcard(inner) {
    const R = this.R;
    const col = R.eTitle.current && R.eTitle.current.parentElement;
    const wide = this.w / this.h > 1.15;
    const blocks = [R.eTitle, R.eHero, R.eBenefit, R.eStats, R.eCta];

    if (col) {
      // The column's gap is authored as a shorthand; clearing rowGap alone
      // would drop it and collapse the stack, so keep the original to put back.
      if (this.ecGap == null) this.ecGap = col.style.gap || '';
      if (wide) {
        col.style.display = 'grid';
        col.style.gridTemplateColumns = '1fr 1fr';
        col.style.gap = '16px 34px';
        col.style.alignContent = 'center';
        const place = [
          [R.eTitle, '1', '1'],
          [R.eHero, '1', '2'],
          [R.eBenefit, '2', '1'],
          [R.eStats, '2', '2'],
        ];
        for (const [ref, gc, gr] of place) {
          const el = ref && ref.current; if (!el) continue;
          el.style.gridColumn = gc; el.style.gridRow = gr; el.style.alignSelf = 'center';
        }
      } else {
        col.style.display = 'flex';
        col.style.gap = this.ecGap;
        for (const p of ['gridTemplateColumns', 'alignContent']) col.style[p] = '';
        for (const ref of blocks) {
          const el = ref && ref.current; if (!el) continue;
          el.style.gridColumn = ''; el.style.gridRow = ''; el.style.alignSelf = '';
        }
      }
    }

    // The CTA lives outside the content column — it is a sibling of it, so grid
    // placement cannot reach it. Line it up under the right-hand column by
    // width instead: half the content box, less half the 34px column gap.
    const cta = R.eCta.current;
    if (cta) {
      if (this.ecCtaMt == null) this.ecCtaMt = cta.style.marginTop;
      cta.style.width = wide ? 'calc(50% - 17px)' : '';
      cta.style.alignSelf = wide ? 'flex-end' : '';
      cta.style.marginTop = wide ? '0' : this.ecCtaMt;
    }

    // Measure in the configuration that will actually be rendered: at the real
    // height, with the transform off. An auto height reports something else
    // entirely, because the column is a flex item with a zero basis and the
    // hero artwork deliberately spills out of its box. What has to fit is the
    // bottom of the in-flow stack, which ends at the CTA; the panel's bottom
    // padding is allowed to be eaten, as it already is on a phone.
    //
    //  offsetTop/offsetHeight are what to read, not a client rect: the fit is
    //  recomputed the moment the card is revealed, while the blocks still
    //  carry the reveal animation's translate, and offsets ignore transforms.
    const tail = R.eCta.current;
    let k = 1;
    for (let pass = 0; pass < 4; pass++) {
      inner.style.width = Math.round(this.w / k) + 'px';
      inner.style.height = Math.round(this.h / k) + 'px';
      if (!tail) break;
      const avail = this.h / k;
      const used = tail.offsetTop + tail.offsetHeight;
      if (used <= avail + 1) break;
      const next = Math.max(0.5, k * (avail / used));
      if (Math.abs(next - k) < 0.005) { k = next; break; }
      k = next;
    }
    inner.style.width = Math.round(this.w / k) + 'px';
    inner.style.height = Math.round(this.h / k) + 'px';
    inner.style.transform = 'scale(' + k + ')';
    this.ec = k;
  }`,
    },
    {
      what: 'player start position',
      find: `px: this.w / 2, tx: this.w / 2,`,
      put: `px: ${CX}, tx: ${CX},`,
    },
    {
      what: 'player reset transform',
      find: `'translate3d(' + (this.w / 2 - 24) + 'px,'`,
      put: `'translate3d(' + (${CX} - 24) + 'px,'`,
    },
    {
      what: 'esim pickup lane',
      find: `g.esim = {x: w / 2, y: -90};`,
      put: `g.esim = {x: ${CX}, y: -90};`,
    },
    {
      what: 'pointer steering bounds',
      find: `    this.g.tx = Math.max(this.w * 0.12, Math.min(this.w * 0.88, (e.clientX - r.left) / s));`,
      put: `    this.g.tx = Math.max(${TX_MIN}, Math.min(${TX_MAX}, (e.clientX - r.left) / s));`,
    },
    {
      what: 'keyboard steering left bound',
      find: `Math.max(this.w * 0.12, this.g.tx - 64)`,
      put: `Math.max(${TX_MIN}, this.g.tx - 64)`,
    },
    {
      what: 'keyboard steering right bound',
      find: `Math.min(this.w * 0.88, this.g.tx + 64)`,
      put: `Math.min(${TX_MAX}, this.g.tx + 64)`,
    },
  ];

  let out = src;
  for (const cut of cuts) {
    const parts = out.split(cut.find);
    if (parts.length !== 2) {
      throw new Error(`bill-shock: expected one "${cut.what}" to rewrite, found ${parts.length - 1}`);
    }
    out = parts.join(cut.put);
  }

  // Horizontal placement must now come from the photo rect, because that is
  // where the road is painted. Vertical placement deliberately stays in board
  // space: it is screen composition, and a landscape tablet crops so much of
  // the photo's height that anchoring to it would put the runner off-screen.
  const stale = out.match(/\bthis\.w \* 0\.\d+/g);
  if (stale) throw new Error(`bill-shock: box-relative horizontal geometry remains: ${[...new Set(stale)].join(', ')}`);

  return out;
}

const BILL_SHOCK_NAMES = {
  'c6212a1b-8527-46de-9442-98bf472623e7': 'logo',
  '61ed3a9a-902e-48cd-996f-860550b6967e': 'runner-frame-a',
  'e5ee5dc2-c794-436a-9e4d-4176ea8a43b0': 'runner-frame-b',
  '9b8bb2c5-9b56-46c5-916b-72328b1d7127': 'top-band',
  '688e5a03-dfcd-43a1-89ad-fdd236b49a98': 'hero-phone',
  '63c7cdf5-6044-4cc8-8a10-bb0015220bd4': 'card-art',
  '508e5e74-9bcb-4234-8d6c-77a8ee97585d': 'float-left',
  '8be60690-689a-48e0-bf13-3eb463f459bb': 'float-right',
  cityBg: 'cityBg',
};

/** dc-runtime keeps a postMessage channel open to whatever frame embeds it:
 *  it announces boot and design-mode upstream, and accepts theme commands back
 *  from any origin without checking one. That is an authoring-tool link. In an
 *  ad slot it breaks the rule against touching the parent frame and leaves an
 *  injection surface; the creative takes its theme from CONFIG either way, so
 *  the whole channel comes out.
 *
 *  Cut by exact match rather than neutered in place, so a reviewer's static
 *  scan finds no cross-frame code at all. Each cut asserts it landed — if the
 *  vendored runtime is ever rebuilt this fails the build instead of quietly
 *  restoring the channel. */
function severHostChannel(src) {
  const cuts = [
    {
      what: 'boot announcement',
      find: /const notifyHost = \(\) => \{\s*if \(window\.parent === window\) return;[\s\S]*?\} catch \{\s*\}\s*\};/,
      put: 'const notifyHost = () => {};',
    },
    {
      what: 'design-mode announcement',
      find: /function postDesignMode\(mode\) \{\s*if \(window\.parent === window\) return;[\s\S]*?\} catch \{\s*\}\s*\}/,
      put: 'function postDesignMode(mode) {}',
    },
    {
      what: 'inbound command listener',
      find: /window\.addEventListener\("message", \(e\) => \{\s*const type = e\.data && e\.data\.type;[\s\S]*?postDesignMode\(designDocMode\);\s*\}\);/,
      put: '',
    },
  ];

  let out = src;
  for (const cut of cuts) {
    const hits = out.match(new RegExp(cut.find.source, 'g'));
    if (!hits || hits.length !== 1) {
      throw new Error(`dc-runtime: expected one "${cut.what}" to remove, found ${hits ? hits.length : 0}`);
    }
    out = out.replace(cut.find, cut.put);
  }

  // Port-to-port postMessage inside React's scheduler is fine; a window
  // reference is not.
  const left = out.match(/window\.(?:parent|top)\b|\bparent\.postMessage\b/g);
  if (left) throw new Error(`dc-runtime: parent-frame access remains: ${[...new Set(left)].join(', ')}`);

  return out;
}

function packBillShock() {
  const slug = 'run-from-bill-shock';
  const dir = path.join(EXTRACT, slug);
  const meta = JSON.parse(read(path.join(dir, 'extract.json')));
  const assetPath = (f) => path.join(dir, 'assets', f);
  const nameFor = (a) => BILL_SHOCK_NAMES[a.label] || BILL_SHOCK_NAMES[a.uuid] || a.label;

  // Every raster here arrived as PNG; re-encoding is the single biggest size
  // win available in this version.
  const images = [];
  const savings = [];
  for (const a of meta.assets.filter((x) => x.mime.startsWith('image/'))) {
    const name = nameFor(a);
    if (a.mime === 'image/svg+xml') {
      images.push({ name, url: dataUri('image/svg+xml', bin(assetPath(a.file))) });
      continue;
    }
    const webp = toWebp(assetPath(a.file));
    savings.push([name, a.bytes, webp.length]);
    images.push({ name, url: dataUri('image/webp', webp) });
  }

  const fonts = meta.assets
    .filter((a) => a.mime === 'font/woff2')
    .map((a, i) => ({ name: `figtree-${i === 0 ? 'latin-ext' : 'latin'}`, uuid: a.uuid, url: dataUri('font/woff2', bin(assetPath(a.file))) }));

  // The stylesheet points at fonts by the bundler's uuid. Swap those for the
  // runtime's font tokens and lift the affected rules out of index.css.
  let css = read(path.join(dir, 'styles.css'));
  let fontFaces = '';
  css = css.replace(/@font-face\s*{[^}]*}/g, (block) => {
    if (!/url\(/.test(block)) return block;
    let rule = block;
    for (const f of fonts) rule = rule.split(`"${f.uuid}"`).join(`__FONT_${f.name}__`);
    fontFaces += rule;
    return '';
  });
  for (const f of fonts) delete f.uuid;

  // The component reads its art off window.__resources, so that object is all
  // the adapter has to rebuild.
  const resourceNames = images.map((i) => i.name);

  const props = JSON.parse(
    meta.xdcAttrs.match(/data-props="([^"]*)"/)[1]
      .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
  );

  const config = {
    googlePlayUrl: 'https://play.google.com/store/apps/details?id=com.holafly.holafly',
    appStoreUrl: 'https://apps.apple.com/app/id1629600786',
    amazonAppstoreUrl: '',
    I18: {
      locale: 'en',
      strings: Object.fromEntries(
        ['Get your Holafly eSIM', 'ROAMING', 'OVERAGE', 'CALL FEE', 'SMS FEE', 'EXTRA FEE', 'CLEARED',
          'Spain', 'Japan', 'Italy', 'France', 'Portugal', 'Mexico']
          .map((s) => [s, { en: s }]),
      ),
    },
    application: {
      showDebugInfo: false,
      theme: props.theme && props.theme.default ? props.theme.default : 'light',
      gameSeconds: props.gameSeconds && props.gameSeconds.default ? props.gameSeconds.default : 30,
      intensity: props.intensity && props.intensity.default ? props.intensity.default : 1,
      variant: 'default',
    },
  };

  const component = fitToContainer(read(path.join(dir, 'component.xdc.js')));
  const runtimeFile = meta.assets.find((a) => a.mime === 'text/javascript' && !/^https?:/.test(a.name));
  const react = meta.assets.find((a) => /\/react@/.test(a.name));
  const reactDom = meta.assets.find((a) => /react-dom@/.test(a.name));

  // Props the creative exposes are re-read from CONFIG so the client can retune
  // the round without a rebuild.
  const liveProps = {
    ...props,
    theme: { ...props.theme, default: config.application.theme },
    gameSeconds: { ...props.gameSeconds, default: config.application.gameSeconds },
    intensity: { ...props.intensity, default: config.application.intensity },
    ctaLabel: { ...props.ctaLabel, default: config.I18.strings['Get your Holafly eSIM'].en },
  };

  // The markup addresses art by the bundler's uuid. Those would fire off
  // relative requests the moment the parser saw them, so the template moves
  // into app.js and the uuids become tokens the runtime resolves.
  let template = read(path.join(dir, 'body.html'))
    .replace(/<helmet>[\s\S]*?<\/helmet>/g, '') // preconnects to a font CDN we already inline
    .replace(/<x-dc>([\s\S]*)<\/x-dc>/, '$1')
    .trim();
  for (const [uuid, name] of Object.entries(BILL_SHOCK_NAMES)) {
    template = template.split(uuid).join(`__ASSET_${name}__`);
  }
  const leftover = template.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g);
  if (leftover) throw new Error(`${slug}: unnamed asset uuid in template: ${[...new Set(leftover)].join(', ')}`);

  const adapter = `
/* run-from-bill-shock — feed the component runtime from CONFIG/ASSETS */
(function (window, document) {
  'use strict';
  var NAMES = ${JSON.stringify(resourceNames)};
  var FONT_FACES = ${JSON.stringify(fontFaces)};
  var COMPONENT = ${JSON.stringify(component)};
  var PROPS = ${JSON.stringify(liveProps)};
  var TEMPLATE = ${JSON.stringify(template)};

  // The component looks art up here by name, exactly as the source shipped.
  var resources = {};
  for (var i = 0; i < NAMES.length; i++) resources[NAMES[i]] = HF.image(NAMES[i]);
  resources.ctaUrl = HF.storeUrl();
  resources.ctaLabel = HF.text('Get your Holafly eSIM');
  window.__resources = resources;

  HF.mountFonts(FONT_FACES);

  // dc-runtime discovers the component by querying the document, so both nodes
  // have to exist before it boots. It boots on DOMContentLoaded and registers
  // that listener after this file's, so ours runs first.
  var script = document.createElement('script');
  script.type = 'text/x-dc';
  script.setAttribute('data-dc-script', '');
  script.setAttribute('data-props', JSON.stringify(PROPS));
  script.textContent = COMPONENT;
  (document.head || document.documentElement).appendChild(script);

  // Object URLs, not data URIs: the runtime parses the template's inline
  // style attributes by splitting on ';', which would cut a data URI in half
  // at ";base64,". The source bundle substituted blob URLs for the same reason.
  HF.ready(function () {
    var host = document.createElement('x-dc');
    host.innerHTML = TEMPLATE.replace(/__ASSET_([a-z0-9-]+)__/gi, function (all, name) {
      return HF.blobUrl(name);
    });
    document.body.appendChild(host);
  });
})(window, document);
`;

  // React must define its globals before dc-runtime looks for them, otherwise
  // the runtime falls back to fetching both from a CDN.
  const appJs = [
    read('tools/pack-runtime.js'),
    `/* react ${react.name} */\n${read(assetPath(react.file))}`,
    `/* react-dom ${reactDom.name} */\n${read(assetPath(reactDom.file))}`,
    adapter,
    `/* dc-runtime (editor host channel removed) */\n${severHostChannel(read(assetPath(runtimeFile.file)))}`,
  ].join('\n;\n');

  const report = emit(slug, {
    'index.html': indexHtml({ title: 'Holafly — Run From Bill Shock', body: '' }),
    'index.css': css.trim() + '\n',
    'config.js': configModule(config),
    'assets.js': assetsModule({ images, fonts }),
    'app.js': appJs,
  });

  const before = savings.reduce((a, s) => a + s[1], 0);
  const after = savings.reduce((a, s) => a + s[2], 0);
  console.log(`  rasters      ${kb(before)} PNG -> ${kb(after)} WebP  (${Math.round((after / before) * 100)}%)`);
  return report;
}

// ================================================= version 3: one stroke

function packOneStroke() {
  const slug = 'one-stroke';
  const dir = path.join(EXTRACT, slug);
  const meta = JSON.parse(read(path.join(dir, 'extract.json')));

  const images = meta.assets.map((a) => ({
    name: a.name,
    url: dataUri(a.mime, bin(path.join(dir, 'assets', a.file))),
  }));

  // This version asks for 'Modern Era' but never shipped the files, so it has
  // been rendering in the system fallback. The subsets the runner already
  // builds drop straight in.
  const manifest = JSON.parse(read('assets/manifest.json'));
  const family = JSON.parse(read('brand/brand-tokens.json')).typography.family;
  const fonts = manifest.fonts.map((f) => ({
    name: `modern-era-${f.weight}`,
    url: dataUri('font/woff2', bin(f.file)),
  }));
  const fontFaces = manifest.fonts.map((f) => [
    '@font-face{',
    `font-family:'${family}';`,
    `font-style:normal;font-weight:${f.weight === 'bold' ? '700 900' : 500};font-display:block;`,
    `src:url(__FONT_modern-era-${f.weight}__) format('woff2');`,
    '}',
  ].join('')).join('');

  const scope = {};
  new Function('window', read(path.join(dir, 'config.src.js')))(scope);
  const base = scope.PlayableConfig;

  const config = {
    googlePlayUrl: 'https://play.google.com/store/apps/details?id=com.holafly.holafly',
    appStoreUrl: 'https://apps.apple.com/app/id1629600786',
    amazonAppstoreUrl: '',
    I18: { locale: 'en', strings: flattenStrings(base.localization.locales) },
    application: {
      showDebugInfo: false,
      tutorTime: base.gameplay.idleHintMs,
      gameSeconds: base.gameplay.timerSeconds,
      mode: base.gameplay.mode,
      variant: 'default',
    },
  };

  const baked = { ...base, localization: { defaultLocale: 'en', locales: { en: base.localization.locales.en } } };

  // The markup carries <img data-asset="…"> placeholders the extractor left
  // behind; the runtime fills them once the DOM exists.
  const body = read(path.join(dir, 'body.html'))
    .replace(/src="__ASSET_([a-z0-9-]+)__"/gi, 'data-asset="$1"')
    .trim();

  const adapter = `
/* one-stroke — bind the creative's own config object to CONFIG/ASSETS */
(function (window) {
  'use strict';
  var BAKED = ${JSON.stringify(baked)};
  var FONT_FACES = ${JSON.stringify(fontFaces)};

  HF.mountFonts(FONT_FACES);

  var cfg = HF.resolve(BAKED, false);
  cfg.localization = { defaultLocale: HF.locale, locales: {} };
  cfg.localization.locales[HF.locale] = HF.resolve(BAKED.localization.locales.en, true);
  cfg.appDetails.clickUrl = HF.storeUrl();
  if (HF.app.tutorTime) cfg.gameplay.idleHintMs = HF.app.tutorTime;
  if (HF.app.gameSeconds) cfg.gameplay.timerSeconds = HF.app.gameSeconds;
  if (HF.app.mode) cfg.gameplay.mode = HF.app.mode;

  window.PlayableConfig = cfg;
})(window);
`;

  // The creative reads the DOM at parse time; app.js now loads from <head>, so
  // hold it until the markup and the art placeholders are in place.
  const appJs = [
    read('tools/pack-runtime.js'),
    adapter,
    `HF.ready(function () {\n  HF.paintAssets();\n${read(path.join(dir, 'app.src.js'))}\n});`,
  ].join('\n;\n');

  return emit(slug, {
    'index.html': indexHtml({ title: 'Holafly — One Stroke', body }),
    'index.css': read(path.join(dir, 'styles.css')).trim() + '\n',
    'config.js': configModule(config),
    'assets.js': assetsModule({ images, fonts }),
    'app.js': appJs,
  });
}

// ---------------------------------------------------------------------- run

ensure(OUT_ROOT);
const reports = [packStayConnectedRun(), packBillShock(), packOneStroke()];
fs.writeFileSync(path.join(OUT_ROOT, 'pack-report.json'), JSON.stringify(reports, null, 2));
console.log(`\npacked ${reports.length} versions into ${OUT_ROOT}`);
