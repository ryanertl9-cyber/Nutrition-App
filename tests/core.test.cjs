// Unit tests for src/core.js. Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const NL = require('../src/core.js');
const db = new NL.FoodDB(require(path.join(__dirname, '../data/foods.json')));

const close = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

test('database loads every SR28 food with the app nutrient order', () => {
  assert.equal(db.foods.filter((f) => f.db === 'sr28').length, 8789);
  assert.equal(db.foods.filter((f) => f.db === 'fndds').length, 5431);
  const banana = db.get(9040);
  assert.equal(banana.name, 'Bananas, raw');
  assert.equal(banana.per100[NL.BY_KEY.kcal.index], 89);
  assert.equal(banana.per100[NL.BY_KEY.potassium.index], 358);
  assert.equal(banana.group, 'Fruits');
});

test('missing lab values stay null instead of becoming zero', () => {
  // Lemon juice from concentrate has no selenium value in SR28.
  const f = db.get(9523);
  assert.equal(f.per100[NL.BY_KEY.selenium.index], null);
  const { totals, missing } = NL.sumEntries([{ src: 'sr', fid: 9523, grams: 100 }], (e) => db.get(e.fid));
  assert.equal(totals.selenium, 0);
  assert.equal(missing.selenium, 1);
});

test('search puts the everyday food first', () => {
  const top = (q) => db.search(q, { limit: 1 })[0].name;
  assert.equal(top('banana'), 'Banana, raw');
  assert.equal(top('eggs'), 'Egg, whole, boiled or poached');
  assert.match(top('greek yogurt'), /^Yogurt, Greek/);
  assert.match(top('chicken breast'), /^Chicken breast, grilled/);
  assert.equal(top('coffee'), 'Coffee, brewed');
  assert.equal(top('apple'), 'Apple, raw');
  assert.equal(top('burger'), 'Hamburger, on white bun, 1 medium patty');
  assert.equal(db.search('zzzz').length, 0);
});

test('search boosts foods the person logs often', () => {
  const usage = new Map([[1293, 20]]); // whole-milk Greek yogurt
  assert.equal(db.search('greek yogurt', { limit: 1, usage })[0].id, 1293);
});

test('energy target follows Mifflin-St Jeor', () => {
  const e = NL.energyTarget({ sex: 'male', age: 30, heightCm: 180, weightKg: 80, activity: 'sedentary', goal: 'maintain' });
  assert.equal(e.bmr, 1780); // 800 + 1125 - 150 + 5
  assert.equal(e.tdee, 2136);
  assert.equal(e.kcal, 2140);
});

test('calorie target never drops below the safety floor', () => {
  const e = NL.energyTarget({ sex: 'female', age: 70, heightCm: 150, weightKg: 45, activity: 'sedentary', goal: 'lose' });
  assert.equal(e.kcal, 1200);
});

test('targets use the right DRI band and sex', () => {
  const w = NL.computeTargets({ sex: 'female', age: 34, heightCm: 165, weightKg: 63, activity: 'moderate', goal: 'maintain' });
  assert.equal(w.iron.target, 18);
  assert.equal(w.calcium.target, 1000);
  assert.equal(w.iron.max, 45);
  const older = NL.computeTargets({ sex: 'female', age: 60, heightCm: 165, weightKg: 63, activity: 'moderate', goal: 'maintain' });
  assert.equal(older.iron.target, 8);
  assert.equal(older.calcium.target, 1200);
  const m = NL.computeTargets({ sex: 'male', age: 25, heightCm: 180, weightKg: 80, activity: 'moderate', goal: 'maintain' });
  assert.equal(m.magnesium.target, 400);
  assert.equal(m.vitK.target, 120);
  assert.equal(w.sodium.max, 2300);
  assert.equal(w.sodium.target, null);
  close(w.fiber.target, (w.kcal.target / 1000) * 14);
});

test('overrides replace targets and are marked custom', () => {
  const t = NL.computeTargets(NL.DEFAULT_PROFILE, { protein: { target: 140 }, sodium: { max: 1500 } });
  assert.equal(t.protein.target, 140);
  assert.equal(t.sodium.max, 1500);
  assert.ok(t.protein.custom);
});

test('status classifies min, range, limit and upper-limit cases', () => {
  const t = NL.computeTargets(NL.DEFAULT_PROFILE);
  assert.equal(NL.status('iron', 18, t.iron).state, 'met');
  assert.equal(NL.status('iron', 13, t.iron).state, 'near');
  assert.equal(NL.status('iron', 5, t.iron).state, 'low');
  assert.equal(NL.status('iron', 50, t.iron).state, 'over');
  assert.equal(NL.status('sodium', 2000, t.sodium).state, 'met');
  assert.equal(NL.status('sodium', 2400, t.sodium).state, 'over');
  const k = t.kcal.target;
  assert.equal(NL.status('kcal', k * 1.05, t.kcal).state, 'met');
  assert.equal(NL.status('kcal', k * 0.85, t.kcal).state, 'near');
  assert.equal(NL.status('kcal', k * 1.3, t.kcal).state, 'over');
  assert.equal(NL.status('kcal', k * 0.5, t.kcal).state, 'low');
  assert.equal(NL.status('sugar', 80, t.sugar).state, 'info');
});

test('parseAmount handles digits, fractions, unicode and words', () => {
  assert.equal(NL.parseAmount('2 eggs').value, 2);
  assert.equal(NL.parseAmount('1/2 cup').value, 0.5);
  assert.equal(NL.parseAmount('1 1/2 cups').value, 1.5);
  assert.equal(NL.parseAmount('½ avocado').value, 0.5);
  assert.equal(NL.parseAmount('1½ cups').value, 1.5);
  assert.equal(NL.parseAmount('a banana').value, 1);
  assert.equal(NL.parseAmount('two slices').value, 2);
  assert.equal(NL.parseAmount('half an apple').value, 0.5);
  assert.equal(NL.parseAmount('a couple of eggs').value, 2);
  assert.equal(NL.parseAmount('oatmeal').value, null);
});

test('parseMeal turns a sentence into foods and grams', () => {
  const items = NL.parseMeal('2 eggs, 1 cup oatmeal and a banana; 8 oz salmon + 2 tbsp peanut butter, 100g rice', db);
  const got = items.map((i) => [i.food && i.food.name, i.grams]);
  assert.deepEqual(got, [
    ['Egg, whole, boiled or poached', 100], // 2 × 1 egg (50 g)
    ['Oatmeal', 240], // 1 cup
    ['Banana, raw', 126], // 1 banana
    ['Fish, salmon, baked or broiled', 226.8], // 8 oz
    ['Peanut butter', 30], // 2 tbsp
    ['Rice, white, cooked, no added fat', 100],
  ]);
});

test('parseMeal reports words it cannot match', () => {
  const items = NL.parseMeal('1 cup qwertyfood', db);
  assert.equal(items.length, 1);
  assert.equal(items[0].food, null);
});

test('splitItems keeps intent words out of food names', () => {
  assert.deepEqual(NL.splitItems('I had 2 eggs with toast'), ['2 eggs', 'toast']);
});

test('gramsPerUnit derives tbsp/tsp from cups when needed', () => {
  const oil = db.get(4053); // olive oil: 1 tbsp 13.5 g, 1 cup 216 g
  close(NL.gramsPerUnit(oil, 'tbsp'), 13.5);
  close(NL.gramsPerUnit(oil, 'tsp'), 4.5);
  close(NL.gramsPerUnit(db.get(9040), 'g'), 1);
});

test('scale and sumEntries add up nutrients', () => {
  const entries = [{ src: 'sr', fid: 9040, grams: 118 }, { src: 'sr', fid: 9040, grams: 118 }];
  const { totals } = NL.sumEntries(entries, (e) => db.get(e.fid));
  close(totals.kcal, 89 * 2.36);
  close(totals.potassium, 358 * 2.36);
});

test('custom food converts per-serving label values to per 100 g', () => {
  const f = NL.customFood('c1', 'Bar', 50, '1 bar', { kcal: 200, protein: 10, iron: '' });
  assert.equal(f.per100[NL.BY_KEY.kcal.index], 400);
  assert.equal(f.per100[NL.BY_KEY.protein.index], 20);
  assert.equal(f.per100[NL.BY_KEY.iron.index], null);
});

test('recipe nutrients equal the sum of its ingredients', () => {
  const r = NL.recipeFood('r1', 'Banana oats', 2, [{ food: db.get(9040), grams: 118 }, { food: db.get(8121), grams: 234 }]);
  const whole = NL.scale(r.per100, r.portions[1][0]);
  const expected = 89 * 1.18 + db.get(8121).per100[0] * 2.34;
  close(whole[0], expected);
  close(r.portions[0][0], (118 + 234) / 2);
});

test('suggestions for a gap are real foods that cover part of it', () => {
  const s = NL.suggestFoods(db, 'magnesium', 150);
  assert.ok(s.length >= 3);
  for (const x of s) {
    assert.ok(x.amount >= 150 * 0.15);
    assert.notEqual(x.food.group, 'Baby foods');
  }
  assert.ok(s.some((x) => /^Spinach/.test(x.food.name)));
});

test('dates step across month and DST boundaries', () => {
  assert.equal(NL.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(NL.addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(NL.daysBetween('2026-01-01', '2026-12-31'), 364);
});

test('trend averages only logged days and builds weekly buckets', () => {
  const t = NL.computeTargets(NL.DEFAULT_PROFILE);
  const byDate = new Map([
    ['2026-11-16', [{ src: 'sr', fid: 9040, grams: 100 }]],
    ['2026-11-18', [{ src: 'sr', fid: 9040, grams: 300 }]],
  ]);
  const tr = NL.trend(byDate, (e) => db.get(e.fid), t, '2026-11-16', '2026-11-22', 'week');
  assert.equal(tr.logged, 2);
  assert.equal(tr.span, 7);
  close(tr.perNutrient[0].avg, 89 * 2); // (89 + 267) / 2
  assert.equal(tr.buckets.length, 1);
  assert.equal(tr.buckets[0].start, '2026-11-16');
  assert.equal(tr.buckets[0].loggedDays, 2);
});

test('insights call out chronic gaps and unlogged days', () => {
  const t = NL.computeTargets(NL.DEFAULT_PROFILE);
  const entries = NL.sampleEntries(db, '2026-11-21', 28);
  const byDate = new Map();
  for (const e of entries) { if (!byDate.has(e.date)) byDate.set(e.date, []); byDate.get(e.date).push(e); }
  const tr = NL.trend(byDate, (e) => db.get(e.fid), t, '2026-10-25', '2026-11-20', 'day');
  const ins = NL.insights(tr, t);
  assert.ok(ins.some((i) => i.tone === 'low' && i.key === 'vitD'));
  assert.ok(ins.some((i) => i.key === 'kcal'));
});

test('USDA FoodData Central results map onto the app nutrients', () => {
  const f = NL.fromFdc({
    fdcId: 123, description: 'Test bar', dataType: 'Branded', brandOwner: 'ACME FOODS', servingSize: 40, servingSizeUnit: 'g',
    householdServingFullText: '1 bar',
    foodNutrients: [{ nutrientNumber: '208', value: 450 }, { nutrientNumber: '203', value: 20 }, { nutrientNumber: '303', value: 3.6 }],
  });
  assert.equal(f.id, 'fdc_123');
  assert.equal(f.name, 'Test bar (Acme Foods)');
  assert.equal(f.per100[NL.BY_KEY.kcal.index], 450);
  assert.equal(f.per100[NL.BY_KEY.iron.index], 3.6);
  assert.equal(f.per100[NL.BY_KEY.zinc.index], null);
  assert.deepEqual(f.portions[0], [40, '1 serving (1 bar)']);
  const kj = NL.fromFdc({ fdcId: 1, description: 'x', foodNutrients: [{ nutrientNumber: '268', value: 418.4 }] });
  close(kj.per100[0], 100);
});

test('sample data is deterministic and leaves today in progress', () => {
  const a = NL.sampleEntries(db, '2026-11-21', 14);
  const b = NL.sampleEntries(db, '2026-11-21', 14);
  assert.deepEqual(a, b);
  const today = a.filter((e) => e.date === '2026-11-21').map((e) => e.meal);
  assert.ok(today.includes('breakfast') && today.includes('lunch'));
  assert.ok(!today.includes('dinner'));
});

test('everyday steak names find the right beef cut', () => {
  const top = (q) => db.search(q, { limit: 1 })[0];
  assert.match(top('ny strip').name, /^Beef, steak, strip/);
  assert.match(top('new york strip steak').name, /^Beef, steak, strip/);
  assert.match(top('filet mignon').name, /tenderloin/);
  assert.match(top('ribeye').name, /^Beef, steak, ribeye/);
  assert.match(top('t-bone').name, /T-bone/i);
  assert.ok(db.versionsOf(top('ribeye')).some((v) => v.db === 'sr28'), 'detailed USDA cuts are versions of the everyday ribeye');
  assert.match(top('sirloin').name, /^Beef/);
  assert.match(top('pork sirloin').name, /^Pork/, 'naming another animal keeps it');
  assert.match(top('oj').name, /^Orange juice/);
});

test('versions of one food collapse into a single result', () => {
  const res = db.search('ribeye', { limit: 30 });
  const families = res.map((f) => f.family);
  assert.equal(new Set(families).size, families.length, 'no family appears twice');
  const ribeye = res[0];
  const versions = db.versionsOf(ribeye);
  assert.ok(versions.length > 10, 'grades, trims and cooking methods are versions');
  assert.ok(versions.every((v) => v.family === ribeye.family));
});

test('meat defaults to a cooked version', () => {
  for (const q of ['ribeye', 'chicken thigh', 'salmon', 'bacon', 'pork chop']) {
    const f = db.search(q, { limit: 1 })[0];
    assert.ok(f.cooked || f.db === 'fndds', q); // everyday foods are as eaten
  }
});

test('broad words offer "which kind?" choices that all find food', () => {
  assert.deepEqual(db.kindsFor('Steak').map((k) => k[0]).slice(0, 3), ['Ribeye', 'NY strip', 'Filet mignon']);
  assert.equal(db.kindsFor('ribeye'), null);
  for (const word of ['steak', 'beef', 'chicken', 'pork', 'cheese', 'bread', 'rice', 'milk', 'fish', 'beans', 'pasta', 'yogurt', 'potato']) {
    for (const [label, q] of db.kindsFor(word)) assert.ok(db.search(q, { limit: 1 }).length, `${word} → ${label}`);
  }
});

test('typos are corrected, nonsense is not', () => {
  assert.match(db.search('brocoli', { limit: 1 })[0].name, /^Broccoli/);
  assert.equal(db.search('bannana', { limit: 1 })[0].name, 'Banana, raw');
  assert.match(db.search('chiken breast', { limit: 1 })[0].name, /^Chicken breast/);
  assert.equal(db.search('qwertyfood').length, 0);
});

test('splitName separates the food from its version details', () => {
  assert.deepEqual(NL.splitName('Beef, loin, top loin steak, boneless, lip off, separable lean only, trimmed to 0" fat, choice, cooked, grilled'),
    { family: 'Beef, loin, top loin steak', version: 'boneless, lip off, separable lean only, trimmed to 0" fat, choice, cooked, grilled' });
  assert.deepEqual(NL.splitName('Bananas, raw'), { family: 'Bananas', version: 'raw' });
});

test('gap suggestions skip organ meats', () => {
  for (const key of ['vitA', 'b12', 'iron', 'copper']) {
    for (const s of NL.suggestFoods(db, key, 500)) assert.doesNotMatch(s.food.name, /liver|variety meats|giblets/i, key);
  }
});

test('popular foods rank above rare ones', () => {
  const water = db.search('water', { limit: 3 }).map((f) => f.name);
  assert.ok(water.includes('Water, tap') || water.includes('Water, bottled, plain'));
  assert.ok(db.get(63107010).pop > 50);
});

test('everyday foods fill pantothenic acid and manganese from ingredients, or leave them unknown', () => {
  const PI = NL.BY_KEY.panto.index, MI = NL.BY_KEY.manganese.index;
  assert.ok(db.get(63107010).per100[MI] > 0, 'banana manganese estimated');
  const fn = db.foods.filter((f) => f.db === 'fndds');
  assert.ok(fn.every((f) => f.per100[MI] === null || f.per100[MI] >= 0));
  assert.ok(fn.some((f) => f.per100[PI] === null), 'some stay unknown rather than zero');
});
