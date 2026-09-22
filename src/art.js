/**
 * S4/S5 — procedural art atlas.
 *
 * Everything that moves is drawn here, once, into offscreen canvases at layout
 * time, and then blitted by the render loop. Two reasons: the store creative's
 * sticker idiom (flat fills, thick white halo, thin dark keyline) reproduces
 * exactly in canvas at any device pixel ratio, and a steady-state frame that
 * only does drawImage plus a couple of gradient fills comfortably clears the
 * 50 FPS floor on mid-tier hardware (RULE-PRF-009).
 *
 * No colour is chosen here. Every fill comes from PlayableConfig.style, which
 * came from brand/brand-tokens.json, which came from Holafly's own artwork.
 */
(function (window) {
  'use strict';

  var TAU = Math.PI * 2;
  var DEG = Math.PI / 180;

  function makeCanvas(w, h, dpr) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * dpr));
    c.height = Math.max(1, Math.ceil(h * dpr));
    c.cssWidth = w;
    c.cssHeight = h;
    var g = c.getContext('2d');
    g.scale(dpr, dpr);
    return { canvas: c, ctx: g, w: w, h: h };
  }

  /**
   * Dilates the artwork into a solid halo and stamps the artwork back on top.
   * This is what makes procedural shapes read as the same cut-out stickers the
   * store creative uses, and it works on arbitrary composite art rather than
   * requiring every piece to be a single strokeable path.
   */
  function haloize(src, radius, color, dpr, shadow) {
    var pad = Math.ceil(radius) + 3;
    var out = makeCanvas(src.w + pad * 2, src.h + pad * 2, dpr);
    var g = out.ctx;
    var steps = 20;

    for (var i = 0; i < steps; i++) {
      var a = (i / steps) * TAU;
      g.drawImage(src.canvas, pad + Math.cos(a) * radius, pad + Math.sin(a) * radius, src.w, src.h);
    }
    g.drawImage(src.canvas, pad, pad, src.w, src.h);

    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, out.w, out.h);
    g.globalCompositeOperation = 'source-over';

    if (shadow) {
      g.save();
      g.shadowColor = 'rgba(103, 16, 39, 0.30)';
      g.shadowBlur = radius * 2.1;
      g.shadowOffsetY = radius * 0.85;
      g.drawImage(out.canvas, 0, 0, out.w, out.h);
      g.restore();
    }

    g.drawImage(src.canvas, pad, pad, src.w, src.h);
    out.pad = pad;
    return out;
  }

  function roundRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /** Five-pointed star, filled with the current fillStyle. `rot` in radians. */
  function star(g, cx, cy, r, rot) {
    g.beginPath();
    for (var i = 0; i < 10; i++) {
      var rad = i % 2 ? r * 0.382 : r; // 0.382 keeps the classic pentagram waist
      var a = rot - Math.PI / 2 + (i * Math.PI) / 5;
      var px = cx + Math.cos(a) * rad;
      var py = cy + Math.sin(a) * rad;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.closePath();
    g.fill();
  }

  // Two-segment limb as stacked round-cap strokes: a wider ink pass makes the
  // keyline, the colour pass sits inside it.
  function limb(g, ox, oy, a1, l1, a2, l2, width, color, ink) {
    var kx = ox + Math.cos(a1) * l1;
    var ky = oy + Math.sin(a1) * l1;
    var ex = kx + Math.cos(a2) * l2;
    var ey = ky + Math.sin(a2) * l2;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = ink;
    g.lineWidth = width + 3;
    g.beginPath(); g.moveTo(ox, oy); g.lineTo(kx, ky); g.lineTo(ex, ey); g.stroke();
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath(); g.moveTo(ox, oy); g.lineTo(kx, ky); g.lineTo(ex, ey); g.stroke();
    return { x: ex, y: ey, ka: a2 };
  }

  function shoe(g, x, y, angle, s, ink) {
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    g.fillStyle = '#FFFFFF';
    g.strokeStyle = ink;
    g.lineWidth = 2.4;
    roundRect(g, -s * 0.30, -s * 0.22, s * 0.95, s * 0.44, s * 0.2);
    g.fill(); g.stroke();
    g.restore();
  }

  /**
   * The traveler. Drawn in the illustration palette lifted from the store
   * creative's sticker people: teal garment, dark hair, warm skin, denim legs.
   * `phase` drives a continuous run cycle so the frames are sampled from one
   * function rather than hand-posed.
   */
  function drawTraveler(g, S, style, phase, mode) {
    var ink = style.illustrationHair;
    var skin = style.illustrationSkin;
    var teal = style.illustrationTeal;
    var denim = style.denim;

    var t = phase * TAU;
    var bob = mode === 'run' ? Math.abs(Math.sin(t)) * S * 0.035 : 0;
    var lean = mode === 'jump' ? 14 * DEG : mode === 'hurt' ? -12 * DEG : 9 * DEG;

    // Hip/knee angles. Measured from straight-down so 90deg is vertical.
    var down = 90 * DEG;
    var fHip, fKnee, bHip, bKnee, fArm, fFore, bArm, bFore;

    if (mode === 'run') {
      fHip = down - Math.sin(t) * 48 * DEG;
      fKnee = fHip + (0.45 + 0.5 * Math.max(0, Math.sin(t + 1.2))) * 62 * DEG;
      bHip = down - Math.sin(t + Math.PI) * 48 * DEG;
      bKnee = bHip + (0.45 + 0.5 * Math.max(0, Math.sin(t + Math.PI + 1.2))) * 62 * DEG;
      fArm = down + Math.sin(t + Math.PI) * 52 * DEG;
      fFore = fArm - 62 * DEG;
      bArm = down + Math.sin(t) * 52 * DEG;
      bFore = bArm - 62 * DEG;
    } else if (mode === 'jump') {
      fHip = down - 62 * DEG; fKnee = fHip + 96 * DEG;
      bHip = down - 22 * DEG; bKnee = bHip + 70 * DEG;
      fArm = down - 78 * DEG; fFore = fArm - 34 * DEG;
      bArm = down + 46 * DEG; bFore = bArm - 30 * DEG;
    } else {
      fHip = down - 16 * DEG; fKnee = fHip + 26 * DEG;
      bHip = down + 20 * DEG; bKnee = bHip + 22 * DEG;
      fArm = down - 108 * DEG; fFore = fArm - 26 * DEG;
      bArm = down + 104 * DEG; bFore = bArm + 26 * DEG;
    }

    g.save();
    // Origin at the feet, centred horizontally.
    g.translate(S * 0.5, S * 1.22 - bob);
    g.rotate(lean);

    var hipY = -S * 0.52;
    var shoulderY = -S * 0.92;
    var legLen = S * 0.27;

    // Back leg and arm first so the near side overlaps them.
    var bFoot = limb(g, 0, hipY, bHip, legLen, bKnee, legLen, S * 0.115, denim, ink);
    shoe(g, bFoot.x, bFoot.y, bKnee - down, S * 0.2, ink);
    var bHand = limb(g, 0, shoulderY, bArm, S * 0.2, bFore, S * 0.19, S * 0.085, skin, ink);

    // Backpack, behind the torso.
    g.save();
    g.rotate(-4 * DEG);
    g.fillStyle = style.primaryColor;
    g.strokeStyle = ink;
    g.lineWidth = 2.6;
    roundRect(g, -S * 0.30, shoulderY + S * 0.03, S * 0.26, S * 0.34, S * 0.09);
    g.fill(); g.stroke();
    g.restore();

    // Torso.
    g.fillStyle = teal;
    g.strokeStyle = ink;
    g.lineWidth = 2.8;
    g.beginPath();
    g.moveTo(-S * 0.16, shoulderY + S * 0.02);
    g.quadraticCurveTo(0, shoulderY - S * 0.06, S * 0.17, shoulderY + S * 0.03);
    g.quadraticCurveTo(S * 0.21, hipY - S * 0.06, S * 0.14, hipY + S * 0.01);
    g.quadraticCurveTo(0, hipY + S * 0.06, -S * 0.14, hipY + S * 0.01);
    g.quadraticCurveTo(-S * 0.20, hipY - S * 0.08, -S * 0.16, shoulderY + S * 0.02);
    g.closePath();
    g.fill(); g.stroke();

    // Strap across the chest.
    g.strokeStyle = style.maroon;
    g.lineWidth = S * 0.035;
    g.beginPath();
    g.moveTo(-S * 0.13, shoulderY + S * 0.06);
    g.quadraticCurveTo(S * 0.02, shoulderY + S * 0.15, S * 0.08, hipY - S * 0.02);
    g.stroke();

    // Head.
    var headR = S * 0.155;
    var headY = shoulderY - headR * 0.92;
    g.fillStyle = skin;
    g.strokeStyle = ink;
    g.lineWidth = 2.8;
    g.beginPath(); g.arc(0, headY, headR, 0, TAU); g.fill(); g.stroke();

    // Hair: a cap plus a bun, matching the creative's illustrated travelers.
    g.fillStyle = ink;
    g.beginPath();
    g.arc(0, headY, headR * 1.03, Math.PI * 1.04, Math.PI * 2.1);
    g.lineTo(-headR * 0.95, headY + headR * 0.28);
    g.closePath();
    g.fill();
    g.beginPath(); g.arc(-headR * 0.92, headY - headR * 0.32, headR * 0.44, 0, TAU); g.fill();

    // Face: eye and smile, kept to two marks so it stays legible when small.
    g.fillStyle = ink;
    g.beginPath(); g.arc(headR * 0.38, headY + headR * 0.04, headR * 0.115, 0, TAU); g.fill();
    g.strokeStyle = ink;
    g.lineWidth = 1.9;
    g.beginPath();
    g.arc(headR * 0.26, headY + headR * 0.3, headR * 0.3, 0.15 * Math.PI, 0.72 * Math.PI);
    g.stroke();

    // Front leg and arm.
    var fFoot = limb(g, 0, hipY, fHip, legLen, fKnee, legLen, S * 0.12, denim, ink);
    shoe(g, fFoot.x, fFoot.y, fKnee - down, S * 0.21, ink);
    var fHand = limb(g, 0, shoulderY + S * 0.01, fArm, S * 0.2, fFore, S * 0.19, S * 0.09, skin, ink);

    // The phone in the leading hand: the product, carried. A crimson tile with
    // the wave-crossbar H — the logomark, not a simulated OS screen.
    g.save();
    g.translate(fHand.x, fHand.y);
    g.rotate(mode === 'jump' ? -20 * DEG : -8 * DEG);
    var pw = S * 0.13, ph = S * 0.21;
    var grad = g.createLinearGradient(-pw / 2, -ph / 2, pw / 2, ph / 2);
    grad.addColorStop(0, '#E02B58');
    grad.addColorStop(1, '#C90A4F');
    g.fillStyle = grad;
    g.strokeStyle = ink;
    g.lineWidth = 2.2;
    roundRect(g, -pw / 2, -ph / 2, pw, ph, pw * 0.26);
    g.fill(); g.stroke();
    drawWaveH(g, 0, 0, pw * 0.62, ph * 0.46, '#FFFFFF');
    g.restore();

    g.restore();
  }

  /** The Holafly H: two stems joined by a wave crossbar that overshoots left. */
  function drawWaveH(g, cx, cy, w, h, color) {
    var stem = w * 0.2;
    g.save();
    g.translate(cx, cy);
    g.fillStyle = color;
    g.fillRect(-w / 2, -h / 2, stem, h);
    g.fillRect(w / 2 - stem, -h / 2, stem, h);
    g.strokeStyle = color;
    g.lineWidth = stem;
    g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(-w * 0.74, -h * 0.02);
    g.quadraticCurveTo(-w * 0.28, h * 0.22, 0, -h * 0.04);
    g.quadraticCurveTo(w * 0.3, -h * 0.28, w * 0.5, -h * 0.02);
    g.stroke();
    g.restore();
  }

  /**
   * Finish flag, planted at the last destination.
   *
   * The pennant carries the logomark rather than a chequered racing flag: the
   * beat being paid off is "you stayed connected the whole way", not "you won
   * a race". Drawn tall and narrow so it clears the runner's head and reads as
   * a goal on the horizon while it is still approaching.
   */
  function drawVictoryFlag(g, w, h, style) {
    var ink = style.illustrationHair;
    var poleX = w * 0.30;
    var poleW = w * 0.072;
    var baseY = h * 0.93;

    // No glow here: the sprite gets dilated into a sticker halo, and a soft
    // gradient dilates into a hard-edged block. Game.prototype._glow lays the
    // yellow burst down behind this at render time instead.
    g.save();

    // Mound, so the flag is planted in the ground rather than floating in it.
    g.fillStyle = style.accentGreen;
    g.strokeStyle = ink;
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(w * 0.06, baseY + h * 0.06);
    g.quadraticCurveTo(w * 0.32, baseY - h * 0.055, w * 0.62, baseY + h * 0.06);
    g.closePath();
    g.fill(); g.stroke();

    // Pole.
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    roundRect(g, poleX, h * 0.04, poleW, baseY - h * 0.02, poleW * 0.45);
    g.fill(); g.stroke();
    g.beginPath(); g.arc(poleX + poleW * 0.5, h * 0.045, poleW * 0.72, 0, TAU);
    g.fillStyle = style.accentYellow;
    g.fill(); g.stroke();

    // Pennant, with a wave along its free edge so it reads as cloth.
    var fx = poleX + poleW * 0.6;
    var fTop = h * 0.10;
    var fH = h * 0.30;
    var fW = w * 0.60;
    var grad = g.createLinearGradient(fx, fTop, fx + fW, fTop + fH);
    grad.addColorStop(0, '#E02B58');
    grad.addColorStop(1, '#C90A4F');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(fx, fTop);
    g.lineTo(fx + fW, fTop + fH * 0.10);
    g.quadraticCurveTo(fx + fW * 0.80, fTop + fH * 0.50, fx + fW, fTop + fH * 0.92);
    g.lineTo(fx, fTop + fH);
    g.closePath();
    g.fill(); g.stroke();
    drawWaveH(g, fx + fW * 0.42, fTop + fH * 0.50, fW * 0.46, fH * 0.44, '#FFFFFF');

    g.restore();
  }

  /** Roaming-charge hazard: a crimson note sticker with a rising-cost arrow. */
  function drawRoamingHazard(g, S, style, glyphs) {
    var ink = style.illustrationHair;
    g.save();
    g.translate(S * 0.5, S * 0.62);
    g.rotate(-7 * DEG);

    var w = S * 0.82, h = S * 0.5;
    // Stacked notes for depth.
    g.save();
    g.rotate(9 * DEG);
    g.fillStyle = '#FFFFFF';
    g.strokeStyle = ink;
    g.lineWidth = 2.4;
    roundRect(g, -w / 2, -h / 2, w, h, S * 0.045);
    g.fill(); g.stroke();
    g.restore();

    g.fillStyle = style.primaryColor;
    g.strokeStyle = ink;
    g.lineWidth = 2.6;
    roundRect(g, -w / 2, -h / 2, w, h, S * 0.045);
    g.fill(); g.stroke();

    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 2;
    roundRect(g, -w / 2 + S * 0.05, -h / 2 + S * 0.05, w - S * 0.1, h - S * 0.1, S * 0.03);
    g.stroke();

    g.fillStyle = '#FFFFFF';
    g.beginPath(); g.arc(0, 0, h * 0.3, 0, TAU); g.fill();
    g.fillStyle = style.primaryColor;
    g.font = '700 ' + (h * 0.42).toFixed(1) + 'px ' + style.fontFamily;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(glyphs.currency, 0, h * 0.02);

    // Cost-going-up arrow, echoing the red arrows on the store creative's
    // money sticker.
    g.restore();
    g.save();
    g.translate(S * 0.78, S * 0.26);
    g.rotate(-32 * DEG);
    g.fillStyle = style.primaryColor;
    g.strokeStyle = ink;
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(0, -S * 0.17);
    g.lineTo(S * 0.11, 0);
    g.lineTo(S * 0.042, 0);
    g.lineTo(S * 0.042, S * 0.16);
    g.lineTo(-S * 0.042, S * 0.16);
    g.lineTo(-S * 0.042, 0);
    g.lineTo(-S * 0.11, 0);
    g.closePath();
    g.fill(); g.stroke();
    g.restore();
  }

  /**
   * Public Wi-Fi trap: the thing an eSIM saves you from leaning on. Drawn as a
   * signal fan with a warning bang, in the same sticker language as the rest.
   */
  function drawPublicWifiHazard(g, S, style) {
    var ink = style.illustrationHair;
    g.save();
    g.translate(S * 0.5, S * 0.68);

    // Router body.
    g.fillStyle = '#FFFFFF';
    g.strokeStyle = ink;
    g.lineWidth = 2.6;
    roundRect(g, -S * 0.3, -S * 0.02, S * 0.6, S * 0.24, S * 0.06);
    g.fill(); g.stroke();
    g.fillStyle = style.accentYellow;
    g.beginPath(); g.arc(-S * 0.18, S * 0.1, S * 0.035, 0, TAU); g.fill();

    // Two broadcast arcs, deliberately stopping short of a third: the signal
    // is weak, which is the whole point.
    g.strokeStyle = style.primaryColor;
    g.lineCap = 'round';
    [0.16, 0.28].forEach(function (r, i) {
      g.lineWidth = S * (0.055 - i * 0.008);
      g.beginPath();
      g.arc(0, -S * 0.02, S * r, -0.78 * Math.PI, -0.22 * Math.PI);
      g.stroke();
    });

    // Warning bang where the third arc would have been.
    g.fillStyle = style.primaryColor;
    g.strokeStyle = ink;
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(-S * 0.055, -S * 0.5);
    g.lineTo(S * 0.055, -S * 0.5);
    g.lineTo(S * 0.03, -S * 0.26);
    g.lineTo(-S * 0.03, -S * 0.26);
    g.closePath();
    g.fill(); g.stroke();
    g.beginPath(); g.arc(0, -S * 0.19, S * 0.042, 0, TAU);
    g.fill(); g.stroke();

    g.restore();
  }

  /**
   * Dead zone: a slab of no-coverage the runner has to hop over. Cool grey-blue
   * so it reads as "absence of signal" against the warm brand backdrop, and
   * wide rather than tall so the affordance is obviously "jump".
   */
  function drawDeadZone(g, w, h, style) {
    var ink = style.illustrationHair;
    g.save();

    // Body: a low storm-cloud shape rather than a rectangle, so it never looks
    // like a platform the runner could stand on.
    g.fillStyle = 'rgba(120,132,148,0.90)';
    g.strokeStyle = ink;
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(w * 0.06, h);
    g.quadraticCurveTo(0, h * 0.62, w * 0.14, h * 0.44);
    g.quadraticCurveTo(w * 0.22, h * 0.06, w * 0.44, h * 0.16);
    g.quadraticCurveTo(w * 0.62, -h * 0.04, w * 0.76, h * 0.26);
    g.quadraticCurveTo(w * 0.99, h * 0.3, w * 0.94, h);
    g.closePath();
    g.fill(); g.stroke();

    // Struck-through signal bars.
    var bx = w * 0.34, by = h * 0.74, bw = w * 0.042, gap = w * 0.058;
    g.fillStyle = 'rgba(255,255,255,0.88)';
    for (var i = 0; i < 4; i++) {
      var bh = h * (0.14 + i * 0.1);
      roundRect(g, bx + i * gap, by - bh, bw, bh, bw * 0.4);
      g.fill();
    }
    g.strokeStyle = style.primaryColor;
    g.lineWidth = Math.max(3, h * 0.055);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(bx - w * 0.03, by + h * 0.06);
    g.lineTo(bx + gap * 3 + bw + w * 0.03, by - h * 0.5);
    g.stroke();

    g.restore();
  }

  /**
   * Data cap: a crossed-out infinity, the exact inverse of the unlimited-data
   * pickup. Reads as "this plan has a ceiling" without a word of copy.
   */
  function drawThrottleHazard(g, S, style) {
    var ink = style.illustrationHair;
    g.save();
    g.translate(S * 0.5, S * 0.55);

    g.fillStyle = '#FFFFFF';
    g.strokeStyle = ink;
    g.lineWidth = 2.8;
    g.beginPath(); g.arc(0, 0, S * 0.32, 0, TAU);
    g.fill(); g.stroke();

    // Infinity lemniscate, as two rings.
    g.strokeStyle = 'rgba(120,132,148,0.95)';
    g.lineWidth = S * 0.05;
    var lr = S * 0.105;
    g.beginPath(); g.arc(-lr, 0, lr, 0, TAU); g.stroke();
    g.beginPath(); g.arc(lr, 0, lr, 0, TAU); g.stroke();

    // Prohibition slash.
    g.strokeStyle = style.primaryColor;
    g.lineWidth = S * 0.07;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-S * 0.21, S * 0.21);
    g.lineTo(S * 0.21, -S * 0.21);
    g.stroke();

    // Downward throttle arrow hanging off the sign.
    g.restore();
    g.save();
    g.translate(S * 0.78, S * 0.72);
    g.fillStyle = style.primaryColor;
    g.strokeStyle = ink;
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(0, S * 0.17);
    g.lineTo(S * 0.11, 0);
    g.lineTo(S * 0.042, 0);
    g.lineTo(S * 0.042, -S * 0.16);
    g.lineTo(-S * 0.042, -S * 0.16);
    g.lineTo(-S * 0.042, 0);
    g.lineTo(-S * 0.11, 0);
    g.closePath();
    g.fill(); g.stroke();
    g.restore();
  }

  /** Speed boost: the rocket sticker from the Backup Plan screenshot. */
  function drawRocket(g, S, style) {
    var ink = style.illustrationHair;
    g.save();
    g.translate(S * 0.5, S * 0.55);

    // Flame.
    g.fillStyle = '#BFEBFF';
    g.beginPath();
    g.moveTo(-S * 0.1, S * 0.3);
    g.quadraticCurveTo(0, S * 0.62, S * 0.1, S * 0.3);
    g.closePath();
    g.fill();

    // Fins.
    g.fillStyle = '#FFFFFF';
    g.strokeStyle = ink;
    g.lineWidth = 2.6;
    [-1, 1].forEach(function (s) {
      g.beginPath();
      g.moveTo(s * S * 0.13, S * 0.03);
      g.quadraticCurveTo(s * S * 0.36, S * 0.16, s * S * 0.27, S * 0.34);
      g.quadraticCurveTo(s * S * 0.2, S * 0.26, s * S * 0.13, S * 0.26);
      g.closePath();
      g.fill(); g.stroke();
    });

    // Body.
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.moveTo(0, -S * 0.46);
    g.quadraticCurveTo(S * 0.17, -S * 0.2, S * 0.155, S * 0.14);
    g.quadraticCurveTo(S * 0.12, S * 0.3, 0, S * 0.32);
    g.quadraticCurveTo(-S * 0.12, S * 0.3, -S * 0.155, S * 0.14);
    g.quadraticCurveTo(-S * 0.17, -S * 0.2, 0, -S * 0.46);
    g.closePath();
    g.fill(); g.stroke();

    // Nose cone.
    g.save();
    g.beginPath();
    g.moveTo(0, -S * 0.46);
    g.quadraticCurveTo(S * 0.17, -S * 0.2, S * 0.155, S * 0.14);
    g.quadraticCurveTo(S * 0.12, S * 0.3, 0, S * 0.32);
    g.quadraticCurveTo(-S * 0.12, S * 0.3, -S * 0.155, S * 0.14);
    g.quadraticCurveTo(-S * 0.17, -S * 0.2, 0, -S * 0.46);
    g.closePath();
    g.clip();
    g.fillStyle = ink;
    g.beginPath();
    g.moveTo(-S * 0.2, -S * 0.2);
    g.quadraticCurveTo(0, -S * 0.1, S * 0.2, -S * 0.24);
    g.lineTo(S * 0.2, -S * 0.5);
    g.lineTo(-S * 0.2, -S * 0.5);
    g.closePath();
    g.fill();
    g.restore();

    // Window.
    g.fillStyle = '#BFEBFF';
    g.strokeStyle = ink;
    g.lineWidth = 3.2;
    g.beginPath(); g.arc(0, -S * 0.04, S * 0.082, 0, TAU); g.fill(); g.stroke();

    // Nozzle.
    g.fillStyle = ink;
    g.beginPath();
    g.moveTo(-S * 0.1, S * 0.24);
    g.lineTo(S * 0.1, S * 0.24);
    g.lineTo(S * 0.075, S * 0.33);
    g.lineTo(-S * 0.075, S * 0.33);
    g.closePath();
    g.fill();

    g.restore();
  }

  var FLAGS = {
    es: function (g, r) {
      g.fillStyle = '#AA151B'; g.fillRect(-r, -r, r * 2, r * 2);
      g.fillStyle = '#F1BF00'; g.fillRect(-r, -r * 0.42, r * 2, r * 0.84);
    },
    fr: function (g, r) {
      g.fillStyle = '#002654'; g.fillRect(-r, -r, r * 0.67, r * 2);
      g.fillStyle = '#FFFFFF'; g.fillRect(-r * 0.33, -r, r * 0.67, r * 2);
      g.fillStyle = '#CE1126'; g.fillRect(r * 0.33, -r, r * 0.67, r * 2);
    },
    it: function (g, r) {
      g.fillStyle = '#008C45'; g.fillRect(-r, -r, r * 0.67, r * 2);
      g.fillStyle = '#F4F5F0'; g.fillRect(-r * 0.33, -r, r * 0.67, r * 2);
      g.fillStyle = '#CD212A'; g.fillRect(r * 0.33, -r, r * 0.67, r * 2);
    },
    jp: function (g, r) {
      g.fillStyle = '#FFFFFF'; g.fillRect(-r, -r, r * 2, r * 2);
      g.fillStyle = '#BC002D';
      g.beginPath(); g.arc(0, 0, r * 0.56, 0, TAU); g.fill();
    },
    cn: function (g, r) {
      g.fillStyle = '#EE1C25'; g.fillRect(-r, -r, r * 2, r * 2);
      g.fillStyle = '#FFDE00';
      // One large star with four smaller ones arced around it, canton-left as
      // on the flag. Offsets are in flag-width units so the chip scales.
      star(g, -r * 0.52, -r * 0.34, r * 0.30, 0);
      star(g, -r * 0.06, -r * 0.60, r * 0.11, -0.35);
      star(g, r * 0.10, -r * 0.34, r * 0.11, -0.05);
      star(g, r * 0.10, -r * 0.03, r * 0.11, 0.25);
      star(g, -r * 0.06, r * 0.20, r * 0.11, 0.55);
    },
    globe: function (g, r) {
      g.fillStyle = '#7FC4E8'; g.fillRect(-r, -r, r * 2, r * 2);
      g.fillStyle = '#FFFFFF';
      g.beginPath();
      g.ellipse(-r * 0.3, -r * 0.2, r * 0.42, r * 0.3, -0.3, 0, TAU);
      g.fill();
      g.beginPath();
      g.ellipse(r * 0.34, r * 0.28, r * 0.34, r * 0.24, 0.4, 0, TAU);
      g.fill();
      g.beginPath();
      g.ellipse(r * 0.2, -r * 0.5, r * 0.24, r * 0.16, 0.1, 0, TAU);
      g.fill();
    },
  };

  /** Circular flag chip, matching the destination chips in the app's home list. */
  function drawFlagChip(g, S, style, code) {
    var r = S * 0.42;
    g.save();
    g.translate(S * 0.5, S * 0.5);
    g.save();
    g.beginPath(); g.arc(0, 0, r, 0, TAU); g.clip();
    (FLAGS[code] || FLAGS.globe)(g, r);
    g.restore();
    g.strokeStyle = '#FFFFFF';
    g.lineWidth = S * 0.075;
    g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(41,43,46,0.16)';
    g.lineWidth = 1.6;
    g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke();
    g.restore();
  }

  var LANDMARKS = {
    es: function (g, w, h) { // Domed cathedral.
      g.beginPath();
      g.moveTo(0, h);
      g.lineTo(0, h * 0.42);
      g.quadraticCurveTo(w * 0.5, -h * 0.22, w, h * 0.42);
      g.lineTo(w, h);
      g.closePath(); g.fill();
      g.beginPath();
      g.moveTo(w * 0.46, h * 0.1);
      g.lineTo(w * 0.5, -h * 0.08);
      g.lineTo(w * 0.54, h * 0.1);
      g.closePath(); g.fill();
    },
    fr: function (g, w, h) { // Lattice tower.
      g.beginPath();
      g.moveTo(w * 0.5, -h * 0.05);
      g.lineTo(w * 0.62, h * 0.55);
      g.lineTo(w * 0.86, h);
      g.lineTo(w * 0.62, h);
      g.lineTo(w * 0.54, h * 0.62);
      g.lineTo(w * 0.46, h * 0.62);
      g.lineTo(w * 0.38, h);
      g.lineTo(w * 0.14, h);
      g.lineTo(w * 0.38, h * 0.55);
      g.closePath(); g.fill();
      g.fillRect(w * 0.34, h * 0.42, w * 0.32, h * 0.07);
    },
    it: function (g, w, h) { // Arcade with a leaning campanile.
      g.fillRect(0, h * 0.46, w * 0.72, h * 0.54);
      for (var i = 0; i < 3; i++) {
        g.save();
        g.globalCompositeOperation = 'destination-out';
        g.beginPath();
        var ax = w * (0.1 + i * 0.22);
        g.arc(ax, h * 0.74, w * 0.07, Math.PI, 0);
        g.rect(ax - w * 0.07, h * 0.74, w * 0.14, h * 0.26);
        g.fill();
        g.restore();
      }
      g.save();
      g.translate(w * 0.84, h);
      g.rotate(7 * DEG);
      g.fillRect(-w * 0.075, -h * 0.86, w * 0.15, h * 0.86);
      g.restore();
    },
    jp: function (g, w, h) { // Torii.
      g.fillRect(w * 0.16, h * 0.3, w * 0.09, h * 0.7);
      g.fillRect(w * 0.75, h * 0.3, w * 0.09, h * 0.7);
      g.beginPath();
      g.moveTo(w * 0.02, h * 0.24);
      g.quadraticCurveTo(w * 0.5, h * 0.1, w * 0.98, h * 0.24);
      g.lineTo(w * 0.98, h * 0.32);
      g.quadraticCurveTo(w * 0.5, h * 0.19, w * 0.02, h * 0.32);
      g.closePath(); g.fill();
      g.fillRect(w * 0.1, h * 0.44, w * 0.8, h * 0.07);
    },
    cn: function (g, w, h) { // Tiered pagoda with upswept eaves.
      var cx = w * 0.5;
      // Four tiers, each a body with a wider flared roof above it. Deliberately
      // not the Oriental Pearl: that already anchors the Bund skyline behind.
      var tiers = [[0.86, 0.34], [0.64, 0.28], [0.44, 0.22], [0.26, 0.16]];
      for (var i = 0; i < tiers.length; i++) {
        var baseY = h * tiers[i][0];
        var halfW = w * tiers[i][1];
        g.fillRect(cx - halfW * 0.62, baseY - h * 0.16, halfW * 1.24, h * 0.17);
        // Flared eave: a shallow arc that lifts at both tips.
        g.beginPath();
        g.moveTo(cx - halfW, baseY - h * 0.15);
        g.quadraticCurveTo(cx, baseY - h * 0.30, cx + halfW, baseY - h * 0.15);
        g.quadraticCurveTo(cx + halfW * 0.5, baseY - h * 0.12, cx, baseY - h * 0.135);
        g.quadraticCurveTo(cx - halfW * 0.5, baseY - h * 0.12, cx - halfW, baseY - h * 0.15);
        g.closePath(); g.fill();
      }
      g.fillRect(cx - w * 0.30, h * 0.86, w * 0.60, h * 0.14); // plinth
      g.fillRect(cx - w * 0.012, 0, w * 0.024, h * 0.12);      // finial
    },
    globe: function (g, w, h) { // Meridian globe.
      var r = Math.min(w, h * 1.4) * 0.38;
      var cx = w * 0.5, cy = h * 0.52;
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
      g.save();
      g.globalCompositeOperation = 'destination-out';
      g.lineWidth = r * 0.1;
      g.strokeStyle = '#000';
      g.beginPath(); g.ellipse(cx, cy, r * 0.44, r, 0, 0, TAU); g.stroke();
      g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.stroke();
      g.restore();
      g.fillRect(cx - r * 0.1, cy + r, r * 0.2, h - cy - r);
    },
  };

  function drawLandmark(g, w, h, code, color) {
    g.save();
    g.fillStyle = color;
    (LANDMARKS[code] || LANDMARKS.globe)(g, w, h);
    g.restore();
  }

  /** Four-point sparkle, the creative's most repeated decorative mark. */
  function drawSparkle(g, S, color) {
    g.save();
    g.translate(S / 2, S / 2);
    var glow = g.createRadialGradient(0, 0, 0, 0, 0, S / 2);
    glow.addColorStop(0, 'rgba(255,246,32,0.55)');
    glow.addColorStop(1, 'rgba(255,246,32,0)');
    g.fillStyle = glow;
    g.beginPath(); g.arc(0, 0, S / 2, 0, TAU); g.fill();

    g.fillStyle = color;
    var a = S * 0.46, b = S * 0.1;
    g.beginPath();
    g.moveTo(0, -a);
    g.quadraticCurveTo(b * 0.6, -b * 0.6, b, 0);
    g.quadraticCurveTo(b * 0.6, b * 0.6, 0, a);
    g.quadraticCurveTo(-b * 0.6, b * 0.6, -b, 0);
    g.quadraticCurveTo(-b * 0.6, -b * 0.6, 0, -a);
    g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(-a, 0);
    g.quadraticCurveTo(-b * 0.6, -b * 0.6, 0, -b);
    g.quadraticCurveTo(b * 0.6, -b * 0.6, a, 0);
    g.quadraticCurveTo(b * 0.6, b * 0.6, 0, b);
    g.quadraticCurveTo(-b * 0.6, b * 0.6, -a, 0);
    g.closePath(); g.fill();
    g.restore();
  }

  function drawCloud(g, w, h, color) {
    g.fillStyle = color;
    g.beginPath();
    g.arc(w * 0.26, h * 0.62, h * 0.36, 0, TAU);
    g.arc(w * 0.46, h * 0.42, h * 0.46, 0, TAU);
    g.arc(w * 0.68, h * 0.56, h * 0.38, 0, TAU);
    g.arc(w * 0.84, h * 0.68, h * 0.28, 0, TAU);
    g.fill();
    roundRect(g, w * 0.12, h * 0.68, w * 0.78, h * 0.3, h * 0.15);
    g.fill();
  }

  /**
   * Building vocabulary for the skyline strips.
   *
   * Every part is a flat, bottom-anchored silhouette drawn in the caller's
   * single fill colour, so a strip stays a backdrop and never competes with
   * the runner. Positions arrive as fractions — `fx`/`fw` of the strip width,
   * `fh` of its height — which is what keeps a city recognisable at any
   * viewport instead of only at the size it was authored against.
   *
   * `BUILD` reserves headroom at the top of the strip. Every shape is anchored
   * to the bottom, so scaling heights is all it takes; without it the tallest
   * towers get sheared flat by the canvas edge, which reads in game as a hard
   * horizontal cut across the middle of the sky.
   */
  function skylineParts(g, w, h) {
    var BUILD = 0.88;
    var W = function (f) { return w * f; };
    var H = function (f) { return h * f * BUILD; };
    var P = {};

    /** Plain mid-rise. The workhorse that gives a city its density. */
    P.block = function (fx, fw, fh) {
      roundRect(g, W(fx), h - H(fh), W(fw), H(fh), Math.min(W(fw), H(fh)) * 0.05);
      g.fill();
      return { x: W(fx), w: W(fw), top: h - H(fh) };
    };

    /** Hipped roof over a block: the Peace Hotel, the Pyramid of Cestius. */
    P.pyramid = function (fx, fw, fh, roof) {
      var b = P.block(fx, fw, fh);
      g.beginPath();
      g.moveTo(b.x - b.w * 0.06, b.top);
      g.lineTo(b.x + b.w * 0.5, b.top - H(roof));
      g.lineTo(b.x + b.w * 1.06, b.top);
      g.closePath(); g.fill();
      return b;
    };

    /** Domed civic pile: HSBC on the Bund, Sacre-Coeur, St Peter's. */
    P.dome = function (fx, fw, fh, rise) {
      var b = P.block(fx, fw, fh);
      var cx = b.x + b.w * 0.5;
      var r = b.w * 0.30;
      var ry = r * (rise == null ? 1 : rise);
      g.beginPath(); g.ellipse(cx, b.top, r, ry, 0, Math.PI, 0); g.fill();
      g.fillRect(cx - b.w * 0.028, b.top - ry - b.w * 0.15, b.w * 0.056, b.w * 0.17);
      return b;
    };

    /** Clock tower rising out of a block: the Customs House. */
    P.clock = function (fx, fw, fh, towerFh) {
      var b = P.block(fx, fw, fh);
      var tw = b.w * 0.56;
      var tx = b.x + b.w * 0.22;
      g.fillRect(tx, h - H(towerFh), tw, H(towerFh) - H(fh) + 2);
      g.beginPath();
      g.moveTo(tx - tw * 0.08, h - H(towerFh));
      g.lineTo(tx + tw * 0.5, h - H(towerFh + 0.06));
      g.lineTo(tx + tw * 1.08, h - H(towerFh));
      g.closePath(); g.fill();
      g.fillRect(tx + tw * 0.42, h - H(towerFh + 0.16), tw * 0.16, H(0.10));
      return b;
    };

    /** Haussmann block: mansard roof and chimney stacks. Paris' texture. */
    P.mansard = function (fx, fw, fh) {
      var b = P.block(fx, fw, fh);
      g.beginPath();
      g.moveTo(b.x, b.top);
      g.lineTo(b.x + b.w * 0.10, b.top - H(0.05));
      g.lineTo(b.x + b.w * 0.90, b.top - H(0.05));
      g.lineTo(b.x + b.w, b.top);
      g.closePath(); g.fill();
      for (var i = 0; i < 2; i++) {
        g.fillRect(b.x + b.w * (0.24 + i * 0.44), b.top - H(0.095), b.w * 0.035, H(0.05));
      }
      return b;
    };

    /**
     * Tiers of arches in a slab: the Colosseum, a loggia.
     *
     * The voids are subpaths cut by the even-odd fill rule rather than erased
     * with `destination-out`, so two arcades can abut to make the Colosseum's
     * stepped profile without one taking a bite out of the other.
     */
    P.arcade = function (fx, fw, fh, arches, tiers) {
      var x0 = W(fx), bw = W(fw), bh = H(fh), top = h - bh;
      var n = arches || 4;
      var rows = tiers || 1;
      var rowH = bh / rows;
      var bay = bw / n;
      var aw = bay * 0.32;
      g.beginPath();
      g.rect(x0, top, bw, bh);
      for (var r = 0; r < rows; r++) {
        var floor = top + rowH * (r + 1) - rowH * 0.13;
        var spring = floor - rowH * 0.36;
        for (var i = 0; i < n; i++) {
          var ax = x0 + bay * (i + 0.5);
          g.moveTo(ax - aw, floor);
          g.lineTo(ax - aw, spring);
          g.arc(ax, spring, aw, Math.PI, 0);
          g.lineTo(ax + aw, floor);
          g.closePath();
        }
      }
      g.fill('evenodd');
      return { x: x0, w: bw, top: top };
    };

    /** Triumphal arch: the Arc de Triomphe. */
    P.arch = function (fx, fw, fh) {
      var b = P.block(fx, fw, fh);
      var aw = b.w * 0.30;
      var cx = b.x + b.w * 0.5;
      var spring = h - H(fh) * 0.48;
      g.save();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.arc(cx, spring, aw, Math.PI, 0);
      g.rect(cx - aw, spring, aw * 2, H(fh));
      g.fill();
      g.restore();
      return b;
    };

    /**
     * Lattice tower: the Eiffel Tower, Tokyo Tower. One polygon that runs up
     * the outside of the legs and back down the inside, which leaves the
     * triangular void between them that makes the silhouette readable.
     */
    P.lattice = function (fx, fw, fh) {
      var x0 = W(fx), bw = W(fw), cx = x0 + bw * 0.5;
      var top = h - H(fh);
      var waist = h - H(fh * 0.42);
      g.beginPath();
      g.moveTo(x0, h);
      g.lineTo(cx - bw * 0.085, top);
      g.lineTo(cx + bw * 0.085, top);
      g.lineTo(x0 + bw, h);
      g.lineTo(x0 + bw * 0.82, h);
      g.lineTo(cx + bw * 0.030, waist);
      g.lineTo(cx - bw * 0.030, waist);
      g.lineTo(x0 + bw * 0.18, h);
      g.closePath(); g.fill();
      g.fillRect(cx - bw * 0.26, h - H(fh * 0.40), bw * 0.52, H(fh * 0.05));
      g.fillRect(cx - bw * 0.15, h - H(fh * 0.68), bw * 0.30, H(fh * 0.04));
      g.fillRect(cx - bw * 0.022, top - H(fh * 0.10), bw * 0.044, H(fh * 0.11));
      return { x: x0, w: bw, top: top };
    };

    /** Slender taper with observation decks: the Tokyo Skytree. */
    P.skytree = function (fx, fw, fh) {
      var x0 = W(fx), bw = W(fw), cx = x0 + bw * 0.5;
      var top = h - H(fh);
      g.beginPath();
      g.moveTo(x0, h);
      g.quadraticCurveTo(cx - bw * 0.10, h - H(fh * 0.45), cx - bw * 0.07, top);
      g.lineTo(cx + bw * 0.07, top);
      g.quadraticCurveTo(cx + bw * 0.10, h - H(fh * 0.45), x0 + bw, h);
      g.closePath(); g.fill();
      g.fillRect(cx - bw * 0.17, h - H(fh * 0.62), bw * 0.34, H(fh * 0.055));
      g.fillRect(cx - bw * 0.12, h - H(fh * 0.80), bw * 0.24, H(fh * 0.045));
      g.fillRect(cx - bw * 0.020, top - H(fh * 0.12), bw * 0.040, H(fh * 0.13));
      return { x: x0, w: bw, top: top };
    };

    /** Rounded-top bullet: Barcelona's Agbar Tower. */
    P.bullet = function (fx, fw, fh) {
      var x0 = W(fx), bw = W(fw), cx = x0 + bw * 0.5;
      var top = h - H(fh);
      g.beginPath();
      g.moveTo(x0, h);
      g.lineTo(x0, h - H(fh * 0.55));
      g.quadraticCurveTo(x0, top, cx, top);
      g.quadraticCurveTo(x0 + bw, top, x0 + bw, h - H(fh * 0.55));
      g.lineTo(x0 + bw, h);
      g.closePath(); g.fill();
      return { x: x0, w: bw, top: top };
    };

    /**
     * Cluster of needle spires: the Sagrada Familia. The middle spires run
     * tallest, the way the real central nave stands over the bell towers.
     */
    P.spires = function (fx, fw, fh, count) {
      var x0 = W(fx), bw = W(fw);
      var n = count || 5;
      P.block(fx, fw, fh * 0.30);
      for (var i = 0; i < n; i++) {
        var sx = x0 + bw * ((i + 0.5) / n);
        var sw = bw / (n * 2.6);
        var k = 1 - Math.abs((i + 0.5) / n - 0.5) * 1.5;
        var stop = h - H(fh * (0.52 + 0.48 * k));
        var base = h - H(fh * 0.28);
        g.beginPath();
        g.moveTo(sx - sw, base);
        g.quadraticCurveTo(sx - sw * 0.45, (stop + base) * 0.5, sx, stop);
        g.quadraticCurveTo(sx + sw * 0.45, (stop + base) * 0.5, sx + sw, base);
        g.closePath(); g.fill();
      }
      return { x: x0, w: bw, top: h - H(fh) };
    };

    /** Bell tower, optionally out of plumb: Pisa, Giotto's campanile. */
    P.campanile = function (fx, fw, fh, lean) {
      var x0 = W(fx), bw = W(fw);
      g.save();
      g.translate(x0 + bw * 0.5, h);
      g.rotate((lean || 0) * (Math.PI / 180));
      g.fillRect(-bw * 0.5, -H(fh), bw, H(fh));
      for (var i = 1; i < 4; i++) {
        g.fillRect(-bw * 0.62, -H(fh) * (i / 4), bw * 1.24, H(0.012));
      }
      g.fillRect(-bw * 0.64, -H(fh) - H(0.018), bw * 1.28, H(0.03));
      g.restore();
      return { x: x0, w: bw, top: h - H(fh) };
    };

    /** Broad flat-topped cone: Fuji sitting on Tokyo's horizon. */
    P.mountain = function (fx, fw, fh) {
      var x0 = W(fx), bw = W(fw);
      g.beginPath();
      g.moveTo(x0, h);
      g.lineTo(x0 + bw * 0.38, h - H(fh));
      g.lineTo(x0 + bw * 0.62, h - H(fh));
      g.lineTo(x0 + bw, h);
      g.closePath(); g.fill();
      return { x: x0, w: bw, top: h - H(fh) };
    };

    /**
     * Torii gate: battered posts under a lintel whose ends sweep up. Stands in
     * for a temple because a swept roof collapses into a shapeless lump at
     * backdrop scale, whereas a torii is legible down to a few pixels.
     */
    P.torii = function (fx, fw, fh) {
      var x0 = W(fx), bw = W(fw), cx = x0 + bw * 0.5, th = H(fh);
      var pw = bw * 0.10, inset = bw * 0.15;
      var post = function (dir) {
        var foot = cx + dir * (bw * 0.5 - inset);
        g.beginPath();
        g.moveTo(foot - pw * 0.6, h);
        g.lineTo(foot + pw * 0.6, h);
        g.lineTo(foot + dir * -pw * 0.1 + pw * 0.4, h - th * 0.80);
        g.lineTo(foot + dir * -pw * 0.1 - pw * 0.4, h - th * 0.80);
        g.closePath(); g.fill();
      };
      post(-1); post(1);
      g.fillRect(x0 + inset * 0.5, h - th * 0.64, bw - inset, th * 0.07);
      g.beginPath();
      g.moveTo(x0, h - th * 0.94);
      g.quadraticCurveTo(cx, h - th * 0.78, x0 + bw, h - th * 0.94);
      g.lineTo(x0 + bw, h - th * 0.86);
      g.quadraticCurveTo(cx, h - th * 0.70, x0, h - th * 0.86);
      g.closePath(); g.fill();
      return { x: x0, w: bw, top: h - th };
    };

    /** Tiered pagoda, each storey narrower than the one below it. */
    P.pagoda = function (fx, fw, fh, storeys) {
      var x0 = W(fx), bw = W(fw), cx = x0 + bw * 0.5;
      var n = storeys || 4;
      for (var i = 0; i < n; i++) {
        var k = 1 - i / n;
        var ew = bw * (0.45 + 0.55 * k) * 0.5;
        var y = h - H(fh * ((i + 1) / n));
        g.fillRect(cx - ew * 0.60, y, ew * 1.20, H(fh / n) + 2);
        g.beginPath();
        g.moveTo(cx - ew, y);
        g.quadraticCurveTo(cx, y - H(fh * 0.10), cx + ew, y);
        g.quadraticCurveTo(cx + ew * 0.5, y + H(fh * 0.035), cx, y + H(fh * 0.025));
        g.quadraticCurveTo(cx - ew * 0.5, y + H(fh * 0.035), cx - ew, y);
        g.closePath(); g.fill();
      }
      g.fillRect(cx - bw * 0.018, h - H(fh * 1.12), bw * 0.036, H(fh * 0.14));
      return { x: x0, w: bw, top: h - H(fh) };
    };

    /** Stepped setbacks tapering to a spire: the Jin Mao Tower. */
    P.tiered = function (fx, fw, fh) {
      var x0 = W(fx), bw = W(fw);
      var steps = [[0.00, 0.56], [0.08, 0.77], [0.16, 0.91], [0.24, 1.00]];
      for (var i = 0; i < steps.length; i++) {
        var inset = bw * steps[i][0];
        g.fillRect(x0 + inset, h - H(fh * steps[i][1]), bw - inset * 2, H(fh * steps[i][1]));
      }
      g.fillRect(x0 + bw * 0.46, h - H(fh * 1.10), bw * 0.08, H(fh * 0.11));
      return { x: x0, w: bw, top: h - H(fh) };
    };

    /** Tapered slab with the trapezoid void: the SWFC's bottle opener. */
    P.notch = function (fx, fw, fh) {
      var x0 = W(fx), bw = W(fw), inset = bw * 0.16, yT = h - H(fh);
      var lT = x0 + inset, rT = x0 + bw - inset, tw = rT - lT, nh = H(fh * 0.065);
      g.beginPath();
      g.moveTo(x0, h);
      g.lineTo(lT, yT);
      g.lineTo(lT + tw * 0.17, yT);
      g.lineTo(lT + tw * 0.33, yT + nh);
      g.lineTo(rT - tw * 0.33, yT + nh);
      g.lineTo(rT - tw * 0.17, yT);
      g.lineTo(rT, yT);
      g.lineTo(x0 + bw, h);
      g.closePath(); g.fill();
      return { x: x0, w: bw, top: yT };
    };

    /**
     * Asymmetric taper: the Shanghai Tower. Both flanks bow the same way
     * rather than mirroring, which is how the real building's twist reads in
     * silhouette; a symmetric taper just looks like a chimney.
     */
    P.taper = function (fx, fw, fh) {
      var x0 = W(fx), bw = W(fw), yT = h - H(fh);
      var lT = x0 + bw * 0.24, rT = x0 + bw * 0.72;
      g.beginPath();
      g.moveTo(x0, h);
      g.quadraticCurveTo(x0 + bw * 0.20, h - H(fh * 0.59), lT, yT);
      g.quadraticCurveTo((lT + rT) * 0.5, yT - H(fh * 0.03), rT, yT);
      g.quadraticCurveTo(x0 + bw * 0.93, h - H(fh * 0.59), x0 + bw, h);
      g.closePath(); g.fill();
      return { x: x0, w: bw, top: yT };
    };

    /** Splayed legs, two spheres, spire: the Oriental Pearl Tower. */
    P.pearl = function (fx, fw, fh) {
      var x0 = W(fx), bw = W(fw), cx = x0 + bw * 0.5, colW = bw * 0.26;
      var leg = function (dir) {
        g.beginPath();
        g.moveTo(cx + dir * colW * 0.5, h - H(fh * 0.42));
        g.lineTo(cx + dir * bw * 0.44, h);
        g.lineTo(cx + dir * bw * 0.26, h);
        g.lineTo(cx + dir * colW * 0.2, h - H(fh * 0.40));
        g.closePath(); g.fill();
      };
      leg(-1); leg(1);
      g.fillRect(cx - colW * 0.5, h - H(fh * 0.87), colW, H(fh * 0.87));
      g.beginPath(); g.arc(cx, h - H(fh * 0.44), bw * 0.38, 0, TAU); g.fill();
      g.beginPath(); g.arc(cx, h - H(fh * 0.75), bw * 0.27, 0, TAU); g.fill();
      g.beginPath();
      g.moveTo(cx - colW * 0.22, h - H(fh * 0.87));
      g.lineTo(cx, h - H(fh));
      g.lineTo(cx + colW * 0.22, h - H(fh * 0.87));
      g.closePath(); g.fill();
      return { x: x0, w: bw, top: h - H(fh) };
    };

    return P;
  }

  /**
   * One skyline composition per destination, so crossing a border actually
   * changes the city behind the runner instead of scrolling the same strip
   * for thirty seconds.
   *
   * Each is hand-authored rather than procedurally generated, because the
   * entire point of this backdrop is that it is recognisable at a glance —
   * random boxes read as "a city", not as "Paris". Nothing touches the left or
   * right edge, so a strip abuts its own copy seamlessly and can be stamped
   * repeatedly across the viewport.
   */
  var SKYLINES = {
    // Shanghai: the Bund's historic row, the Huangpu gap, then Pudong.
    cn: function (P) {
      P.block(0.030, 0.052, 0.27);
      P.pyramid(0.086, 0.044, 0.25, 0.09);            // Peace Hotel
      P.dome(0.136, 0.062, 0.31);                     // HSBC Building
      P.block(0.204, 0.050, 0.26);
      P.clock(0.258, 0.042, 0.28, 0.56);              // Customs House
      P.block(0.306, 0.048, 0.24);
      // The Huangpu: a deliberate gap between the two banks.
      P.pearl(0.396, 0.078, 0.99);                    // Oriental Pearl
      P.tiered(0.520, 0.046, 0.78);                   // Jin Mao
      P.notch(0.592, 0.055, 0.86);                    // SWFC
      P.taper(0.664, 0.062, 0.99);                    // Shanghai Tower
      P.block(0.740, 0.040, 0.36);
      P.block(0.788, 0.052, 0.48);
      P.block(0.848, 0.036, 0.30);
      P.block(0.892, 0.046, 0.40);
      P.block(0.946, 0.038, 0.26);
    },

    // Tokyo: Fuji on the horizon, Asakusa's temple roofs, then the towers.
    jp: function (P) {
      P.mountain(0.014, 0.196, 0.58);                 // Mt Fuji
      P.torii(0.184, 0.076, 0.34);                    // Torii gate
      P.pagoda(0.276, 0.058, 0.50);
      P.block(0.342, 0.040, 0.30);
      P.lattice(0.390, 0.092, 0.92);                  // Tokyo Tower
      P.block(0.452, 0.042, 0.34);
      P.block(0.502, 0.050, 0.46);
      P.skytree(0.572, 0.062, 0.99);                  // Tokyo Skytree
      P.block(0.654, 0.044, 0.38);
      P.block(0.706, 0.056, 0.52);
      P.block(0.778, 0.046, 0.64);
      P.block(0.840, 0.040, 0.34);
      P.block(0.888, 0.052, 0.44);
      P.block(0.950, 0.036, 0.26);
    },

    // Barcelona: the Sagrada Familia's spires against the Agbar Tower.
    es: function (P) {
      P.block(0.028, 0.048, 0.26);
      P.dome(0.084, 0.058, 0.30);
      P.block(0.150, 0.042, 0.24);
      P.spires(0.200, 0.140, 0.94, 5);                // Sagrada Familia
      P.block(0.352, 0.046, 0.28);
      P.campanile(0.410, 0.028, 0.62, 0);
      P.block(0.450, 0.050, 0.32);
      P.bullet(0.514, 0.052, 0.78);                   // Agbar Tower
      P.block(0.578, 0.044, 0.30);
      P.arcade(0.632, 0.086, 0.34, 3, 2);
      P.block(0.730, 0.040, 0.26);
      P.dome(0.780, 0.054, 0.38);
      P.block(0.846, 0.046, 0.30);
      P.block(0.902, 0.052, 0.40);
      P.block(0.962, 0.030, 0.22);
    },

    // Paris: the Eiffel Tower over a run of Haussmann roofs.
    fr: function (P) {
      P.mansard(0.026, 0.060, 0.26);
      P.dome(0.096, 0.064, 0.34, 1.25);               // Sacre-Coeur
      P.mansard(0.170, 0.056, 0.24);
      P.lattice(0.238, 0.104, 0.99);                  // Eiffel Tower
      P.mansard(0.356, 0.058, 0.25);
      P.arch(0.426, 0.060, 0.32);                     // Arc de Triomphe
      P.mansard(0.496, 0.054, 0.23);
      P.block(0.560, 0.044, 0.66);                    // Tour Montparnasse
      P.mansard(0.616, 0.060, 0.26);
      P.dome(0.686, 0.058, 0.30);                     // Les Invalides
      P.mansard(0.754, 0.056, 0.24);
      P.campanile(0.820, 0.026, 0.44, 0);
      P.mansard(0.858, 0.062, 0.27);
      P.mansard(0.932, 0.050, 0.24);
    },

    // Italy: the Colosseum, St Peter's, and a campanile that leans.
    it: function (P) {
      P.block(0.026, 0.044, 0.24);
      P.arcade(0.080, 0.058, 0.44, 3, 3);             // Colosseum, outer wall
      P.arcade(0.136, 0.082, 0.30, 4, 2);             // Colosseum, ruined ring
      P.block(0.224, 0.042, 0.22);
      P.dome(0.276, 0.096, 0.44, 1.35);               // St Peter's
      P.block(0.384, 0.040, 0.24);
      P.campanile(0.436, 0.030, 0.66, 5);             // Pisa
      P.block(0.482, 0.048, 0.26);
      P.dome(0.542, 0.078, 0.38, 1.2);                // Florence Duomo
      P.campanile(0.632, 0.026, 0.52, 0);             // Giotto's campanile
      P.block(0.670, 0.046, 0.25);
      P.arcade(0.728, 0.092, 0.32, 4, 2);
      P.block(0.832, 0.042, 0.23);
      P.pyramid(0.884, 0.048, 0.22, 0.14);            // Pyramid of Cestius
      P.block(0.944, 0.040, 0.26);
    },

    // The payoff strip: one landmark from everywhere, for "200+ destinations".
    globe: function (P) {
      P.block(0.024, 0.044, 0.26);
      P.pagoda(0.078, 0.052, 0.42);
      P.block(0.142, 0.040, 0.28);
      P.lattice(0.192, 0.084, 0.90);
      P.dome(0.290, 0.060, 0.34, 1.3);
      P.block(0.362, 0.042, 0.26);
      P.pearl(0.412, 0.076, 0.94);
      P.block(0.502, 0.044, 0.30);
      P.spires(0.556, 0.110, 0.80, 4);
      P.bullet(0.680, 0.050, 0.70);
      P.block(0.742, 0.042, 0.32);
      P.notch(0.796, 0.050, 0.76);
      P.arcade(0.858, 0.082, 0.32, 3, 2);
      P.block(0.952, 0.036, 0.24);
    },
  };

  /** Paints one destination's skyline strip in a single flat colour. */
  function drawSkyline(g, w, h, color, flag) {
    g.save();
    g.fillStyle = color;
    (SKYLINES[flag] || SKYLINES.globe)(skylineParts(g, w, h));
    g.restore();
  }

  /**
   * Destination gate. Two posts carrying a maroon ribbon with the flag chip at
   * the apex — a border crossing the runner passes through, which is the beat
   * that demonstrates "you changed country and stayed online".
   */
  function drawGate(g, w, h, style, flagCanvas) {
    var postW = w * 0.085;
    var chip = w * 0.30;
    var ribbonH = Math.max(9, h * 0.062);
    // Headroom at the top so the flag chip can overhang the banner without
    // being clipped by the canvas edge.
    var ribbonTop = chip * 0.55;
    var postTop = ribbonTop + ribbonH * 0.85;
    var chipCy = ribbonTop + ribbonH * 0.5;

    // Posts.
    g.fillStyle = '#FFFFFF';
    g.strokeStyle = 'rgba(41,43,46,0.16)';
    g.lineWidth = 2;
    roundRect(g, 0, postTop, postW, h - postTop, postW * 0.42);
    g.fill(); g.stroke();
    roundRect(g, w - postW, postTop, postW, h - postTop, postW * 0.42);
    g.fill(); g.stroke();

    // Gold caps, echoing the gold device frame in the store creative.
    g.fillStyle = style.gold;
    roundRect(g, -postW * 0.18, postTop - ribbonH * 0.1, postW * 1.36, ribbonH * 0.52, postW * 0.28);
    g.fill();
    roundRect(g, w - postW * 1.18, postTop - ribbonH * 0.1, postW * 1.36, ribbonH * 0.52, postW * 0.28);
    g.fill();

    // Banner.
    g.fillStyle = style.maroon;
    roundRect(g, postW * 0.3, ribbonTop, w - postW * 0.6, ribbonH, ribbonH * 0.28);
    g.fill();

    if (flagCanvas) {
      g.drawImage(flagCanvas.canvas, (w - chip) / 2, chipCy - chip / 2, chip, chip);
    }
  }

  /**
   * Builds the whole atlas for one layout pass. `S` is the runner's reference
   * size in CSS pixels; every other piece is proportional to it, so the whole
   * scene rescales from a single number.
   */
  function buildAtlas(style, S, dpr, glyphs) {
    var atlas = {};
    var halo = Math.max(3, S * 0.055);

    // Run cycle, sampled from the continuous pose function.
    atlas.run = [];
    var frames = 10;
    for (var i = 0; i < frames; i++) {
      var f = makeCanvas(S, S * 1.34, dpr);
      drawTraveler(f.ctx, S, style, i / frames, 'run');
      atlas.run.push(haloize(f, halo, '#FFFFFF', dpr, true));
    }

    var jf = makeCanvas(S, S * 1.34, dpr);
    drawTraveler(jf.ctx, S, style, 0, 'jump');
    atlas.jump = haloize(jf, halo, '#FFFFFF', dpr, true);

    var hf = makeCanvas(S, S * 1.34, dpr);
    drawTraveler(hf.ctx, S, style, 0, 'hurt');
    atlas.hurt = haloize(hf, halo, '#FFFFFF', dpr, true);

    // Keyed by the hazard kinds in PlayableConfig.gameplay.hazards. The dead
    // zone is authored wide instead of square: it is an area to clear, not an
    // object to dodge, and the silhouette has to say so before it arrives.
    atlas.hazards = {};
    var hzRoaming = makeCanvas(S, S, dpr);
    drawRoamingHazard(hzRoaming.ctx, S, style, glyphs);
    atlas.hazards.roaming = haloize(hzRoaming, halo, '#FFFFFF', dpr, true);

    var hzWifi = makeCanvas(S, S, dpr);
    drawPublicWifiHazard(hzWifi.ctx, S, style);
    atlas.hazards.wifi = haloize(hzWifi, halo, '#FFFFFF', dpr, true);

    var hzThrottle = makeCanvas(S, S, dpr);
    drawThrottleHazard(hzThrottle.ctx, S, style);
    atlas.hazards.throttle = haloize(hzThrottle, halo, '#FFFFFF', dpr, true);

    var dzW = S * 2.8, dzH = S * 0.78;
    var hzDead = makeCanvas(dzW, dzH, dpr);
    drawDeadZone(hzDead.ctx, dzW, dzH, style);
    atlas.hazards.deadzone = haloize(hzDead, halo, '#FFFFFF', dpr, true);

    var rk = makeCanvas(S * 0.92, S * 1.05, dpr);
    drawRocket(rk.ctx, S * 0.92, style);
    atlas.rocket = haloize(rk, halo, '#FFFFFF', dpr, true);

    var vf = makeCanvas(S * 1.5, S * 2.3, dpr);
    drawVictoryFlag(vf.ctx, S * 1.5, S * 2.3, style);
    atlas.victoryFlag = haloize(vf, halo, '#FFFFFF', dpr, true);

    atlas.flags = {};
    atlas.gates = {};
    var flagSize = S * 0.7;
    Object.keys(FLAGS).forEach(function (code) {
      var fc = makeCanvas(flagSize, flagSize, dpr);
      drawFlagChip(fc.ctx, flagSize, style, code);
      atlas.flags[code] = fc;

      var gw = S * 2.5, gh = S * 2.35;
      var gc = makeCanvas(gw, gh, dpr);
      drawGate(gc.ctx, gw, gh, style, fc);
      atlas.gates[code] = gc;
    });

    // Landmarks get the same headroom treatment as the skyline. Several of
    // them deliberately overshoot their nominal box — the cathedral's spire
    // sits at -0.08h and its dome is pulled by a control point at -0.22h, the
    // lattice tower's mast at -0.05h — so drawing into the full canvas sheared
    // the tips off every spire in the set.
    atlas.landmarks = {};
    Object.keys(LANDMARKS).forEach(function (code) {
      var lw = S * 3.4, lh = S * 3.1, lPad = lh * 0.22;
      var lc = makeCanvas(lw, lh, dpr);
      lc.ctx.save();
      lc.ctx.translate(0, lPad);
      drawLandmark(lc.ctx, lw, lh - lPad, code, 'rgba(198,58,88,0.42)');
      lc.ctx.restore();
      atlas.landmarks[code] = lc;
    });

    var sp = makeCanvas(S * 0.5, S * 0.5, dpr);
    drawSparkle(sp.ctx, S * 0.5, style.accentYellow);
    atlas.sparkle = sp;

    atlas.clouds = [0.9, 1.35, 1.8].map(function (k) {
      var cw = S * 2.1 * k, chh = S * 0.8 * k;
      var cc = makeCanvas(cw, chh, dpr);
      drawCloud(cc.ctx, cw, chh, style.cloudPink);
      return cc;
    });

    atlas.S = S;
    return atlas;
  }

  window.PlayableArt = {
    buildAtlas: buildAtlas,
    makeCanvas: makeCanvas,
    roundRect: roundRect,
    drawWaveH: drawWaveH,
    drawSkyline: drawSkyline,
    drawVictoryFlag: drawVictoryFlag,
  };
})(window);
