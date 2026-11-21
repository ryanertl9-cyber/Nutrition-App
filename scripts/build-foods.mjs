// Builds data/foods.json from USDA National Nutrient Database for Standard Reference,
// Release 28 (public domain; files in vendor/sr28 come from the MIT-licensed
// npm package "fda-nutrient-database"). Run: node scripts/build-foods.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, 'vendor/sr28', f), 'latin1').split(/\r?\n/).filter(Boolean);
const fields = (line) => line.split('^').map((s) => s.replace(/^~|~$/g, ''));

// Column index in ABBREV.txt for each nutrient the app tracks (order = app's nutrient order).
// Must stay in sync with NUTRIENTS in src/core.js.
export const COLUMNS = {
  kcal: 3, protein: 4, fat: 5, carbs: 7, fiber: 8, sugar: 9,
  satfat: 44, mufa: 45, pufa: 46, chol: 47,
  vitA: 33, vitC: 20, vitD: 41, vitE: 40, vitK: 43,
  thiamin: 21, riboflavin: 22, niacin: 23, panto: 24, b6: 25, folate: 29, b12: 31, choline: 30,
  calcium: 10, iron: 11, magnesium: 12, phosphorus: 13, potassium: 14, sodium: 15,
  zinc: 16, copper: 17, manganese: 18, selenium: 19,
};
const KEYS = Object.keys(COLUMNS);

const GROUPS = {
  '0100': 'Dairy & eggs', '0200': 'Spices & herbs', '0300': 'Baby foods', '0400': 'Fats & oils',
  '0500': 'Poultry', '0600': 'Soups & sauces', '0700': 'Sausages & deli meats', '0800': 'Breakfast cereals',
  '0900': 'Fruits', '1000': 'Pork', '1100': 'Vegetables', '1200': 'Nuts & seeds', '1300': 'Beef',
  '1400': 'Beverages', '1500': 'Fish & shellfish', '1600': 'Legumes', '1700': 'Lamb, veal & game',
  '1800': 'Baked goods', '1900': 'Sweets', '2000': 'Grains & pasta', '2100': 'Fast food',
  '2200': 'Meals & entrees', '2500': 'Snacks', '3500': 'Traditional foods', '3600': 'Restaurant foods',
};
// Sorted explicitly: object keys like '1000' are integer-like and would otherwise reorder.
const groupCodes = Object.keys(GROUPS).sort();

// Extra household portions SR28's abbreviated file lacks (grams per unit, from the full SR28 weight table).
const EXTRA_PORTIONS = {
  '01123': [[50, '1 large']], '01129': [[50, '1 large']], '01132': [[61, '1 large']],
  '09040': [[118, '1 medium']], '09003': [[182, '1 medium']], '09200': [[131, '1 fruit']],
  '09037': [[201, '1 avocado'], [30, '1 slice (1/5 avocado)']], '11124': [[61, '1 medium']],
  '11529': [[123, '1 medium']], '11508': [[114, '1 medium']], '11674': [[173, '1 medium']],
  '09316': [[12, '1 medium']], '18075': [[32, '1 slice']], '18076': [[29, '1 slice']], '18069': [[25, '1 slice']],
  '05064': [[172, '1/2 breast']], '15237': [[170, '1 fillet']], '14209': [[237, '1 cup (8 fl oz)']],
  '14355': [[237, '1 cup (8 fl oz)']], '04053': [[13.5, '1 tbsp']], '16098': [[32, '2 tbsp']],
  '12061': [[28.35, '1 oz (23 nuts)']], '01009': [[28.35, '1 oz'], [17, '1 slice']], '01256': [[170, '1 container (6 oz)']],
  '18002': [[71, '1 bagel']], '18001': [[105, '1 bagel']], '23568': [[85, '3 oz patty']], '19296': [[21, '1 tbsp']],
  '19335': [[4.2, '1 tsp']], '19904': [[28.35, '1 oz']], '21224': [[63, '1 slice']], '18363': [[26, '1 tortilla']],
  '18364': [[32, '1 tortilla']], '09132': [[4.9, '1 grape']], '11282': [[110, '1 medium']], '12155': [[28.35, '1 oz (14 halves)']],
};

const des = new Map();
for (const line of read('FOOD_DES.txt')) {
  const f = fields(line);
  des.set(f[0], { group: f[1], name: f[2], common: f[4], survey: f[6] === 'Y' });
}

const round = (v) => {
  if (v === '' || v === undefined) return null; // unknown, not zero
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return 0;
  const a = Math.abs(n);
  const p = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
  return Number(n.toFixed(p));
};

const foods = [];
for (const line of read('ABBREV.txt')) {
  const f = fields(line);
  const id = f[0];
  const d = des.get(id);
  if (!d) throw new Error(`No description for ${id}`);
  const vals = KEYS.map((k) => round(f[COLUMNS[k]]));
  // Folate: prefer DFE, fall back to total folate when DFE is missing.
  const fi = KEYS.indexOf('folate');
  if (vals[fi] === null) vals[fi] = round(f[26]);
  const portions = [];
  for (const [g, desc] of [[f[48], f[49]], [f[50], f[51]]]) {
    const gn = Number(g);
    if (g !== '' && gn > 0 && desc) portions.push([round(gn), desc]);
  }
  for (const p of EXTRA_PORTIONS[id] || []) if (!portions.some((q) => q[1] === p[1])) portions.unshift(p);
  foods.push([Number(id), d.name, groupCodes.indexOf(d.group), d.survey ? 1 : 0, d.common || '', vals, portions]);
}
foods.sort((a, b) => a[0] - b[0]);
for (const id of Object.keys(EXTRA_PORTIONS)) {
  if (!foods.some((f) => f[0] === Number(id))) throw new Error(`EXTRA_PORTIONS id ${id} not found`);
}

const out = {
  source: 'USDA National Nutrient Database for Standard Reference, Release 28 (2015). Values per 100 g; null = not analyzed.',
  nutrients: KEYS,
  groups: groupCodes.map((c) => GROUPS[c]),
  foods,
};
const json = JSON.stringify(out);
writeFileSync(join(root, 'data/foods.json'), json);
console.log(`Wrote ${foods.length} foods, ${(json.length / 1024 / 1024).toFixed(2)} MB`);
