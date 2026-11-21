# Nutrition tracking apps: competitive research

*Prepared November 2026 for the Nutrient Ledger design.*

**Reliability.** Neither MyFitnessPal nor Cronometer publishes a detailed engineering architecture. The infrastructure notes below come from vendor case studies, patents, job ads and help-center pages. Retention and accuracy figures in this space mostly come from competing apps, which have a commercial interest. Each claim says where it came from.

## 1. MyFitnessPal

| Area | What we found | Source quality |
|---|---|---|
| Food database | Very large and mostly crowdsourced (reported figures range from 14M to 20M+ entries). Breadth comes at the cost of duplicate and inaccurate entries. MFP runs a "Verified Foods" program to counter this. | Size and accuracy claims come from competitor and affiliate reviews. "Verified Foods" is MFP's own program. |
| Data pipeline | Databricks was used to build the Verified Foods database, cutting algorithm run times "from weeks to hours". Nutritionix supplies some food data. | Databricks partner article (vendor). |
| Storage | Moved from MySQL to clustered Percona servers, then to PlanetScale, a managed Vitess / sharded MySQL service. | PlanetScale customer case study (vendor). |
| Search | Patents describe a food-record database whose search results are ranked partly by how often a food has been logged, so popularity feeds the ranking. | MFP patents (US12062295B2 and related). |
| Logging features | Search, barcode scan, Meal Scan (photo; reportedly from its acquisition of Cal AI), and Voice Log. Barcode, photo and voice logging have moved behind Premium (about $80/yr). | Review sites. Pricing is consistent across sources. |
| Micronutrients | Tracks a limited set of micronutrients, with emphasis on calories and macros. Crowdsourced entries often lack micronutrient values. | Reviews. |

**Takeaway.** MFP wins on coverage and habit-forming speed for packaged food. It loses on data trust, and it gives little micronutrient insight unless you pay.

## 2. Cronometer

| Area | What we found | Source quality |
|---|---|---|
| Food database | Prioritises lab-analysed sources: USDA, NCCDB, CNF (Canada), NUTTAB (Australia), CoFID (UK), NEVO (Netherlands) and others. Branded and label data is kept separate because it carries only label nutrients. User submissions are reviewed by staff. | Cronometer support "Data sources" article (first party). |
| Nutrient depth | Tracks 80+ nutrients. The blog advises choosing entries with full profiles from NCCDB, USDA or NUTTAB. | First party; exact count varies. |
| Targets UX | The Nutrient Targets Summary has a configurable "highlighted targets" area at the top (pick 8 nutrients) and the full list grouped by category below. Defaults come from the DRIs, with maximums at the Tolerable Upper Intake Level. Bar colours were redesigned to "communicate relationships rather than judgments". Today, green means minimum met and under the max, and red means over the max. An older yellow "minimum not met" state confused users (forum threads). | Help center and blog (first party), plus user forums. |
| Missing data | Visual dots tell "no value logged" apart from a value. | Help center. |
| Stack | Java on the back end (StackShare), GCP/AWS/Cloudflare, and a mobile rewrite in Flutter (job listing). | Third-party listings; partly stale. |

**Takeaway.** Cronometer is the reference for data quality and micronutrient depth. Its weak spot is a dense screen of more than 80 bars: the user has to work out what to do about a shortfall.

## 3. Others worth noting

- **MacroFactor** works out energy expenditure from smoothed weight trend against intake and adjusts targets weekly. It claims the fewest taps per logged food (its own "speed index"), and it uses a verified database that partners with Open Food Facts. *(Claims from the vendor.)*
- **Lose It!, Yazio, Lifesum and the AI photo apps (Cal AI and others)** compete on logging speed: photo, voice and barcode.

## 4. What the evidence says about why people quit

- Vendor churn studies (Nutrola, which analysed 1.2M of its own accounts, and others) consistently show the steepest drop-off in the first days to weeks. They point to **logging time per meal** as the strongest predictor of who is still tracking at 30 days. *(These are vendor data; Nutrola says no tracker publishes exact retention.)*
- A competing finding, a 2017 study cited by the same vendor, says **perceived lack of progress** is the strongest predictor of dropout at 6 to 8 weeks, more than friction.
- 2026 JMIR studies tie the **frequency** of daily food tracking to clinically significant weight loss, so consistency matters more than precision.

These point to two design requirements: logging must be fast, and progress must be visible and meaningful over weeks.

## 5. Gaps an innovative app can fill

| Gap in the market | Nutrient Ledger's answer |
|---|---|
| Micronutrient screens show many bars but don't say what matters. | **Scoreboard first**: "17 of 29 targets met", one stacked status bar, and a short "Needs attention" list. Full detail is one tap away. |
| Shortfalls come without an answer. | **Gap closer**: tap a low nutrient to see where today's amount came from and which everyday foods close the gap, ranked by nutrient per calorie, each with a one-tap "+ Add". |
| Weekly patterns are hard to see. | **Target map**: a heatmap of every nutrient by day (or by week for 3 and 6 months), plus a "days on target" ranking and plain-language insights such as "Vitamin D fell short on 21 of 25 days". |
| Crowdsourced data is unreliable. | Lab-analysed USDA data only, with optional live USDA FoodData Central search. **Unknown is never treated as zero**: rows with incomplete data are flagged. |
| Logging is slow, and speed features sit behind paywalls. | Free natural-language entry ("2 eggs, 1 cup oatmeal and a banana"), a Recent list with one-tap re-add, "copy yesterday's meal", recipes, and search ranked by your own history. |
| Mid-day status reads as failure. | Trends use complete days only; today is labelled "in progress". Unlogged days are excluded from averages, not counted as zero intake. |
| Privacy | All data stays on the device, with JSON export and import. No account needed. |

## Sources

- Cronometer: [Data sources](https://support.cronometer.com/hc/en-us/articles/360018239472-data-sources) · [Accurate databases](https://cronometer.com/features/accurate-databases.html) · [Tips for accurate data](https://cronometer.com/blog/accurate-data-tips/) · [Mobile highlighted nutrient targets](https://support.cronometer.com/hc/en-us/articles/360019003531-Mobile-Highlighted-Nutrient-Targets) · [Designing for understanding](https://cronometer.com/blog/designing-for-understanding/) · [Forum: red, green and grey bars](https://forums.cronometer.com/discussion/5568/red-green-and-grey-bars) · [Forum: 100% met but yellow](https://forums.cronometer.com/discussion/1843/100-of-nutrient-met-but-still-showing-in-yellow-bars) · [StackShare](https://stackshare.io/companies/cronometer) · [Mobile developer job (Flutter)](https://jobera.com/job/cronometer-software-developer-mobile-team-44f683a8/) · [Calorie-trackers.com review](https://www.calorie-trackers.com/reviews/cronometer/)
- MyFitnessPal: [PlanetScale case study](https://planetscale.com/customers/myfitnesspal) · [Patent US12062295B2](https://patents.google.com/patent/US12062295) · [Patents by MyFitnessPal Inc.](https://patents.justia.com/assignee/myfitnesspal-inc) · [Databricks partner article](https://bdaily.co.uk/articles/2016/10/18/myfitnesspal-boosts-team-productivity-with-databricks) · [MyNetDiary comparison](https://www.mynetdiary.com/myfitnesspal-vs-mynetdiary.html) · [Fitia: MFP alternatives 2026](https://fitia.app/learn/article/best-myfitnesspal-alternatives-2026/) · [Macaron review](https://macaron.im/playbook/reviews/myfitnesspal-food-tracking-review) · [Gaya review](https://trygaya.com/review/myfitnesspal-review) · [Jotform: AI calorie trackers 2026](https://jotform.com/ai/best-ai-calorie-tracker)
- MacroFactor: [App Store listing](https://apps.apple.com/us/app/macrofactor-macro-tracker/id1553503471) · [Food logger revamp](https://macrofactor.com/mm-may-2022/) · [Product page](https://macrofactor.com/macrofactor/)
- Retention: [Nutrola dropout curve](https://nutrola.app/en/blog/calorie-tracking-dropout-curve-when-and-why-users-quit-data-study) · [Nutrola retention rates](https://nutrola.app/en/blog/calorie-tracker-retention-rates-how-long-users-stick-with-each-app) · [Nutrola 120k churn report](https://nutrola.app/en/blog/120k-first-app-churn-90-day-data-report-2026) · [JMIR 2026 cohort](https://www.jmir.org/2026/1/e98144) · [JMIR Human Factors 2026](https://humanfactors.jmir.org/2026/1/e80734)
- Reference intakes: National Academies Dietary Reference Intakes; Dietary Guidelines for Americans 2020–2025; USDA SR28 (2015) and FoodData Central.
