// Builds the client-facing preview page. Everything the shell needs is inlined
// so the page works from a file:// double-click, a local server, or any static
// host — the only thing it loads is the creative itself, in the iframe.
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = 'dist/preview';
const PACKS = 'dist/packages';

const read = (p) => fs.readFileSync(p, 'utf8');

const BLURBS = {
  'stay-connected-run': {
    name: 'Stay Connected Run',
    desc: 'Side-scrolling runner. Tap to jump the roaming traps and keep the signal bar alive while the destination counter climbs.',
  },
  'run-from-bill-shock': {
    name: 'Run From Bill Shock',
    desc: 'Three-lane runner rendered in React. Swipe away the roaming charges stacking up on the bill before the meter runs out.',
  },
  'one-stroke': {
    name: 'One Stroke',
    desc: 'Map puzzle. Draw a single unbroken line through every city — one connection, never dropped, never repeated.',
  },
};

function main() {
  if (!fs.existsSync(path.join(PACKS, 'pack-report.json'))) {
    throw new Error('dist/packages/pack-report.json missing — run tools/pack.mjs first.');
  }
  const report = JSON.parse(read(path.join(PACKS, 'pack-report.json')));

  const versions = report.map((r) => {
    const blurb = BLURBS[r.slug];
    if (!blurb) throw new Error(`no preview copy for "${r.slug}"`);
    return {
      slug: r.slug,
      name: blurb.name,
      desc: blurb.desc,
      path: `../packages/${r.slug}/index.html`,
      files: r.sizes,
      total: r.total,
    };
  });

  // Reuse the wordmark already inside a package rather than adding another
  // copy of the brand art. One Stroke carries the red-on-transparent version,
  // which is the one that reads on a light page.
  const packed = read(path.join(PACKS, 'one-stroke', 'assets.js'));
  const assets = new Function(`${packed}; return ASSETS;`)();
  const wordmark = assets.images.find((i) => i.name === 'logo');
  if (!wordmark) throw new Error('one-stroke/assets.js has no "logo" image');

  const slots = {
    __STYLE__: () => read('preview/preview.css'),
    __LOGO__: () => wordmark.url,
    // Checked in rather than bundled on demand, so a clean checkout can build
    // the page without esbuild. Regenerate with:
    //   npx esbuild qrcode --bundle --global-name=QRCodeLib --minify \
    //     --outfile=preview/vendor/qrcode.browser.js
    __QRCODE__: () => read('preview/vendor/qrcode.browser.js'),
    __VERSIONS__: () => `window.PREVIEW_VERSIONS = ${JSON.stringify(versions)};`,
    __SCRIPT__: () => read('preview/preview.js'),
  };

  let html = read('preview/index.html');
  for (const [token, value] of Object.entries(slots)) {
    if (!html.includes(token)) throw new Error(`preview/index.html has no ${token} slot`);
    html = html.replace(token, value);
  }
  const unresolved = Object.keys(slots).filter((t) => html.includes(t));
  if (unresolved.length) throw new Error(`unfilled placeholders: ${unresolved.join(', ')}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, 'index.html');
  fs.writeFileSync(out, html);

  console.log(`built ${out}  (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
  for (const v of versions) {
    console.log(`  ${v.name.padEnd(22)} ${v.path}  ${(v.total / 1024).toFixed(1)} KB`);
  }
}

main();
