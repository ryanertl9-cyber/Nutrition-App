/* Simply Nutrition: core logic (no DOM). Runs in the browser (window.NL) and in Node (module.exports). */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Nutrients. Order matches data/foods.json "nutrients".
  // kind: range = aim for a band around the target, min = reach at least the target
  //       (red flag above the Tolerable Upper Intake Level), limit = stay under, info = no target.
  // ---------------------------------------------------------------------------
  const NUTRIENTS = [
    { key: 'kcal', name: 'Calories', unit: 'kcal', cat: 'energy', kind: 'range' },
    { key: 'protein', name: 'Protein', unit: 'g', cat: 'macro', kind: 'min' },
    { key: 'fat', name: 'Fat', unit: 'g', cat: 'macro', kind: 'range' },
    { key: 'carbs', name: 'Carbs', unit: 'g', cat: 'macro', kind: 'range' },
    { key: 'fiber', name: 'Fiber', unit: 'g', cat: 'macro', kind: 'min' },
    { key: 'sugar', name: 'Sugars (total)', unit: 'g', cat: 'limits', kind: 'info' },
    { key: 'satfat', name: 'Saturated fat', unit: 'g', cat: 'limits', kind: 'limit' },
    { key: 'mufa', name: 'Monounsaturated fat', unit: 'g', cat: 'limits', kind: 'info' },
    { key: 'pufa', name: 'Polyunsaturated fat', unit: 'g', cat: 'limits', kind: 'info' },
    { key: 'chol', name: 'Cholesterol', unit: 'mg', cat: 'limits', kind: 'info' },
    { key: 'vitA', name: 'Vitamin A', unit: 'µg', cat: 'vitamin', kind: 'min' },
    { key: 'vitC', name: 'Vitamin C', unit: 'mg', cat: 'vitamin', kind: 'min' },
    { key: 'vitD', name: 'Vitamin D', unit: 'µg', cat: 'vitamin', kind: 'min' },
    { key: 'vitE', name: 'Vitamin E', unit: 'mg', cat: 'vitamin', kind: 'min' },
    { key: 'vitK', name: 'Vitamin K', unit: 'µg', cat: 'vitamin', kind: 'min' },
    { key: 'thiamin', name: 'Thiamin (B1)', unit: 'mg', cat: 'vitamin', kind: 'min' },
    { key: 'riboflavin', name: 'Riboflavin (B2)', unit: 'mg', cat: 'vitamin', kind: 'min' },
    { key: 'niacin', name: 'Niacin (B3)', unit: 'mg', cat: 'vitamin', kind: 'min' },
    { key: 'panto', name: 'Pantothenic acid (B5)', unit: 'mg', cat: 'vitamin', kind: 'min' },
    { key: 'b6', name: 'Vitamin B6', unit: 'mg', cat: 'vitamin', kind: 'min' },
    { key: 'folate', name: 'Folate', unit: 'µg', cat: 'vitamin', kind: 'min' },
    { key: 'b12', name: 'Vitamin B12', unit: 'µg', cat: 'vitamin', kind: 'min' },
    { key: 'choline', name: 'Choline', unit: 'mg', cat: 'vitamin', kind: 'min' },
    { key: 'calcium', name: 'Calcium', unit: 'mg', cat: 'mineral', kind: 'min' },
    { key: 'iron', name: 'Iron', unit: 'mg', cat: 'mineral', kind: 'min' },
    { key: 'magnesium', name: 'Magnesium', unit: 'mg', cat: 'mineral', kind: 'min' },
    { key: 'phosphorus', name: 'Phosphorus', unit: 'mg', cat: 'mineral', kind: 'min' },
    { key: 'potassium', name: 'Potassium', unit: 'mg', cat: 'mineral', kind: 'min' },
    { key: 'sodium', name: 'Sodium', unit: 'mg', cat: 'limits', kind: 'limit' },
    { key: 'zinc', name: 'Zinc', unit: 'mg', cat: 'mineral', kind: 'min' },
    { key: 'copper', name: 'Copper', unit: 'mg', cat: 'mineral', kind: 'min' },
    { key: 'manganese', name: 'Manganese', unit: 'mg', cat: 'mineral', kind: 'min' },
    { key: 'selenium', name: 'Selenium', unit: 'µg', cat: 'mineral', kind: 'min' },
  ];
  const KEYS = NUTRIENTS.map((n) => n.key);
  const BY_KEY = Object.fromEntries(NUTRIENTS.map((n, i) => [n.key, Object.assign({ index: i }, n)]));
  const CATEGORIES = [
    { key: 'energy', name: 'Energy' },
    { key: 'macro', name: 'Macros & fiber' },
    { key: 'vitamin', name: 'Vitamins' },
    { key: 'mineral', name: 'Minerals' },
    { key: 'limits', name: 'Fats, sugar & sodium' },
  ];
  const MEALS = [
    { key: 'breakfast', name: 'Breakfast' },
    { key: 'lunch', name: 'Lunch' },
    { key: 'dinner', name: 'Dinner' },
    { key: 'snacks', name: 'Snacks' },
  ];

  // ---------------------------------------------------------------------------
  // Dietary Reference Intakes (National Academies). RDA or AI; UL where it applies to food.
  // Values: [age band] -> [male, female]. Bands: 14-18, 19-30, 31-50, 51-70, 71+.
  // ULs for magnesium, niacin, folate, vitamin E and preformed vitamin A apply only to
  // supplements/fortificants (or retinol, not carotenoids), so they are not flagged from food.
  // ---------------------------------------------------------------------------
  const BANDS = [14, 19, 31, 51, 71];
  const DRI = {
    vitA: [[900, 700], [900, 700], [900, 700], [900, 700], [900, 700]],
    vitC: [[75, 65], [90, 75], [90, 75], [90, 75], [90, 75]],
    vitD: [[15, 15], [15, 15], [15, 15], [15, 15], [20, 20]],
    vitE: [[15, 15], [15, 15], [15, 15], [15, 15], [15, 15]],
    vitK: [[75, 75], [120, 90], [120, 90], [120, 90], [120, 90]],
    thiamin: [[1.2, 1.0], [1.2, 1.1], [1.2, 1.1], [1.2, 1.1], [1.2, 1.1]],
    riboflavin: [[1.3, 1.0], [1.3, 1.1], [1.3, 1.1], [1.3, 1.1], [1.3, 1.1]],
    niacin: [[16, 14], [16, 14], [16, 14], [16, 14], [16, 14]],
    panto: [[5, 5], [5, 5], [5, 5], [5, 5], [5, 5]],
    b6: [[1.3, 1.2], [1.3, 1.3], [1.3, 1.3], [1.7, 1.5], [1.7, 1.5]],
    folate: [[400, 400], [400, 400], [400, 400], [400, 400], [400, 400]],
    b12: [[2.4, 2.4], [2.4, 2.4], [2.4, 2.4], [2.4, 2.4], [2.4, 2.4]],
    choline: [[550, 400], [550, 425], [550, 425], [550, 425], [550, 425]],
    calcium: [[1300, 1300], [1000, 1000], [1000, 1000], [1000, 1200], [1200, 1200]],
    iron: [[11, 15], [8, 18], [8, 18], [8, 8], [8, 8]],
    magnesium: [[410, 360], [400, 310], [420, 320], [420, 320], [420, 320]],
    phosphorus: [[1250, 1250], [700, 700], [700, 700], [700, 700], [700, 700]],
    potassium: [[3000, 2300], [3400, 2600], [3400, 2600], [3400, 2600], [3400, 2600]],
    zinc: [[11, 9], [11, 8], [11, 8], [11, 8], [11, 8]],
    copper: [[0.89, 0.89], [0.9, 0.9], [0.9, 0.9], [0.9, 0.9], [0.9, 0.9]],
    manganese: [[2.2, 1.6], [2.3, 1.8], [2.3, 1.8], [2.3, 1.8], [2.3, 1.8]],
    selenium: [[55, 55], [55, 55], [55, 55], [55, 55], [55, 55]],
  };
  const UL = {
    vitC: [1800, 2000, 2000, 2000, 2000],
    vitD: [100, 100, 100, 100, 100],
    b6: [80, 100, 100, 100, 100],
    choline: [3000, 3500, 3500, 3500, 3500],
    calcium: [3000, 2500, 2500, 2000, 2000],
    iron: [45, 45, 45, 45, 45],
    phosphorus: [4000, 4000, 4000, 4000, 3000],
    zinc: [34, 40, 40, 40, 40],
    copper: [8, 10, 10, 10, 10],
    manganese: [9, 11, 11, 11, 11],
    selenium: [400, 400, 400, 400, 400],
  };

  const ACTIVITY = [
    { key: 'sedentary', name: 'Mostly sitting', factor: 1.2 },
    { key: 'light', name: 'Lightly active (1–3 workouts/week)', factor: 1.375 },
    { key: 'moderate', name: 'Moderately active (3–5 workouts/week)', factor: 1.55 },
    { key: 'active', name: 'Very active (6–7 workouts/week)', factor: 1.725 },
    { key: 'athlete', name: 'Athlete or physical job', factor: 1.9 },
  ];
  const GOALS = [
    { key: 'lose', name: 'Lose weight (about 0.5 kg / 1 lb a week)', kcalDelta: -500, proteinPerKg: 1.6 },
    { key: 'maintain', name: 'Maintain weight', kcalDelta: 0, proteinPerKg: 1.2 },
    { key: 'gain', name: 'Build muscle (slow gain)', kcalDelta: 300, proteinPerKg: 1.8 },
  ];

  const DEFAULT_PROFILE = { sex: 'female', age: 34, heightCm: 165, weightKg: 63, activity: 'moderate', goal: 'maintain' };

  function band(age) {
    let i = 0;
    for (let b = 0; b < BANDS.length; b++) if (age >= BANDS[b]) i = b;
    return i;
  }

  /** Mifflin-St Jeor resting energy × activity factor, adjusted for goal. */
  function energyTarget(p) {
    const s = p.sex === 'male' ? 5 : -161;
    const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + s;
    const act = (ACTIVITY.find((a) => a.key === p.activity) || ACTIVITY[2]).factor;
    const goal = GOALS.find((g) => g.key === p.goal) || GOALS[1];
    const floor = p.sex === 'male' ? 1500 : 1200;
    return { bmr: Math.round(bmr), tdee: Math.round(bmr * act), kcal: Math.max(floor, Math.round((bmr * act + goal.kcalDelta) / 10) * 10) };
  }

  /**
   * Daily targets for a profile. Each target: { target, max, kind, basis }.
   * overrides: { key: { target?, max? } } entered by the user.
   */
  function computeTargets(profile, overrides) {
    const p = Object.assign({}, DEFAULT_PROFILE, profile || {});
    const sexIdx = p.sex === 'male' ? 0 : 1;
    const bi = band(p.age);
    const e = energyTarget(p);
    const goal = GOALS.find((g) => g.key === p.goal) || GOALS[1];
    const kcal = e.kcal;
    const protein = Math.max(0.8 * p.weightKg, goal.proteinPerKg * p.weightKg);
    const fat = (kcal * 0.3) / 9;
    const carbs = Math.max(130, (kcal - protein * 4 - fat * 9) / 4);
    const t = {};
    const set = (key, target, max, basis) => { t[key] = { target, max: max == null ? null : max, kind: BY_KEY[key].kind, basis }; };
    set('kcal', kcal, null, `Resting ${e.bmr} kcal × activity = ${e.tdee} kcal, ${goal.kcalDelta >= 0 ? '+' : ''}${goal.kcalDelta} for your goal`);
    set('protein', round1(protein), null, `${goal.proteinPerKg} g per kg body weight`);
    set('fat', round1(fat), null, '30% of calories');
    set('carbs', round1(carbs), null, 'Remaining calories after protein and fat');
    set('fiber', round1((kcal / 1000) * 14), null, '14 g per 1,000 kcal (Dietary Guidelines)');
    set('satfat', null, round1((kcal * 0.1) / 9), 'Under 10% of calories (Dietary Guidelines)');
    set('sodium', null, 2300, 'Under 2,300 mg (chronic disease risk reduction intake)');
    for (const key of ['sugar', 'mufa', 'pufa', 'chol']) set(key, null, null, 'No daily target; shown for reference');
    for (const key of Object.keys(DRI)) {
      const ul = UL[key] ? UL[key][bi] : null;
      set(key, DRI[key][bi][sexIdx], ul, `DRI for ${p.sex === 'male' ? 'men' : 'women'} ${['14–18', '19–30', '31–50', '51–70', '71+'][bi]}${ul ? `; upper limit ${fmt(ul)} ${BY_KEY[key].unit}` : ''}`);
    }
    for (const [key, o] of Object.entries(overrides || {})) {
      if (!t[key] || !o) continue;
      if (o.target != null && o.target !== '') t[key].target = Number(o.target);
      if (o.max != null && o.max !== '') t[key].max = Number(o.max);
      t[key].custom = true;
      t[key].basis = 'Your custom target';
    }
    return t;
  }

  // ---------------------------------------------------------------------------
  // Status of one nutrient against its target.
  // ---------------------------------------------------------------------------
  const STATES = {
    met: { name: 'Met', rank: 3 },
    near: { name: 'Close', rank: 1 },
    low: { name: 'Low', rank: 0 },
    over: { name: 'Over', rank: 0 },
    info: { name: '', rank: 4 },
  };

  function status(key, value, t) {
    if (!t) return { state: 'info', pct: null };
    const v = value || 0;
    if (t.kind === 'info' || (t.target == null && t.max == null)) return { state: 'info', pct: null };
    if (t.kind === 'limit' || t.target == null) {
      const pct = t.max ? v / t.max : 0;
      return { state: v > t.max ? 'over' : 'met', pct };
    }
    const pct = t.target ? v / t.target : 0;
    if (t.kind === 'range') {
      const tol = key === 'kcal' ? 0.1 : 0.15;
      if (pct > 1 + 2 * tol) return { state: 'over', pct };
      if (pct > 1 + tol) return { state: 'near', pct, over: true };
      if (pct >= 1 - tol) return { state: 'met', pct };
      if (pct >= 1 - 2 * tol) return { state: 'near', pct };
      return { state: 'low', pct };
    }
    if (t.max != null && v > t.max) return { state: 'over', pct };
    if (pct >= 1) return { state: 'met', pct };
    if (pct >= 0.7) return { state: 'near', pct };
    return { state: 'low', pct };
  }

  /** Report for one set of totals: per-nutrient rows plus counts. */
  function report(totals, targets, missing) {
    const rows = NUTRIENTS.map((n) => {
      const t = targets[n.key];
      const s = status(n.key, totals[n.key], t);
      return Object.assign({ key: n.key, name: n.name, unit: n.unit, cat: n.cat, kind: n.kind, value: totals[n.key] || 0, target: t, missing: missing ? missing[n.key] || 0 : 0 }, s);
    });
    const tracked = rows.filter((r) => r.state !== 'info');
    const counts = { met: 0, near: 0, low: 0, over: 0 };
    for (const r of tracked) counts[r.state]++;
    return { rows, counts, total: tracked.length };
  }

  // ---------------------------------------------------------------------------
  // Food database
  // ---------------------------------------------------------------------------
  const BRAND_RE = /\b[A-Z][A-Z'&.]{2,}\b/;
  const VOLUME_RE = /\b(cup|cups|tbsp|tsp|fl oz|oz|g|ml)\b/i;

  function tokenize(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim().split(' ').filter(Boolean);
  }
  function singular(w) {
    if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 4 && /(ches|shes|sses|oes)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
  }

  // Common words → a sensible default USDA food (matches how people describe meals).
  const ALIASES = {
    egg: 1129, 'boiled egg': 1129, 'hard boiled egg': 1129, 'scrambled egg': 1132, 'fried egg': 1129,
    banana: 9040, apple: 9003, orange: 9200, avocado: 9037, spinach: 11457, almond: 12061,
    rice: 20045, 'white rice': 20045, 'chicken breast': 5064, chicken: 5064, salmon: 15237, broccoli: 11091,
    'peanut butter': 16098, blueberry: 9050, strawberry: 9316, 'sweet potato': 11508, lentil: 16070,
    'black bean': 16015, cheddar: 1009, cheese: 1009, 'olive oil': 4053, butter: 1001, pasta: 20121,
    spaghetti: 20121, tomato: 11529, carrot: 11124, quinoa: 20137, tofu: 16426, 'greek yogurt': 1256,
    yogurt: 1256, oatmeal: 8121, porridge: 8121, oat: 8120, toast: 18076, 'whole wheat toast': 18076, 'wheat toast': 18076, 'white toast': 18069, bread: 18075,
    'whole wheat bread': 18075, 'white bread': 18069, milk: 1079, 'whole milk': 1077, coffee: 14209,
    tea: 14355, 'orange juice': 9206, potato: 11674, 'baked potato': 11674, kale: 11233, mushroom: 11260,
    onion: 11282, lettuce: 11251, romaine: 11251, cucumber: 11205, grape: 9132, chickpea: 16057,
    hummus: 16158, 'chia seed': 12006, chia: 12006, flaxseed: 12220, walnut: 12155, cashew: 12087,
    turkey: 5168, tuna: 15121, shrimp: 15151, mozzarella: 1026, 'cottage cheese': 1015, 'soy milk': 16139,
    soymilk: 16139, honey: 19296, sugar: 19335, 'dark chocolate': 19904, pizza: 21224, 'ground beef': 23568,
    burger: 23568, 'hamburger patty': 23568, bagel: 18001, tortilla: 18364, 'corn tortilla': 18363,
    'pork loin': 10023, granola: 8037, cheerio: 8013, bacon: 10862,
  };

  // ---------------------------------------------------------------------------
  // Search helpers: everyday words → USDA wording, versions grouped into one food,
  // "which kind?" chips for broad words, and typo tolerance.
  // ---------------------------------------------------------------------------

  // Whole-query or phrase rewrites, applied before matching. Keys are lowercase phrases.
  const SYNONYMS = [
    [/\b(ny|new york|kansas city) strip( steak)?\b|\bstrip steak\b/g, 'beef short loin top loin steak'],
    [/\bfilet mignon\b|\bfillet mignon\b/g, 'beef tenderloin steak'],
    [/\brib[\s-]?eye( steak)?\b/g, 'beef rib eye'],
    [/\bt[\s-]?bone( steak)?\b/g, 'beef tbone steak'],
    [/\bporterhouse( steak)?\b/g, 'beef porterhouse steak'],
    [/\bskirt( steak)?\b/g, 'beef skirt steak'],
    [/\bflank( steak)?\b/g, 'beef flank steak'],
    [/\btri[\s-]?tip\b/g, 'beef tritip'],
    [/\bbrisket\b/g, 'beef brisket'],
    [/\bshort ?ribs?\b/g, 'beef shortribs'],
    [/\boj\b/g, 'orange juice'],
    [/\bpb\b/g, 'peanut butter'],
    [/\bevoo\b/g, 'olive oil'],
    [/\bmac(aroni)? (and|n|&) cheese\b/g, 'macaroni and cheese'],
    [/\b(french )?fries\b/g, 'potatoes french fried'],
    [/\bbell peppers?\b/g, 'peppers sweet'],
    [/\bgreek yoghurt\b/g, 'greek yogurt'],
    [/\byoghurt\b/g, 'yogurt'],
    [/\bskim milk\b/g, 'milk nonfat'],
    [/\b2% milk\b/g, 'milk reduced fat 2%'],
    [/\bpeanut butter and jelly\b|\bpb ?& ?j\b/g, 'peanut butter'],
  ];
  // Cut names that mean beef unless another animal is named.
  const BEEF_DEFAULT = /\b(sirloin|tenderloin|top loin)\b/;
  const OTHER_ANIMAL = /\b(beef|pork|veal|lamb|chicken|turkey|bison|deer|venison|game|fish|tuna|salmon)\b/;

  // Broad words get a row of "which kind?" choices: [label, query].
  const KINDS = {
    steak: [['Ribeye', 'ribeye'], ['NY strip', 'ny strip'], ['Filet mignon', 'filet mignon'], ['Sirloin', 'beef top sirloin steak'], ['T-bone', 't-bone'], ['Porterhouse', 'porterhouse'], ['Flank', 'flank steak'], ['Skirt', 'beef outside skirt steak']],
    beef: [['Ground beef', 'ground beef'], ['Steak', 'steak'], ['Rib roast', 'beef rib roast'], ['Brisket', 'beef brisket flat half'], ['Short ribs', 'short ribs'], ['Jerky', 'beef jerky']],
    chicken: [['Breast', 'chicken breast'], ['Thigh', 'chicken thigh'], ['Drumstick', 'chicken drumstick'], ['Wing', 'chicken wing'], ['Ground', 'ground chicken'], ['Nuggets', 'chicken nuggets']],
    pork: [['Chop', 'pork chop'], ['Tenderloin', 'pork tenderloin'], ['Bacon', 'pork cured bacon cooked'], ['Ham', 'ham sliced'], ['Ground', 'ground pork'], ['Ribs', 'pork spareribs']],
    cheese: [['Cheddar', 'cheddar'], ['Mozzarella', 'mozzarella'], ['Swiss', 'swiss cheese'], ['Parmesan', 'cheese parmesan grated'], ['Feta', 'feta'], ['Cottage', 'cottage cheese'], ['Cream cheese', 'cream cheese'], ['American', 'cheese pasteurized process american']],
    bread: [['Whole wheat', 'whole wheat bread'], ['White', 'white bread'], ['Multigrain', 'multi-grain bread'], ['Rye', 'rye bread'], ['Sourdough', 'sourdough'], ['Bagel', 'bagel'], ['English muffin', 'english muffin'], ['Tortilla', 'tortilla']],
    rice: [['White', 'white rice'], ['Brown', 'brown rice'], ['Wild', 'wild rice'], ['Fried', 'fried rice']],
    milk: [['2%', '2% milk'], ['Whole', 'whole milk'], ['Skim', 'skim milk'], ['1%', 'milk lowfat 1%'], ['Almond', 'almond milk'], ['Soy', 'soymilk'], ['Chocolate', 'milk chocolate fluid reduced fat']],
    fish: [['Salmon', 'salmon'], ['Tuna', 'tuna'], ['Cod', 'cod'], ['Tilapia', 'tilapia'], ['Halibut', 'halibut cooked'], ['Trout', 'trout rainbow cooked'], ['Shrimp', 'shrimp']],
    beans: [['Black', 'black beans'], ['Pinto', 'pinto beans'], ['Kidney', 'kidney beans red cooked'], ['Chickpeas', 'chickpeas'], ['Lentils', 'lentils'], ['Baked', 'beans baked canned plain']],
    pasta: [['Spaghetti', 'spaghetti'], ['Whole wheat', 'whole-wheat pasta cooked'], ['Macaroni & cheese', 'mac and cheese'], ['Egg noodles', 'egg noodles']],
    yogurt: [['Greek, plain', 'greek yogurt plain'], ['Greek, vanilla', 'greek yogurt vanilla'], ['Plain', 'yogurt plain lowfat'], ['Fruit', 'yogurt fruit']],
    potato: [['Baked', 'baked potato'], ['Mashed', 'mashed potatoes'], ['Fries', 'french fries'], ['Sweet potato', 'sweet potato'], ['Hash browns', 'hash brown']],
  };
  KINDS.steaks = KINDS.steak; KINDS.potatoes = KINDS.potato; KINDS.noodles = KINDS.pasta;

  // Comma-separated parts of a USDA name that describe a version of the same food, not a different food.
  const VERSION_PART = new RegExp('^(' + [
    'separable lean (only|and fat)', 'lean only', 'lean and fat', 'meat only', 'meat and skin', 'trimmed to .*fat',
    'choice', 'select', 'prime', 'all grades', 'usda (choice|select|prime)', 'raw', 'cooked', 'boneless', 'bone-in',
    'lip[- ]?off', 'lip[- ]?on', 'with(out)? added solution', 'drained', 'drained solids', 'with(out)? salt', 'unheated', 'heated',
    'fresh', 'frozen', 'canned', 'unprepared', 'prepared', 'regular pack',
    '(pan-)?(broiled|fried|grilled|roasted|braised|stewed|baked|boiled|simmered|steamed|microwaved|poached|scrambled|hard-boiled|pan-browned)',
    'batter', 'flour', 'dry heat', 'moist heat', 'fried in .*', 'grilled .*', 'crumbles', 'patty', 'loaf',
  ].join('|') + ')$', 'i');
  const COOKED_FIRST = new Set(['Poultry', 'Pork', 'Beef', 'Fish & shellfish', 'Lamb, veal & game', 'Legumes', 'Grains & pasta', 'Sausages & deli meats']);

  function splitName(name) {
    const parts = name.split(/,\s*/);
    const keep = [], version = [];
    parts.forEach((p, i) => { (i > 0 && VERSION_PART.test(p.trim()) ? version : keep).push(p.trim()); });
    return { family: keep.join(', '), version: version.join(', ') };
  }

  /** Optimal string alignment distance (insert, delete, substitute, swap neighbours); stops early past max. */
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev2 = null;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (prev2 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev;
      prev = cur;
    }
    return prev[b.length];
  }

  class FoodDB {
    constructor(data) {
      this.source = data.source;
      this.groups = data.groups;
      if (data.nutrients.join() !== KEYS.join()) throw new Error('Food data nutrient order does not match the app');
      this.foods = data.foods.map((f) => ({
        id: f[0], src: 'sr', name: f[1], group: data.groups[f[2]], survey: !!f[3], common: f[4], per100: f[5], portions: f[6],
      }));
      this.byId = new Map(this.foods.map((f) => [f.id, f]));
      this.families = new Map();
      this.vocab = new Map();
      for (const f of this.foods) {
        // Hyphenated words are also indexed joined ("t-bone" → "tbone") so they can be searched as one word.
        const joined = ((f.name + ' ' + f.common).match(/[a-z0-9]+(?:-[a-z0-9]+)+/gi) || []).map((w) => w.replace(/-/g, '').toLowerCase());
        f.tokens = tokenize(f.name + ' ' + f.common).concat(joined);
        f.lower = f.name.toLowerCase();
        f.branded = BRAND_RE.test(f.name);
        const sp = splitName(f.name);
        f.family = f.group + '|' + sp.family.toLowerCase();
        f.familyName = sp.family;
        f.version = sp.version;
        f.cooked = /\bcooked\b|\b(broiled|grilled|roasted|braised|stewed|baked|boiled|fried|simmered|steamed|poached|scrambled|hard-boiled)\b/.test(f.lower);
        if (!this.families.has(f.family)) this.families.set(f.family, []);
        this.families.get(f.family).push(f);
        for (const t of new Set(f.tokens)) this.vocab.set(t, (this.vocab.get(t) || 0) + 1);
      }
      // Default order of versions inside a family: the most typical version first.
      for (const list of this.families.values()) list.sort((a, b) => this.baseScore(b) - this.baseScore(a));
    }
    get(id) { return this.byId.get(Number(id)); }
    /** All versions of a food (itself included), most typical first. */
    versionsOf(food) { return (food && food.family && this.families.get(food.family)) || (food ? [food] : []); }
    aliasFor(term) {
      const words = tokenize(term).map(singular).join(' ');
      return ALIASES[words] ? this.get(ALIASES[words]) : null;
    }
    /** "Which kind?" choices for broad words like "steak" or "cheese". */
    kindsFor(query) {
      const k = tokenize(query).join(' ');
      return KINDS[k] || KINDS[singular(k)] || null;
    }
    /** Rewrite everyday wording into USDA wording. Returns the query to match. */
    rewrite(query) {
      let q = ' ' + String(query).toLowerCase().trim() + ' ';
      for (const [re, rep] of SYNONYMS) q = q.replace(re, rep);
      if (BEEF_DEFAULT.test(q) && !OTHER_ANIMAL.test(q)) q = 'beef ' + q;
      if (/^\s*steaks?\s*$/.test(q)) q = 'beef steak';
      return q.replace(/\s+/g, ' ').trim();
    }
    /** Correct a word that matches nothing ("brocoli" → "broccoli"). */
    correct(word) {
      for (const t of this.vocab.keys()) if (t.startsWith(word)) return word;
      if (word.length < 4) return word;
      const max = word.length >= 7 ? 2 : 1;
      let best = null, bestD = max + 1, bestN = 0;
      for (const [t, n] of this.vocab) {
        if (t[0] !== word[0] || t.length < 3) continue;
        // Compare with the whole word, and with its start for words still being typed.
        const d = Math.min(editDistance(word, t, max), t.length > word.length ? editDistance(word, t.slice(0, word.length), max) : max + 1);
        if (d > max) continue;
        if (d < bestD || (d === bestD && n > bestN)) { best = t; bestD = d; bestN = n; }
      }
      return best || word;
    }
    /** Score that doesn't depend on the query: how typical/everyday a food is. */
    baseScore(f) {
      let s = 0;
      if (f.survey) s += 4;
      if (f.group === 'Baby foods') s -= 12;
      if (f.group === 'Fast food' || f.group === 'Restaurant foods') s -= 3;
      if (f.branded) s -= 2;
      if (/\braw\b/.test(f.lower) && (f.group === 'Fruits' || f.group === 'Vegetables')) s += 1.5;
      if (COOKED_FIRST.has(f.group)) s += f.cooked ? 3 : -2; // people log meat, fish, grains and beans cooked
      if (/\ball grades\b/.test(f.lower)) s += 0.6; else if (/\bchoice\b/.test(f.lower)) s += 0.3;
      if (/\blean and fat\b/.test(f.lower)) s += 0.3;
      if (/\btrimmed to 1\/8"/.test(f.lower)) s += 0.2;
      if (/\bwithout salt\b/.test(f.lower)) s += 0.1;
      s -= f.tokens.length * 0.35;
      return s;
    }
    /**
     * Search. Returns one food per family (its best-matching version); use versionsOf() for the rest.
     * usage: Map(fid -> times logged) boosts foods the person eats often.
     */
    search(query, opts) {
      const o = Object.assign({ limit: 30, usage: null, group: true }, opts);
      const rewritten = this.rewrite(query);
      let q = tokenize(rewritten);
      if (!q.length) return [];
      q = q.map((w) => this.correct(w));
      const qs = q.map(singular);
      const alias = this.aliasFor(query) || this.aliasFor(q.join(' '));
      const wantsBaby = q.includes('baby') || q.includes('babyfood');
      const phrase = q.join(' ');
      const best = new Map();
      for (const f of this.foods) {
        let ok = true;
        for (let i = 0; i < q.length && ok; i++) {
          const a = q[i], b = qs[i];
          ok = f.tokens.some((t) => t.startsWith(a) || t.startsWith(b));
        }
        if (!ok) continue;
        let s = this.baseScore(f);
        if (f.group === 'Baby foods' && wantsBaby) s += 12;
        if (f.tokens[0].startsWith(qs[0])) s += 6;
        if (f.lower.startsWith(phrase)) s += 3;
        for (let i = 0; i < q.length; i++) if (f.tokens.includes(q[i]) || f.tokens.includes(qs[i])) s += 0.8; // whole-word matches beat prefixes
        if (f.familyName.toLowerCase().replace(/[^a-z0-9% ]+/g, ' ').replace(/\s+/g, ' ').trim() === phrase) s += 4;
        if (o.usage && o.usage.get(f.id)) s += Math.min(14, 3 * Math.log2(1 + o.usage.get(f.id)));
        if (alias && alias.id === f.id) s += 12;
        const key = o.group ? f.family : f.id;
        const cur = best.get(key);
        if (!cur || s > cur[0] || (s === cur[0] && f.name.length < cur[1].name.length)) best.set(key, [s, f]);
      }
      const scored = [...best.values()];
      scored.sort((x, y) => y[0] - x[0] || x[1].name.length - y[1].name.length);
      return scored.slice(0, o.limit).map((x) => x[1]);
    }
  }

  /** Portion choices for a food: household measures first, then weight units. */
  function portionsFor(food) {
    const list = (food.portions || []).map(([g, label]) => ({ label, grams: g }));
    list.push({ label: 'g', grams: 1 }, { label: 'oz', grams: 28.35 });
    return list;
  }

  /** Nutrient vector for `grams` of a food given per-100 g values (null stays null = unknown). */
  function scale(per100, grams) {
    const f = grams / 100;
    return per100.map((v) => (v == null ? null : v * f));
  }

  /** Sum entries into totals. resolve(entry) -> { per100 } or null. */
  function sumEntries(entries, resolve) {
    const totals = {};
    const missing = {};
    for (const k of KEYS) { totals[k] = 0; missing[k] = 0; }
    for (const e of entries) {
      const food = resolve(e);
      if (!food) continue;
      const v = scale(food.per100, e.grams);
      for (let i = 0; i < KEYS.length; i++) {
        if (v[i] == null) missing[KEYS[i]]++;
        else totals[KEYS[i]] += v[i];
      }
    }
    return { totals, missing };
  }

  /** Foods that contributed most to one nutrient. */
  function contributors(entries, resolve, key, limit) {
    const i = BY_KEY[key].index;
    const rows = [];
    for (const e of entries) {
      const f = resolve(e);
      if (!f || f.per100[i] == null) continue;
      rows.push({ entry: e, amount: (f.per100[i] * e.grams) / 100 });
    }
    rows.sort((a, b) => b.amount - a.amount);
    return rows.slice(0, limit || 5);
  }

  // ---------------------------------------------------------------------------
  // Gap-closing suggestions: nutrient-dense everyday foods for a nutrient you're short on.
  // ---------------------------------------------------------------------------
  const SUGGEST_EXCLUDE = new Set(['Soups & sauces', 'Baby foods', 'Spices & herbs', 'Fast food', 'Restaurant foods', 'Sweets', 'Snacks', 'Fats & oils', 'Breakfast cereals', 'Traditional foods']);
  const ANIMAL = new Set(['Poultry', 'Pork', 'Beef', 'Fish & shellfish', 'Lamb, veal & game', 'Sausages & deli meats']);
  const EVERYDAY = new Set(Object.values(ALIASES));
  function suggestFoods(db, key, gap, opts) {
    const o = Object.assign({ limit: 6, usage: null }, opts);
    const i = BY_KEY[key].index;
    const ki = BY_KEY.kcal.index;
    const seen = new Set();
    const cands = [];
    for (const f of db.foods) {
      if (!f.survey || f.branded || SUGGEST_EXCLUDE.has(f.group)) continue;
      if (/\b(crude|dehydrated|powder|dry|dried|unprepared|frozen|flour|pickled|yolk|giblets|liver|variety meats|by-products|sauce|curd cheese|natto|nopales|bran)\b/.test(f.lower)) continue;
      if (/\braw\b/.test(f.lower) && (ANIMAL.has(f.group) || f.group === 'Legumes' || f.group === 'Grains & pasta')) continue;
      if (/\bmature seeds\b/.test(f.lower) && !/\bcooked|canned\b/.test(f.lower)) continue;
      if (/^mollusks|^game meat/.test(f.lower)) continue;
      const v = f.per100[i];
      const kcal = f.per100[ki];
      if (!v || !kcal || kcal < 15) continue;
      let portion = (f.portions || []).find((p) => p[0] >= 20 && p[0] <= 350);
      if (!portion) continue;
      // Calorie-dense foods (nuts, seeds, cheese): suggest a 1 oz handful instead of a cup.
      if ((kcal * portion[0]) / 100 > 350) portion = (f.portions || []).find((p) => /\boz\b/.test(p[1]) && p[0] <= 60) || [28.35, '1 oz'];
      const amount = (v * portion[0]) / 100;
      const pkcal = (kcal * portion[0]) / 100;
      const share = gap > 0 ? amount / gap : 0;
      if (share < 0.15) continue;
      let score = Math.log(1 + amount / Math.max(pkcal, 40)) * 10 + Math.min(share, 1) * 4;
      if (o.usage && o.usage.get(f.id)) score += 3;
      if (EVERYDAY.has(f.id)) score += 2;
      cands.push({ food: f, portion: { label: portion[1], grams: portion[0] }, amount, kcal: pkcal, share, score });
    }
    cands.sort((a, b) => b.score - a.score);
    const out = [];
    for (const c of cands) {
      const k = c.food.tokens[0] === 'fish' ? c.food.tokens.slice(0, 2).join(' ') : c.food.tokens[0];
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
      if (out.length >= o.limit) break;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Natural-language meal parsing: "2 eggs, 1 cup oatmeal and a banana".
  // ---------------------------------------------------------------------------
  const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, half: 0.5, couple: 2, few: 3, dozen: 12 };
  const UNIT_WORDS = {
    g: ['g', 'gram', 'grams', 'gr'], kg: ['kg', 'kilo', 'kilos', 'kilogram', 'kilograms'],
    oz: ['oz', 'ounce', 'ounces'], lb: ['lb', 'lbs', 'pound', 'pounds'], ml: ['ml', 'milliliter', 'milliliters'],
    floz: ['fl oz', 'fluid ounce', 'fluid ounces'], cup: ['cup', 'cups', 'mug', 'mugs', 'glass', 'glasses', 'bowl', 'bowls'],
    tbsp: ['tbsp', 'tbs', 'tablespoon', 'tablespoons', 'tbl'], tsp: ['tsp', 'teaspoon', 'teaspoons'],
    slice: ['slice', 'slices'], piece: ['piece', 'pieces', 'pc', 'pcs'], large: ['large', 'big'],
    medium: ['medium'], small: ['small'], serving: ['serving', 'servings', 'portion', 'portions'],
  };
  const UNIT_LOOKUP = [];
  for (const [u, words] of Object.entries(UNIT_WORDS)) for (const w of words) UNIT_LOOKUP.push([w, u]);
  UNIT_LOOKUP.sort((a, b) => b[0].length - a[0].length);

  function parseAmount(s) {
    s = s.trim();
    const uni = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
    let m = s.match(/^(\d+)\s*([½¼¾⅓⅔])/);
    if (m) return { value: Number(m[1]) + uni[m[2]], rest: s.slice(m[0].length) };
    m = s.match(/^([½¼¾⅓⅔])/);
    if (m) return { value: uni[m[1]], rest: s.slice(1) };
    m = s.match(/^(\d+)\s+(\d+)\/(\d+)/);
    if (m) return { value: Number(m[1]) + Number(m[2]) / Number(m[3]), rest: s.slice(m[0].length) };
    m = s.match(/^(\d+)\/(\d+)/);
    if (m) return { value: Number(m[1]) / Number(m[2]), rest: s.slice(m[0].length) };
    m = s.match(/^(\d*\.?\d+)/);
    if (m) return { value: Number(m[1]), rest: s.slice(m[0].length) };
    m = s.toLowerCase().match(/^(a couple of|a few|half an?|half|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple of|few|dozen)\b/);
    if (m) {
      const w = m[1].replace(/ of$/, '').replace(/^a (couple|few)$/, '$1').replace(/^half an?$/, 'half');
      return { value: NUMBER_WORDS[w], rest: s.slice(m[0].length) };
    }
    return { value: null, rest: s };
  }

  function leadingNumber(label) {
    const m = String(label).match(/^\s*(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)/);
    if (!m) return 1;
    const t = m[1].trim();
    if (t.includes(' ')) { const [w, fr] = t.split(/\s+/); const [a, b] = fr.split('/'); return Number(w) + a / b; }
    if (t.includes('/')) { const [a, b] = t.split('/'); return a / b; }
    return Number(t) || 1;
  }

  /** Grams for one `unit` of a food, using its household portions where possible. */
  function gramsPerUnit(food, unit) {
    const ps = food.portions || [];
    const find = (re) => { const p = ps.find((x) => re.test(x[1])); return p ? p[0] / leadingNumber(p[1]) : null; };
    switch (unit) {
      case 'g': return 1;
      case 'kg': return 1000;
      case 'oz': return 28.35;
      case 'lb': return 453.6;
      case 'ml': { const c = find(/\bcup\b/); return c ? c / 236.6 : 1; }
      case 'floz': { const c = find(/\bcup\b/); return c ? c / 8 : 29.6; }
      case 'cup': return find(/\bcup\b/) || (find(/\btbsp\b/) || 0) * 16 || (find(/\btsp\b/) || 0) * 48 || 240;
      case 'tbsp': return find(/\btbsp\b/) || (find(/\bcup\b/) || 0) / 16 || (find(/\btsp\b/) || 0) * 3 || 15;
      case 'tsp': return find(/\btsp\b/) || (find(/\btbsp\b/) || 0) / 3 || (find(/\bcup\b/) || 0) / 48 || 5;
      case 'slice': return find(/\bslice\b/) || find(/\bpiece\b/) || defaultUnit(food).grams;
      case 'piece': return find(/\bpiece\b/) || defaultUnit(food).grams;
      case 'large': return find(/\blarge\b/) || (find(/\bmedium\b/) || 0) * 1.25 || defaultUnit(food).grams;
      case 'medium': return find(/\bmedium\b/) || defaultUnit(food).grams;
      case 'small': return find(/\bsmall\b/) || (find(/\bmedium\b/) || 0) * 0.75 || defaultUnit(food).grams;
      default: return defaultUnit(food).grams;
    }
  }

  /** The portion a bare count ("2 eggs") most likely means. */
  function defaultUnit(food) {
    const ps = food.portions || [];
    const count = ps.find((p) => !VOLUME_RE.test(p[1]));
    const p = count || ps[0];
    if (!p) return { label: '100 g', grams: 100 };
    return { label: p[1], grams: p[0] / leadingNumber(p[1]) };
  }

  function splitItems(text) {
    return String(text)
      .split(/\n|,|;|\+|\s+&\s+|\band\b|\bwith\b|\bplus\b/i)
      .map((s) => s.trim().replace(/^(i had|i ate|had|ate|for (breakfast|lunch|dinner|snack)s?:?)\s+/i, '').trim())
      .filter((s) => s && /[a-z]/i.test(s));
  }

  /**
   * Parse free text into candidate log items.
   * Returns [{ text, qty, unit, unitLabel, term, food, grams, alternatives }]; food is null when nothing matched.
   */
  function parseMeal(text, db, opts) {
    const items = [];
    for (const raw of splitItems(text)) {
      let { value, rest } = parseAmount(raw);
      rest = rest.trim();
      let unit = null;
      const low = rest.toLowerCase();
      for (const [w, u] of UNIT_LOOKUP) {
        const re = new RegExp('^' + w.replace(/ /g, '\\s+') + '\\b\\.?\\s*(of\\s+)?', 'i');
        const m = low.match(re);
        if (m) { unit = u; rest = rest.slice(m[0].length); break; }
      }
      // "100g chicken" (no space)
      if (!unit) {
        const m = rest.match(/^(g|kg|oz|ml|lb)\b\s*/i);
        if (m) { unit = m[1].toLowerCase(); rest = rest.slice(m[0].length); }
      }
      const term = rest.replace(/^of\s+/i, '').trim();
      if (!term) continue;
      const qty = value == null ? 1 : value;
      const results = db.search(term, { limit: 4, usage: opts && opts.usage });
      const food = results[0] || null;
      let grams = null, unitLabel = '';
      if (food) {
        if (unit) {
          grams = qty * gramsPerUnit(food, unit);
          unitLabel = { floz: 'fl oz' }[unit] || unit;
        } else {
          const d = defaultUnit(food);
          grams = qty * d.grams;
          unitLabel = d.label.replace(/^\s*[\d./ ]+\s*/, '') || d.label;
        }
        grams = Math.round(grams * 10) / 10;
      }
      items.push({ text: raw, qty, unit, unitLabel, term, food, grams, alternatives: results.slice(1) });
    }
    return items;
  }

  // ---------------------------------------------------------------------------
  // Dates (local calendar days as YYYY-MM-DD)
  // ---------------------------------------------------------------------------
  function ymd(d) {
    const z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }
  function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
  function daysBetween(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 86400000); }

  // ---------------------------------------------------------------------------
  // Trends over weeks and months.
  // ---------------------------------------------------------------------------
  /**
   * Summarize a date range. byDate: Map(date -> entries[]). Days with no entries are "unlogged"
   * and excluded from averages so a skipped day doesn't read as a nutrient deficit.
   * bucket: 'day' or 'week' (Monday-start weeks averaged over logged days).
   */
  function trend(byDate, resolve, targets, start, end, bucket) {
    const days = [];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const entries = byDate.get(d) || [];
      if (!entries.length) { days.push({ date: d, logged: false }); continue; }
      const { totals, missing } = sumEntries(entries, resolve);
      const rep = report(totals, targets, missing);
      days.push({ date: d, logged: true, totals, report: rep });
    }
    const logged = days.filter((d) => d.logged);
    const perNutrient = NUTRIENTS.map((n) => {
      let sum = 0, met = 0;
      const states = { met: 0, near: 0, low: 0, over: 0 };
      for (const d of logged) {
        sum += d.totals[n.key];
        const r = d.report.rows[BY_KEY[n.key].index];
        if (r.state !== 'info') states[r.state]++;
        if (r.state === 'met') met++;
      }
      const avg = logged.length ? sum / logged.length : 0;
      const s = status(n.key, avg, targets[n.key]);
      return Object.assign({ key: n.key, name: n.name, unit: n.unit, cat: n.cat, kind: n.kind, avg, metDays: met, states, adherence: logged.length ? met / logged.length : 0 }, s);
    });
    let buckets;
    if (bucket === 'week') {
      const map = new Map();
      for (const d of days) {
        const dt = parseYmd(d.date);
        const monday = addDays(d.date, -((dt.getDay() + 6) % 7));
        if (!map.has(monday)) map.set(monday, []);
        map.get(monday).push(d);
      }
      buckets = [...map.entries()].map(([wk, ds]) => {
        const lg = ds.filter((d) => d.logged);
        const totals = {};
        for (const k of KEYS) totals[k] = lg.length ? lg.reduce((a, d) => a + d.totals[k], 0) / lg.length : 0;
        return { label: wk, start: wk, logged: lg.length > 0, loggedDays: lg.length, totals, report: lg.length ? report(totals, targets) : null };
      });
    } else {
      buckets = days.map((d) => ({ label: d.date, start: d.date, logged: d.logged, loggedDays: d.logged ? 1 : 0, totals: d.totals, report: d.report || null }));
    }
    const avgMet = logged.length ? logged.reduce((a, d) => a + d.report.counts.met, 0) / logged.length : 0;
    const total = logged.length ? logged[0].report.total : report({}, targets).total;
    return { days, logged: logged.length, span: days.length, perNutrient, buckets, avgMet, total };
  }

  /** Plain-language observations from a trend. */
  function insights(tr, targets) {
    const out = [];
    if (tr.logged < 2) return out;
    const n = tr.logged;
    const tracked = tr.perNutrient.filter((p) => p.state !== 'info' && targets[p.key] && targets[p.key].target != null && p.cat !== 'energy');
    // "Short" means under target: low or close-but-under days. Range nutrients only count when the average is clearly under.
    const misses = tracked.filter((p) => p.kind === 'min' || (p.kind === 'range' && p.pct < 0.85))
      .map((p) => ({ p, missed: p.states.low + p.states.near })).filter((x) => x.missed / n >= 0.6).sort((a, b) => a.p.adherence - b.p.adherence);
    for (const { p, missed } of misses.slice(0, 3)) {
      out.push({ tone: 'low', key: p.key, text: `${p.name} fell short on ${missed} of ${n} logged days, averaging ${Math.round(p.pct * 100)}% of your target.` });
    }
    for (const p of tr.perNutrient.filter((p) => p.kind === 'limit' && p.states.over / n >= 0.3)) {
      out.push({ tone: 'over', key: p.key, text: `${p.name} went over your limit on ${p.states.over} of ${n} logged days (average ${fmt(p.avg)} ${p.unit}).` });
    }
    const strong = tracked.filter((p) => p.adherence >= 0.85).sort((a, b) => b.adherence - a.adherence);
    if (strong.length) out.push({ tone: 'met', text: `Consistently met: ${strong.slice(0, 5).map((p) => p.name).join(', ')}${strong.length > 5 ? ` and ${strong.length - 5} more` : ''}.` });
    const kc = tr.perNutrient[BY_KEY.kcal.index];
    if (targets.kcal && targets.kcal.target) {
      const diff = Math.round(kc.avg - targets.kcal.target);
      out.push({ tone: Math.abs(diff) <= targets.kcal.target * 0.1 ? 'met' : 'near', key: 'kcal', text: `Calories averaged ${fmt(kc.avg)} kcal, ${Math.abs(diff)} ${diff >= 0 ? 'above' : 'below'} your ${fmt(targets.kcal.target)} kcal target.` });
    }
    if (tr.logged < tr.span) out.push({ tone: 'info', text: `${tr.span - tr.logged} of ${tr.span} days have no entries and are left out of the averages.` });
    return out;
  }

  // ---------------------------------------------------------------------------
  // USDA FoodData Central (live search) → app food shape.
  // ---------------------------------------------------------------------------
  const FDC_NUMBERS = {
    kcal: ['208', '957', '958'], protein: ['203'], fat: ['204'], carbs: ['205'], fiber: ['291'], sugar: ['269', '2000'],
    satfat: ['606'], mufa: ['645'], pufa: ['646'], chol: ['601'], vitA: ['320'], vitC: ['401'], vitD: ['328'],
    vitE: ['323'], vitK: ['430'], thiamin: ['404'], riboflavin: ['405'], niacin: ['406'], panto: ['410'], b6: ['415'],
    folate: ['435', '417'], b12: ['418'], choline: ['421'], calcium: ['301'], iron: ['303'], magnesium: ['304'],
    phosphorus: ['305'], potassium: ['306'], sodium: ['307'], zinc: ['309'], copper: ['312'], manganese: ['315'], selenium: ['317'],
  };
  function fromFdc(item) {
    const byNum = new Map();
    for (const n of item.foodNutrients || []) {
      const num = String(n.nutrientNumber || (n.nutrient && n.nutrient.number) || '');
      const val = n.value != null ? n.value : n.amount;
      if (num && val != null && !byNum.has(num)) byNum.set(num, Number(val));
    }
    const per100 = KEYS.map((k) => {
      for (const num of FDC_NUMBERS[k]) if (byNum.has(num)) return byNum.get(num);
      if (k === 'kcal' && byNum.has('268')) return byNum.get('268') / 4.184;
      return null;
    });
    const portions = [];
    if (item.servingSize && /^(g|grm|ml|mlt)$/i.test(item.servingSizeUnit || '')) {
      portions.push([Number(item.servingSize), item.householdServingFullText ? `1 serving (${item.householdServingFullText})` : '1 serving']);
    }
    const brand = item.brandName || item.brandOwner;
    return {
      id: 'fdc_' + item.fdcId, src: 'my', kind: 'usda', fdcId: item.fdcId,
      name: item.description + (brand ? ` (${titleCase(brand)})` : ''), dataType: item.dataType, per100, portions,
    };
  }
  function titleCase(s) { return String(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()); }

  // ---------------------------------------------------------------------------
  // Custom foods and recipes
  // ---------------------------------------------------------------------------
  /** Custom food from label values per serving. values: { key: amount per serving }. */
  function customFood(id, name, servingGrams, servingLabel, values) {
    const f = 100 / servingGrams;
    const per100 = KEYS.map((k) => (values[k] == null || values[k] === '' ? null : Number(values[k]) * f));
    return { id, src: 'my', kind: 'custom', name, per100, portions: [[servingGrams, servingLabel || '1 serving']] };
  }
  /** Recipe from ingredients [{ food, grams }] making `servings` portions. */
  function recipeFood(id, name, servings, ingredients) {
    const totalGrams = ingredients.reduce((a, x) => a + x.grams, 0);
    const per100 = KEYS.map((_, i) => {
      let sum = 0, known = false;
      for (const x of ingredients) {
        const v = x.food.per100[i];
        if (v != null) { sum += (v * x.grams) / 100; known = true; }
      }
      return known && totalGrams ? (sum / totalGrams) * 100 : null;
    });
    return {
      id, src: 'my', kind: 'recipe', name, servings, per100,
      portions: [[round1(totalGrams / servings), '1 serving'], [round1(totalGrams), 'whole recipe']],
      ingredients: ingredients.map((x) => ({ src: x.food.src, fid: x.food.id, name: x.food.name, grams: x.grams, label: x.label || `${x.grams} g` })),
    };
  }

  // ---------------------------------------------------------------------------
  // Example data so a first-time visitor sees a working ledger. Deterministic.
  // ---------------------------------------------------------------------------
  function sampleEntries(db, endDate, days) {
    let seed = 20261121;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const B = [
      [[8121, 234], [9050, 74], [12155, 14], [1079, 122]],
      [[1256, 170], [9316, 72], [8037, 30]],
      [[1132, 122], [18076, 58], [9037, 50], [14209, 237]],
      [[18001, 105], [1009, 28], [9206, 248]],
      [[1129, 100], [18076, 29], [9040, 118], [14209, 237]],
    ];
    const L = [
      [[5064, 120], [16057, 82], [11251, 94], [11529, 90], [4053, 13.5]],
      [[18075, 64], [16098, 32], [9003, 182]],
      [[15121, 100], [20137, 185], [11457, 60], [11205, 104]],
      [[21224, 126], [9200, 131]],
      [[16070, 198], [20045, 158], [11124, 61]],
    ];
    const D = [
      [[15237, 170], [11508, 114], [11091, 156]],
      [[23568, 85], [11674, 173], [11233, 67], [4053, 13.5]],
      [[20121, 210], [16426, 126], [11091, 78], [4053, 13.5]],
      [[5168, 140], [20045, 158], [16015, 172], [11529, 123]],
      [[15151, 113], [20121, 140], [11457, 90], [1001, 14]],
    ];
    const S = [[[12061, 28.35]], [[9132, 92]], [[1015, 113], [9050, 74]], [[19904, 28.35]], [[9040, 118]], [[16158, 30], [11124, 61]]];
    const out = [];
    let n = 0;
    for (let i = days - 1; i >= 0; i--) {
      const date = addDays(endDate, -i);
      if (i > 0 && rnd() < 0.08) continue; // a few unlogged days
      const add = (meal, items) => {
        for (const [fid, g] of items) {
          const f = db.get(fid);
          if (!f) continue;
          const grams = Math.round(g * (1.15 + rnd() * 0.35));
          out.push({ id: 'ex' + n++, date, meal, src: 'sr', fid, name: f.name, grams, qty: grams, unit: 'g', sample: true });
        }
      };
      add('breakfast', pick(B));
      add('lunch', pick(L));
      if (i === 0) continue; // today: breakfast and lunch only, so the day looks in progress
      add('dinner', pick(D));
      add('snacks', pick(S));
      if (rnd() < 0.5) add('snacks', pick(S));
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------
  function round1(v) { return Math.round(v * 10) / 10; }
  function fmt(v) {
    if (v == null || !Number.isFinite(v)) return '–';
    const a = Math.abs(v);
    if (a >= 100) return Math.round(v).toLocaleString('en-US');
    if (a >= 10) return String(Math.round(v * 10) / 10);
    if (a >= 1) return String(Math.round(v * 10) / 10);
    if (a === 0) return '0';
    return String(Math.round(v * 100) / 100);
  }

  const api = {
    NUTRIENTS, KEYS, BY_KEY, CATEGORIES, MEALS, STATES, ACTIVITY, GOALS, DEFAULT_PROFILE, ALIASES,
    energyTarget, computeTargets, status, report, FoodDB, portionsFor, scale, sumEntries, contributors,
    suggestFoods, parseMeal, parseAmount, gramsPerUnit, defaultUnit, splitItems, ymd, parseYmd, addDays,
    daysBetween, trend, insights, fromFdc, customFood, recipeFood, sampleEntries, fmt, round1, tokenize, splitName,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.NL = api;
})(typeof window !== 'undefined' ? window : globalThis);
