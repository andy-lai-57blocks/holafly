// Minimal dependency-free PNG decode/encode, enough for the S4 asset forge.
// Handles the truecolour / truecolour+alpha / palette 8-bit variants that the
// Play Store CDN actually serves.
import zlib from 'node:zlib';
import fs from 'node:fs';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function decodePng(file) {
  const buf = fs.readFileSync(file);
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error(`not a PNG: ${file}`);

  let pos = 8;
  let ihdr = null;
  let palette = null;
  let trns = null;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
  }

  if (!ihdr) throw new Error(`no IHDR: ${file}`);
  if (ihdr.interlace) throw new Error(`interlaced PNG unsupported: ${file}`);
  if (ihdr.depth !== 8) throw new Error(`bit depth ${ihdr.depth} unsupported: ${file}`);

  const ch = CHANNELS[ihdr.colorType];
  const { width, height } = ihdr;
  const stride = width * ch;
  const raw = zlib.inflateSync(Buffer.concat(idat));

  const flat = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    switch (filter) {
      case 0: break;
      case 1:
        for (let i = ch; i < stride; i++) line[i] = (line[i] + line[i - ch]) & 255;
        break;
      case 2:
        for (let i = 0; i < stride; i++) line[i] = (line[i] + prev[i]) & 255;
        break;
      case 3:
        for (let i = 0; i < stride; i++) {
          const a = i >= ch ? line[i - ch] : 0;
          line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255;
        }
        break;
      case 4:
        for (let i = 0; i < stride; i++) {
          const a = i >= ch ? line[i - ch] : 0;
          const b = prev[i];
          const c = i >= ch ? prev[i - ch] : 0;
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          line[i] = (line[i] + pr) & 255;
        }
        break;
      default: throw new Error(`bad filter ${filter}`);
    }
    line.copy(flat, y * stride);
    prev = line;
  }

  // Normalise everything to straight RGBA.
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const s = i * ch, d = i * 4;
    let r, g, b, a = 255;
    if (ihdr.colorType === 3) {
      const idx = flat[s];
      r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
      if (trns && idx < trns.length) a = trns[idx];
    } else if (ihdr.colorType === 0) {
      r = g = b = flat[s];
    } else if (ihdr.colorType === 4) {
      r = g = b = flat[s]; a = flat[s + 1];
    } else {
      r = flat[s]; g = flat[s + 1]; b = flat[s + 2];
      if (ihdr.colorType === 6) a = flat[s + 3];
    }
    rgba[d] = r; rgba[d + 1] = g; rgba[d + 2] = b; rgba[d + 3] = a;
  }

  return { width, height, data: rgba };
}

export function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const chunk = (type, payload) => {
    const out = Buffer.alloc(payload.length + 12);
    out.writeUInt32BE(payload.length, 0);
    out.write(type, 4, 'ascii');
    payload.copy(out, 8);
    out.writeInt32BE(crc32(out.subarray(4, 8 + payload.length)) | 0, 8 + payload.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

export function getPixel(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

export function crop(img, x0, y0, w, h) {
  x0 = Math.max(0, x0); y0 = Math.max(0, y0);
  w = Math.min(w, img.width - x0); h = Math.min(h, img.height - y0);
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * img.width + x0) * 4;
    img.data.copy(out, y * w * 4, src, src + w * 4);
  }
  return { width: w, height: h, data: out };
}

// Box-filter downscale. Sprites only ever shrink, so a box filter is both
// correct and cheaper than anything fancier.
export function resize(img, tw, th) {
  const out = Buffer.alloc(tw * th * 4);
  const sx = img.width / tw, sy = img.height / th;
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < img.height; yy++) {
        for (let xx = x0; xx < x1 && xx < img.width; xx++) {
          const i = (yy * img.width + xx) * 4;
          const al = img.data[i + 3] / 255;
          // Premultiply so transparent pixels stop bleeding their colour in.
          r += img.data[i] * al; g += img.data[i + 1] * al; b += img.data[i + 2] * al;
          a += img.data[i + 3]; n++;
        }
      }
      const d = (y * tw + x) * 4;
      const aa = a / n;
      const un = aa > 0 ? n * (aa / 255) : 1;
      out[d] = Math.round(r / un); out[d + 1] = Math.round(g / un);
      out[d + 2] = Math.round(b / un); out[d + 3] = Math.round(aa);
    }
  }
  return { width: tw, height: th, data: out };
}

export function trim(img, alphaThreshold = 8) {
  let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return img;
  return crop(img, minX, minY, maxX - minX + 1, maxY - minY + 1);
}
