// Unit tests for src/sync.js using an in-memory server. Run: node --test tests/sync.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const Sync = require('../src/sync.js');

/** In-memory stand-in for the Supabase tables of one user. */
function makeServer() {
  let clock = Date.parse('2026-11-21T12:00:00Z');
  const tick = () => new Date((clock += 1000)).toISOString();
  const tables = { entries: new Map(), foods: new Map() };
  let profile = null;
  return {
    tables,
    get profile() { return profile; },
    remote: {
      async pull(kind, since) {
        return [...tables[kind].values()].filter((r) => !since || r.server_updated_at >= since).sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at));
      },
      async push(kind, rows) { for (const r of rows) tables[kind].set(r.id, JSON.parse(JSON.stringify(Object.assign({}, r, { server_updated_at: tick() })))); },
      async getProfile() { return profile && { data: JSON.parse(JSON.stringify(profile)) }; },
      async putProfile(p) { profile = JSON.parse(JSON.stringify(p)); },
    },
  };
}
function makeDevice(server, data) {
  const dev = {
    data: data || { profile: { sex: 'female', age: 30, heightCm: 165, weightKg: 60, activity: 'moderate', goal: 'maintain' }, overrides: {}, entries: [], myFoods: [], settings: { units: 'us', apiKey: 'secret' } },
    meta: Sync.emptyMeta(),
    remoteChanges: 0,
  };
  dev.engine = new Sync.SyncEngine(server.remote, {
    getData: () => dev.data,
    getMeta: () => dev.meta,
    saveMeta: (m) => { dev.meta = m; },
    onRemoteChange: (n) => { dev.remoteChanges += n; },
  });
  return dev;
}
const entry = (id, grams, extra) => Object.assign({ id, date: '2026-11-21', meal: 'lunch', src: 'sr', fid: 9040, name: 'Bananas, raw', qty: 1, unit: 'g', unitGrams: 1, grams }, extra);

test('stable() ignores key order', () => {
  assert.equal(Sync.stable({ b: 1, a: [1, { y: 2, x: 1 }] }), Sync.stable({ a: [1, { x: 1, y: 2 }], b: 1 }));
});

test('first sync uploads local entries, foods and profile', async () => {
  const s = makeServer();
  const a = makeDevice(s);
  a.data.entries.push(entry('e1', 100), entry('e2', 50));
  a.data.myFoods.push({ id: 'my_1', src: 'my', kind: 'custom', name: 'Bar', per100: [400], portions: [[40, '1 bar']] });
  const r = await a.engine.sync();
  assert.equal(r.firstSync, true);
  assert.equal(s.tables.entries.size, 2);
  assert.equal(s.tables.foods.size, 1);
  assert.equal(s.profile.profile.age, 30);
  assert.equal(s.profile.settings.apiKey, undefined, 'USDA key stays on the device');
  assert.equal(Sync.pendingCount(a.data, a.meta), 0);
});

test('example entries are never uploaded', async () => {
  const s = makeServer();
  const a = makeDevice(s);
  a.data.entries.push(entry('ex1', 100, { sample: true }), entry('e1', 10));
  await a.engine.sync();
  assert.deepEqual([...s.tables.entries.keys()], ['e1']);
});

test('a second device downloads the account, including the profile', async () => {
  const s = makeServer();
  const a = makeDevice(s);
  a.data.profile.age = 44;
  a.data.overrides = { protein: { target: 140 } };
  a.data.entries.push(entry('e1', 100));
  await a.engine.sync();
  const b = makeDevice(s); // fresh install with default profile
  const r = await b.engine.sync();
  assert.equal(r.remoteProfileFound, true);
  assert.equal(b.data.profile.age, 44, 'account profile wins over the new device defaults');
  assert.equal(b.data.overrides.protein.target, 140);
  assert.equal(b.data.entries.length, 1);
  assert.equal(b.data.settings.apiKey, 'secret', 'local-only settings are kept');
});

test('edits and deletions flow between devices', async () => {
  const s = makeServer();
  const a = makeDevice(s);
  a.data.entries.push(entry('e1', 100), entry('e2', 200));
  await a.engine.sync();
  const b = makeDevice(s);
  await b.engine.sync();
  // A edits e1 and deletes e2.
  a.data.entries[0].grams = 150;
  a.data.entries.splice(1, 1);
  await a.engine.sync();
  assert.equal(s.tables.entries.get('e2').deleted, true);
  await b.engine.sync();
  assert.deepEqual(b.data.entries.map((e) => [e.id, e.grams]), [['e1', 150]]);
  // B adds one; A gets it.
  b.data.entries.push(entry('e3', 30));
  await b.engine.sync();
  await a.engine.sync();
  assert.deepEqual(a.data.entries.map((e) => e.id).sort(), ['e1', 'e3']);
});

test('offline edits on two devices both survive (different entries)', async () => {
  const s = makeServer();
  const a = makeDevice(s);
  const b = makeDevice(s);
  await a.engine.sync(); await b.engine.sync();
  a.data.entries.push(entry('a1', 10));
  b.data.entries.push(entry('b1', 20));
  await a.engine.sync(); await b.engine.sync(); await a.engine.sync();
  assert.deepEqual(a.data.entries.map((e) => e.id).sort(), ['a1', 'b1']);
  assert.deepEqual(b.data.entries.map((e) => e.id).sort(), ['a1', 'b1']);
});

test('an unsynced local edit wins over an older remote change to the same entry', async () => {
  const s = makeServer();
  const a = makeDevice(s);
  a.data.entries.push(entry('e1', 100));
  await a.engine.sync();
  const b = makeDevice(s);
  await b.engine.sync();
  b.data.entries[0].grams = 300; await b.engine.sync();   // remote now 300
  a.data.entries[0].grams = 120;                          // A edited offline
  await a.engine.sync();
  assert.equal(a.data.entries[0].grams, 120);
  assert.equal(s.tables.entries.get('e1').data.grams, 120);
});

test('profile changes sync, and a new device does not overwrite them', async () => {
  const s = makeServer();
  const a = makeDevice(s);
  await a.engine.sync();
  a.data.profile.weightKg = 70;
  await a.engine.sync();
  assert.equal(s.profile.profile.weightKg, 70);
  const b = makeDevice(s);
  await b.engine.sync();
  assert.equal(b.data.profile.weightKg, 70);
  assert.equal(s.profile.profile.weightKg, 70);
});

test('nothing is re-uploaded when nothing changed', async () => {
  const s = makeServer();
  const a = makeDevice(s);
  a.data.entries.push(entry('e1', 100));
  await a.engine.sync();
  const r = await a.engine.sync();
  assert.equal(r.pushed, 0);
  assert.equal(r.remoteChanges, 0);
});

test('large logs upload in batches', async () => {
  const s = makeServer();
  const a = makeDevice(s);
  for (let i = 0; i < 1234; i++) a.data.entries.push(entry('e' + i, i));
  const pushes = [];
  const orig = s.remote.push;
  s.remote.push = async (k, rows) => { pushes.push(rows.length); return orig(k, rows); };
  await a.engine.sync();
  assert.deepEqual(pushes, [500, 500, 234]);
  assert.equal(s.tables.entries.size, 1234);
});

test('a failed push keeps changes pending and reports the error', async () => {
  const s = makeServer();
  const statuses = [];
  const a = makeDevice(s);
  a.engine.host.onStatus = (st) => statuses.push(st.state);
  a.data.entries.push(entry('e1', 100));
  s.remote.push = async () => { throw new Error('network down'); };
  await assert.rejects(a.engine.sync(), /network down/);
  assert.equal(statuses.at(-1), 'error');
  assert.ok(Sync.pendingCount(a.data, a.meta) >= 1);
});

test('concurrent sync calls coalesce instead of running in parallel', async () => {
  const s = makeServer();
  const a = makeDevice(s);
  let active = 0, maxActive = 0;
  const orig = s.remote.getProfile;
  s.remote.getProfile = async () => { active++; maxActive = Math.max(maxActive, active); await new Promise((r) => setTimeout(r, 10)); active--; return orig(); };
  await Promise.all([a.engine.sync(), a.engine.sync(), a.engine.sync()]);
  assert.equal(maxActive, 1);
});

test('saved meals sync through the foods table and land back in savedMeals', async () => {
  const s = makeServer();
  const a = makeDevice(s);
  a.data.savedMeals = [{ id: 'meal_1', kind: 'meal', name: 'Usual breakfast', items: [{ src: 'sr', fid: 9040, name: 'Banana', qty: 1, unit: 'banana', unitGrams: 126, grams: 126 }] }];
  a.data.myFoods.push({ id: 'my_1', src: 'my', kind: 'custom', name: 'Bar', per100: [400], portions: [[40, '1 bar']] });
  await a.engine.sync();
  assert.equal(s.tables.foods.get('meal_1').data.kind, 'meal');
  const b = makeDevice(s);
  await b.engine.sync();
  assert.deepEqual(b.data.savedMeals.map((m) => m.name), ['Usual breakfast']);
  assert.deepEqual(b.data.myFoods.map((f) => f.name), ['Bar'], 'meals do not leak into My foods');
  b.data.savedMeals[0].name = 'Weekday breakfast';
  await b.engine.sync();
  await a.engine.sync();
  assert.equal(a.data.savedMeals[0].name, 'Weekday breakfast');
  a.data.savedMeals = [];
  await a.engine.sync();
  await b.engine.sync();
  assert.equal(b.data.savedMeals.length, 0, 'deleting a meal syncs');
});
