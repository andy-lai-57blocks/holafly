// Developer-only. Parks the runner inside a dead zone and screenshots it, so
// the coverage-hole feedback (drag, interference wash, HUD glitch) can be
// eyeballed without waiting for the spawn table to cooperate.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ART = pathToFileURL(path.resolve('dist/holafly-playable.html')).href;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(ART);
await page.waitForFunction(() => !!window.__playable);
await page.waitForTimeout(2600);
await page.screenshot({ path: 'dist/shots/deadzone-before.png' });

// Drop a zone exactly on the runner and let a few frames accumulate static.
await page.evaluate(() => {
  const g = window.__playable.game;
  g.pools.hazards.clear();
  const hz = g.pools.hazards.spawn();
  hz.x = g.runnerX;
  hz.y = 0;
  hz.spec = g._hazardsByKind.deadzone;
  hz.spent = false;
  // Hold it under the runner instead of letting the world carry it away.
  const advance = g._advance.bind(g);
  g._advance = function (vx, dt, elapsedMs) {
    advance(vx, dt, elapsedMs);
    g.pools.hazards.each((h) => { h.x = g.runnerX; h.active = true; });
  };
});
await page.waitForTimeout(700);

const snap = await page.evaluate(() => ({
  inDeadZone: window.__playable.game.state.inDeadZone,
  speedMultiplier: window.__playable.game.speedMultiplier(),
  drainMultiplier: window.__playable.game.drainMultiplier(),
  speed: Math.round(window.__playable.game.state.speed),
  pillClass: document.getElementById('meter-pill').className,
}));
console.log(snap);

await page.screenshot({ path: 'dist/shots/deadzone.png' });
await browser.close();
