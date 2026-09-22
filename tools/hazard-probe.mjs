// Developer-only. Two jobs:
//  1. Force one of every hazard kind on screen at once so the new art can be
//     eyeballed without waiting on the spawn table.
//  2. Sample the signal meter over a full run, passive and active, to check the
//     added drains did not make the creative unwinnable.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ART = pathToFileURL(path.resolve('dist/holafly-playable.html')).href;

const browser = await chromium.launch();

// ---------------------------------------------------------------- art review
const page = await browser.newPage({ viewport: { width: 900, height: 420 }, deviceScaleFactor: 2 });
await page.goto(ART);
await page.waitForFunction(() => !!window.__playable);
await page.waitForTimeout(700);

await page.evaluate(() => {
  const g = window.__playable.game;
  g.pools.hazards.clear();
  g.pools.orbs.clear();
  g.pools.coins.clear();
  g.pools.boosts.clear();
  g.pools.gates.clear();
  const kinds = ['roaming', 'wifi', 'deadzone', 'throttle'];
  kinds.forEach((kind, i) => {
    const hz = g.pools.hazards.spawn();
    hz.x = g.w * (0.30 + i * 0.185);
    hz.y = 0;
    hz.spec = g._hazardsByKind[kind];
    hz.spent = false;
  });
  // Freeze so the lineup does not scroll out from under the screenshot.
  g.update = () => {};
  g.render();
});
await page.waitForTimeout(300);
await page.screenshot({ path: 'dist/shots/hazards.png' });
await page.close();

// ----------------------------------------------------------------- balance
async function run(label, { tap, cadenceMs = 260 }) {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await p.goto(ART);
  await p.waitForFunction(() => !!window.__playable);

  // Count what actually lands, by kind. Sparse polling undercounts short
  // effects, so hook the event the creative already emits.
  await p.evaluate(() => {
    const ev = window.__playable.game.events;
    const real = ev.onHazard;
    window.__hits = {};
    ev.onHazard = (kind) => {
      window.__hits[kind] = (window.__hits[kind] || 0) + 1;
      return real(kind);
    };
  });

  const trace = [];
  const deadline = Date.now() + 32000;
  while (Date.now() < deadline) {
    const snap = await p.evaluate(() => {
      const pl = window.__playable;
      return {
        meter: pl.game.state.meter,
        t: pl.game.state.elapsedMs,
        over: pl.game.state.over,
        reason: pl.game.state.overReason,
        dest: pl.game.state.destinationsCrossed,
        orbs: pl.game.state.orbsCollected,
        zone: pl.game.state.inDeadZone,
        throttled: pl.game.isThrottled(),
        mult: pl.game.drainMultiplier(),
      };
    });
    trace.push(snap);
    if (snap.over) break;
    // A competent player jumps on a cadence; hazards and orbs both need air.
    if (tap) await p.mouse.click(195, 500);
    await p.waitForTimeout(tap ? cadenceMs : 400);
  }
  const hits = await p.evaluate(() => window.__hits);
  await p.close();

  const last = trace[trace.length - 1];
  const low = Math.min(...trace.map((s) => s.meter));
  console.log(
    `${label.padEnd(10)} ends=${String(last.reason ?? 'survived').padEnd(9)} ` +
    `at=${(last.t / 1000).toFixed(1)}s  meterFinal=${last.meter.toFixed(0)}%  ` +
    `meterMin=${low.toFixed(0)}%  dest=${last.dest}  orbs=${last.orbs}  ` +
    `hits=${JSON.stringify(hits)}`
  );
  return last;
}

// The hazard table is a weighted draw, so a single sample says very little
// about how long a passive viewer actually lasts. Repeat to see the spread.
const reps = Number(process.argv[2] || 1);
const passiveEnds = [];
for (let i = 0; i < reps; i++) {
  const last = await run(`passive#${i + 1}`, { tap: false });
  passiveEnds.push(last.reason === 'signal' ? last.t / 1000 : Infinity);
}
if (reps > 1) {
  const finite = passiveEnds.filter((v) => Number.isFinite(v));
  console.log(
    `\npassive spread: ${passiveEnds.map((v) => (Number.isFinite(v) ? v.toFixed(1) + 's' : 'survived')).join(', ')}` +
    `  -> min=${Math.min(...finite).toFixed(1)}s max=${Math.max(...finite).toFixed(1)}s\n`
  );
}

await run('casual', { tap: true, cadenceMs: 800 });
await run('active', { tap: true, cadenceMs: 260 });

await browser.close();
