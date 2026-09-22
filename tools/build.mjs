// S7 INLINE_BUNDLE — assemble the single self-contained .html artefact.
//
// Gate G7: zero external URL references in any loadable position, total size
// <= 2MB. Both are asserted here, so a regression fails the build rather than
// surfacing as a blank creative in an ad network's QA queue.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = 'dist';
const OUT_FILE = path.join(OUT_DIR, 'holafly-playable.html');

const BUDGET_BYTES = 2 * 1024 * 1024;       // RULE-PRF-002 target
const HARD_CAP_BYTES = 5 * 1024 * 1024;     // RULE-PRF-002 hard maximum
const BOOTSTRAP_BUDGET = 200 * 1024;        // RULE-PRF-003

// Order matters: config must be parsed before anything reads it, and the MRAID
// bridge must exist before boot wires lifecycle callbacks (RULE-CFG-002).
const SCRIPTS = [
  'src/mraid-bridge.js',
  'src/art.js',
  'src/engine.js',
  'src/ui.js',
  'src/game.js',
  'src/boot.js',
];

function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function b64(p) { return fs.readFileSync(path.join(ROOT, p)).toString('base64'); }

function fontFaces(manifest) {
  const family = JSON.parse(read('brand/brand-tokens.json')).typography.family;
  return manifest.fonts
    .map((f) => {
      const weight = f.weight === 'bold' ? 700 : 500;
      return [
        '@font-face{',
        `font-family:'${family}';`,
        `font-style:normal;font-weight:${weight};font-display:block;`,
        `src:url(data:font/woff2;base64,${b64(f.file)}) format('woff2');`,
        '}',
      ].join('');
    })
    .join('');
}

function inlineConfig(manifest, locale) {
  let src = read('src/config.js');
  const byName = new Map(manifest.sprites.map((s) => [s.name, s]));

  src = src.replace(/'__ASSET_([a-z0-9-]+)__'/gi, (all, name) => {
    const sprite = byName.get(name);
    if (!sprite) throw new Error(`G7: config references unknown asset "${name}"`);
    return `'data:image/webp;base64,${b64(sprite.file)}'`;
  });

  const leftover = src.match(/__ASSET_[a-z0-9-]+__/gi);
  if (leftover) throw new Error(`G7: unresolved asset tokens ${leftover.join(', ')}`);

  // Networks that host the creative themselves serve it from a bare URL, so
  // `?lang=` never arrives and the runtime override cannot fire. The shipped
  // language has to be compiled in, one artefact per locale, which is also the
  // granularity Liftoff tags creatives at.
  if (locale) {
    const re = /(defaultLocale:\s*)'[a-z-]+'/i;
    if (!re.test(src)) throw new Error('G7: no defaultLocale to rewrite in config.js');
    src = src.replace(re, `$1'${locale}'`);
  }
  return src;
}

/** Runs the config for real rather than regexing it, so a broken locale key or
 *  a malformed edit fails the build instead of shipping. */
function evalConfig(src) {
  const w = {};
  new Function('window', src)(w);
  return w.PlayableConfig;
}

/**
 * Scans for anything the browser would fetch at runtime. Data URIs are fine;
 * an http(s) or protocol-relative URL in a loadable position is not, because a
 * playable is served into containers with no network guarantee at all.
 */
function assertNoExternalRefs(html) {
  const offenders = [];
  const loadable = [
    /<script[^>]+\bsrc\s*=\s*["']([^"']+)["']/gi,
    /<link[^>]+\bhref\s*=\s*["']([^"']+)["']/gi,
    /<img[^>]+\bsrc\s*=\s*["']([^"']+)["']/gi,
    /<(?:video|audio|source|iframe|embed)[^>]+\bsrc\s*=\s*["']([^"']+)["']/gi,
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
    /@import\s+["']([^"']+)["']/gi,
  ];

  for (const re of loadable) {
    let m;
    while ((m = re.exec(html))) {
      const url = m[1].trim();
      if (!url || url.startsWith('data:') || url.startsWith('#')) continue;
      offenders.push(url.slice(0, 120));
    }
  }

  // Catch fetch/XHR/font-loading targets that no markup regex would see.
  const dynamic = html.match(/(?:fetch|XMLHttpRequest|importScripts|EventSource)\s*\(/g);
  if (dynamic) offenders.push(...dynamic.map((d) => `dynamic:${d.trim()}`));

  if (offenders.length) {
    throw new Error(`G7: external references present:\n  ${offenders.join('\n  ')}`);
  }
}

function main() {
  if (!fs.existsSync('assets/manifest.json')) {
    throw new Error('assets/manifest.json missing — run tools/extract-assets.mjs first (S4).');
  }

  const requested = (process.env.LOCALE || '').trim().toLowerCase();
  const available = Object.keys(evalConfig(read('src/config.js')).localization.locales);
  if (requested && !available.includes(requested)) {
    throw new Error(`G7: unknown locale "${requested}" — have ${available.join(', ')}`);
  }
  const outFile = requested ? OUT_FILE.replace(/\.html$/, `-${requested}.html`) : OUT_FILE;

  const manifest = JSON.parse(read('assets/manifest.json'));
  const config = inlineConfig(manifest, requested);
  const scripts = SCRIPTS.map((p) => `/* ${path.basename(p)} */\n${read(p)}`).join('\n;\n');
  const style = read('src/style.css');
  const faces = fontFaces(manifest);
  const parsed = evalConfig(config);
  const appName = parsed.appDetails.appName;
  if (requested && parsed.localization.defaultLocale !== requested) {
    throw new Error(`G7: defaultLocale is "${parsed.localization.defaultLocale}", expected "${requested}"`);
  }

  const html = read('src/index.template.html')
    .replace('__APP_NAME__', appName)
    .replace('__FONT_FACES__', () => faces)
    .replace('__STYLE__', () => style)
    .replace('__CONFIG__', () => config)
    .replace('__SCRIPTS__', () => scripts);

  assertNoExternalRefs(html);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(outFile, html);
  const bytes = Buffer.byteLength(html);

  // Bootstrap payload = everything that must land before script execution can
  // paint: markup, CSS and the embedded faces.
  const bootstrapBytes = Buffer.byteLength(
    html.slice(0, html.indexOf('<script>')),
  );

  const report = {
    artifact: outFile,
    locale: parsed.localization.defaultLocale,
    bytes,
    budgetBytes: BUDGET_BYTES,
    hardCapBytes: HARD_CAP_BYTES,
    bootstrapBytes,
    bootstrapBudget: BOOTSTRAP_BUDGET,
    spriteBytes: manifest.totals.spriteBytes,
    fontBytes: manifest.totals.fontBytes,
    scriptBytes: Buffer.byteLength(scripts) + Buffer.byteLength(config),
    externalRefs: 0,
  };
  const reportName = requested ? `build-report-${requested}.json` : 'build-report.json';
  fs.writeFileSync(path.join(OUT_DIR, reportName), JSON.stringify(report, null, 2));

  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  console.log(`built ${outFile}  [locale ${report.locale}]`);
  console.log(`  total       ${kb(bytes)}  (budget ${kb(BUDGET_BYTES)}, cap ${kb(HARD_CAP_BYTES)})`);
  console.log(`  bootstrap   ${kb(bootstrapBytes)}  (budget ${kb(BOOTSTRAP_BUDGET)})`);
  console.log(`  js          ${kb(report.scriptBytes)}`);
  console.log(`  sprites     ${kb(report.spriteBytes)} raw`);
  console.log(`  fonts       ${kb(report.fontBytes)} raw`);

  if (bytes > BUDGET_BYTES) throw new Error(`G7: ${kb(bytes)} exceeds the ${kb(BUDGET_BYTES)} budget`);
  if (bootstrapBytes > BOOTSTRAP_BUDGET) {
    throw new Error(`G7: bootstrap ${kb(bootstrapBytes)} exceeds ${kb(BOOTSTRAP_BUDGET)}`);
  }
}

main();
