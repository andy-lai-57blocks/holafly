// S4 ASSET_FORGE — harvest brand rasters out of the Play Store creative,
// cut them out, clamp them to the texture budget, encode WebP, subset the
// official webfont, and emit a manifest for the bundler.
//
// Gate G4: no source image over 1024px, WebP only, manifest complete.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { decodePng, encodePng, crop, resize, trim } from './png.mjs';
import { cutout, keyCoral } from './cutout.mjs';
import { SPRITES } from './sprite-boxes.mjs';

const RAW = 'assets/raw';
const OUT = 'assets/sprites';
const MAX_TEXTURE = 1024; // RULE-PRF-004

// Glyphs the creative can render across every shipped locale, plus the digits
// and punctuation the HUD needs. Subsetting to this keeps the brand typeface
// inside the 200KB bootstrap budget (RULE-PRF-003).
const GLYPH_SOURCES = ['src/config.js'];
const ALWAYS_KEEP =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ' +
  '.,!?¡¿:;\'"“”‘’()[]-–—+×/%&@#*·…°';

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

function roundCorners(img, radiusRatio) {
  const { width: w, height: h } = img;
  const out = Buffer.from(img.data);
  const r = Math.round(Math.min(w, h) * radiusRatio);
  const cornerAlpha = (x, y) => {
    const cx = x < r ? r : x >= w - r ? w - r - 1 : x;
    const cy = y < r ? r : y >= h - r ? h - r - 1 : y;
    if (cx === x && cy === y) return 255;
    const d = Math.hypot(x - cx, y - cy);
    if (d <= r - 1) return 255;
    if (d >= r + 1) return 0;
    return Math.round((r + 1 - d) * 127.5);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[i + 3] = Math.min(out[i + 3], cornerAlpha(x, y));
    }
  }
  return { width: w, height: h, data: out };
}

function toWebp(img, file, quality) {
  const tmp = `${file}.tmp.png`;
  fs.writeFileSync(tmp, encodePng(img));
  execFileSync('cwebp', ['-quiet', '-q', String(quality), '-alpha_q', '100', '-m', '6', tmp, '-o', file]);
  fs.unlinkSync(tmp);
}

function subsetFonts(manifest) {
  const chars = new Set(ALWAYS_KEEP.split(''));
  for (const f of GLYPH_SOURCES) {
    if (!fs.existsSync(f)) continue;
    for (const ch of fs.readFileSync(f, 'utf8')) chars.add(ch);
  }
  const unicodes = [...chars]
    .filter((c) => c.codePointAt(0) > 31)
    .map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase())
    .join(',');

  const py = fs.existsSync('.venv/bin/pyftsubset') ? '.venv/bin/pyftsubset' : 'pyftsubset';
  for (const [weight, srcName] of [['bold', 'ModernEra-Bold'], ['medium', 'ModernEra-Medium']]) {
    const src = `assets/fonts/${srcName}.woff2`;
    const dst = `assets/fonts/${srcName}.subset.woff2`;
    execFileSync(py, [
      src,
      `--unicodes=${unicodes}`,
      '--flavor=woff2',
      '--layout-features=kern,liga',
      '--desubroutinize',
      `--output-file=${dst}`,
    ]);
    manifest.fonts.push({
      weight,
      file: dst,
      bytes: fs.statSync(dst).size,
      sourceBytes: fs.statSync(src).size,
      provenance: 'Official Modern Era webfont, self-hosted by Holafly at media.holafly.com.',
    });
  }
}

function main() {
  ensureDir(OUT);
  const manifest = { generatedAt: new Date().toISOString(), sprites: [], fonts: [], totals: {} };

  for (const s of SPRITES) {
    let img = decodePng(path.join(RAW, s.src));
    if (s.box) img = crop(img, ...s.box);

    if (s.mode === 'cutout') {
      img = trim(cutout(img, s.seed[0], s.seed[1], s.exclude));
    } else if (s.mode === 'key-coral') {
      img = trim(keyCoral(img));
    } else if (s.mode === 'round') {
      img = roundCorners(img, s.radius);
    }

    const tw = Math.min(s.targetWidth, MAX_TEXTURE);
    if (img.width > tw) {
      img = resize(img, tw, Math.max(1, Math.round((img.height * tw) / img.width)));
    }
    if (img.width > MAX_TEXTURE || img.height > MAX_TEXTURE) {
      throw new Error(`G4 violation: ${s.name} is ${img.width}x${img.height}`);
    }

    const file = path.join(OUT, `${s.name}.webp`);
    toWebp(img, file, s.quality);
    const bytes = fs.statSync(file).size;
    manifest.sprites.push({
      name: s.name, file, width: img.width, height: img.height, bytes,
      source: s.src, provenance: s.provenance, role: s.role,
    });
    console.log(`  ${s.name.padEnd(16)} ${String(img.width).padStart(4)}x${String(img.height).padEnd(4)} ${String(bytes).padStart(7)} B`);
  }

  subsetFonts(manifest);
  for (const f of manifest.fonts) {
    console.log(`  font:${f.weight.padEnd(11)} ${String(f.bytes).padStart(7)} B  (from ${f.sourceBytes} B)`);
  }

  manifest.totals.spriteBytes = manifest.sprites.reduce((a, s) => a + s.bytes, 0);
  manifest.totals.fontBytes = manifest.fonts.reduce((a, f) => a + f.bytes, 0);
  manifest.totals.allBytes = manifest.totals.spriteBytes + manifest.totals.fontBytes;
  fs.writeFileSync('assets/manifest.json', JSON.stringify(manifest, null, 2));

  console.log(`\nsprites ${manifest.totals.spriteBytes} B + fonts ${manifest.totals.fontBytes} B = ${manifest.totals.allBytes} B`);
  console.log(`base64 inflated ≈ ${Math.round((manifest.totals.allBytes * 4) / 3)} B`);
}

main();
