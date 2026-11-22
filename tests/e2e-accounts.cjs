// End-to-end tests for accounts and sync, against a fake Supabase (tests/fake-supabase-*.js).
// Run: node tests/e2e-accounts.cjs
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createFakeSupabase } = require('./fake-supabase-server.cjs');

const ROOT = path.join(__dirname, '..');
const CSP = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8').match(/Content-Security-Policy = "([^"]+)"/)[1];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const FAKE_CLIENT = fs.readFileSync(path.join(__dirname, 'fake-supabase-client.js'), 'utf8');

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
  try { await fn(); results.push(['ok', name]); console.log('ok   ', name); } catch (e) { results.push(['FAIL', name]); console.log('FAIL ', name, '\n     ', e.message.split('\n')[0]); }
}
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    try { if (await fn()) return; } catch (e) { /* retry */ }
    if (Date.now() > end) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 100));
  }
}

(async () => {
  const fake = createFakeSupabase({ requireConfirmation: true });
  let failNetwork = false;
  const srv = await serve();
  const url = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];
  async function device(name) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    await ctx.route('**/src/vendor/supabase-*.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_CLIENT }));
    await ctx.exposeBinding('__fakeSupabase', async (_src, op, args) => (failNetwork && op === 'query' ? { error: 'Failed to fetch' } : fake.handle(op, args)));
    ctx.setDefaultTimeout(10000);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
    await page.goto(url + 'app/');
    await page.waitForSelector('.score');
    return { ctx, page };
  }
  const st = (page) => page.evaluate(() => { const s = window.NutrientLedger.state; return { user: s.user, entries: s.data.entries, foods: s.data.myFoods, profile: s.data.profile }; });
  const rowsFor = (email, table) => { const u = fake.users.get(email); return u ? fake.tables[table].filter((r) => r.user_id === u.id) : []; };
  const signIn = async (page, email, pw) => {
    await page.click('[data-action="auth-open"][data-mode="signin"] >> nth=0');
    await page.fill('#auth-email', email);
    await page.fill('#auth-password', pw);
    await page.click('form[data-form="signin"] button[type="submit"]');
  };
  const A = 'ana@example.com', B = 'ben@example.com';

  const d1 = await device('phone');
  const p1 = d1.page;

  await step('guest mode works and shows a Sign in button', async () => {
    assert.ok(await p1.isVisible('#account-slot [data-action="auth-open"]'));
    await p1.click('[data-action="start-own"]');
    await p1.click('[data-tab="today"]');
    await p1.fill('#nl-input', '2 eggs and a banana');
    await p1.click('[data-action="nl-parse"]');
    await p1.click('[data-action="parsed-add"]');
    assert.equal((await st(p1)).entries.length, 2);
  });

  await step('sign-up requires agreeing to the terms, then asks to confirm email', async () => {
    await p1.click('[data-action="auth-open"][data-mode="signin"]');
    await p1.click('[data-action="auth-mode"][data-mode="signup"]');
    await p1.fill('#auth-email', A);
    await p1.fill('#auth-email2', 'ana@exmaple.com');
    await p1.fill('#auth-password', 'correct horse 1');
    await p1.click('form[data-form="signup"] button[type="submit"]');
    assert.match(await p1.textContent('[role="alert"]'), /don't match/);
    await p1.fill('#auth-email2', A.toUpperCase()); // case doesn't matter
    await p1.fill('#auth-password', 'short');
    await p1.click('form[data-form="signup"] button[type="submit"]');
    assert.match(await p1.textContent('[role="alert"]'), /8 characters/);
    await p1.fill('#auth-password', 'correct horse 1');
    await p1.click('form[data-form="signup"] button[type="submit"]');
    assert.match(await p1.textContent('[role="alert"]'), /agree/);
    await p1.check('#auth-agree');
    await p1.click('form[data-form="signup"] button[type="submit"]');
    await p1.waitForSelector('text=Check your email');
    assert.ok(fake.users.has(A));
  });

  await step('signing in before confirming explains what to do', async () => {
    await p1.click('[data-action="auth-mode"][data-mode="signin"]');
    await p1.fill('#auth-email', A);
    await p1.fill('#auth-password', 'correct horse 1');
    await p1.click('form[data-form="signin"] button[type="submit"]');
    assert.match(await p1.textContent('[role="alert"]'), /Confirm your email/);
    assert.ok(await p1.isVisible('[data-action="auth-resend"]'));
  });

  await step('wrong password gets a clear message', async () => {
    fake.confirm(A);
    await p1.fill('#auth-password', 'nope nope nope');
    await p1.click('form[data-form="signin"] button[type="submit"]');
    assert.match(await p1.textContent('[role="alert"]'), /don't match/);
  });

  await step('first sign-in offers to bring the guest log into the account', async () => {
    await p1.fill('#auth-password', 'correct horse 1');
    await p1.click('form[data-form="signin"] button[type="submit"]');
    await p1.waitForSelector('text=Bring your log into your account?');
    await p1.click('[data-action="import-yes"]');
    await until(() => rowsFor(A, 'entries').length === 2);
    const s = await st(p1);
    assert.equal(s.user.email, A);
    assert.equal(s.entries.length, 2);
    assert.ok(rowsFor(A, 'profiles').length === 1);
    const guestLeft = await p1.evaluate(() => JSON.parse(localStorage.getItem('nutrient-ledger:v1')).entries.length);
    assert.equal(guestLeft, 0, 'guest copy cleared after import');
  });

  await step('profile changes and new entries sync up', async () => {
    await p1.click('[data-tab="settings"]');
    await p1.fill('#p-age', '41'); await p1.press('#p-age', 'Tab');
    await until(() => rowsFor(A, 'profiles')[0].data.profile.age === 41);
    await p1.click('[data-tab="today"]');
    await p1.click('[data-action="open-add"][data-meal="dinner"]');
    await p1.fill('#add-q', 'salmon');
    await p1.click('#add-results [data-action="pick"] >> nth=0');
    await p1.click('[data-action="confirm-add"]');
    await until(() => rowsFor(A, 'entries').length === 3);
    await until(async () => (await p1.getAttribute('#account-slot button', 'title')).includes('All changes saved'));
  });

  const d2 = await device('laptop');
  const p2 = d2.page;
  await step('a second device signs in and gets the same log and profile', async () => {
    await signIn(p2, A, 'correct horse 1');
    await until(async () => (await st(p2)).entries.length === 3);
    const s = await st(p2);
    assert.equal(s.profile.age, 41);
    assert.ok(!(await p2.isVisible('text=Bring your log into your account?')), 'no import prompt: this device had only example data');
  });

  await step('edits on one device reach the other', async () => {
    await p2.click('[data-action="open-add"][data-meal="snacks"]');
    await p2.fill('#add-q', 'almonds');
    await p2.click('#add-results [data-action="pick"] >> nth=0');
    await p2.click('[data-action="confirm-add"]');
    await until(() => rowsFor(A, 'entries').length === 4);
    await p1.click('#account-slot button');
    await p1.click('[data-action="sync-now"]');
    await until(async () => (await st(p1)).entries.length === 4);
    await p1.click('[data-action="close-sheet"]');
    assert.ok(await p1.isVisible('.entry .name >> text=/almonds/i'));
  });

  await step('deleting on one device removes it everywhere', async () => {
    const victim = (await st(p1)).entries[0].id;
    await p1.click(`[data-action="del-entry"][data-id="${victim}"]`);
    await until(() => rowsFor(A, 'entries').find((r) => r.id === victim).deleted === true);
    await p2.evaluate(() => window.NutrientLedger.account.engine.sync());
    await until(async () => !(await st(p2)).entries.some((e) => e.id === victim));
  });

  await step('custom foods and recipes sync', async () => {
    await p1.click('[data-tab="foods"]');
    await p1.click('[data-action="new-custom"]');
    await p1.fill('#cf-name', 'Synced bar');
    await p1.fill('#cf-grams', '40');
    await p1.fill('[data-cf="kcal"]', '200');
    await p1.click('[data-action="save-custom"]');
    await until(() => rowsFor(A, 'foods').some((r) => r.data.name === 'Synced bar'));
    await p2.evaluate(() => window.NutrientLedger.account.engine.sync());
    await until(async () => (await st(p2)).foods.some((f) => f.name === 'Synced bar'));
  });

  await step('when the server is unreachable, changes wait and then sync', async () => {
    failNetwork = true;
    await p1.click('[data-tab="today"]');
    await p1.fill('#nl-input', 'an apple');
    await p1.click('[data-action="nl-parse"]');
    await p1.click('[data-action="parsed-add"]');
    await until(async () => /Couldn't reach|offline/.test(await p1.getAttribute('#account-slot button', 'title')));
    const before = rowsFor(A, 'entries').length;
    failNetwork = false;
    await p1.click('#account-slot button');
    await p1.click('[data-action="sync-now"]');
    await until(() => rowsFor(A, 'entries').length === before + 1);
    await p1.click('[data-action="close-sheet"]');
  });

  await step('another user sees none of the first user\'s data', async () => {
    const d3 = await device('ben');
    const p3 = d3.page;
    await p3.click('[data-action="auth-open"][data-mode="signin"]');
    await p3.click('[data-action="auth-mode"][data-mode="signup"]');
    await p3.fill('#auth-email', B);
    await p3.fill('#auth-email2', B);
    await p3.fill('#auth-password', 'another good pw');
    await p3.check('#auth-agree');
    await p3.click('form[data-form="signup"] button[type="submit"]');
    await p3.waitForSelector('text=Check your email');
    fake.confirm(B);
    await p3.click('[data-action="auth-mode"][data-mode="signin"]');
    await p3.fill('#auth-password', 'another good pw');
    await p3.click('form[data-form="signin"] button[type="submit"]');
    await until(async () => (await st(p3)).user && rowsFor(B, 'profiles').length === 1);
    const s = await st(p3);
    assert.equal(s.entries.length, 0);
    assert.equal(s.foods.length, 0);
    assert.equal(await p3.isVisible('[data-tab="settings"][aria-selected="true"]'), true, 'new account lands on profile setup');
    // Directly ask the server for the other user's rows with Ben's session.
    const leaked = await p3.evaluate(async () => {
      const c = window.NutrientLedger.account.client;
      const { data } = await c.from('entries').select('*');
      return data.length;
    });
    assert.equal(leaked, 0);
    global.p3 = p3;
  });

  await step('delete account removes the user and all their rows', async () => {
    const p3 = global.p3;
    await p3.click('#account-slot button');
    await p3.click('summary >> text=Delete account');
    await p3.fill('#acct-delete', 'delete');
    await p3.click('form[data-form="delete"] button[type="submit"]');
    assert.match(await p3.textContent('[role="alert"]'), /DELETE/);
    await p3.fill('#acct-delete', 'DELETE');
    await p3.click('form[data-form="delete"] button[type="submit"]');
    await until(async () => !(await st(p3)).user);
    assert.equal(fake.users.has(B), false);
    assert.equal(fake.tables.profiles.filter((r) => r.user_id.includes('ben')).length, 0);
    assert.ok(rowsFor(A, 'entries').length > 0, 'other users untouched');
  });

  await step('signing out removes the account copy from the device', async () => {
    await p2.click('#account-slot button');
    await p2.click('[data-action="sign-out"]');
    await until(async () => !(await st(p2)).user);
    const keys = await p2.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('nutrient-ledger:acct:') || k.startsWith('nutrient-ledger:sync:')));
    assert.deepEqual(keys, []);
    assert.ok(await p2.isVisible('#account-slot [data-action="auth-open"]'));
  });

  await step('forgot password: email link lets you set a new one', async () => {
    await p2.click('[data-action="auth-open"][data-mode="signin"]');
    await p2.click('[data-action="auth-mode"][data-mode="forgot"]');
    await p2.fill('#auth-email', A);
    await p2.click('form[data-form="forgot"] button[type="submit"]');
    await p2.waitForSelector('text=Check your email');
    const code = fake.lastRecoveryCode(A);
    assert.ok(code);
    await p2.goto('about:blank'); // the email link opens a fresh page load
    await p2.goto(url + 'app/#fake_recovery=' + encodeURIComponent(code));
    await p2.waitForSelector('form[data-form="newpass"]');
    await p2.fill('#auth-password', 'brand new pass 2');
    await p2.click('form[data-form="newpass"] button[type="submit"]');
    await until(() => fake.users.get(A).password === 'brand new pass 2');
  });

  await step('session survives a reload', async () => {
    await p1.reload();
    await p1.waitForSelector('.score');
    await until(async () => (await st(p1)).user && (await st(p1)).user.email === A);
  });

  await step('landing-page links open the sign-in and sign-up forms', async () => {
    const { page: d } = await device('landing');
    await d.goto(url + 'app/#signup'); // already on /app/: same-page link
    await d.waitForSelector('form[data-form="signup"]');
    await d.click('[data-action="close-sheet"]');
    await d.goto('about:blank');
    await d.goto(url + 'app/#signin');
    await d.waitForSelector('form[data-form="signin"]');
  });

  await step('no console errors', async () => { assert.deepEqual(errors, []); });

  await browser.close();
  srv.close();
  const failed = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
