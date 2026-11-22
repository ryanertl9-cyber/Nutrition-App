// Barcode scanning and lookup in a real browser. The phone camera is a generated video of an
// EAN-13 barcode (Chromium's fake capture device); Open Food Facts and USDA are mocked.
// Run: node tests/e2e-barcode.cjs
const { chromium, devices } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const TOML = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
const CSP = TOML.match(/Content-Security-Policy = "([^"]+)"/)[1];
const PERMS = TOML.match(/Permissions-Policy = "([^"]+)"/)[1];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

// --- A fake camera: an EAN-13 barcode drawn into a .y4m video ------------------------------
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = L.map((c) => c.split('').map((b) => (b === '1' ? '0' : '1')).reverse().join(''));
const R = L.map((c) => c.split('').map((b) => (b === '1' ? '0' : '1')).join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
function ean13Bits(code) {
  const d = code.split('').map(Number);
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (PARITY[d[0]][i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  return bits + '101';
}
function barcodeVideo(code, file) {
  const W = 640, H = 480, MOD = 4;
  const bits = ean13Bits(code);
  const x0 = Math.round((W - bits.length * MOD) / 2);
  const y = Buffer.alloc(W * H, 235);
  for (let row = 140; row < 340; row++) for (let i = 0; i < bits.length; i++) if (bits[i] === '1') y.fill(16, row * W + x0 + i * MOD, row * W + x0 + (i + 1) * MOD);
  const uv = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, uv]);
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F15:1 Ip A1:1 C420jpeg\n`), frame, frame]));
}

const CODE = '0012345678905'; // UPC-A 012345678905 written as EAN-13
const OFF_PRODUCT = {
  code: CODE, product_name: 'Crunchy Peanut Butter', brands: 'Acme Foods', serving_size: '2 tbsp (32 g)', serving_quantity: 32,
  nutriments: { 'energy-kcal_100g': 588, proteins_100g: 25, fat_100g: 50, carbohydrates_100g: 20, fiber_100g: 6, sugars_100g: 9, sodium_100g: 0.43 },
};

function serve() {
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = p.endsWith('/') ? path.join(p, 'index.html') : p;
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'content-security-policy': CSP, 'permissions-policy': PERMS });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => srv.listen(0, () => r(srv)));
}
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['ok', name]); console.log('ok   ', name); } catch (e) { results.push(['FAIL', name]); console.log('FAIL ', name, '\n     ', e.message.split('\n')[0]); }
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-barcode-'));
  const video = path.join(tmp, 'barcode.y4m');
  barcodeVideo(CODE, video);
  const srv = await serve();
  const url = `http://localhost:${srv.address().port}/app/`;
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`] });
  const errors = [];
  const offCalls = [];
  let offMode = 'found';

  async function context(opts) {
    const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block' }, opts));
    ctx.setDefaultTimeout(20000);
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    // A hosted copy (lookups and camera allowed), with accounts pointed nowhere.
    await ctx.route('**/src/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.NL_CONFIG = { supabaseUrl: 'https://fake-project.supabase.test', supabaseKey: 'sb_publishable_test', siteUrl: 'http://localhost/' };" }));
    await ctx.route('https://fake-project.supabase.test/**', (r) => r.abort());
    await ctx.route('https://world.openfoodfacts.org/**', (r) => {
      offCalls.push(r.request().url());
      if (offMode === 'down') return r.abort();
      if (offMode === 'found') return r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ status: 1, product: OFF_PRODUCT }) });
      return r.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ status: 0 }) });
    });
    await ctx.route('https://api.nal.usda.gov/**', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ foods: [] }) }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForSelector('.score');
    await page.click('[data-action="close-sheet"]'); // skip the guided setup
    return { ctx, page };
  }
  const state = (p) => p.evaluate(() => window.NutrientLedger.state.data);

  const phone = await context(Object.assign({}, devices['Pixel 5'], { permissions: ['camera'] }));
  const p = phone.page;

  await step('phones get a Scan button on Today and in Add food', async () => {
    if (process.env.SHOTS_DIR) await p.screenshot({ path: process.env.SHOTS_DIR + '/scan-today.png' });
    assert.equal(await p.locator('[data-action="scan-open"][data-from="today"]').count(), 1);
    await p.click('[data-action="open-add"][data-meal="breakfast"]');
    assert.equal(await p.locator('#sheet-root [data-action="scan-open"]').count(), 1);
    await p.click('[data-action="close-sheet"]');
  });

  await step('scanning with the camera finds the product and opens the portion picker', async () => {
    await p.click('[data-action="open-add"][data-meal="lunch"]');
    await p.click('#sheet-root [data-action="scan-open"]');
    await p.waitForSelector('#scan-video');
    if (process.env.SHOTS_DIR) { await p.waitForFunction(() => document.querySelector('#scan-video') && document.querySelector('#scan-video').videoWidth > 0).catch(() => {}); await p.screenshot({ path: process.env.SHOTS_DIR + '/scan-camera.png' }).catch(() => {}); }
    await p.waitForSelector('#pp-qty', { timeout: 30000 });
    if (process.env.SHOTS_DIR) await p.screenshot({ path: process.env.SHOTS_DIR + '/scan-found.png' });
    assert.match(await p.textContent('.portion-pane'), /Crunchy Peanut Butter \(Acme Foods\)/);
    assert.match(await p.textContent('.portion-pane'), /Open Food Facts/);
    assert.match(await p.textContent('#pp-unit'), /1 serving \(2 tbsp\) \(32 g\)/);
    assert.equal(await p.evaluate(() => document.querySelector('#pp-meal').value), 'lunch', 'keeps the meal it was opened from');
    assert.equal(await p.locator('video').count(), 0, 'camera view is gone');
    await p.click('[data-action="confirm-add"]');
    const d = await state(p);
    const e = d.entries.find((x) => x.name.startsWith('Crunchy Peanut Butter'));
    assert.ok(e, 'logged');
    assert.equal(e.grams, 32);
    assert.equal(e.meal, 'lunch');
    const f = d.myFoods.find((x) => x.kind === 'barcode');
    assert.ok(f && NLsame(f.barcode, CODE), 'saved to My foods with its barcode');
  });

  await step('the camera turns off when the scanner is closed or a code is read', async () => {
    await p.evaluate(() => {
      window.__streams = [];
      const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (c) => { const st = await orig(c); window.__streams.push(st); return st; };
    });
    offMode = 'found';
    await p.click('[data-action="scan-open"][data-from="today"]');
    await p.waitForFunction(() => window.__streams.length === 1);
    await p.click('[data-action="close-sheet"]');
    await p.click('[data-action="open-add"][data-meal="breakfast"]');
    await p.click('#sheet-root [data-action="scan-open"]');
    await p.waitForSelector('#pp-qty', { timeout: 30000 });
    await p.click('[data-action="close-sheet"]');
    const live = await p.evaluate(() => window.__streams.flatMap((st) => st.getTracks()).filter((t) => t.readyState !== 'ended').length);
    assert.equal(live, 0, 'no camera tracks left running');
  });

  await step('a barcode scanned before works offline, without asking the internet', async () => {
    const before = offCalls.length;
    await phone.ctx.setOffline(true);
    await p.click('[data-action="scan-open"][data-from="today"]');
    await p.waitForSelector('#pp-qty', { timeout: 30000 });
    assert.equal(offCalls.length, before);
    assert.match(await p.textContent('.portion-pane'), /Crunchy Peanut Butter/);
    await p.click('[data-action="close-sheet"]');
    await phone.ctx.setOffline(false);
  });

  await step('My foods labels scanned products', async () => {
    await p.click('[data-tab="foods"]');
    assert.match(await p.textContent('#main'), /Scanned/);
    await p.click('[data-tab="today"]');
  });

  const desk = await context({ viewport: { width: 1280, height: 900 } });
  const d = desk.page;

  await step('desktop has no Scan button, but typing a barcode into search looks it up', async () => {
    assert.equal(await d.locator('[data-action="scan-open"]').count(), 0);
    await d.click('[data-action="open-add"][data-meal="dinner"]');
    await d.fill('#add-q', '0 12345 67890 5');
    await d.waitForSelector('#add-results [data-action="bc-lookup"]');
    await d.press('#add-q', 'Enter');
    await d.waitForSelector('#pp-qty');
    assert.match(await d.textContent('.portion-pane'), /Crunchy Peanut Butter/);
    await d.click('[data-action="confirm-add"]');
    assert.ok((await state(d)).entries.some((e) => e.meal === 'dinner' && e.name.startsWith('Crunchy')));
  });

  await step('an unknown barcode can be added from the label, and is found next time', async () => {
    offMode = 'missing';
    await d.click('[data-action="open-add"][data-meal="snacks"]');
    await d.fill('#add-q', '4006381333931');
    await d.click('#add-results [data-action="bc-lookup"]');
    await d.waitForSelector('[data-action="bc-custom"]');
    assert.match(await d.textContent('.scan-status'), /No product found/);
    if (process.env.SHOTS_DIR) await d.screenshot({ path: process.env.SHOTS_DIR + '/scan-notfound.png' });
    await d.click('[data-action="bc-custom"]');
    assert.match(await d.textContent('.sheet-body'), /barcode 4006381333931/);
    await d.fill('#cf-name', 'Highlighter snack bar');
    await d.fill('#cf-grams', '40');
    await d.fill('[data-cf="kcal"]', '180');
    await d.fill('[data-cf="protein"]', '4');
    await d.click('[data-action="save-custom"]');
    await d.waitForSelector('#pp-qty');
    await d.click('[data-action="confirm-add"]');
    const calls = offCalls.length;
    await d.click('[data-action="open-add"][data-meal="snacks"]');
    await d.fill('#add-q', '4006381333931');
    await d.waitForSelector('#add-results [data-action="bc-lookup"]');
    assert.match(await d.textContent('#add-results'), /Highlighter snack bar/);
    await d.click('#add-results [data-action="bc-lookup"]');
    await d.waitForSelector('#pp-qty');
    assert.equal(offCalls.length, calls, 'found on the device');
    await d.click('[data-action="close-sheet"]');
  });

  await step('when the databases are unreachable, it says so plainly', async () => {
    offMode = 'down';
    await desk.ctx.route('https://api.nal.usda.gov/**', (r) => r.abort());
    await d.click('[data-action="open-add"][data-meal="snacks"]');
    await d.fill('#add-q', '5000112637922');
    await d.click('#add-results [data-action="bc-lookup"]');
    await d.waitForFunction(() => !/Looking up/.test(document.querySelector('.scan-status').textContent));
    assert.match(await d.textContent('.scan-status'), /Couldn't reach/);
    await d.click('[data-action="close-sheet"]');
  });

  await step('camera blocked: a clear message and the typed-number box', async () => {
    const blocked = await browser.newContext(Object.assign({}, devices['Pixel 5'], { serviceWorkers: 'block' }));
    await blocked.route(/fonts\./, (r) => r.abort());
    await blocked.route('**/src/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.NL_CONFIG = { supabaseUrl: 'https://fake-project.supabase.test', supabaseKey: 'x', siteUrl: 'http://localhost/' };" }));
    await blocked.route('https://fake-project.supabase.test/**', (r) => r.abort());
    const b = await blocked.newPage();
    await b.goto(url);
    await b.waitForSelector('.score');
    await b.click('[data-action="close-sheet"]');
    await b.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })); });
    await b.click('[data-action="scan-open"][data-from="today"]');
    await b.waitForSelector('.scan-status b');
    assert.match(await b.textContent('.scan-status'), /Camera access is turned off/);
    assert.equal(await b.locator('#bc-input').count(), 1);
    await blocked.close();
  });

  await step('no page errors', async () => assert.deepEqual(errors, []));
  await browser.close();
  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  const failed = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

function NLsame(a, b) { return String(a).replace(/^0+/, '') === String(b).replace(/^0+/, ''); }
