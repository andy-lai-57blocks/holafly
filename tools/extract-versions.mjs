// Unwraps the two playables that arrive as finished single files (creatives/)
// into plain sources, so the packer downstream can treat all three versions
// the same way. The third, Stay Connected Run, is built here and needs no
// unwrapping — its sources are already in src/.
//
// "Run From Bill Shock" arrives inside a bundler envelope: a uuid-keyed
// manifest of (optionally gzipped) base64 blobs plus the real page as a
// JSON-encoded string. "One Stroke" is a straightforward single file whose
// style, markup and two scripts only need separating.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT = 'build/extracted';

const ensure = (d) => fs.mkdirSync(d, { recursive: true });
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

const EXT_FOR_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'font/woff2': 'woff2',
  'text/javascript': 'js',
  'application/javascript': 'js',
};

function billShock() {
  const src = 'creatives/run-from-bill-shock.html';
  const dir = path.join(OUT, 'run-from-bill-shock');
  const assetDir = path.join(dir, 'assets');
  ensure(assetDir);

  const html = fs.readFileSync(src, 'utf8');
  const section = (type) => {
    const m = html.match(new RegExp(`<script type="__bundler/${type}">\\s*([\\s\\S]*?)\\s*</script>`));
    if (!m) throw new Error(`${src}: missing __bundler/${type}`);
    return m[1];
  };

  const manifest = JSON.parse(section('manifest'));
  const external = JSON.parse(section('ext_resources'));
  const template = JSON.parse(section('template'));

  // The bundler keys blobs by uuid and keeps the human name (an asset id or a
  // CDN url) in a side table. Recover the name so the packed asset list reads
  // like something a person wrote.
  const nameFor = new Map(external.map((e) => [e.uuid, e.id]));

  const assets = [];
  for (const [uuid, entry] of Object.entries(manifest)) {
    let bytes = Buffer.from(entry.data, 'base64');
    if (entry.compressed) {
      // The envelope does not record which codec it used.
      const tries = [zlib.gunzipSync, zlib.inflateSync, zlib.inflateRawSync];
      let ok = false;
      for (const fn of tries) {
        try { bytes = fn(bytes); ok = true; break; } catch (err) { /* next */ }
      }
      if (!ok) throw new Error(`${uuid}: cannot decompress`);
    }

    const rawName = nameFor.get(uuid) || uuid;
    // CDN urls make terrible filenames; keep the package and version.
    const label = /^https?:/.test(rawName)
      ? (rawName.match(/\/([a-z-]+)@([\d.]+)\//i) || [, 'vendor', '0'])
        .slice(1, 3).join('-') + (/react-dom/.test(rawName) ? '-dom' : '')
      : rawName;
    const ext = EXT_FOR_MIME[entry.mime] || 'bin';
    const file = `${label.replace(/[^a-z0-9.-]+/gi, '-')}.${ext}`;
    fs.writeFileSync(path.join(assetDir, file), bytes);
    assets.push({ uuid, name: rawName, label, mime: entry.mime, file, bytes: bytes.length });
  }

  // React and ReactDOM have to execute before the component runtime, and the
  // runtime before the component source. Record the order the template used
  // rather than guessing it later.
  const scriptOrder = [];
  for (const m of template.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) scriptOrder.push(m[1]);

  const styles = [...template.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  const xdc = template.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/);
  const xdcAttrs = template.match(/<script type="text\/x-dc"([^>]*)>/);
  const bodyMatch = template.match(/<body[^>]*>([\s\S]*)<\/body>/);

  let body = bodyMatch ? bodyMatch[1] : '';
  // Pull the component source and the stylesheets out of the markup; they are
  // packaged as app.js and index.css.
  body = body.replace(/<script type="text\/x-dc"[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .trim();

  fs.writeFileSync(path.join(dir, 'template.html'), template);
  fs.writeFileSync(path.join(dir, 'body.html'), body);
  fs.writeFileSync(path.join(dir, 'styles.css'), styles.join('\n'));
  if (xdc) fs.writeFileSync(path.join(dir, 'component.xdc.js'), xdc[1]);
  fs.writeFileSync(path.join(dir, 'extract.json'), JSON.stringify({
    source: src, assets, scriptOrder, styleBlocks: styles.length,
    xdcAttrs: xdcAttrs ? xdcAttrs[1].trim() : null,
    xdcBytes: xdc ? xdc[1].length : 0,
    bodyBytes: body.length,
  }, null, 2));

  console.log(`run-from-bill-shock -> ${dir}`);
  console.log(`  ${assets.length} assets, css ${kb(styles.join('').length)}, component ${kb(xdc ? xdc[1].length : 0)}, body ${kb(body.length)}`);
  for (const a of assets.filter((x) => x.mime.startsWith('image/'))) {
    console.log(`    ${a.file.padEnd(46)} ${a.mime.padEnd(16)} ${kb(a.bytes)}`);
  }
}

function oneStroke() {
  const src = 'creatives/one-stroke.html';
  const dir = path.join(OUT, 'one-stroke');
  const assetDir = path.join(dir, 'assets');
  ensure(assetDir);

  const html = fs.readFileSync(src, 'utf8');
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (scripts.length !== 2) throw new Error(`${src}: expected 2 inline scripts, found ${scripts.length}`);

  let body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
  body = body.replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g, '').trim();

  // Every raster/vector in this one is already a data URI, some in the markup
  // and some inside the config. Lift them into files so the packer can decide
  // how to encode each and the markup stops carrying payload.
  const assets = [];
  const seen = new Map();
  const nameHint = (context) => {
    const m = context.match(/class="(?:cloud )?([a-z0-9]+)"|id="([a-z0-9]+)"|appLogo/i);
    if (/appLogo/.test(context)) return 'logo';
    return (m && (m[1] || m[2])) || 'img';
  };

  const harvest = (text, origin) => text.replace(
    /data:image\/(svg\+xml|png|jpeg|webp);base64,([A-Za-z0-9+/=]+)/g,
    (all, kind, b64) => {
      if (seen.has(b64)) return `__ASSET_${seen.get(b64)}__`;
      const before = text.slice(Math.max(0, text.indexOf(all) - 120), text.indexOf(all));
      let base = nameHint(before) || 'img';
      let name = base;
      let n = 2;
      while ([...seen.values()].includes(name)) name = `${base}-${n++}`;
      seen.set(b64, name);
      const ext = kind === 'svg+xml' ? 'svg' : kind;
      const bytes = Buffer.from(b64, 'base64');
      fs.writeFileSync(path.join(assetDir, `${name}.${ext}`), bytes);
      assets.push({ name, mime: `image/${kind}`, file: `${name}.${ext}`, bytes: bytes.length, origin });
      return `__ASSET_${name}__`;
    },
  );

  body = harvest(body, 'markup');
  const config = harvest(scripts[0], 'config');

  fs.writeFileSync(path.join(dir, 'body.html'), body);
  fs.writeFileSync(path.join(dir, 'styles.css'), styles.join('\n'));
  fs.writeFileSync(path.join(dir, 'config.src.js'), config);
  fs.writeFileSync(path.join(dir, 'app.src.js'), scripts[1]);
  fs.writeFileSync(path.join(dir, 'extract.json'), JSON.stringify({
    source: src, assets, styleBytes: styles.join('').length,
    configBytes: config.length, appBytes: scripts[1].length, bodyBytes: body.length,
    usesMraidScriptTag: /<script src="mraid\.js">/.test(html),
  }, null, 2));

  console.log(`one-stroke -> ${dir}`);
  console.log(`  ${assets.length} assets, css ${kb(styles.join('').length)}, config ${kb(config.length)}, app ${kb(scripts[1].length)}, body ${kb(body.length)}`);
  for (const a of assets) console.log(`    ${a.file.padEnd(46)} ${a.mime.padEnd(16)} ${kb(a.bytes)}`);
}

ensure(OUT);
billShock();
console.log();
oneStroke();
