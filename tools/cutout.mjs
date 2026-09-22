// Sticker cutout for the S4 asset forge.
//
// The store creative composites white-outlined sticker illustrations on top of
// a coral gradient *and* on top of the device mockup, so a single chroma key is
// not enough. Three passes:
//
//   A. flood the coral gradient from the crop border (stops at any non-coral)
//   B. peel inward: repeatedly drop boundary pixels that are not part of the
//      sticker's white outline, which eats the black bezel and gold frame
//   C. keep only the connected component containing the seed point
//
// Pass B is what makes this work: every sticker is fully ringed by a thick
// white outline, so an erosion that refuses to cross white-ish pixels cannot
// get inside the sticker.

const isCoral = (r, g, b) => r > 175 && r - g > 40 && r - b > 30 && g < 195;

// Deliberately strict. The sticker halo is pure paper white, whereas the
// device mockup's screen is a pale tinted wash (#F9E8EC, #F1F0F8). A loose
// threshold lets the screen masquerade as sticker and the two regions weld
// together; this one keeps them separable.
const isWhiteish = (r, g, b) =>
  r >= 242 && g >= 242 && b >= 242 && Math.max(r, g, b) - Math.min(r, g, b) <= 12;

export function cutout(img, seedX, seedY, exclude = []) {
  const { width: w, height: h } = img;
  const n = w * h;
  const opaque = new Uint8Array(n).fill(1);

  // Matte hints: rectangles that are device mockup, not sticker. Painted to
  // the coral key so pass A carries them away along with the real background.
  const data = Buffer.from(img.data);
  for (const [ex, ey, ew, eh] of exclude) {
    for (let y = ey; y < ey + eh && y < h; y++) {
      for (let x = ex; x < ex + ew && x < w; x++) {
        if (x < 0 || y < 0) continue;
        const i = (y * w + x) * 4;
        data[i] = 240; data[i + 1] = 134; data[i + 2] = 137; data[i + 3] = 255;
      }
    }
  }

  const at = (i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];

  // --- Pass A: flood the coral field in from the border.
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x); stack.push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w); stack.push(y * w + w - 1); }
  const seen = new Uint8Array(n);
  while (stack.length) {
    const i = stack.pop();
    if (seen[i]) continue;
    seen[i] = 1;
    const [r, g, b] = at(i);
    if (!isCoral(r, g, b)) continue;
    opaque[i] = 0;
    const x = i % w, y = (i - x) / w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }

  // --- Pass B: erode everything that is not the sticker's white outline.
  for (let pass = 0; pass < Math.max(w, h); pass++) {
    const doomed = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!opaque[i]) continue;
        const [r, g, b] = at(i);
        if (isWhiteish(r, g, b)) continue;
        const border =
          x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
          !opaque[i - 1] || !opaque[i + 1] || !opaque[i - w] || !opaque[i + w];
        if (border) doomed.push(i);
      }
    }
    if (!doomed.length) break;
    for (const i of doomed) opaque[i] = 0;
  }

  // --- Pass C: keep the component the seed sits in.
  const seedIdx = seedY * w + seedX;
  if (!opaque[seedIdx]) {
    throw new Error(`cutout seed (${seedX},${seedY}) landed on removed background`);
  }
  const keep = new Uint8Array(n);
  const q = [seedIdx];
  keep[seedIdx] = 1;
  while (q.length) {
    const i = q.pop();
    const x = i % w, y = (i - x) / w;
    const push = (j) => { if (opaque[j] && !keep[j]) { keep[j] = 1; q.push(j); } };
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }

  const out = Buffer.from(img.data);
  for (let i = 0; i < n; i++) if (!keep[i]) out[i * 4 + 3] = 0;
  return { width: w, height: h, data: out };
}

// Flat chroma key for assets that sit on nothing but the coral field, e.g. the
// wordmark. Feathers the alpha across the antialiased glyph edge instead of
// hard-thresholding, so the mark keeps its curves when it scales down.
export function keyCoral(img) {
  const { width: w, height: h, data } = img;
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    // The mark is white, the field is coral. Distance from white along the
    // channel spread gives a clean matte for the antialiased rim.
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    let a = 255 - Math.min(255, Math.round(spread * (255 / 90)));
    if (isCoral(r, g, b) && spread > 70) a = 0;
    out[i * 4] = 255; out[i * 4 + 1] = 255; out[i * 4 + 2] = 255;
    out[i * 4 + 3] = a;
  }
  return { width: w, height: h, data: out };
}
