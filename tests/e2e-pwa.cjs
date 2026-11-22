// Installable / offline app: service worker caching, offline start, update flow, install tips.
// Run: node tests/e2e-pwa.cjs
const { chromium, devices } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const CSP = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8').match(/Content-Security-Policy = "([^"]+)"/)[1];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
let swOverride = null; // simulate publishing a new version

function serve() {
  const srv = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (pathname === '/sw.js' && swOverride) {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' });
      res.end(swOverride);
      return;
    }
    const p = path.join(ROOT, pathname);
    const file = p.endsWith('/') ? path.join(p, 'index.html') : p;
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'content-security-policy': CSP, 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => srv.listen(0, () => r(srv)));
}
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['ok', name]); console.log('ok   ', name); } catch (e) { results.push(['FAIL', name]); console.log('FAIL ', name, '\n     ', e.message.split('\n')[0]); }
}

(async () => {
  const srv = await serve();
  const url = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  ctx.setDefaultTimeout(20000);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));

  await step('the service worker installs and takes control', async () => {
    await page.goto(url + 'app/');
    await page.waitForSelector('.score');
    await page.click('[data-action="close-sheet"]'); // skip the guided setup
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForSelector('.score');
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller));
    const keys = await page.evaluate(() => caches.keys());
    assert.ok(keys.some((k) => k.startsWith('simply-nutrition-')));
  });

  await step('the manifest is linked and valid', async () => {
    const href = await page.getAttribute('link[rel="manifest"]', 'href');
    const m = await page.evaluate(async (h) => (await fetch(h)).json(), href);
    assert.equal(m.name, 'Simply Nutrition');
    assert.equal(m.display, 'standalone');
  });

  await step('the app opens and works with no network', async () => {
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForSelector('.score');
    await page.click('[data-tab="today"]');
    await page.fill('#nl-input', 'a banana and 1 cup of milk');
    await page.click('[data-action="nl-parse"]');
    await page.click('[data-action="parsed-add"]');
    const n = await page.evaluate(() => window.NutrientLedger.state.data.entries.length);
    assert.equal(n, 2, 'logging works offline');
    await page.goto(url + 'privacy.html');
    assert.match(await page.textContent('h1'), /Privacy/);
    await page.goto(url + 'app/');
    await page.waitForSelector('.score');
    await ctx.setOffline(false);
  });

  await step('publishing a new version shows "new version" and Refresh switches to it', async () => {
    const current = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    swOverride = current.replace(/const VERSION = '[^']+'/, "const VERSION = 'test-v2'");
    await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); await reg.update(); });
    await page.waitForSelector('.updatebar');
    await Promise.all([page.waitForEvent('load'), page.click('.updatebar button')]);
    await page.waitForSelector('.score');
    await page.waitForFunction(async () => (await caches.keys()).includes('simply-nutrition-test-v2'));
    const keys = await page.evaluate(() => caches.keys());
    assert.deepEqual(keys.filter((k) => k.startsWith('simply-nutrition-')), ['simply-nutrition-test-v2'], 'old version removed');
    assert.equal(await page.evaluate(() => window.NutrientLedger.state.data.entries.length), 2, 'log kept across the update');
    swOverride = null;
  });

  await step('iPhone Safari visitors get "Add to Home Screen" steps, which can be dismissed', async () => {
    const ios = await browser.newContext(devices['iPhone 13']);
    await ios.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const p = await ios.newPage();
    p.on('pageerror', (e) => errors.push('ios: ' + e.message));
    await p.goto(url + 'app/');
    await p.waitForSelector('.score');
    assert.equal(await p.locator('.install').count(), 0, 'not shown during the guided setup');
    await p.click('[data-action="close-sheet"]');
    assert.match(await p.textContent('.install'), /Add to Home Screen/);
    await p.click('[data-action="install-dismiss"]');
    assert.equal(await p.locator('.install').count(), 0);
    await p.reload();
    await p.waitForSelector('.score');
    assert.equal(await p.locator('.install').count(), 0, 'stays dismissed');
    await ios.close();
  });

  await step('installed on a phone, content starts below the status bar and stays clear when scrolling', async () => {
    const phone = await browser.newContext(Object.assign({}, devices['iPhone 13'], { serviceWorkers: 'block' }));
    await phone.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const p = await phone.newPage();
    await p.goto(url + 'app/');
    await p.waitForSelector('.score');
    // Simulate the iPhone status bar area that a home-screen app runs under (Chromium has no notch to emulate).
    await p.addStyleTag({ content: ':root { --safe-top: 47px !important; }' });
    const layout = () => p.evaluate(() => {
      const bar = document.querySelector('.appbar').getBoundingClientRect();
      const first = document.querySelector('#main').firstElementChild.getBoundingClientRect();
      return { barTop: bar.top, barBottom: bar.bottom, firstTop: first.top };
    });
    let l = await layout();
    assert.equal(l.barTop, 47, 'menu bar starts below the status bar');
    assert.ok(l.firstTop >= l.barBottom, `page content (${l.firstTop}) starts below the menu bar (${l.barBottom})`);
    await p.evaluate(() => window.scrollTo(0, 800));
    l = await layout();
    assert.equal(l.barTop, 47, 'menu bar stays below the status bar when scrolled');
    if (process.env.SHOTS_DIR) await p.screenshot({ path: process.env.SHOTS_DIR + '/safe-top.png' });
    await phone.close();
  });

  await step('no page errors', async () => assert.deepEqual(errors, []));
  await browser.close();
  srv.close();
  const failed = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
