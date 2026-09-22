// Developer-only. Renders every destination's skyline tile on its own, at full
// opacity and with guides, so geometry faults are visible instead of being
// hidden by the 0.30 alpha they ship at. Each city is stamped twice so the
// tiling seam is exposed too.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ART = pathToFileURL(path.resolve('dist/holafly-playable.html')).href;
const browser = await chromium.launch();
const query = process.argv[2] || '';
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await page.goto(ART + query);
await page.waitForFunction(() => !!window.__playable);
await page.waitForTimeout(500);

const flags = await page.evaluate(() =>
  window.PlayableConfig.gameplay.destinations.map((d) => d.flag));

for (const flag of flags) {
  await page.evaluate((flag) => {
    const old = document.getElementById('probe');
    if (old) old.remove();

    const art = window.PlayableArt;
    const S = Number(new URLSearchParams(location.search).get('probeS') || 52);
    const tileW = S * 13;
    const tileH = S * 2.75;
    const tileCount = Number(new URLSearchParams(location.search).get('tiles') || 2);

    const cvs = document.createElement('canvas');
    cvs.width = tileW * tileCount;
    cvs.height = tileH + 60;
    cvs.id = 'probe';
    cvs.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff;' +
      'width:' + cvs.width + 'px;height:' + cvs.height + 'px';
    document.body.appendChild(cvs);
    const g = cvs.getContext('2d');

    for (let i = 0; i < tileCount; i++) {
      g.save();
      g.translate(tileW * i, 30);
      art.drawSkyline(g, tileW, tileH, '#C63A58', flag);
      g.restore();
    }

    // Guides: tile boundaries (blue), the top edge of the strip (green), and
    // the ground line the skyline is supposed to sit on (orange).
    g.lineWidth = 1;
    g.strokeStyle = '#0066FF';
    Array.from({ length: tileCount + 1 }, (_, i) => tileW * i).forEach((x) => {
      g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, cvs.height); g.stroke();
    });
    g.strokeStyle = '#00A000';
    g.beginPath(); g.moveTo(0, 30.5); g.lineTo(cvs.width, 30.5); g.stroke();
    g.strokeStyle = '#FF8800';
    g.beginPath(); g.moveTo(0, 30.5 + tileH); g.lineTo(cvs.width, 30.5 + tileH); g.stroke();
  }, flag);

  await page.waitForTimeout(150);
  await page.locator('#probe').screenshot({ path: `dist/shots/skyline-${flag}.png` });
}

// Landmarks, straight out of the atlas, on a white ground with a guide at the
// top of each canvas so sheared spires are obvious.
await page.evaluate(() => {
  document.getElementById('probe').remove();
  const atlas = window.__playable.game.atlas;
  const codes = Object.keys(atlas.landmarks);
  const one = atlas.landmarks[codes[0]];
  const cvs = document.createElement('canvas');
  cvs.id = 'probe2';
  cvs.width = one.w * codes.length;
  cvs.height = one.h + 20;
  cvs.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff;' +
    'width:' + cvs.width + 'px;height:' + cvs.height + 'px';
  document.body.appendChild(cvs);
  const g = cvs.getContext('2d');
  codes.forEach((code, i) => {
    g.drawImage(atlas.landmarks[code].canvas, one.w * i, 10, one.w, one.h);
    g.strokeStyle = '#0066FF';
    g.beginPath(); g.moveTo(one.w * i + 0.5, 0); g.lineTo(one.w * i + 0.5, cvs.height); g.stroke();
  });
  g.strokeStyle = '#00A000';
  g.beginPath(); g.moveTo(0, 10.5); g.lineTo(cvs.width, 10.5); g.stroke();
});
await page.waitForTimeout(150);
await page.locator('#probe2').screenshot({ path: 'dist/shots/landmarks.png' });

await browser.close();
console.log('wrote dist/shots/skyline-{' + flags.join(',') + '}.png and landmarks.png');
