// End-to-end check of the client preview: every version loads in the frame,
// the device controls resize it without clipping, and the QR really does
// decode to an address a phone can open.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium, devices } from 'playwright';
import jsQR from 'jsqr';

const PORT = Number(process.env.PORT || 4291);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SHOTS = 'build/verify';

const server = spawn(process.execPath, ['tools/serve.mjs'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve) => {
  server.stdout.on('data', (d) => { if (String(d).includes('preview')) resolve(); });
  setTimeout(resolve, 2500);
});

const browser = await chromium.launch();
const failures = [];
const note = (ok, line) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${line}`); if (!ok) failures.push(line); };

fs.mkdirSync(SHOTS, { recursive: true });

// ------------------------------------------------------------- desktop shell

const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${ORIGIN}/`, { waitUntil: 'load' });
await page.waitForTimeout(2500);

console.log('\npreview shell');
note((await page.locator('.version').count()) === 3, 'three versions listed');
note((await page.locator('#device-seg button').count()) === 6, 'six device presets');

/** The frame is scaled to fit; if the maths is off it hangs outside the stage
 *  and the client sees a cropped creative. */
async function framesFit() {
  return page.evaluate(() => {
    const stage = document.querySelector('.stage-inner').getBoundingClientRect();
    const dev = document.getElementById('device').getBoundingClientRect();
    return dev.top >= stage.top - 2 && dev.bottom <= stage.bottom + 2
      && dev.left >= stage.left - 2 && dev.right <= stage.right + 2;
  });
}

for (let d = 0; d < 6; d++) {
  for (const landscape of [false, true]) {
    await page.locator('#device-seg button').nth(d).click();
    const pressed = await page.getAttribute('#rotate', 'aria-pressed');
    if ((pressed === 'true') !== landscape) await page.click('#rotate');
    await page.waitForTimeout(350);
    const label = await page.textContent('#stage-note');
    note(await framesFit(), `fits: ${label}`);
  }
}
await page.click('#rotate'); // back to portrait
await page.locator('#device-seg button').nth(1).click();

// --------------------------------------------------------------- the QR code

console.log('\nqr code');
for (let v = 0; v < 3; v++) {
  await page.locator('.version').nth(v).click();
  await page.waitForTimeout(700);

  const shown = (await page.textContent('#qr-url')).trim();
  const pixels = await page.evaluate(() => {
    const c = document.getElementById('qr');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    return { w: c.width, h: c.height, data: Array.from(d.data) };
  });
  const decoded = jsQR(Uint8ClampedArray.from(pixels.data), pixels.w, pixels.h);

  note(!!decoded && decoded.data === shown, `scans to the address on screen: ${shown}`);

  // The QR points at the LAN interface; prove the same path answers.
  const path = new URL(shown).pathname;
  const res = await page.request.get(ORIGIN + path);
  note(res.ok(), `that path serves 200 (${path})`);
}

note(errors.length === 0, `shell console clean${errors.length ? ': ' + errors[0].slice(0, 120) : ''}`);
await page.screenshot({ path: `${SHOTS}/preview-shell.png` });
await ctx.close();

// ----------------------------------------------- what the phone actually gets

console.log('\nscanned on a phone');
for (const slug of ['stay-connected-run', 'run-from-bill-shock', 'one-stroke']) {
  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await phone.newPage();
  const phoneErrors = [];
  p.on('pageerror', (e) => phoneErrors.push(String(e)));
  await p.goto(`${ORIGIN}/packages/${slug}/index.html`, { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  await p.touchscreen.tap(195, 420);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${SHOTS}/phone-${slug}.png` });
  const painted = await p.evaluate(() => document.querySelectorAll('img, canvas, svg, x-dc, #dc-root').length);
  note(painted > 0 && phoneErrors.length === 0, `${slug}: ${painted} rendered nodes, ${phoneErrors.length} errors`);
  await phone.close();
}

await browser.close();
server.kill();

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall preview checks passed');
process.exit(failures.length ? 1 : 0);
