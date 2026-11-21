# Design prompt (filled skeleton)

This is the skeleton from the first request, filled in from the research in `RESEARCH.md` and the decisions made with the user. It is the brief the Nutrient Ledger app was built to.

---

## ROLE
You are a senior product designer and software architect who also knows nutrition science well. You are designing a nutrition-tracking app.

## GOAL
Design an app that lets users log what they eat. The app works out the macronutrients and micronutrients in each entry and tracks progress against personal targets over weeks and months. It should be easy to use, and it should be obvious at a glance which targets are being hit and which are being missed.

## TARGET USERS
- **Primary audience:** health-conscious adults (14+) who want micronutrient insight, not just calories. They find MyFitnessPal shallow and Cronometer dense.
- **Experience level:** beginner to intermediate trackers. Experts can set custom targets.
- **Platform(s):** a responsive web app that works on phones and desktops, published as a claude.ai Artifact and as a static site from GitHub.

## CORE REQUIREMENTS

### 1. User profile & targets
- **Collect:** sex (for reference intakes), age, height, weight, activity level, goal (lose / maintain / build muscle). Units are lb/ft or kg/cm.
- **Daily targets:**
  - *Energy and macros:* calories (Mifflin–St Jeor × activity factor, ±goal, with a 1,200/1,500 kcal floor), protein (1.2–1.8 g/kg by goal, never below the 0.8 g/kg RDA), fat (30% of calories), carbs (the remainder, at least 130 g), fiber (14 g per 1,000 kcal).
  - *Micros:* vitamins A, C, D, E, K, B1, B2, B3, B5, B6, folate, B12 and choline; minerals calcium, iron, magnesium, phosphorus, potassium, zinc, copper, manganese and selenium.
  - *Limits:* sodium under 2,300 mg; saturated fat under 10% of calories. Total sugar, MUFA, PUFA and cholesterol are shown for reference.
- **Basis for targets:** National Academies DRIs (RDA or AI) by age band and sex. Upper limits (ULs) are flagged only where the UL applies to food.
- **Manual target customization:** yes, per nutrient (target and max), with a reset.

### 2. Food input
- **Input methods:** search with quick add, natural-language entry, recent foods with one-tap re-add, copy yesterday's meal, custom foods from a label, and recipes.
- **Food data source:** USDA SR28 (8,789 lab-analysed foods, 33 nutrients each) built into the app, plus optional live USDA FoodData Central search using a DEMO_KEY or the user's own key.
- **Portions:** USDA household measures (cup, tbsp, slice, medium, …), grams and ounces. The parser converts cup, tbsp, tsp, ml and fl oz using each food's own household measures.
- **Unknown nutrient data:** kept as unknown, never zero. Affected rows show "partial data", and the detail view says the true total is probably higher.

### 3. Daily tracking
- A scoreboard headline ("N of 29 targets met") with a stacked status bar.
- Calories plus protein, carbs and fat at a glance.
- A "Needs attention" list of low and over nutrients. Every nutrient row opens a detail view with sources and gap-closing foods.
- Meals: Breakfast, Lunch, Dinner, Snacks.
- Status states: **Met**, **Close** (70–99% of target, or within the band for range targets), **Low**, **Over** (above the UL or the limit). Each state has both a colour and a distinct shape, so colour-blind users can read it.

### 4. Long-term progress (weeks & months)
- **Aggregations:** daily, plus weekly averages for 3 and 6 months. Unlogged days are excluded from averages.
- **Trend visualizations:** a target map heatmap (nutrient × day or week), a days-on-target ranking, and a per-nutrient line chart with target and limit lines.
- **Insights:** chronic shortfalls ("Vitamin D fell short on 21 of 25 logged days"), frequent overs, consistently met nutrients, average calories against target, and unlogged days.
- **Data export:** JSON backup and restore.

### 5. Non-functional requirements
- **Privacy & storage:** stored in the browser on the device only. No account and no server.
- **Offline support:** the built-in database works offline. Only online search needs a network.
- **Accessibility:** status is shown by shape as well as colour, controls are labelled, focus is visible, the layout works at 390 px, and light and dark themes are supported.
- **Performance:** a whole meal can be logged in one sentence; search responds as you type (120 ms debounce over 8.8k foods).

## CONSTRAINTS
- **Tech stack:** dependency-free HTML, CSS and JS, with one data file (2.1 MB JSON, about 600 KB gzipped). Core logic is a pure module shared by the browser and the Node tests.
- **Out of scope for v1:** barcode scanning, photo logging, social features, meal plans, adaptive TDEE, and device sync.
- **Disclaimer:** this is a tracking tool, not medical advice. Pregnancy, lactation and medical diets need custom targets set with a clinician.

## DELIVERABLES (where each lives)
1. Product summary: `README.md`
2. Feature list (MVP, v2, future): `README.md` › Roadmap
3. User flows: `README.md` › How it works
4. Data model: `README.md` › Data model
5. Nutrient calculation logic: `src/core.js` (commented) and `README.md`
6. Screen-by-screen outline: `README.md` › Screens
7. Progress and analytics design: `README.md` › Trends
8. Technical architecture: `README.md` › Architecture
9. Risks and open questions: `README.md` › Risks
