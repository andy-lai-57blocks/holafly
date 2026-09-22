// Dev-only: load the built artefact, capture console/page errors, and shoot a
// few frames so the creative can actually be looked at.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ART = path.resolve('dist/holafly-playable.html');
const OUT = 'dist/shots';
const AT_MS = [900, 2000, 3400, 5200, 8000, 14000];

const run = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack}`));

  await page.goto(pathToFileURL(ART).href);

  // Play, rather than idle. A passive run now loses signal at ~17-23s, so
  // without taps the later frames photograph the endcard instead of the game.
  // The first window is left untouched so the idle hint still shows up in the
  // 900ms and 2000ms frames.
  const advance = async (ms, { play }) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const slice = Math.min(300, deadline - Date.now());
      await page.waitForTimeout(slice);
      if (play) await page.mouse.click(195, 520);
    }
  };

  let prev = 0;
  for (const at of AT_MS) {
    await advance(at - prev, { play: prev >= 2000 });
    prev = at;
    await page.screenshot({ path: path.join(OUT, `portrait-${at}ms.png`) });
  }

  const state = await page.evaluate(() => {
    const p = window.__playable;
    if (!p) return { missing: true };
    return {
      funnel: p.funnel.currentState,
      history: p.funnel.history,
      metrics: p.metrics,
      fps: p.meanFps(),
      locale: p.locale,
      meter: p.game.state.meter,
      destinations: p.game.state.destinationsCrossed,
      orbs: p.game.state.orbsCollected,
    };
  });

  // Landscape composition, mid-gameplay.
  await page.setViewportSize({ width: 844, height: 390 });
  await advance(900, { play: true });
  await page.screenshot({ path: path.join(OUT, 'landscape.png') });

  // Endcard, both orientations: they have separate layouts.
  await page.evaluate(() => window.__playable.forceEnd('qa'));
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'endcard-landscape.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__playable.forceEnd('qa'));
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, 'endcard.png') });

  await browser.close();

  console.log(JSON.stringify(state, null, 2));
  if (errors.length) {
    console.log('\nERRORS:\n' + errors.join('\n---\n'));
    process.exitCode = 1;
  } else {
    console.log('\nno console or page errors');
  }
};

run();
