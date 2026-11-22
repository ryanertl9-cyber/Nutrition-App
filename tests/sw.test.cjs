// Guards the offline app: sw.js must be rebuilt whenever a precached file changes,
// and every precached file must exist. Run: node --test tests/sw.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('sw.js is up to date with the app files (run: node scripts/build-sw.mjs)', async () => {
  const { computeVersion, PRECACHE } = await import('../scripts/build-sw.mjs');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert.match(sw, new RegExp(`const VERSION = '${computeVersion()}'`));
  for (const url of Object.keys(PRECACHE)) assert.ok(sw.includes(JSON.stringify(url)), url);
});

test('every precached file exists', async () => {
  const { PRECACHE } = await import('../scripts/build-sw.mjs');
  for (const file of Object.values(PRECACHE)) assert.ok(fs.existsSync(path.join(__dirname, '..', file)), file);
});

test('manifest describes an installable app', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/app/');
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  assert.ok(m.icons.some((i) => i.sizes === '192x192'));
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(__dirname, '..', i.src)), i.src);
});
