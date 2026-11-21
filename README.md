# Simply Nutrition

A nutrition tracker that shows at a glance which of your daily nutrient targets you've hit and which you've missed. It covers calories, macros, 13 vitamins, 9 minerals and dietary limits, and tracks the pattern over weeks and months.

- **Scoreboard first.** "17 of 29 targets met", a status bar, and the short list of nutrients that need attention.
- **Gap closer.** Tap a nutrient to see which foods it came from, and which everyday foods would close the gap. Each suggestion can be added with one tap.
- **Target map.** A heatmap of every nutrient by day (or week), with a days-on-target ranking and plain-language insights.
- **Fast logging.** Type "2 eggs, 1 cup oatmeal and a banana". Re-add recent foods in one tap, copy yesterday's meal, and save recipes and custom foods.
- **Trustworthy data.** Lab-analysed USDA values (SR28, 8,789 foods), with optional live search of USDA FoodData Central. Unknown values are flagged, never counted as zero.
- **Accounts and sync.** Use it as a guest (data stays in the browser) or create a free account (email and password) to sync your log across devices. Accounts run on Supabase with row-level security, so each person can only read their own data.
- **Private.** No ads, no trackers. Export or delete everything at any time.

The background research (MyFitnessPal, Cronometer, MacroFactor, retention studies) is in [`docs/RESEARCH.md`](docs/RESEARCH.md). The filled-in design brief is in [`docs/DESIGN-PROMPT.md`](docs/DESIGN-PROMPT.md).

## Run it

Browsers block `fetch()` from `file://` URLs, so serve the folder instead of opening `index.html` from disk:

```bash
npx serve .
```

Then open the printed URL. Any static host works, including GitHub Pages (Settings → Pages → deploy from the `main` branch root).

## Accounts setup (Supabase + Netlify)

1. **Database.** In the Supabase dashboard, open SQL Editor → New query, paste [`supabase/schema.sql`](supabase/schema.sql), and click Run. This creates the `profiles`, `entries` and `foods` tables, locks each row to its owner (row-level security) and adds the `delete_account()` function. It's safe to run again.
2. **Auth URLs.** In Authentication → URL Configuration, set **Site URL** to the live site (`https://simplynutrition.app`) and add it under **Redirect URLs** (keep `https://simplynutrition.netlify.app` there too for old links). Confirmation and password-reset emails link there.
3. **Email.** Supabase's built-in email sender only allows a few messages per hour. Before inviting people, add an SMTP provider (for example Resend) under Authentication → Emails → SMTP settings.
4. **Config.** [`src/config.js`](src/config.js) holds the project URL and the *publishable* key. These are meant to be public. Never put the secret (service_role) key in this repository.

Guests who sign in are offered to copy their on-device log into the account. Sync is local-first: every change saves on the device immediately and uploads in the background, so the app keeps working offline.

## Test it

```bash
npm test
```

```bash
npm run test:e2e
```

```bash
npm run test:accounts
```

`npm test` runs 35 unit tests for the core logic and the sync engine (`node --test`). `npm run test:e2e` runs 27 browser checks of guest mode with Playwright: logging, editing, recipes, custom foods, online search (mocked), trends, export and import, reload persistence, phone layout and dark mode. `npm run test:accounts` runs 17 browser checks of accounts against a fake Supabase: sign-up, email confirmation, guest import, two-device sync, offline recovery, isolation between users, sign-out, password reset and account deletion. Both browser suites send the same Content-Security-Policy as the live site.

## How it works

**User flows**
1. **First visit.** The app opens on ten weeks of clearly labelled example data, so every screen shows something real. "Start my own log" clears the examples and opens Profile.
2. **Profile.** Enter sex, age, height, weight, activity and goal. Targets are computed instantly, and any of them can be overridden.
3. **Log a meal.** Type it in words, or tap "+ Add food" on a meal. Search, pick a portion, and see live how much the food adds to each target before adding it.
4. **Check the day.** Read the scoreboard and the Needs-attention chips, then tap a nutrient for its sources and suggested foods.
5. **Review weeks and months.** The Trends tab shows tiles, insights, the target map, the days-on-target ranking and a chart for each nutrient.

**Nutrient math** (`src/core.js`)
- Each food stores values per 100 g. An entry stores grams, so its nutrients are `per100 × grams / 100`. A missing lab value stays `null` and is counted as missing data.
- Calories: Mifflin–St Jeor resting energy × activity factor, ±500/0/+300 kcal for the goal, with a floor of 1,200 kcal (women) or 1,500 kcal (men).
- Protein: 1.2, 1.6 or 1.8 g/kg depending on the goal, at least 0.8 g/kg. Fat is 30% of calories. Carbs are the remainder (at least 130 g). Fiber is 14 g per 1,000 kcal.
- Micronutrients: National Academies RDA or AI by sex and age band (14–18, 19–30, 31–50, 51–70, 71+). Upper limits are flagged only where they apply to food.
- Status: **Met** (≥100% of target), **Close** (70–99%), **Low** (<70%), **Over** (above the upper limit or a limit). Calories use a ±10% band (±20% counts as Close); carbs and fat use ±15% (±30%).

## Screens

| Screen | Purpose |
|---|---|
| Today | Scoreboard (count met, status bar, calories and macros, Needs attention, all nutrients with filter), natural-language entry, and meals with entries. |
| Add food (sheet) | Search, Recent and My foods tabs. The portion picker shows a live preview of the food's contribution to each target. Online USDA search is available here. |
| Nutrient detail (sheet) | Amount against target, the basis for the target, a missing-data warning, top sources, and gap-closing foods with "+ Add". |
| Trends | Range of 1 week, 4 weeks, 3 months or 6 months. Tiles, insights, target map, days on target, and a nutrient chart. |
| My foods | Custom foods (from a label), recipes (from ingredients, per serving) and saved online foods. |
| Profile | Profile, a targets table with overrides, the USDA API key, and export, import and erase. |

## Trends

- **Days count only if logged.** Unlogged days are excluded from averages, so skipping a day doesn't look like a deficiency. Today is excluded until it's over.
- **Buckets.** Daily for 1 and 4 weeks; weekly averages (Monday start) for 3 and 6 months.
- **Adherence** is the share of logged days on which a nutrient was met. Insights flag nutrients missed on 60% or more of days, and limits exceeded on 30% or more.

## Data model

```text
Profile   { sex, age, heightCm, weightKg, activity, goal }
Overrides { [nutrientKey]: { target?, max? } }
Entry     { id, date: 'YYYY-MM-DD', meal, src: 'sr' | 'my', fid, name, qty, unit, unitGrams, grams }
Food      { id, src, name, per100: number|null[33], portions: [grams, label][] }   // SR28 foods are read-only
MyFood    Food + { kind: 'custom' | 'recipe' | 'usda', servings?, ingredients?, fdcId? }
Settings  { apiKey, units: 'us' | 'metric' }
```

Guests' data is stored under one `localStorage` key (`nutrient-ledger:v1`). Each signed-in account has its own local copy (`nutrient-ledger:acct:<user id>`) plus sync bookkeeping (`nutrient-ledger:sync:<user id>`), both removed on sign-out. The export file is the same JSON.

On the server, each record is a row with `user_id`, `id`, a `data` JSON column, a `deleted` flag (so deletions reach other devices) and `server_updated_at` (set by the database, used for incremental pulls). Unsynced local edits win over older server copies. Example data and the USDA API key never leave the device.

## Architecture

```text
index.html          markup shell + CSS (light/dark tokens)
src/core.js         pure logic: nutrients, DRIs, targets, status, search, parser, trends, insights, FDC mapping
src/app.js          UI: rendering, events, sheets, storage, export/import, accounts
src/sync.js         local-first sync engine (diff, pull/merge, batched push) + Supabase adapter
src/config.js       public Supabase settings for the hosted site
src/vendor/         supabase-js 2.119.0 (MIT), served from the site itself
supabase/schema.sql tables, row-level security and delete_account()
privacy.html, terms.html  legal pages (review before launch)
netlify.toml        hosting config and security headers
data/foods.json     USDA SR28 compiled by scripts/build-foods.mjs from vendor/sr28/*.txt
tests/              node:test unit tests + Playwright end-to-end script
scripts/            build-foods.mjs (data), build-artifact.mjs (claude.ai Artifact page)
```

There are no runtime dependencies. Online search calls `api.nal.usda.gov/fdc/v1/foods/search` directly from the browser. (api.data.gov is documented to accept browser requests, but this path was only tested against a mocked response, because the build environment couldn't reach USDA.) On hosts that block outside requests, including the claude.ai Artifact viewer, online search shows a clear message and the built-in database keeps working.

## Roadmap

| | Features |
|---|---|
| **MVP (this release)** | Profile-based DRI targets, overrides, scoreboard, gap closer, natural-language entry, search, recent, copy meal, custom foods, recipes, online USDA search, target map, insights, charts, export/import, light and dark themes. |
| **v2** | Sign in with Google/Apple, barcode scanning via Open Food Facts, weight log with adaptive energy target, an optional AI parser for messy text and photos, highlighted-nutrient picker, more nutrients (omega-3, iodine) via FoodData Central Foundation Foods. |
| **Future** | Clinician share view, pregnancy and lactation DRIs, meal planning toward gaps, reminders. |

## Risks and open questions

- **Data age.** SR28 dates from 2015. FoodData Central Foundation Foods is newer but covers fewer foods. A future build could merge the two.
- **Upper limits.** Several ULs (magnesium, niacin, folate, vitamin E, preformed vitamin A) apply only to supplements or fortificants, so they are not flagged from food. Supplement logging would need them.
- **Parser limits.** Dish names that contain "and" or "with" (such as "mac and cheese") split into separate items. The preview lets you fix them before adding.
- **Storage.** Guest data is per device, and clearing site data erases it unless exported. Account data lives in Supabase; the free tier pauses after a week without traffic and has no automatic backups.
- **Not medical advice.** Targets are population reference values.

## Data and licenses

- Food composition: U.S. Department of Agriculture, Agricultural Research Service, Nutrient Data Laboratory, *USDA National Nutrient Database for Standard Reference, Release 28* (2015). This is a public-domain U.S. government work. The raw files in `vendor/sr28` come from the MIT-licensed `fda-nutrient-database` npm package.
- Online search: USDA FoodData Central API (public domain data; free api.data.gov key).
- App code: MIT.
