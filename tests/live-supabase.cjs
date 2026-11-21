// Live test against the real Supabase project in src/config.js. Creates two throwaway accounts,
// checks sync and isolation through the real app, then deletes both accounts.
// Needs "Confirm email" switched off in Supabase while it runs (no emails are sent).
// Run: LIVE_A=you+a@example.org LIVE_B=you+b@example.org node tests/live-supabase.cjs
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const A = process.env.LIVE_A, B = process.env.LIVE_B;
if (!A || !B) { console.error('Set LIVE_A and LIVE_B to two test email addresses.'); process.exit(2); }
const PW_A = 'Live test ' + Date.now() + ' a', PW_B = 'Live test ' + Date.now() + ' b';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

function serve() {
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = p.endsWith('/') ? path.join(p, 'index.html') : p;
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['ok', name]); console.log('ok   ', name); } catch (e) { results.push(['FAIL', name]); console.log('FAIL ', name, '\n     ', e.message.split('\n')[0]); }
}
async function until(fn, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    try { if (await fn()) return; } catch (e) { /* retry */ }
    if (Date.now() > end) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 250));
  }
}

(async () => {
  const srv = await serve();
  const url = `http://127.0.0.1:${srv.address().port}/`;
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
  const browser = await chromium.launch({ proxy });
  const errors = [];
  async function device(name) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    ctx.setDefaultTimeout(20000);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await page.goto(url);
    await page.waitForSelector('.score');
    await until(() => page.evaluate(() => window.NutrientLedger.account.available));
    return page;
  }
  const st = (page) => page.evaluate(() => { const s = window.NutrientLedger.state; return { user: s.user, entries: s.data.entries.filter((e) => !e.sample), profile: s.data.profile }; });
  const synced = (page) => until(async () => /All changes saved/.test((await page.getAttribute('#account-slot button', 'title')) || ''));
  async function signUp(page, email, pw) {
    await page.click('[data-action="auth-open"]');
    await page.click('[data-action="auth-mode"][data-mode="signup"]');
    await page.fill('#auth-email', email);
    await page.fill('#auth-email2', email);
    await page.fill('#auth-password', pw);
    await page.check('#auth-agree');
    await page.click('form[data-form="signup"] button[type="submit"]');
  }
  async function signIn(page, email, pw) {
    await page.click('[data-action="auth-open"]');
    await page.fill('#auth-email', email);
    await page.fill('#auth-password', pw);
    await page.click('form[data-form="signin"] button[type="submit"]');
  }
  async function deleteAccount(page) {
    await page.click('#account-slot button');
    await page.click('summary >> text=Delete account');
    await page.fill('#acct-delete', 'DELETE');
    await page.click('form[data-form="delete"] button[type="submit"]');
    await until(async () => !(await st(page)).user);
  }
  const remoteCount = (page, table) => page.evaluate(async (t) => {
    const { data, error } = await window.NutrientLedger.account.client.from(t).select(t === 'profiles' ? 'user_id' : 'id,deleted');
    if (error) throw new Error(error.message);
    return data.filter((r) => !r.deleted).length;
  }, table);

  const a1 = await device('A-phone');
  let a2, b;

  await step('sign up account A (real Supabase)', async () => {
    await signUp(a1, A, PW_A);
    await until(async () => (await st(a1)).user);
    assert.equal((await st(a1)).user.email, A.toLowerCase());
    await synced(a1);
  });

  await step('A logs meals and a profile change; they reach the server', async () => {
    await a1.fill('#p-age', '37'); await a1.press('#p-age', 'Tab');
    await a1.click('[data-tab="today"]');
    await a1.fill('#nl-input', '2 eggs, 1 cup oatmeal and a banana');
    await a1.click('[data-action="nl-parse"]');
    await a1.click('[data-action="parsed-add"]');
    await synced(a1);
    await until(async () => (await remoteCount(a1, 'entries')) === 3);
  });

  await step('A signs in on a second device and gets the same log and profile', async () => {
    a2 = await device('A-laptop');
    await signIn(a2, A, PW_A);
    await until(async () => (await st(a2)).entries.length === 3);
    assert.equal((await st(a2)).profile.age, 37);
  });

  await step('an entry added on the second device reaches the first', async () => {
    await a2.fill('#nl-input', '6 oz salmon');
    await a2.click('[data-action="nl-parse"]');
    await a2.click('[data-action="parsed-add"]');
    await synced(a2);
    await a1.evaluate(() => window.NutrientLedger.account.engine.sync());
    await until(async () => (await st(a1)).entries.length === 4);
  });

  await step('a deletion on the first device reaches the second', async () => {
    const id = (await st(a1)).entries[0].id;
    await a1.click(`[data-action="del-entry"][data-id="${id}"]`);
    await synced(a1);
    await a2.evaluate(() => window.NutrientLedger.account.engine.sync());
    await until(async () => !(await st(a2)).entries.some((e) => e.id === id));
  });

  await step('account B sees none of A\'s data, even asking the server directly', async () => {
    b = await device('B');
    await signUp(b, B, PW_B);
    await until(async () => (await st(b)).user);
    await synced(b);
    assert.equal((await st(b)).entries.length, 0);
    assert.equal(await remoteCount(b, 'entries'), 0);
    assert.equal(await remoteCount(b, 'profiles'), 1, 'B sees only its own profile row');
  });

  await step('B cannot write a row into A\'s account', async () => {
    const aId = (await st(a1)).user.id;
    const res = await b.evaluate(async (victim) => {
      const c = window.NutrientLedger.account.client;
      const { error } = await c.from('entries').insert({ user_id: victim, id: 'intrusion', data: {} });
      return error ? error.message : 'inserted';
    }, aId);
    assert.match(res, /row-level security|violates|permission/i);
    assert.equal(await remoteCount(a1, 'entries'), 3, 'A still has exactly its own 3 entries');
  });

  await step('signed-out visitors cannot read any table', async () => {
    const res = await a1.evaluate(async (cfg) => {
      const anon = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: false } });
      const out = [];
      for (const t of ['profiles', 'entries', 'foods']) { const { data, error } = await anon.from(t).select('*').limit(1); out.push(error ? 'denied' : data.length); }
      return out;
    }, await a1.evaluate(() => window.NL_CONFIG));
    assert.deepEqual(res, ['denied', 'denied', 'denied']);
  });

  await step('delete account B, then account A, through the app', async () => {
    await deleteAccount(b);
    await a2.click('#account-slot button');
    await a2.click('[data-action="sign-out"]');
    await until(async () => !(await st(a2)).user);
    await deleteAccount(a1);
  });

  await step('deleted accounts can no longer sign in', async () => {
    await signIn(a1, A, PW_A);
    try { await a1.waitForSelector('[data-auth-error]:not([hidden])'); } catch (e) {
      await a1.screenshot({ path: process.env.SHOT || '/tmp/live-fail.png' });
      console.log('     state:', JSON.stringify(await st(a1)).slice(0, 200));
      throw e;
    }
    assert.match(await a1.textContent('[data-auth-error]'), /don't match/);
  });

  await step('no page errors', async () => assert.deepEqual(errors, []));
  await browser.close();
  srv.close();
  const failed = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
