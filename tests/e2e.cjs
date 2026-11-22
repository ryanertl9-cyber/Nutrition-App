// End-to-end test in a real browser. Starts a static server, drives the app, checks results.
// Run: node tests/e2e.cjs   (needs the `playwright` package and a Chromium build)
const { chromium, devices } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS_DIR || '';
// Same Content-Security-Policy the live site sends (netlify.toml), so blocked requests fail here too.
const CSP = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8').match(/Content-Security-Policy = "([^"]+)"/)[1];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serve() {
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = p.endsWith('/') ? path.join(p, 'index.html') : p;
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'content-security-policy': CSP });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => srv.listen(0, () => r(srv)));
}

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['ok', name]); console.log('ok   ', name); } catch (e) { results.push(['FAIL', name, e]); console.log('FAIL ', name, '\n     ', e.message.split('\n')[0]); }
}

(async () => {
  const srv = await serve();
  const url = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // This suite covers on-device (guest) mode, as in the claude.ai version: no account backend.
  await ctx.route('**/src/config.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.NL_CONFIG = null;' }));
  // Online search is not reachable in CI: answer it with a canned USDA response.
  await ctx.route('https://api.nal.usda.gov/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ foods: [{ fdcId: 999, description: 'PROTEIN BAR, CHOCOLATE', dataType: 'Branded', brandOwner: 'ACME', servingSize: 60, servingSizeUnit: 'g', householdServingFullText: '1 bar', foodNutrients: [{ nutrientNumber: '208', value: 380 }, { nutrientNumber: '203', value: 33 }, { nutrientNumber: '303', value: 4.5 }] }] }),
  }));
  ctx.setDefaultTimeout(15000);
  const page = await ctx.newPage();
  console.log('server', url);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const entryCount = () => page.evaluate(() => window.NutrientLedger.state.data.entries.length);
  const todayEntries = () => page.evaluate(() => { const s = window.NutrientLedger.state; return s.data.entries.filter((e) => e.date === s.date); });

  await page.goto(url + 'app/');
  await page.waitForSelector('.score');

  await step('first visit opens on example data with a scoreboard', async () => {
    assert.ok(await page.isVisible('.banner'));
    const txt = await page.textContent('.bigcount');
    assert.match(txt, /\d+\/29 met/);
    assert.ok((await todayEntries()).length > 0);
  });

  await step('start my own log clears examples and opens profile', async () => {
    await page.click('[data-action="start-own"]');
    assert.equal(await entryCount(), 0);
    assert.ok(await page.isVisible('#p-age'));
  });

  await step('changing the profile recalculates targets', async () => {
    await page.selectOption('#p-sex', 'male');
    await page.fill('#p-age', '40'); await page.press('#p-age', 'Tab');
    const t = await page.evaluate(() => window.NL.computeTargets(window.NutrientLedger.state.data.profile).iron.target);
    assert.equal(t, 8);
    assert.match(await page.textContent('table.targets'), /DRI for men 31–50/);
  });

  await step('custom target override is applied and resettable', async () => {
    await page.fill('[data-target="protein"]', '150'); await page.press('[data-target="protein"]', 'Tab');
    assert.equal(await page.evaluate(() => window.NutrientLedger.state.data.overrides.protein.target), 150);
    await page.click('[data-action="reset-target"][data-key="protein"]');
    assert.equal(await page.evaluate(() => window.NutrientLedger.state.data.overrides.protein), undefined);
  });

  await step('natural-language entry logs three foods to the chosen meal', async () => {
    await page.click('[data-tab="today"]');
    await page.fill('#nl-input', '2 eggs, 1 cup oatmeal and a banana');
    await page.selectOption('#nl-meal', 'breakfast');
    await page.click('[data-action="nl-parse"]');
    assert.equal(await page.locator('.pitem').count(), 3);
    await page.click('[data-action="parsed-add"]');
    const es = await todayEntries();
    assert.equal(es.length, 3);
    const names = es.map((e) => e.name);
    assert.match(names[0], /^Egg, whole/);
    assert.match(names[1], /^Oatmeal/);
    assert.match(names[2], /^Banana/);
    assert.ok(es.every((e) => e.meal === 'breakfast'));
    assert.equal(es[0].grams, 100);
  });

  await step('scoreboard reflects logged food', async () => {
    const kcal = await page.textContent('.energy .kcal');
    // Expected total computed from the same database the page uses.
    const expected = await page.evaluate(() => {
      const s = window.NutrientLedger.state, db = window.NutrientLedger.db;
      return Math.round(s.data.entries.filter((e) => e.date === s.date).reduce((a, e) => a + (db.get(e.fid).per100[0] * e.grams) / 100, 0));
    });
    assert.ok(expected > 200);
    assert.equal(kcal.trim().replace(/,/g, ''), String(expected));
  });

  await step('search sheet adds a food with a chosen portion', async () => {
    await page.click('[data-action="open-add"][data-meal="lunch"]');
    await page.fill('#add-q', 'salmon');
    await page.waitForSelector('#add-results [data-action="pick"]');
    await page.click('#add-results [data-action="pick"] >> nth=0');
    await page.fill('#pp-qty', '6');
    await page.selectOption('#pp-unit', await page.$eval('#pp-unit', (sel) => [...sel.options].find((o) => o.text.startsWith('oz')).value));
    assert.match(await page.textContent('#pp-preview'), /Calories/);
    await page.click('[data-action="confirm-add"]');
    const lunch = (await todayEntries()).filter((e) => e.meal === 'lunch');
    assert.equal(lunch.length, 1);
    assert.match(lunch[0].name, /salmon/i);
    assert.equal(lunch[0].grams, 170.1);
  });

  await step('"steak" offers cuts, and a cut has a version picker', async () => {
    await page.click('[data-action="open-add"][data-meal="dinner"]');
    await page.fill('#add-q', 'steak');
    await page.waitForSelector('.kinds [data-action="kind"]');
    await page.click('.kinds [data-action="kind"] >> text=Ribeye');
    assert.equal(await page.inputValue('#add-q'), 'ribeye');
    assert.match(await page.textContent('#add-results .result >> nth=0'), /ribeye/i);
    assert.match(await page.textContent('#add-results .result >> nth=0'), /versions/);
    await page.click('#add-results [data-action="pick"] >> nth=0');
    const opts = await page.locator('#pp-version option').count();
    assert.ok(opts > 3);
    const before = await page.textContent('#pp-preview');
    const second = await page.getAttribute('#pp-version option >> nth=1', 'value');
    await page.selectOption('#pp-version', second);
    assert.equal(await page.inputValue('#pp-version'), second);
    assert.notEqual(await page.textContent('#pp-preview'), before);
    await page.click('[data-action="close-sheet"]');
  });

  await step('editing an entry changes its amount', async () => {
    await page.click('.entry .name >> text=/salmon/i');
    await page.fill('#pp-qty', '4');
    await page.click('[data-action="confirm-add"]');
    const lunch = (await todayEntries()).filter((e) => e.meal === 'lunch');
    assert.equal(lunch[0].grams, 113.4);
  });

  await step('recent list re-adds a food in one tap', async () => {
    await page.click('[data-action="open-add"][data-meal="snacks"]');
    await page.click('[data-action="add-view"][data-view="recent"]');
    await page.click('[data-action="quick-add"] >> nth=0');
    await page.click('[data-action="close-sheet"]');
    assert.equal((await todayEntries()).filter((e) => e.meal === 'snacks').length, 1);
  });

  await step('nutrient detail shows sources and gap-closing foods that can be added', async () => {
    await page.click('.nrow[data-key="magnesium"]');
    assert.match(await page.textContent('.sheet'), /Where it came from/);
    const before = await entryCount();
    await page.click('[data-action="add-suggestion"] >> nth=0');
    assert.equal(await entryCount(), before + 1);
    await page.click('[data-action="close-sheet"]');
  });

  await step('deleting an entry removes it', async () => {
    const before = await entryCount();
    await page.click('[data-action="del-entry"] >> nth=0');
    assert.equal(await entryCount(), before - 1);
  });

  await step('online USDA search result can be logged and is saved to My foods', async () => {
    await page.click('[data-action="open-add"][data-meal="snacks"]');
    await page.fill('#add-q', 'protein bar');
    await page.click('[data-action="search-online"]');
    await page.waitForSelector('[data-action="pick-online"]');
    await page.click('[data-action="pick-online"]');
    await page.click('[data-action="confirm-add"]');
    const mine = await page.evaluate(() => window.NutrientLedger.state.data.myFoods.map((f) => f.id));
    assert.ok(mine.includes('fdc_999'));
    const e = (await todayEntries()).find((x) => x.fid === 'fdc_999');
    assert.equal(e.grams, 60);
  });

  await step('a custom food from a label can be created and logged', async () => {
    await page.click('[data-tab="foods"]');
    await page.click('[data-action="new-custom"]');
    await page.fill('#cf-name', 'Test granola bar');
    await page.fill('#cf-label', '1 bar');
    await page.fill('#cf-grams', '40');
    await page.fill('[data-cf="kcal"]', '180');
    await page.fill('[data-cf="protein"]', '4');
    await page.click('[data-action="save-custom"]');
    assert.match(await page.textContent('.food-list'), /Test granola bar/);
    const f = await page.evaluate(() => window.NutrientLedger.state.data.myFoods.find((x) => x.name === 'Test granola bar'));
    assert.equal(f.per100[0], 450);
  });

  await step('a recipe is built from ingredients and logs per serving', async () => {
    await page.click('[data-action="new-recipe"]');
    await page.fill('#rc-name', 'Lentil soup');
    await page.fill('#rc-servings', '2');
    await page.click('[data-action="ing-add"]');
    await page.fill('#add-q', 'lentils');
    await page.click('#add-results [data-action="pick"] >> nth=0');
    await page.fill('#pp-qty', '2');
    await page.click('[data-action="confirm-add"]');
    await page.click('[data-action="ing-add"]');
    await page.fill('#add-q', 'spinach');
    await page.click('#add-results [data-action="pick"] >> nth=0');
    await page.click('[data-action="confirm-add"]');
    assert.equal(await page.locator('[data-ing-qty]').count(), 2);
    await page.click('[data-action="save-recipe"]');
    const r = await page.evaluate(() => window.NutrientLedger.state.data.myFoods.find((x) => x.kind === 'recipe'));
    assert.equal(r.name, 'Lentil soup');
    assert.equal(r.ingredients.length, 2);
    assert.equal(r.servings, 2);
  });

  await step('trends render heatmap, chart and insights from history', async () => {
    await page.evaluate(() => {
      const s = window.NutrientLedger.state;
      s.data.entries = s.data.entries.concat(window.NL.sampleEntries(window.NutrientLedger.db, window.NL.addDays(s.today, -1), 60));
    });
    await page.click('[data-tab="settings"]'); // re-render through a tab switch
    await page.evaluate(() => window.dispatchEvent(new Event('noop')));
    await page.click('[data-action="units"][data-units="metric"]'); // commit() reindexes
    await page.click('[data-tab="trends"]');
    await page.waitForSelector('.heat');
    assert.ok((await page.locator('.heat td.c-met').count()) > 50);
    assert.ok(await page.isVisible('.chart svg path'));
    assert.ok((await page.locator('.insights li').count()) >= 2);
    for (const r of ['1w', '3m', '6m']) {
      await page.click(`[data-action="range"][data-range="${r}"]`);
      await page.waitForSelector('.heat');
    }
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'e2e-trends-6m.png'), fullPage: true });
  });

  await step('heatmap day opens that day on Today', async () => {
    await page.click('[data-action="range"][data-range="1w"]');
    const d = await page.getAttribute('.heat [data-action="goto-day"] >> nth=0', 'data-date');
    await page.click('.heat [data-action="goto-day"] >> nth=0');
    assert.equal(await page.evaluate(() => window.NutrientLedger.state.date), d);
    assert.ok(await page.isVisible('.score'));
  });

  await step('data survives a reload', async () => {
    const before = await entryCount();
    await page.reload();
    await page.waitForSelector('.score');
    assert.equal(await entryCount(), before);
  });

  await step('export produces a backup and import restores it', async () => {
    await page.click('[data-tab="settings"]');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export"]')]);
    const file = await dl.path();
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(data.entries.length > 0);
    await page.click('[data-action="erase"]');
    await page.click('[data-action="erase"]');
    assert.equal(await entryCount(), 0);
    await page.setInputFiles('#import-file', file);
    await page.waitForFunction((n) => window.NutrientLedger.state.data.entries.length === n, data.entries.length);
  });

  await step('no console errors on desktop', async () => { assert.deepEqual(errors, []); });

  // Landing page
  const land = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const lp = await land.newPage();
  const landErrors = [];
  lp.on('pageerror', (e) => landErrors.push(e.message));
  await step('landing page shows to first-time visitors and links to the app', async () => {
    await lp.goto(url);
    assert.equal(new URL(lp.url()).pathname, '/');
    assert.match(await lp.textContent('h1'), /See which nutrients you hit/);
    assert.ok(await lp.isVisible('.label'));
    assert.equal(await lp.getAttribute('.hero .btn.primary', 'href'), '/app/');
    for (const img of await lp.locator('img').all()) {
      await img.scrollIntoViewIfNeeded();
      await lp.waitForFunction((el) => el.complete, await img.elementHandle());
      assert.ok(await img.evaluate((el) => el.naturalWidth > 0), 'image loads');
    }
  });
  await step('returning users skip the landing page; ?home shows it anyway', async () => {
    await lp.goto(url + 'app/');
    await lp.waitForSelector('.score');
    await lp.click('[data-action="start-own"]');
    await lp.click('[data-tab="today"]');
    await lp.fill('#nl-input', 'a banana');
    await lp.click('[data-action="nl-parse"]');
    await lp.click('[data-action="parsed-add"]');
    await lp.goto(url);
    await lp.waitForURL(/\/app\/$/);
    await lp.goto(url + '?home');
    assert.equal(new URL(lp.url()).pathname, '/');
  });
  await step('email sign-in links on the landing page are forwarded to the app', async () => {
    const c2 = await browser.newContext();
    const p = await c2.newPage();
    await p.goto(url + '#access_token=abc&type=recovery');
    await p.waitForURL(/\/app\/#access_token=abc&type=recovery$/);
    await c2.close();
  });
  await step('no errors on the landing page', async () => assert.deepEqual(landErrors, []));
  await land.close();

  // Phone layout + dark theme
  const phone = await browser.newContext(Object.assign({}, devices['iPhone 13'], { colorScheme: 'dark' }));
  await phone.route('**/src/config.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.NL_CONFIG = null;' }));
  const p2 = await phone.newPage();
  const errors2 = [];
  p2.on('pageerror', (e) => errors2.push(e.message));
  await p2.goto(url + 'app/');
  await p2.waitForSelector('.score');
  for (const tab of ['today', 'trends', 'foods', 'settings']) {
    await step(`phone ${tab}: no sideways page scroll`, async () => {
      await p2.click(`[data-tab="${tab}"]`);
      const over = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 0, `page is ${over}px wider than the screen`);
      if (SHOTS) await p2.screenshot({ path: path.join(SHOTS, `phone-${tab}.png`) });
    });
  }
  await step('phone: scoreboard comes before the logging form', async () => {
    await p2.click('[data-tab="today"]');
    const a = await p2.locator('.score').boundingBox();
    const b = await p2.locator('.quick').boundingBox();
    assert.ok(a.y < b.y);
  });
  await step('dark theme uses dark background', async () => {
    const bg = await p2.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(bg, 'rgb(14, 20, 17)');
  });
  await step('phone: add sheet fits the screen', async () => {
    await p2.click('[data-action="open-add"][data-meal="dinner"]');
    await p2.fill('#add-q', 'broccoli');
    await p2.waitForSelector('#add-results [data-action="pick"]');
    const box = await p2.locator('.sheet').boundingBox();
    assert.ok(box.width <= 390 && box.x >= 0);
    if (SHOTS) await p2.screenshot({ path: path.join(SHOTS, 'phone-add.png') });
  });
  await step('no console errors on phone', async () => { assert.deepEqual(errors2, []); });

  await browser.close();
  srv.close();
  const failed = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
