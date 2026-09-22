// Developer-only. Plays the ad through every border crossing and screenshots
// each one twice — once mid-dissolve and once settled — so the skyline
// handover can be checked as it actually renders rather than tile by tile.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ART = pathToFileURL(path.resolve('dist/holafly-playable.html')).href;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.goto(ART);
await page.waitForFunction(() => !!window.__playable && !!window.__playable.game);

// Keep the runner alive and airborne-ish so the run reaches every gate, and
// pin the meter so the probe measures the backdrop rather than the balance.
await page.evaluate(() => {
  const g = window.__playable.game;
  window.__seen = [];
  window.__pin = setInterval(() => { g.state.meter = 100; }, 50);
  const tick = setInterval(() => {
    const s = g.state;
    if (s.over) { clearInterval(tick); clearInterval(window.__pin); return; }
    const last = window.__seen[window.__seen.length - 1];
    if (!last || last.flag !== s.currentFlag) {
      window.__seen.push({ flag: s.currentFlag, at: Math.round(s.elapsedMs), mix: s.skyMix });
    }
  }, 16);
});
await page.mouse.click(195, 500);

const shot = async (name) => page.screenshot({ path: `dist/shots/transition-${name}.png` });
const flags = await page.evaluate(() => window.PlayableConfig.gameplay.destinations.map((d) => d.flag));

await page.waitForTimeout(400);
await shot('0-' + flags[0]);

for (let i = 1; i < flags.length; i++) {
  // Wait for the crossfade to be in flight, then catch it at the halfway mark.
  await page.waitForFunction(
    (f) => window.__playable.game.state.currentFlag === f,
    flags[i], { timeout: 15000 },
  );
  await page.waitForFunction(() => {
    const s = window.__playable.game.state;
    return s.skyMix > 0.35 && s.skyMix < 0.75;
  }, null, { timeout: 4000 });
  await shot(i + '-' + flags[i] + '-mid');
  await page.waitForFunction(() => window.__playable.game.state.skyMix >= 1, null, { timeout: 4000 });
  await shot(i + '-' + flags[i] + '-done');
}

console.log(JSON.stringify(await page.evaluate(() => window.__seen), null, 2));
await browser.close();
