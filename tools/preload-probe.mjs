// Reproduces how a Liftoff/Vungle container actually delivers a playable:
// the creative is fetched and `ready` fires while the ad is still cached
// off-screen, and only becomes viewable when the publisher shows it.
//
// Liftoff's docs require checking `mraid.viewable` at `ready` and only then
// starting, precisely because this gap can be many seconds long.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ART = path.resolve('dist/holafly-playable.html');
const OUT = path.resolve('dist/liftoff');
const PRELOAD_GAP_MS = 8000;

// `ready` fires immediately, but the ad is NOT viewable yet.
const PRELOADED_MRAID = () => {
  window.__log = [];
  const listeners = {};
  let viewable = false;
  window.mraid = {
    getState: () => 'default',
    isViewable: () => viewable,
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    removeEventListener: () => {},
    open: (u) => window.__log.push('open:' + u),
  };
  window.__becomeViewable = () => {
    viewable = true;
    (listeners.viewableChange || []).forEach((fn) => fn(true));
  };
};

const snapshot = (page) => page.evaluate(() => ({
  funnel: window.__playable.funnel.currentState,
  loopRunning: window.__playable.isLoopRunning(),
  simElapsedMs: Math.round(window.__playable.game.state.elapsedMs),
  destinationsCrossed: window.__playable.game.state.destinationsCrossed,
  meter: Math.round(window.__playable.game.state.meter),
  hookVisible: !document.getElementById('hook-overlay').classList.contains('hide'),
  idleHintVisible: document.getElementById('idle-hint').classList.contains('show'),
}));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 320, height: 480 }, deviceScaleFactor: 2 });
await page.addInitScript(PRELOADED_MRAID);
await page.goto(pathToFileURL(ART).href);

await page.waitForTimeout(PRELOAD_GAP_MS);
const whileHidden = await snapshot(page);

await page.evaluate(() => window.__becomeViewable());
await page.waitForTimeout(80);
const firstVisibleFrame = await snapshot(page);
await page.screenshot({ path: path.join(OUT, 'preload-first-visible-frame.png') });

await browser.close();

const fmt = (o) => Object.entries(o).map(([k, v]) => `    ${k.padEnd(20)} ${v}`).join('\n');
console.log(`after ${PRELOAD_GAP_MS}ms cached off-screen, before the user ever sees it:\n${fmt(whileHidden)}`);
console.log(`\nthe first frame the user actually sees:\n${fmt(firstVisibleFrame)}`);
