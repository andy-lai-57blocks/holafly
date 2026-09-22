// Covers the three behaviours the standard QA suite has no opinion about:
// replay from the endcard, per-device store routing, and that each compiled
// locale artefact really ships in its own language.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ART = path.resolve('dist/holafly-playable.html');
const OUT = path.resolve('dist/liftoff');
const browser = await chromium.launch();
let failures = 0;

const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  console.log(`      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
};

// ---------------------------------------------------------------- replay
{
  const page = await browser.newPage({ viewport: { width: 320, height: 480 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(ART).href);
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__playable.forceEnd('qa'));
  await page.waitForTimeout(500);

  const endcard = await page.evaluate(() => ({
    funnel: window.__playable.funnel.currentState,
    replayVisible: document.getElementById('end-replay').getBoundingClientRect().height > 0,
  }));
  await page.screenshot({ path: path.join(OUT, 'endcard-with-replay.png') });

  const r = await page.evaluate(() => document.getElementById('end-replay').getBoundingClientRect());
  check('replay control is present and tappable on the endcard',
    endcard.replayVisible && r.height >= 44, `${Math.round(r.width)}x${Math.round(r.height)}`);

  await page.click('#end-replay');
  await page.waitForTimeout(350);
  const after = await page.evaluate(() => ({
    funnel: window.__playable.funnel.currentState,
    loopRunning: window.__playable.isLoopRunning(),
    endcardHidden: document.getElementById('endcard').hidden,
    simElapsedMs: Math.round(window.__playable.game.state.elapsedMs),
    meter: Math.round(window.__playable.game.state.meter),
    destinations: window.__playable.game.state.destinationsCrossed,
    over: window.__playable.game.state.over,
  }));
  // The simulation clock has to have rewound, or the 30s cap ends the new run
  // on its first frame.
  check('replay rewinds the clock and resumes a fresh run',
    after.loopRunning && after.endcardHidden && !after.over && after.simElapsedMs < 2000 &&
    after.destinations === 0 && after.meter > 70, after);

  await page.waitForTimeout(3000);
  const stillRunning = await page.evaluate(() => ({
    loopRunning: window.__playable.isLoopRunning(),
    funnel: window.__playable.funnel.currentState,
    simElapsedMs: Math.round(window.__playable.game.state.elapsedMs),
  }));
  check('the replayed run keeps running', stillRunning.loopRunning, stillRunning);
  await page.close();
}

// ------------------------------------------------------------------ audio
// There is no sound control in the creative, so the contract is narrow: on by
// default, but not a sound until the player has touched it.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(pathToFileURL(ART).href);
  await page.waitForTimeout(1400);
  const before = await page.evaluate(() => ({
    muteControlPresent: !!document.getElementById('mute'),
    configDefaultMuted: window.__playable.config.audio.defaultMuted,
    contextOpened: !!window.__playable.audio.ctx,
    silent: window.__playable.isAudioSilent(),
  }));
  check('no audio context is opened before the first gesture',
    !before.muteControlPresent && before.configDefaultMuted === false &&
    !before.contextOpened && before.silent, before);

  await page.mouse.click(195, 500);
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => ({
    contextOpened: !!window.__playable.audio.ctx,
    state: window.__playable.audio.ctx && window.__playable.audio.ctx.state,
    silent: window.__playable.isAudioSilent(),
  }));
  check('the first tap turns sound on with no control to find',
    after.contextOpened && !after.silent, after);
  await page.close();
}

// ------------------------------------------------------- store routing
const UA = {
  iPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  Android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
};
for (const [device, userAgent] of Object.entries(UA)) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, userAgent });
  await page.goto(pathToFileURL(ART).href);
  await page.waitForTimeout(900);
  const url = await page.evaluate(() => window.__playable.resolveClickUrl());
  const wantHost = device === 'iPhone' ? 'apps.apple.com' : 'play.google.com';
  check(`${device} click routes to ${wantHost}`, url.includes(wantHost), url);
  await page.close();
}

// Liftoff's own API must win over anything baked into the creative.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => {
    window.__liftoffOpens = 0;
    window.Liftoff = { open: () => { window.__liftoffOpens++; } };
  });
  await page.goto(pathToFileURL(ART).href);
  await page.waitForTimeout(900);
  await page.click('#live-cta');
  await page.waitForTimeout(150);
  const opens = await page.evaluate(() => window.__liftoffOpens);
  check('CTA prefers Liftoff.open when the container provides it', opens === 1, `${opens} call(s)`);
  await page.close();
}

// ------------------------------------------------------- locale builds
for (const loc of ['en', 'es', 'ja', 'zh']) {
  const file = path.resolve(`dist/holafly-playable-${loc}.html`);
  if (!fs.existsSync(file)) { check(`${loc} artefact exists`, false, file); continue; }
  // The narrowest slot Liftoff serves, which is where the centred readouts
  // are most likely to wrap in a long locale.
  const page = await browser.newPage({ viewport: { width: 320, height: 480 }, deviceScaleFactor: 2 });
  // Deliberately no ?lang= — this is how the network will serve it.
  await page.goto(pathToFileURL(file).href);
  await page.waitForTimeout(900);
  const got = await page.evaluate(() => ({
    locale: window.__playable.locale,
    cta: document.getElementById('live-cta').textContent,
    readoutRows: new Set(
      ['meter-pill', 'dest-pill'].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().top)),
    ).size,
  }));
  check(`${loc} artefact ships in ${loc} with no URL override`, got.locale === loc, got);
  await page.screenshot({ path: path.join(OUT, `locale-${loc}.png`) });
  await page.close();
}

await browser.close();
console.log(`\n${failures === 0 ? 'all checks passed' : failures + ' check(s) failed'}`);
process.exit(failures === 0 ? 0 : 1);
