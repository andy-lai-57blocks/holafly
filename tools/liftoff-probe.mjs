// Ad-hoc audit against Liftoff's creative integration requirements:
//   - 50x50 regions in both top corners may be covered by the close button
//     or a regulatory watermark, so nothing interactive may live there.
//   - Liftoff buckets every impression into 320x480 / 480x320 / 768x1024 /
//     1024x768, so those are the sizes that actually ship.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ART = path.resolve('dist/holafly-playable.html');
const OUT = path.resolve('dist/liftoff');
const CORNER = 50;

const SIZES = [
  ['320x480', { width: 320, height: 480 }],
  ['480x320', { width: 480, height: 320 }],
  ['768x1024', { width: 768, height: 1024 }],
  ['1024x768', { width: 1024, height: 768 }],
];

// Anything a finger is meant to hit, plus the HUD the creative relies on to
// tell its story.
const TRACKED = ['live-cta', 'hud-wordmark', 'meter-pill', 'dest-pill', 'end-cta', 'end-logo', 'legal'];

function overlaps(r, zone) {
  return r.left < zone.right && r.right > zone.left && r.top < zone.bottom && r.bottom > zone.top;
}

const browser = await chromium.launch();
const findings = [];
fs.mkdirSync(OUT, { recursive: true });

for (const [label, viewport] of SIZES) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(ART).href);
  await page.waitForTimeout(2600);

  const paint = async () => page.evaluate((c) => {
    document.querySelectorAll('.__zone').forEach((n) => n.remove());
    const mk = (side) => {
      const d = document.createElement('div');
      d.className = '__zone';
      d.style.cssText = `position:fixed;top:0;${side}:0;width:${c}px;height:${c}px;` +
        'background:rgba(255,0,0,.45);outline:2px solid red;z-index:99999;pointer-events:none';
      document.body.appendChild(d);
    };
    mk('left'); mk('right');
  }, CORNER);

  const measure = async (phase) => {
    const boxes = await page.evaluate((ids) => {
      const out = {};
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const vis = getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).opacity !== '0';
        if (!vis) return;
        out[id] = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: Math.round(r.width), h: Math.round(r.height) };
      });
      return out;
    }, TRACKED);

    const zones = {
      topLeft: { left: 0, top: 0, right: CORNER, bottom: CORNER },
      topRight: { left: viewport.width - CORNER, top: 0, right: viewport.width, bottom: CORNER },
    };
    for (const [id, r] of Object.entries(boxes)) {
      for (const [zname, z] of Object.entries(zones)) {
        if (overlaps(r, z)) findings.push({ size: label, phase, element: id, zone: zname, box: `${r.w}x${r.h} @ ${Math.round(r.left)},${Math.round(r.top)}` });
      }
    }
  };

  await measure('gameplay');

  // Clearing the corners is only half the job: the HUD moved down into the
  // space the headline and the hint were already using.
  // Banners are transient, so force one up rather than hoping to catch it.
  await page.evaluate(() => window.__playable.ui.banner('Sketchy public Wi-Fi', 'bad'));
  await page.waitForTimeout(60);

  const collisions = await page.evaluate(() => {
    const box = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width && r.height ? r : null;
    };
    const hud = ['hud-wordmark', 'meter-pill', 'dest-pill'].map(box).filter(Boolean);
    const copy = ['hook-overlay', 'banner', 'idle-hint', 'live-cta'].map((id) => [id, box(id)]);
    const hit = [];
    for (const [id, c] of copy) {
      if (!c) continue;
      for (const h of hud) {
        if (c.left < h.right && c.right > h.left && c.top < h.bottom && c.bottom > h.top) {
          hit.push(id);
          break;
        }
      }
    }
    return hit;
  });
  for (const id of collisions) findings.push({ size: label, phase: 'gameplay', element: id, zone: 'HUD overlap', box: '-' });

  await paint();
  await page.screenshot({ path: path.join(OUT, `${label}-gameplay.png`) });

  await page.evaluate(() => window.__playable.forceEnd('qa'));
  await page.waitForTimeout(600);
  await measure('endcard');
  await paint();
  await page.screenshot({ path: path.join(OUT, `${label}-endcard.png`) });

  await page.close();
}

await browser.close();

if (findings.length === 0) {
  console.log('no element intrudes into the 50x50 top corners');
} else {
  console.log(`${findings.length} intrusion(s) into Liftoff's reserved top corners:\n`);
  for (const f of findings) {
    console.log(`  ${f.size.padEnd(9)} ${f.phase.padEnd(9)} ${f.element.padEnd(14)} -> ${f.zone.padEnd(9)} ${f.box}`);
  }
}
