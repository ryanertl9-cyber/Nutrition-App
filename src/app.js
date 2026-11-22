/* Simply Nutrition: UI. Depends on core.js (window.NL). Plain JS, no framework. */
(function () {
  'use strict';
  const NL = window.NL;
  const STORE_KEY = 'nutrient-ledger:v1';
  const GLYPH = { met: '', near: '', low: '', over: '', info: '' };
  const STATE_WORD = { met: 'Met', near: 'Close', low: 'Low', over: 'Over', info: 'No target' };
  const RANGES = { '1w': { days: 7, bucket: 'day', name: '1 week' }, '4w': { days: 28, bucket: 'day', name: '4 weeks' }, '3m': { days: 91, bucket: 'week', name: '3 months' }, '6m': { days: 182, bucket: 'week', name: '6 months' } };

  let db = null;
  let targets = null;
  let byDate = new Map();
  let myById = new Map();
  let usage = new Map();
  const memStore = {};
  const downloadsP = window.claude && typeof window.claude.use === 'function' ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);

  const S = {
    tab: 'today',
    today: NL.ymd(new Date()),
    date: NL.ymd(new Date()),
    filter: 'all',
    range: '4w',
    chartKey: 'kcal',
    parsed: null,
    sheet: null,
    confirm: null,
    data: null,
  };

  // ---------------------------------------------------------------------------
  // Storage (browser only; wrapped because storage can be blocked)
  // ---------------------------------------------------------------------------
  // Guests keep one local copy; each signed-in account gets its own local copy plus sync bookkeeping.
  const ACCT_PREFIX = 'nutrient-ledger:acct:';
  const META_PREFIX = 'nutrient-ledger:sync:';
  function storeKey() { return S.user ? ACCT_PREFIX + S.user.id : STORE_KEY; }
  function readKey(k) {
    if (memStore[k]) return memStore[k];
    try { const raw = window.localStorage.getItem(k); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function writeKey(k, v) { memStore[k] = v; try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* keep in memory */ } }
  function removeKey(k) { delete memStore[k]; try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  function load() { return readKey(storeKey()); }
  function save() {
    writeKey(storeKey(), S.data);
    if (Acct.engine) Acct.engine.schedule();
  }
  function normalize(d) {
    d.settings = Object.assign({ apiKey: '', units: 'us' }, d.settings || {});
    d.overrides = d.overrides || {};
    d.myFoods = d.myFoods || [];
    d.savedMeals = d.savedMeals || [];
    d.entries = d.entries || [];
    d.profile = Object.assign({}, NL.DEFAULT_PROFILE, d.profile || {});
    if (d.onboarded === undefined) d.onboarded = true; // logs from before the guided first visit
    return d;
  }
  function freshData(withSample) {
    return {
      version: 1,
      profile: Object.assign({}, NL.DEFAULT_PROFILE),
      overrides: {},
      entries: withSample ? NL.sampleEntries(db, S.today, 70) : [],
      myFoods: [],
      savedMeals: [],
      settings: { apiKey: '', units: 'us' },
      sample: !!withSample,
      onboarded: true,
    };
  }

  function reindex() {
    byDate = new Map();
    usage = new Map();
    for (const e of S.data.entries) {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date).push(e);
      if (e.src === 'sr') usage.set(e.fid, (usage.get(e.fid) || 0) + 1);
    }
    myById = new Map(S.data.myFoods.map((f) => [f.id, f]));
    targets = NL.computeTargets(S.data.profile, S.data.overrides);
  }
  function commit() { save(); reindex(); render(); }

  const resolve = (e) => (e.src === 'sr' ? db.get(e.fid) : myById.get(e.fid));
  const foodOf = (src, fid) => (src === 'sr' ? db.get(fid) : myById.get(fid));

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = NL.fmt;
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const $ = (sel) => document.querySelector(sel);
  const pct = (v) => (v == null ? '–' : Math.round(v * 100) + '%');
  function dateLabel(d) {
    const dt = NL.parseYmd(d);
    const diff = NL.daysBetween(d, S.today);
    const base = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    if (diff === 0) return 'Today · ' + base.split(', ')[1];
    if (diff === 1) return 'Yesterday · ' + base.split(', ')[1];
    return base;
  }
  function shortDate(d) { return NL.parseYmd(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  function defaultMeal() {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    return h < 10.5 ? 'breakfast' : h < 15 ? 'lunch' : h < 20.5 ? 'dinner' : 'snacks';
  }
  function toast(msg) {
    const root = $('#toast-root');
    root.innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { root.innerHTML = ''; }, 2600);
  }
  function kcalOf(food, grams) { const v = food.per100[NL.BY_KEY.kcal.index]; return v == null ? null : (v * grams) / 100; }
  function portionText(e) {
    if (e.unit === 'g') return `${fmt(e.grams)} g`;
    return `${fmt(e.qty)} × ${e.unit} · ${fmt(e.grams)} g`;
  }
  function foodTag(f) {
    if (f.src === 'sr') return f.group ? `<span class="tag">${esc(f.group)}</span>` : '';
    return `<span class="tag mine">${f.kind === 'recipe' ? 'Recipe' : f.kind === 'usda' ? 'USDA online' : f.kind === 'barcode' ? 'Scanned' : 'My food'}</span>`;
  }
  /** Portions to offer: optional synthetic first, then the food's own, deduped by label. */
  function portionChoices(food, first) {
    const list = [];
    if (first) list.push(first);
    for (const p of NL.portionsFor(food)) if (!list.some((q) => q.label === p.label)) list.push(p);
    return list;
  }

  function addEntry(date, meal, food, qty, portion) {
    const e = {
      id: uid(), date, meal, src: food.src, fid: food.id, name: food.name,
      qty: Number(qty), unit: portion.label, unitGrams: portion.grams, grams: Math.round(Number(qty) * portion.grams * 10) / 10,
    };
    S.data.entries.push(e);
    return e;
  }

  // ---------------------------------------------------------------------------
  // Render root
  // ---------------------------------------------------------------------------
  function render() {
    for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.tab === S.tab));
    const main = $('#main');
    const banner = S.data.sample
      ? `<div class="banner"><p><b>You're looking at example data.</b> Ten weeks of sample meals show how the app works. Your own log starts when you clear them.</p><div class="row"><button class="btn primary" data-action="start-own">Start my own log</button></div></div>`
      : '';
    const views = { today: renderToday, trends: renderTrends, foods: renderFoods, settings: renderSettings };
    main.innerHTML = banner + views[S.tab]();
    renderAccountButton();
    renderSheet();
  }

  // ---------------------------------------------------------------------------
  // Today
  // ---------------------------------------------------------------------------
  function dayData(date) {
    const entries = byDate.get(date) || [];
    const { totals, missing } = NL.sumEntries(entries, resolve);
    return { entries, totals, missing, rep: NL.report(totals, targets, missing) };
  }

  function barHTML(r) {
    let w = 0;
    if (r.kind === 'limit' || (r.target && r.target.target == null)) w = r.target && r.target.max ? r.value / r.target.max : 0;
    else w = r.pct || 0;
    w = Math.max(0, Math.min(1, w));
    const cls = r.state === 'info' ? '' : 'bg-' + r.state;
    return `<div class="bar" aria-hidden="true"><div class="fill ${cls}" style="width:${(w * 100).toFixed(1)}%;${r.state === 'info' ? 'background:var(--info)' : ''}"></div></div>`;
  }
  function amountHTML(r) {
    const t = r.target;
    if (!t || r.state === 'info') return `<b>${fmt(r.value)}</b> ${esc(r.unit)}`;
    if (r.kind === 'limit' || t.target == null) return `<b>${fmt(r.value)}</b> / max ${fmt(t.max)} ${esc(r.unit)}`;
    return `<b>${fmt(r.value)}</b> / ${fmt(t.target)} ${esc(r.unit)} · ${pct(r.pct)}`;
  }
  function nrowHTML(r) {
    const label = `${r.name}: ${STATE_WORD[r.state]}`;
    return `<button class="nrow" data-action="detail" data-key="${r.key}" aria-label="${esc(label)}">
      <span class="dot s-${r.state}" aria-hidden="true">${GLYPH[r.state]}</span>
      <span class="nm">${esc(r.name)}${r.missing ? ` <span class="incomplete" title="${r.missing} logged food(s) have no value for this nutrient">· partial data</span>` : ''}</span>
      ${barHTML(r)}
      <span class="amt">${amountHTML(r)}</span>
    </button>`;
  }

  function renderToday() {
    const d = dayData(S.date);
    const { rep, totals } = d;
    const c = rep.counts;
    const segs = ['met', 'near', 'low', 'over'].map((s) => c[s] ? `<span class="bg-${s}" style="width:${(c[s] / rep.total) * 100}%" title="${STATE_WORD[s]}: ${c[s]}"></span>` : '').join('');
    const kc = rep.rows[NL.BY_KEY.kcal.index];
    const macro = (k, extra) => {
      const r = rep.rows[NL.BY_KEY[k].index];
      const t = r.target;
      const togo = t.target != null && r.value < t.target ? `${fmt(t.target - r.value)} g to go` : t.max != null && r.value > t.max ? `${fmt(r.value - t.max)} g over` : 'Target met';
      return `<div class="macro${extra ? ' macro-extra' : ''}"><div class="mhead"><span class="mname small"><span class="dot s-${r.state}">${GLYPH[r.state]}</span> ${esc(r.name)}</span><span class="v small">${fmt(r.value)}<span class="muted">/${fmt(t.target)} g</span></span></div>${barHTML(r)}<div class="mleft small muted">${togo}</div></div>`;
    };
    const macrosOnly = S.data.settings.scoreView === 'macros';
    const macroRows = rep.rows.filter((r) => r.cat === 'energy' || r.cat === 'macro');
    const macroMet = macroRows.filter((r) => r.state === 'met').length;
    const attention = rep.rows.filter((r) => (r.state === 'low' || r.state === 'over') && r.cat !== 'energy').sort((a, b) => (a.state === 'over' ? -1 : 0) - (b.state === 'over' ? -1 : 0) || (a.pct || 0) - (b.pct || 0));
    const isEmpty = !d.entries.length;
    const inProgress = S.date === S.today && !isEmpty;
    const CHIP_MAX = 8;
    const chips = attention.length
      ? attention.slice(0, CHIP_MAX).map((r) => `<button class="chip ${r.state}" data-action="detail" data-key="${r.key}"><span class="dot s-${r.state}">${GLYPH[r.state]}</span>${esc(r.name)} <span class="num muted">${r.state === 'over' ? 'over' : pct(r.pct)}</span></button>`).join('') + (attention.length > CHIP_MAX ? `<button class="chip" data-action="filter" data-filter="attn">+${attention.length - CHIP_MAX} more</button>` : '')
      : `<span class="small muted">${isEmpty ? 'Nothing logged yet for this day.' : 'Every tracked nutrient is met or close. Nice work.'}</span>`;

    const rowsFor = (rows) => {
      if (S.filter === 'attn') return rows.filter((r) => r.state === 'low' || r.state === 'over' || r.state === 'near');
      if (S.filter === 'met') return rows.filter((r) => r.state === 'met');
      return rows;
    };
    const board = NL.CATEGORIES.filter((cat) => cat.key !== 'energy').map((cat) => {
      const rows = rowsFor(rep.rows.filter((r) => r.cat === cat.key));
      if (!rows.length) return '';
      return `<div class="cat"><h3>${esc(cat.name)}</h3>${rows.map(nrowHTML).join('')}</div>`;
    }).join('') || `<p class="empty">No nutrients in this view.</p>`;

    const score = `
      <section class="score${macrosOnly ? ' macro-mode' : ''}" aria-labelledby="score-h">
        <div class="score-nav">
          <div class="eyebrow">Daily targets</div>
          <div class="day-ctrls" role="group" aria-label="Change day">
            <button class="icon-btn" data-action="day-prev" aria-label="Previous day"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
            <button class="icon-btn" data-action="open-cal" aria-label="Choose a date" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg></button>
            <button class="icon-btn" data-action="day-next" aria-label="Next day"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
            ${S.date !== S.today ? '<button class="today-btn" data-action="day-today" id="btn-today">Today</button>' : ''}
          </div>
        </div>
        <div class="score-title">
          <div><h2 id="score-h"><button class="date-btn" data-action="open-cal" aria-label="${esc(dateLabel(S.date))}. Choose a date" aria-haspopup="dialog"><span id="date-label">${esc(dateLabel(S.date))}</span><svg class="cal" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg></button></h2></div>
          <div class="bigcount"><span class="count-all" aria-label="${c.met} of ${rep.total} targets met">${c.met}<small>/${rep.total} met</small></span><span class="count-macro" aria-label="${macroMet} of ${macroRows.length} macro targets met">${macroMet}<small>/${macroRows.length} macros met</small></span></div>
        </div>
        <div class="rule-xl"></div>
        <div class="fold"${macrosOnly ? ' inert' : ''}><div class="fold-inner">
        <div class="statebar" role="img" aria-label="Met ${c.met}, close ${c.near}, low ${c.low}, over ${c.over}">${segs}</div>
        <div class="legend">
          ${['met', 'near', 'low', 'over'].map((s) => `<span><span class="dot s-${s}">${GLYPH[s]}</span> ${STATE_WORD[s]} <b>${c[s]}</b></span>`).join('')}
        </div>
        ${inProgress ? `<p class="small muted" style="margin:6px 0 0">Day in progress. Totals so far.</p>` : ''}
        <div class="rule-m"></div>
        </div></div>
        <div class="energy">
          <div class="kcal">${fmt(kc.value)}</div>
          <div><div class="row" style="justify-content:space-between"><span class="small"><span class="dot s-${kc.state}">${GLYPH[kc.state]}</span> Calories</span><span class="small muted num">target ${fmt(targets.kcal.target)} · ${fmt(Math.max(0, targets.kcal.target - kc.value))} left</span></div>${barHTML(kc)}</div>
        </div>
        <div class="macros">${macro('protein')}${macro('carbs')}${macro('fat')}${macro('fiber', true)}</div>
        <button class="fold-toggle" data-action="toggle-micros" aria-expanded="${!macrosOnly}" aria-controls="score-more">
          <span class="when-open">Macros only</span><span class="when-closed">Show all ${rep.total} nutrients</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>
        </button>
        <div class="fold" id="score-more"${macrosOnly ? ' inert' : ''}><div class="fold-inner">
        <div class="rule"></div>
        <div class="eyebrow" style="margin-top:8px">Needs attention</div>
        <div class="attn">${chips}</div>
        <div class="rule-m"></div>
        <div class="section-head" style="margin:0">
          <span class="eyebrow">All nutrients</span>
          <div class="seg" role="group" aria-label="Filter nutrients">
            ${[['all', 'All'], ['attn', 'Not met'], ['met', 'Met']].map(([k, n]) => `<button data-action="filter" data-filter="${k}" aria-pressed="${S.filter === k}">${n}</button>`).join('')}
          </div>
        </div>
        ${board}
        <p class="small muted" style="margin:10px 0 0">Tap any nutrient to see where it came from and which foods would close the gap.</p>
        </div></div>
      </section>`;

    const quick = `
      <section class="card quick" aria-labelledby="quick-h">
        <div class="section-head"><h2 id="quick-h">Log a meal in words</h2><span class="hint">Ctrl/⌘ + Enter</span></div>
        <textarea class="input" id="nl-input" rows="2" placeholder="2 eggs, 1 slice whole wheat toast and a banana">${esc(S.nlText || '')}</textarea>
        <div class="row" style="margin-top:8px">
          <select class="input" id="nl-meal" style="width:auto" aria-label="Meal">${NL.MEALS.map((m) => `<option value="${m.key}" ${m.key === (S.nlMeal || defaultMeal()) ? 'selected' : ''}>${m.name}</option>`).join('')}</select>
          <button class="btn accent" data-action="nl-parse">Read it</button>
          ${canScan() ? `<button class="btn scan-btn" data-action="scan-open" data-from="today">${BARCODE_ICON}<span>Scan barcode</span></button>` : ''}
          <span class="hint">Amounts, units and plain food names: “1 cup oatmeal”, “8 oz salmon”, “a handful of almonds”.</span>
        </div>
        ${S.parsed ? parsedHTML() : ''}
      </section>`;

    const meals = NL.MEALS.map((m) => {
      const es = d.entries.filter((e) => e.meal === m.key);
      const mk = es.reduce((a, e) => { const f = resolve(e); return a + (f ? kcalOf(f, e.grams) || 0 : 0); }, 0);
      const prev = (byDate.get(NL.addDays(S.date, -1)) || []).filter((e) => e.meal === m.key);
      return `<div class="meal">
        <div class="meal-head">
          <h3>${m.name} <span class="small muted num" style="font-family:var(--body);font-weight:500">${es.length ? fmt(mk) + ' kcal' : ''}</span></h3>
          <div class="row">
            ${!es.length && prev.length ? `<button class="btn small ghost" data-action="copy-meal" data-meal="${m.key}">Copy yesterday's</button>` : ''}
            ${es.length ? `<button class="btn small ghost" data-action="save-meal" data-meal="${m.key}" title="Save these foods to log them again in one tap">☆ Save meal</button>` : ''}
            <button class="btn small" data-action="open-add" data-meal="${m.key}">+ Add food</button>
          </div>
        </div>
        ${!es.length ? savedMealChipsHTML(m.key) : ''}
        ${es.length ? `<ul class="entries">${es.map((e) => {
          const f = resolve(e);
          const k = f ? kcalOf(f, e.grams) : null;
          return `<li class="entry"><div style="min-width:0"><button class="name" data-action="edit-entry" data-id="${e.id}">${esc(e.name)}</button><div class="portion">${esc(portionText(e))}</div></div><span class="kc">${k == null ? '–' : fmt(k)} <span class="muted small">kcal</span></span><button class="btn ghost icon" data-action="del-entry" data-id="${e.id}" aria-label="Remove ${esc(e.name)}">✕</button></li>`;
        }).join('')}</ul>` : `<p class="empty">Nothing logged.</p>`}
      </div>`;
    }).join('');

    return `${installTipHTML()}<div class="today">
      <div class="col-score">${score}</div>
      <div class="col-log">${quick}<section class="card" aria-label="Meals" style="margin-top:16px">${meals}</section>
      <p class="foot">Food values: ${esc(db.source)} Targets: National Academies Dietary Reference Intakes and the 2020–2025 Dietary Guidelines. This is a tracking tool, not medical advice.</p></div>
    </div>`;
  }

  function parsedHTML() {
    const items = S.parsed.items;
    if (!items.length) return `<p class="empty">I couldn't find any foods in that. Try “1 cup rice and 4 oz chicken”.</p>`;
    const totalK = items.reduce((a, it) => a + (it.food ? kcalOf(it.food, it.qty * it.portions[it.unitIdx].grams) || 0 : 0), 0);
    return `<div class="parsed" id="parsed">
      ${items.map((it, i) => {
        if (!it.food) return `<div class="pitem nomatch"><div><b>“${esc(it.text)}”</b> <span class="small muted">no match in the database</span></div><div class="row"><button class="btn small" data-action="parsed-search" data-i="${i}">Search</button><button class="btn ghost icon" data-action="parsed-remove" data-i="${i}" aria-label="Remove">✕</button></div></div>`;
        const g = it.qty * it.portions[it.unitIdx].grams;
        const options = [it.food, ...it.alternatives].map((f, j) => `<option value="${j}">${esc(f.name)}</option>`).join('');
        return `<div class="pitem">
          <div style="min-width:0"><span class="small muted">“${esc(it.text)}”</span></div>
          <div class="small num"><b>${fmt(kcalOf(it.food, g))}</b> kcal · ${fmt(g)} g</div>
          <div class="controls">
            <input class="input qty" type="number" inputmode="decimal" min="0" step="any" value="${it.qty}" data-parsed-qty="${i}" aria-label="Amount">
            <select class="input" data-parsed-unit="${i}" aria-label="Unit">${it.portions.map((p, j) => `<option value="${j}" ${j === it.unitIdx ? 'selected' : ''}>${esc(p.label)}${p.label !== 'g' ? ` (${fmt(p.grams)} g)` : ''}</option>`).join('')}</select>
            <select class="input foodsel" data-parsed-food="${i}" aria-label="Food">${options}</select>
            <button class="btn ghost small" data-action="parsed-search" data-i="${i}">Other…</button>
            <button class="btn ghost icon" data-action="parsed-remove" data-i="${i}" aria-label="Remove">✕</button>
          </div>
        </div>`;
      }).join('')}
      <div class="row" style="justify-content:space-between"><span class="small muted num">${items.filter((x) => x.food).length} foods · ${fmt(totalK)} kcal</span><div class="row"><button class="btn ghost" data-action="parsed-cancel">Cancel</button><button class="btn primary" data-action="parsed-add">Add to ${esc(NL.MEALS.find((m) => m.key === S.parsed.meal).name)}</button></div></div>
    </div>`;
  }

  function buildParsed(text, meal) {
    const items = NL.parseMeal(text, db, { usage }).map((it) => {
      if (!it.food) return { text: it.text, food: null };
      const perUnit = it.grams / (it.qty || 1);
      const first = { label: it.unit ? it.unitLabel : it.unitLabel || 'serving', grams: Math.round(perUnit * 10) / 10 };
      return { text: it.text, food: it.food, alternatives: it.alternatives, qty: it.qty, portions: portionChoices(it.food, first), unitIdx: 0 };
    });
    return { meal, items };
  }

  // ---------------------------------------------------------------------------
  // Trends
  // ---------------------------------------------------------------------------
  function renderTrends() {
    const R = RANGES[S.range];
    // Complete days only: today is still in progress, so the range ends yesterday.
    const end = NL.addDays(S.today, -1);
    const start = NL.addDays(end, -(R.days - 1));
    const tr = NL.trend(byDate, resolve, targets, start, end, R.bucket);
    const macrosOnly = S.data.settings.scoreView === 'macros';
    const inView = (p) => !macrosOnly || p.cat === 'energy' || p.cat === 'macro';
    const ins = macrosOnly ? NL.macroInsights(tr, targets) : NL.insights(tr, targets);
    const tracked = tr.perNutrient.filter((p) => p.state !== 'info' && inView(p));
    const worst = tracked.filter((p) => p.cat !== 'energy').slice().sort((a, b) => a.adherence - b.adherence)[0];
    const kc = tr.perNutrient[NL.BY_KEY.kcal.index];
    const seg = `<div class="trend-ctrls"><div class="seg" role="group" aria-label="Nutrients shown">${[['all', 'All nutrients'], ['macros', 'Macros only']].map(([k, n]) => `<button data-action="score-view" data-view="${k}" aria-pressed="${(k === 'macros') === macrosOnly}">${n}</button>`).join('')}</div><div class="seg" role="group" aria-label="Time range">${Object.entries(RANGES).map(([k, r]) => `<button data-action="range" data-range="${k}" aria-pressed="${S.range === k}">${r.name}</button>`).join('')}</div></div>`;
    if (!tr.logged) {
      return `<div class="section-head"><h2>Trends</h2>${seg}</div><div class="card"><p class="empty">No meals logged in the last ${R.name}. Log a few days and your patterns show up here.</p></div>`;
    }
    const macroRows = tr.perNutrient.filter((p) => p.cat === 'energy' || p.cat === 'macro');
    const pr = tr.perNutrient[NL.BY_KEY.protein.index];
    const tiles = macrosOnly ? `<div class="tiles">
      <div class="tile"><div class="eyebrow">Macro targets met per day</div><div class="v">${fmt(macroRows.reduce((a, p) => a + p.metDays, 0) / tr.logged)}<span class="muted" style="font-size:1rem"> / ${macroRows.length}</span></div><div class="small muted">calories, protein, carbs, fat, fiber</div></div>
      <div class="tile"><div class="eyebrow">Days logged</div><div class="v">${tr.logged}<span class="muted" style="font-size:1rem"> / ${tr.span}</span></div><div class="small muted">${pct(tr.logged / tr.span)} of the last ${R.name}</div></div>
      <div class="tile"><div class="eyebrow">Average calories</div><div class="v">${fmt(kc.avg)}</div><div class="small"><span class="dot s-${kc.state}">${GLYPH[kc.state]}</span> target ${fmt(targets.kcal.target)} kcal</div></div>
      <div class="tile"><div class="eyebrow">Average protein</div><div class="v">${fmt(pr.avg)}<span class="muted" style="font-size:1rem"> g</span></div><div class="small"><span class="dot s-${pr.state}">${GLYPH[pr.state]}</span> target ${fmt(targets.protein.target)} g · met ${pr.metDays} of ${tr.logged} days</div></div>
    </div>` : `<div class="tiles">
      <div class="tile"><div class="eyebrow">Targets met per day</div><div class="v">${fmt(tr.avgMet)}<span class="muted" style="font-size:1rem"> / ${tr.total}</span></div><div class="small muted">average over logged days</div></div>
      <div class="tile"><div class="eyebrow">Days logged</div><div class="v">${tr.logged}<span class="muted" style="font-size:1rem"> / ${tr.span}</span></div><div class="small muted">${pct(tr.logged / tr.span)} of the last ${R.name}</div></div>
      <div class="tile"><div class="eyebrow">Average calories</div><div class="v">${fmt(kc.avg)}</div><div class="small"><span class="dot s-${kc.state}">${GLYPH[kc.state]}</span> target ${fmt(targets.kcal.target)} kcal</div></div>
      <div class="tile"><div class="eyebrow">Most often missed</div><div class="v" style="font-size:1.4rem">${worst ? esc(worst.name) : '–'}</div><div class="small muted">${worst ? `met on ${worst.metDays} of ${tr.logged} days` : ''}</div></div>
    </div>`;

    const insightsHTML = ins.length ? `<ul class="insights">${ins.map((i) => `<li><span><span class="dot s-${i.tone}"></span></span><span>${esc(i.text)}${i.key && i.tone === 'low' ? ` <button class="btn ghost small" data-action="detail" data-key="${i.key}" data-range="1">Foods that help</button>` : ''}</span></li>`).join('')}</ul>` : `<p class="empty">Log a couple more days to see patterns.</p>`;

    // Heatmap: nutrients × days (or weeks)
    const cols = tr.buckets;
    const cats = NL.CATEGORIES;
    const head = cols.map((b, i) => {
      const dt = NL.parseYmd(b.start);
      let lab = R.bucket === 'week' ? (i % 2 === 0 ? shortDate(b.start) : '') : (dt.getDate() === 1 || i === 0 ? shortDate(b.start) : (R.days <= 7 ? dt.toLocaleDateString('en-US', { weekday: 'narrow' }) : (i % 7 === 0 ? String(dt.getDate()) : '')));
      return `<th scope="col"><span style="display:inline-block;writing-mode:${R.days > 7 ? 'vertical-rl' : 'horizontal-tb'};transform:${R.days > 7 ? 'rotate(180deg)' : 'none'};height:${R.days > 7 ? '3.6em' : 'auto'}">${esc(lab)}</span></th>`;
    }).join('');
    let body = '';
    for (const cat of cats) {
      const rows = tracked.filter((p) => p.cat === cat.key);
      rows.forEach((p, ri) => {
        const idx = NL.BY_KEY[p.key].index;
        const cells = cols.map((b) => {
          if (!b.logged) return `<td class="c-none" title="${esc(shortDate(b.start))}: not logged"></td>`;
          const r = b.report.rows[idx];
          const tip = `${R.bucket === 'week' ? 'Week of ' : ''}${shortDate(b.start)} · ${p.name}: ${fmt(r.value)} ${p.unit} (${STATE_WORD[r.state]}${r.pct != null && r.kind !== 'limit' ? ', ' + pct(r.pct) : ''})`;
          return `<td class="c-${r.state}" title="${esc(tip)}">${R.bucket === 'day' ? `<button data-action="goto-day" data-date="${b.start}" aria-label="${esc(tip)}"></button>` : ''}</td>`;
        }).join('');
        body += `<tr class="${ri === 0 ? 'sep' : ''}"><th scope="row">${esc(p.name)}</th>${cells}</tr>`;
      });
    }
    const heat = `<div class="heat-wrap"><table class="heat"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <div class="legend" style="margin-top:8px">${['met', 'near', 'low', 'over'].map((s) => `<span><span class="sq bg-${s}"></span> ${STATE_WORD[s]}</span>`).join('')}<span><span class="sq none"></span> Not logged</span></div>`;

    const adh = tracked.filter((p) => macrosOnly || p.cat !== 'energy').slice().sort((a, b) => a.adherence - b.adherence).map((p) => `
      <div class="adh"><button class="btn ghost small" style="justify-content:flex-start;padding:2px 4px" data-action="chart-key" data-key="${p.key}">${esc(p.name)}</button><div class="bar"><div class="fill bg-${p.adherence >= 0.8 ? 'met' : p.adherence >= 0.5 ? 'near' : 'low'}" style="width:${(p.adherence * 100).toFixed(1)}%"></div></div><span class="num small" style="text-align:right">${pct(p.adherence)}</span></div>`).join('');

    const chartKey = macrosOnly && !NL.MACRO_KEYS.includes(S.chartKey) ? 'kcal' : S.chartKey;
    const chartOpts = NL.NUTRIENTS.filter((n) => !macrosOnly || NL.MACRO_KEYS.includes(n.key)).map((n) => `<option value="${n.key}" ${n.key === chartKey ? 'selected' : ''}>${esc(n.name)}</option>`).join('');
    return `<div class="section-head"><h2>Trends</h2>${seg}</div>
      ${tiles}
      <div class="trend-grid">
        <div>
          <section class="card"><div class="section-head"><h2>Target map</h2><span class="small muted">${R.bucket === 'week' ? 'Weekly averages' : 'Each square is one day; tap to open it'} · through yesterday</span></div>${heat}</section>
          <section class="card chart"><div class="section-head"><h2>${esc(NL.BY_KEY[chartKey].name)} over time</h2><select class="input" id="chart-key" style="width:auto" aria-label="Nutrient to chart">${chartOpts}</select></div>${chartSVG(tr, chartKey, R)}</section>
        </div>
        <div>
          <section class="card"><h2 style="margin-bottom:10px">What stands out</h2>${insightsHTML}</section>
          <section class="card"><div class="section-head"><h2>Days on target</h2><span class="small muted">share of logged days met</span></div><div class="adherence">${adh}</div></section>
        </div>
      </div>`;
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / p;
    const steps = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10];
    return steps.find((x) => m <= x) * p;
  }
  function chartSVG(tr, key, R) {
    const W = 640, H = 230, L = 48, Rp = 14, T = 14, B = 28;
    const n = NL.BY_KEY[key];
    const t = targets[key] || {};
    const pts = tr.buckets.map((b) => (b.logged ? b.totals[key] : null));
    const vals = pts.filter((v) => v != null);
    const ymax = niceMax(Math.max(...vals, t.target || 0, t.max && t.max < (Math.max(...vals, t.target || 0)) * 3 ? t.max : 0) * 1.08);
    const x = (i) => L + (pts.length === 1 ? (W - L - Rp) / 2 : (i * (W - L - Rp)) / (pts.length - 1));
    const y = (v) => T + (H - T - B) * (1 - v / ymax);
    let grid = '';
    for (let k = 0; k <= 4; k++) {
      const v = (ymax * k) / 4;
      grid += `<line x1="${L}" x2="${W - Rp}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
    }
    let path = '', area = '', started = false, segStart = null;
    pts.forEach((v, i) => {
      if (v == null) { if (started) { area += `L${x(i - 1)},${y(0)}L${x(segStart)},${y(0)}Z`; } started = false; return; }
      if (!started) { path += `M${x(i)},${y(v)}`; area += `M${x(i)},${y(v)}`; segStart = i; started = true; } else { path += `L${x(i)},${y(v)}`; area += `L${x(i)},${y(v)}`; }
    });
    if (started) area += `L${x(pts.length - 1)},${y(0)}L${x(segStart)},${y(0)}Z`;
    const dots = pts.map((v, i) => (v == null ? '' : `<circle cx="${x(i)}" cy="${y(v)}" r="${pts.length > 40 ? 1.8 : 3}" fill="${statusColor(key, v)}"><title>${esc(shortDate(tr.buckets[i].start))}: ${fmt(v)} ${n.unit}</title></circle>`)).join('');
    const lines = [];
    if (t.target != null && t.target <= ymax) lines.push(`<line x1="${L}" x2="${W - Rp}" y1="${y(t.target)}" y2="${y(t.target)}" stroke="var(--met)" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${W - Rp}" y="${y(t.target) - 5}" text-anchor="end" style="fill:var(--met)">target ${fmt(t.target)}</text>`);
    if (t.max != null && t.max <= ymax) lines.push(`<line x1="${L}" x2="${W - Rp}" y1="${y(t.max)}" y2="${y(t.max)}" stroke="var(--over)" stroke-width="1.5" stroke-dasharray="2 4"/><text x="${W - Rp}" y="${y(t.max) - 5}" text-anchor="end" style="fill:var(--over)">${t.kind === 'limit' ? 'limit' : 'upper limit'} ${fmt(t.max)}</text>`);
    const step = Math.max(1, Math.ceil(pts.length / 6));
    let xl = '';
    for (let i = 0; i < pts.length; i += step) xl += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(shortDate(tr.buckets[i].start))}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(n.name)} per ${R.bucket} with target line">
      ${grid}<path d="${area}" fill="var(--accent)" opacity=".08"/>${lines.join('')}<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>${dots}${xl}
      <text x="${L}" y="${T - 2}" text-anchor="start">${esc(n.unit)}${R.bucket === 'week' ? ' per day, weekly average' : ''}</text>
    </svg>`;
  }
  function statusColor(key, v) {
    const s = NL.status(key, v, targets[key]).state;
    return `var(--${s === 'info' ? 'accent' : s})`;
  }

  // ---------------------------------------------------------------------------
  // My foods
  // ---------------------------------------------------------------------------
  function renderFoods() {
    const items = S.data.myFoods.slice().sort((a, b) => a.name.localeCompare(b.name));
    const list = items.length ? `<ul class="food-list">${items.map((f) => {
      const p = f.portions[0];
      const k = p ? kcalOf(f, p[0]) : null;
      const confirming = S.confirm === 'food:' + f.id;
      return `<li><div style="min-width:0"><b>${esc(f.name)}</b> ${foodTag(f)}<div class="small muted">${p ? `${esc(p[1])} (${fmt(p[0])} g) · ${fmt(k)} kcal` : ''}${f.kind === 'recipe' ? ` · ${f.ingredients.length} ingredients, ${f.servings} servings` : ''}</div></div>
        <div class="row">
          <button class="btn small" data-action="log-food" data-id="${f.id}">Log</button>
          ${f.kind !== 'usda' ? `<button class="btn small ghost" data-action="${f.kind === 'recipe' ? 'edit-recipe' : 'edit-custom'}" data-id="${f.id}">Edit</button>` : ''}
          <button class="btn small ghost danger" data-action="del-food" data-id="${f.id}">${confirming ? 'Confirm delete' : 'Delete'}</button>
        </div></li>`;
    }).join('')}</ul>` : `<p class="empty">Nothing here yet. Add a food from a nutrition label, or build a recipe from ingredients so a home-cooked dish is one tap to log.</p>`;
    const meals = sortedSavedMeals();
    const mealList = meals.length ? `<ul class="food-list">${meals.map((m) => {
      const confirming = S.confirm === 'meal:' + m.id;
      return `<li><div style="min-width:0"><b>${esc(m.name)}</b> <span class="tag mine">Meal</span><div class="small muted">${m.items.length} food${m.items.length === 1 ? '' : 's'} · ${fmt(savedMealKcal(m))} kcal · ${esc(m.items.map((x) => x.name.split(',')[0]).join(', '))}</div></div>
        <div class="row">
          <button class="btn small" data-action="log-saved" data-id="${m.id}" data-meal="${m.mealHint || defaultMeal()}" data-today="1">Log</button>
          <button class="btn small ghost" data-action="edit-saved" data-id="${m.id}">Edit</button>
          <button class="btn small ghost danger" data-action="del-saved" data-id="${m.id}">${confirming ? 'Confirm delete' : 'Delete'}</button>
        </div></li>`;
    }).join('')}</ul>` : `<p class="empty">No saved meals yet. On the Today screen, tap <b>☆ Save meal</b> on any meal you've logged to re-log it in one tap.</p>`;
    return `<div class="section-head"><h2>Saved meals</h2></div>
      <section class="card" style="margin-bottom:22px">${mealList}</section>
      <div class="section-head"><h2>My foods &amp; recipes</h2><div class="row"><button class="btn" data-action="new-custom">+ New food</button><button class="btn primary" data-action="new-recipe">+ New recipe</button></div></div>
      <section class="card">${list}</section>
      <p class="foot">Foods you pick from online USDA search are saved here too, so they keep working offline. Log entries point to the saved food, so editing a food or recipe updates every day it was logged.</p>`;
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  function renderSettings() {
    const p = S.data.profile;
    const us = S.data.settings.units === 'us';
    const ft = Math.floor(p.heightCm / 30.48);
    const inch = Math.round((p.heightCm / 2.54) - ft * 12);
    const e = NL.energyTarget(p);
    const rows = NL.NUTRIENTS.map((n) => {
      const t = targets[n.key];
      const o = S.data.overrides[n.key] || {};
      const def = NL.computeTargets(S.data.profile, {})[n.key];
      if (n.kind === 'info') return '';
      return `<tr><td><b>${esc(n.name)}</b><div class="basis">${esc(t.basis)}</div></td>
        <td>${n.kind !== 'limit' ? `<input class="input num" type="number" step="any" min="0" data-target="${n.key}" value="${o.target != null ? o.target : ''}" placeholder="${fmt(def.target)}" aria-label="${esc(n.name)} target">` : '<span class="muted small">–</span>'}</td>
        <td><input class="input num" type="number" step="any" min="0" data-max="${n.key}" value="${o.max != null ? o.max : ''}" placeholder="${def.max != null ? fmt(def.max) : 'none'}" aria-label="${esc(n.name)} maximum"></td>
        <td>${esc(n.unit)}</td>
        <td>${t.custom ? `<button class="btn small ghost" data-action="reset-target" data-key="${n.key}">Reset</button>` : ''}</td></tr>`;
    }).join('');
    const eraseConfirm = S.confirm === 'erase';
    return `<div class="settings-grid">
      <div>
        <section class="card">
          <div class="section-head"><h2>Profile</h2><div class="seg" role="group" aria-label="Units"><button data-action="units" data-units="us" aria-pressed="${us}">lb · ft</button><button data-action="units" data-units="metric" aria-pressed="${!us}">kg · cm</button></div></div>
          <div class="grid2">
            <label class="field"><span>Sex (for reference intakes)</span><select class="input" id="p-sex"><option value="female" ${p.sex === 'female' ? 'selected' : ''}>Female</option><option value="male" ${p.sex === 'male' ? 'selected' : ''}>Male</option></select></label>
            <label class="field"><span>Age</span><input class="input" id="p-age" type="number" min="14" max="110" value="${p.age}"></label>
            ${us ? `<div class="field"><span>Height</span><div class="row" style="flex-wrap:nowrap"><input class="input" id="p-ft" type="number" min="3" max="8" value="${ft}" aria-label="Feet"><span class="muted">ft</span><input class="input" id="p-in" type="number" min="0" max="11" value="${inch}" aria-label="Inches"><span class="muted">in</span></div></div>
              <label class="field"><span>Weight (lb)</span><input class="input" id="p-lb" type="number" min="60" max="700" step="0.1" value="${Math.round(p.weightKg * 2.20462 * 10) / 10}"></label>`
              : `<label class="field"><span>Height (cm)</span><input class="input" id="p-cm" type="number" min="100" max="250" value="${Math.round(p.heightCm)}"></label>
              <label class="field"><span>Weight (kg)</span><input class="input" id="p-kg" type="number" min="30" max="320" step="0.1" value="${Math.round(p.weightKg * 10) / 10}"></label>`}
            <label class="field" style="grid-column:1/-1"><span>Activity</span><select class="input" id="p-activity">${NL.ACTIVITY.map((a) => `<option value="${a.key}" ${a.key === p.activity ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
            <label class="field" style="grid-column:1/-1"><span>Goal</span><select class="input" id="p-goal">${NL.GOALS.map((g) => `<option value="${g.key}" ${g.key === p.goal ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
          </div>
          <p class="small muted" style="margin:12px 0 0">Resting energy ${fmt(e.bmr)} kcal (Mifflin–St Jeor) · daily burn about ${fmt(e.tdee)} kcal · target <b class="num">${fmt(targets.kcal.target)} kcal</b>. Reference intakes don't cover pregnancy, breastfeeding or medical diets; set custom targets with your clinician if those apply.</p>
        </section>
        <section class="card">
          <h2 style="margin-bottom:8px">Online USDA search</h2>
          <p class="small muted" style="margin-top:0">The built-in database has 14,220 USDA foods, including 5,431 everyday foods ranked by how often Americans eat them, and works offline. Online search adds about 400,000 more foods, including branded products, from USDA FoodData Central. It uses the shared demo key (about 30 searches an hour) unless you add your own free key from api.data.gov.</p>
          <label class="field"><span>Your api.data.gov key (optional)</span><input class="input" id="api-key" type="text" autocomplete="off" spellcheck="false" value="${esc(S.data.settings.apiKey || '')}" placeholder="DEMO_KEY"></label>
          <p class="small muted" style="margin-bottom:0">Get a key at <a href="https://fdc.nal.usda.gov/api-key-signup" target="_blank" rel="noopener">fdc.nal.usda.gov/api-key-signup</a>. It's saved only in this browser.</p>
        </section>
        <section class="card">
          <h2 style="margin-bottom:8px">Your data</h2>
          ${S.user
            ? `<p class="small muted" style="margin-top:0">Saved to your account (<b>${esc(S.user.email)}</b>) and synced across your devices: ${S.data.entries.filter((e) => !e.sample).length.toLocaleString('en-US')} entries, ${S.data.myFoods.length} saved foods.</p>`
            : `<p class="small muted" style="margin-top:0">Stored only in this browser on this device: ${S.data.entries.length.toLocaleString('en-US')} entries, ${S.data.myFoods.length} saved foods.${Acct.available ? ' Create a free account to keep it safe and use it on your other devices.' : ' Export a backup to move it to another device.'}</p>
               ${Acct.available ? `<div class="row" style="margin-bottom:10px"><button class="btn primary" data-action="auth-open" data-mode="signup">Create a free account</button><button class="btn" data-action="auth-open" data-mode="signin">Sign in</button></div>` : ''}`}
          <div class="row">
            <button class="btn" data-action="export">Export backup (.json)</button>
            <label class="btn" for="import-file">Import backup</label><input id="import-file" type="file" accept=".json,application/json" hidden>
            ${S.data.sample ? `<button class="btn" data-action="start-own">Remove example data</button>` : S.user ? '' : `<button class="btn" data-action="load-sample">Load example data</button>`}
            <button class="btn danger" data-action="erase">${eraseConfirm ? (S.user ? 'Tap again: this erases your log on every device' : 'Tap again to erase everything') : (S.user ? 'Erase my log' : 'Erase all data')}</button>
          </div>
        </section>
      </div>
      <section class="card">
        <div class="section-head"><h2>Daily targets</h2><span class="small muted">Leave blank to use the recommended value</span></div>
        <div class="table-wrap"><table class="targets"><thead><tr><th>Nutrient</th><th>Target</th><th>Max</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      </section>
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // Sheets: add food, nutrient detail, custom food, recipe
  // ---------------------------------------------------------------------------
  function openSheet(sheet) {
    S.sheet = sheet;
    renderSheet();
    setTimeout(() => {
      // Put the cursor in the sheet's first field, unless that sheet has closed or the person already
      // tapped into a field: on a slow phone this can run late, and stealing focus would send their
      // typing into the wrong box (e.g. the calories ending up in the food's name).
      if (S.sheet !== sheet) return;
      const root = $('#sheet-root');
      const active = document.activeElement;
      if (active && root.contains(active) && active.matches('input, textarea, select')) return;
      const f = root.querySelector('[data-autofocus]');
      if (f) f.focus();
    }, 30);
  }
  function closeSheet() {
    if (S.sheet && S.sheet.type === 'welcome' && !S.data.onboarded) { S.data.onboarded = true; save(); S.dirtyRender = true; } // closing the welcome = skip it
    S.sheet = null;
    if (S.dirtyRender) { S.dirtyRender = false; render(); } else renderSheet();
  }
  function renderSheet() {
    const root = $('#sheet-root');
    if (!S.sheet || S.sheet.type !== 'scan') stopCamera();
    if (!S.sheet) { root.innerHTML = ''; document.body.style.overflow = ''; return; }
    const sh = S.sheet;
    const map = { scan: sheetScan, calendar: sheetCalendar, savemeal: sheetSaveMeal, add: sheetAdd, detail: sheetDetail, custom: sheetCustom, recipe: sheetRecipe, auth: sheetAuth, account: sheetAccount, import: sheetImport, welcome: sheetWelcome };
    const { title, body } = map[sh.type]();
    root.innerHTML = `<div class="scrim" data-action="scrim"><div class="sheet${sh.type === 'calendar' ? ' cal-sheet' : ''}" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="sheet-head"><h2 id="sheet-title">${title}</h2><button class="btn ghost icon" data-action="close-sheet" aria-label="Close">✕</button></div>
      <div class="sheet-body">${body}</div></div></div>`;
    document.body.style.overflow = 'hidden';
    if (sh.type === 'scan') afterScanRender();
  }

  // --- Barcode scanning -------------------------------------------------------
  // Phones and tablets get a camera scanner; everyone can type the number into search.
  // Lookup order: foods already on this device (works offline) → Open Food Facts → USDA branded foods.
  const BARCODE_ICON = '<svg class="bc-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M10 8v8M13 8v8M16 8v8" class="bars"/></svg>';
  const ZXING_SRC = 'src/vendor/zxing-library-0.23.0.min.js';
  const SCAN = { stream: null, timer: null, detector: null, reader: null, canvas: null, run: 0 };
  function canScan() {
    if (!CFG || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
    return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }
  function localBarcodeFood(code) { return S.data.myFoods.find((f) => f.barcode && NL.sameBarcode(f.barcode, code)) || null; }
  function newAddSheet(meal) { return { type: 'add', mode: 'add', meal: meal || defaultMeal(), date: S.date, view: 'search', query: '', selected: null, online: null }; }
  function openScan(parent, meal, code) {
    const sh = { type: 'scan', parent, meal: meal || (parent && parent.meal) || defaultMeal(), status: canScan() ? 'camera' : 'manual', code: '', message: '', productName: '' };
    openSheet(sh);
    if (code) runLookup(code);
  }
  function sheetScan() {
    const sh = S.sheet;
    const manual = `<div id="bc-form" class="bc-manual"><label class="field" style="flex:1"><span>${sh.status === 'camera' ? 'Or type the number under the barcode' : 'Number under the barcode'}</span><input class="input num" id="bc-input" inputmode="numeric" autocomplete="off" placeholder="e.g. 012345678905" value="${esc(sh.code)}"${sh.status === 'manual' ? ' data-autofocus' : ''}></label><button type="button" class="btn" data-action="bc-lookup">Look up</button></div>`;
    let top = '';
    if (sh.status === 'camera') {
      top = `<div class="scan-view"><video id="scan-video" playsinline muted autoplay></video><div class="scan-frame" aria-hidden="true"><span></span></div></div>
        <p class="small muted" id="scan-msg" role="status" style="text-align:center">Starting the camera…</p>`;
    } else if (sh.status === 'lookup') {
      top = `<p class="scan-status" role="status">Looking up <b>${esc(sh.code)}</b>…</p>`;
    } else if (sh.status === 'notfound') {
      top = `<div class="scan-status" role="status"><b>${sh.productName ? esc(sh.productName) + ' has no nutrition facts online yet' : `No product found for ${esc(sh.code)}`}</b>
          <p class="small muted">Checked Open Food Facts and USDA. Add it once from the label, and scanning it again will find it.</p>
          <div class="row" style="justify-content:center"><button class="btn primary" data-action="bc-custom">Add from the label</button>${canScan() ? '<button class="btn" data-action="scan-again">Scan again</button>' : ''}</div></div>`;
    } else if (sh.status === 'error') {
      top = `<div class="scan-status" role="status"><b>${esc(sh.message)}</b>${canScan() ? '<div class="row" style="justify-content:center;margin-top:10px"><button class="btn" data-action="scan-again">Try the camera again</button></div>' : ''}</div>`;
    } else {
      top = `<p class="small muted" style="margin-top:0">Type the digits printed under the barcode (UPC or EAN). Products are looked up in Open Food Facts and USDA FoodData Central.</p>`;
    }
    return { title: 'Scan a barcode', body: top + manual };
  }
  function scanMsg(t) { const el = $('#scan-msg'); if (el) el.textContent = t; }
  function stopCamera() {
    SCAN.run++;
    clearTimeout(SCAN.timer);
    if (SCAN.stream) { for (const t of SCAN.stream.getTracks()) t.stop(); SCAN.stream = null; }
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src; el.onload = resolve; el.onerror = () => reject(new Error('script'));
      document.head.appendChild(el);
    });
  }
  /** Native BarcodeDetector where it exists (Chrome on Android); otherwise the bundled ZXing decoder (iPhone Safari). */
  async function makeDecoder() {
    const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
    if ('BarcodeDetector' in window) {
      try {
        const ok = await window.BarcodeDetector.getSupportedFormats();
        if (formats.some((f) => ok.includes(f))) {
          const det = new window.BarcodeDetector({ formats: formats.filter((f) => ok.includes(f)) });
          return async (video) => { const r = await det.detect(video); return r.length ? r[0].rawValue : null; };
        }
      } catch (e) { /* fall back to ZXing */ }
    }
    if (!window.ZXing) await loadScript(ZXING_SRC);
    const Z = window.ZXing;
    const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]);
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    const reader = new Z.MultiFormatReader();
    reader.setHints(hints);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return async (video) => {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return null;
      // Decode the middle band of the picture, where the guide box is, scaled down for speed.
      const sh = Math.round(vh * 0.5), sy = Math.round((vh - sh) / 2);
      const scale = Math.min(1, 960 / vw);
      canvas.width = Math.round(vw * scale); canvas.height = Math.round(sh * scale);
      ctx.drawImage(video, 0, sy, vw, sh, 0, 0, canvas.width, canvas.height);
      try {
        const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
        return reader.decode(bmp, hints).getText();
      } catch (e) { return null; } finally { reader.reset(); }
    };
  }
  async function afterScanRender() {
    const sh = S.sheet;
    if (sh.status !== 'camera') { stopCamera(); return; }
    const video = $('#scan-video');
    const run = ++SCAN.run;
    try {
      if (!SCAN.stream) {
        SCAN.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      }
      if (run !== SCAN.run || S.sheet !== sh) { if (S.sheet !== sh) stopCamera(); return; }
      video.srcObject = SCAN.stream;
      await video.play().catch(() => {});
      const decode = await makeDecoder();
      if (run !== SCAN.run || S.sheet !== sh) return;
      scanMsg('Hold the barcode inside the box.');
      const tick = async () => {
        if (run !== SCAN.run || S.sheet !== sh) return;
        let code = null;
        try { code = NL.normalizeBarcode(await decode(video)); } catch (e) { code = null; }
        if (run !== SCAN.run || S.sheet !== sh) return;
        if (code) {
          if (navigator.vibrate) navigator.vibrate(60);
          stopCamera();
          runLookup(code);
          return;
        }
        SCAN.timer = setTimeout(tick, 120);
      };
      tick();
    } catch (err) {
      if (run !== SCAN.run || S.sheet !== sh) return;
      stopCamera();
      const name = err && err.name;
      sh.status = 'error';
      sh.message = name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Camera access is turned off for this site. Allow it in your browser settings, or type the number below.'
        : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'No camera was found. Type the number below instead.'
          : err && err.message === 'script' ? 'The scanner couldn\'t load (are you offline?). Type the number below instead.'
            : 'The camera couldn\'t start. Type the number below instead.';
      renderSheet();
    }
  }
  async function fetchJson(url, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms || 10000);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (res.status === 404) return { notFound: true };
      if (!res.ok) throw new Error('http ' + res.status);
      return { json: await res.json() };
    } finally { clearTimeout(timer); }
  }
  /** Find a product by barcode. Resolves { food } | { notFound, productName } | { error }. */
  async function lookupBarcode(code) {
    const local = localBarcodeFood(code);
    if (local) return { food: local };
    if (!CFG) return { error: 'Barcode lookup needs the full app at simplynutrition.app; this preview can\'t reach outside sites.' };
    let productName = '';
    let reached = false;
    try {
      const fields = 'code,product_name,product_name_en,generic_name,generic_name_en,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit,quantity,product_quantity,product_quantity_unit';
      const r = await fetchJson(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${fields}`);
      reached = true;
      const p = r.json && r.json.status === 1 ? r.json.product : null;
      const food = NL.fromOff(p, code);
      if (food) return { food };
      if (p) productName = String(p.product_name_en || p.product_name || '').trim() + (p.brands ? ` (${String(p.brands).split(',')[0].trim()})` : '');
    } catch (e) { /* try USDA */ }
    try {
      const key = (S.data.settings.apiKey || '').trim() || 'DEMO_KEY';
      const r = await fetchJson(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(code)}&dataType=Branded&pageSize=10`);
      reached = true;
      const item = ((r.json && r.json.foods) || []).find((x) => x.gtinUpc && NL.sameBarcode(x.gtinUpc, code));
      if (item) {
        const food = NL.fromFdc(item);
        if (food.per100[0] != null) return { food: Object.assign(food, { barcode: code, source: 'USDA FoodData Central' }) };
      }
    } catch (e) { /* fall through */ }
    if (!reached) return { error: navigator.onLine === false ? 'You\'re offline. Barcodes you\'ve scanned before still work; new ones need a connection.' : 'Couldn\'t reach the product databases. Check your connection and try again.' };
    return { notFound: true, productName: productName.replace(/^\(|\)$/g, '').trim() };
  }
  async function runLookup(code) {
    const sh = S.sheet;
    stopCamera();
    sh.status = 'lookup'; sh.code = code; sh.productName = '';
    renderSheet();
    const r = await lookupBarcode(code);
    if (S.sheet !== sh) return; // closed meanwhile
    if (r.food) {
      const food = r.food;
      if (!myById.has(food.id) && !S.data.myFoods.some((f) => f.id === food.id)) { S.data.myFoods.push(stripFood(food)); save(); reindex(); }
      const target = sh.parent || newAddSheet(sh.meal);
      target.selected = null;
      S.sheet = target;
      const saved = myById.get(food.id) || food;
      const last = [...S.data.entries].reverse().find((e) => e.src === 'my' && e.fid === saved.id);
      if (last) selectFood(saved, last.qty, last.unit, last.unitGrams); else selectFood(saved, 1);
      renderSheet();
      return;
    }
    if (r.notFound) { sh.status = 'notfound'; sh.productName = r.productName || ''; }
    else { sh.status = 'error'; sh.message = r.error; }
    renderSheet();
  }

  // --- Add / edit food -------------------------------------------------------
  function openAdd(opts) {
    openSheet(Object.assign({ type: 'add', mode: 'add', meal: defaultMeal(), date: S.date, view: 'search', query: '', selected: null, online: null }, opts));
  }
  function recentFoods() {
    const seen = new Set();
    const out = [];
    for (let i = S.data.entries.length - 1; i >= 0 && out.length < 25; i--) {
      const e = S.data.entries[i];
      const k = e.src + ':' + e.fid;
      if (seen.has(k)) continue;
      const f = resolve(e);
      if (!f) continue;
      seen.add(k);
      out.push({ food: f, entry: e });
    }
    return out;
  }
  function resultsHTML() {
    const sh = S.sheet;
    if (sh.view === 'recent') {
      const rec = recentFoods();
      if (!rec.length) return `<p class="empty">Foods you log show up here for one-tap adding.</p>`;
      return `<ul class="results">${rec.map(({ food, entry }) => `<li class="result"><button class="pick" data-action="pick" data-src="${food.src}" data-fid="${food.id}"><b>${esc(food.name)}</b><span class="meta">${esc(portionText(entry))} · ${fmt(kcalOf(food, entry.grams))} kcal</span></button>${sh.mode === 'add' ? `<button class="btn small" data-action="quick-add" data-entry="${entry.id}" aria-label="Add ${esc(food.name)} again">+ Add</button>` : ''}</li>`).join('')}</ul>`;
    }
    if (sh.view === 'meals') {
      if (!S.data.savedMeals.length) return `<p class="empty">No saved meals yet. Log a meal you eat often, then tap <b>☆ Save meal</b> on it to re-log it in one tap.</p>`;
      return `<ul class="results">${sortedSavedMeals(sh.meal).map((m) => `<li class="result"><div class="pick" style="cursor:default"><b>${esc(m.name)}</b><span class="meta">${m.items.length} food${m.items.length === 1 ? '' : 's'} · ${fmt(savedMealKcal(m))} kcal · ${esc(m.items.map((x) => x.name.split(',')[0]).join(', ').slice(0, 70))}</span></div><button class="btn small" data-action="log-saved" data-id="${m.id}" data-meal="${sh.meal}">+ Add</button></li>`).join('')}</ul>`;
    }
    if (sh.view === 'mine') {
      if (!S.data.myFoods.length) return `<p class="empty">No saved foods yet. Create them under My foods.</p>`;
      return `<ul class="results">${S.data.myFoods.map((f) => `<li class="result"><button class="pick" data-action="pick" data-src="my" data-fid="${f.id}"><b>${esc(f.name)}</b><span class="meta">${foodTag(f)}</span></button></li>`).join('')}</ul>`;
    }
    const q = sh.query.trim();
    const code = NL.normalizeBarcode(q);
    if (code) {
      const known = localBarcodeFood(code);
      return `<div class="bc-typed">${BARCODE_ICON}<div><b>Barcode ${esc(code)}</b><span class="small muted">${known ? esc(known.name) : 'Look it up in Open Food Facts and USDA'}</span></div><button class="btn small accent" data-action="bc-lookup" data-code="${code}">${known ? 'Use it' : 'Look up'}</button></div>`;
    }
    if (!q) return `<p class="empty">Search ${db.foods.length.toLocaleString('en-US')} USDA foods, or switch to Recent for one-tap adds.</p>`;
    const mine = S.data.myFoods.filter((f) => NL.tokenize(q).every((t) => f.name.toLowerCase().includes(t))).slice(0, 5);
    const res = db.search(q, { limit: 30, usage });
    const kinds = db.kindsFor(q);
    const row = (f) => {
      const p = (f.portions && f.portions[0]) || [100, '100 g'];
      const n = f.src === 'sr' ? db.versionsOf(f).length : 1;
      const title = f.src === 'sr' ? f.familyName : f.name;
      const detail = f.src === 'sr' && f.version && db.versionsOf(f).length > 1 ? `<span class="version">${esc(f.db === 'fndds' ? f.version.charAt(0).toUpperCase() + f.version.slice(1) : versionLabel(f.version))}</span>` : '';
      return `<li class="result"><button class="pick" data-action="pick" data-src="${f.src}" data-fid="${f.id}"><b>${esc(title)}</b>${detail}<span class="meta">${foodTag(f)} ${esc(p[1])} · ${fmt(kcalOf(f, p[0]))} kcal${n > 1 ? ` · <span class="versions">${n} versions</span>` : ''}</span></button></li>`;
    };
    const kindsRow = kinds ? `<div class="kinds" role="group" aria-label="Which kind?"><span class="eyebrow">Which kind?</span>${kinds.map(([label, kq]) => `<button class="chip" data-action="kind" data-q="${esc(kq)}">${esc(label)}</button>`).join('')}</div>` : '';
    let online = '';
    const o = sh.online;
    if (o && o.query === q) {
      if (o.status === 'loading') online = `<p class="small muted">Searching USDA FoodData Central…</p>`;
      else if (o.status === 'error') online = `<p class="small" style="color:var(--low)">${esc(o.message)}</p>`;
      else if (o.status === 'done') online = o.results.length ? `<div class="eyebrow" style="margin-top:14px">USDA FoodData Central (online)</div><ul class="results">${o.results.map((f, i) => `<li class="result"><button class="pick" data-action="pick-online" data-i="${i}"><b>${esc(f.name)}</b><span class="meta"><span class="tag mine">${esc(f.dataType || 'USDA')}</span> per 100 g · ${fmt(f.per100[0])} kcal</span></button></li>`).join('')}</ul>` : `<p class="empty">No online results for “${esc(q)}”.</p>`;
    }
    return `${kindsRow}${mine.length ? `<div class="eyebrow" style="margin-top:6px">My foods</div><ul class="results">${mine.map(row).join('')}</ul>` : ''}
      ${resultListHTML(res, row, q)}
      <div class="row" style="margin-top:12px"><button class="btn small" data-action="search-online">Search USDA online for “${esc(q)}”</button><button class="btn small ghost" data-action="new-custom-from-search">Create a custom food</button></div>
      ${online}`;
  }
  /** USDA version details, cooking method first and in plain words: "Grilled · lean & fat · 0" trim · all grades". */
  function versionLabel(v) {
    if (!v) return '';
    const parts = v.split(/,\s*/);
    const rank = (p) => (/^(raw|cooked|unprepared|prepared|frozen|canned)$/i.test(p) ? 0 : /(broiled|grilled|roasted|braised|stewed|baked|boiled|fried|simmered|steamed|microwaved|poached|scrambled|pan-browned|dry heat|moist heat)/i.test(p) ? 1 : /lean|meat|skin/i.test(p) ? 2 : /trimmed/i.test(p) ? 3 : /choice|select|prime|grades/i.test(p) ? 4 : 5);
    const nice = (p) => p.replace(/^separable lean only$/i, 'lean only').replace(/^separable lean and fat$/i, 'lean & fat').replace(/^trimmed to (.*) fat$/i, '$1 fat trim').replace(/^without salt$/i, 'no salt').replace(/^dry heat$|^moist heat$/i, '');
    const sorted = parts.map((p, i) => [rank(p), i, nice(p)]).filter((x) => x[2]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
    // "cooked" adds nothing when a method follows it.
    const out = sorted.filter((p, i) => !(p.toLowerCase() === 'cooked' && sorted[i + 1] && rank(sorted[i + 1]) === 1));
    const text = out.join(' · ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  /** Grade, trim, cooking method etc. for USDA foods that come in several versions. */
  function versionPickerHTML(f) {
    if (f.src !== 'sr') return '';
    const vs = db.versionsOf(f);
    if (vs.length < 2) return f.version ? `<p class="small muted" style="margin:0">${esc(versionLabel(f.version))}</p>` : '';
    const label = (v) => (v.db === 'fndds' ? (v.version ? v.version.charAt(0).toUpperCase() + v.version.slice(1) : 'Standard') : versionLabel(v.version) || 'Standard');
    return `<label class="field"><span>Version (${vs.length})</span><select class="input" id="pp-version">${vs.map((v) => `<option value="${v.id}" ${v.id === f.id ? 'selected' : ''}>${esc(label(v))} · ${fmt(v.per100[0])} kcal/100 g</option>`).join('')}</select></label>`;
  }
  // ---- Saved meals ---------------------------------------------------------
  function savedMealKcal(m) { return m.items.reduce((a, x) => { const f = foodOf(x.src, x.fid); return a + (f ? kcalOf(f, x.grams) || 0 : 0); }, 0); }
  /** Meals saved from this slot first, then the most used. */
  function sortedSavedMeals(slot) {
    return S.data.savedMeals.slice().sort((a, b) => (slot ? (a.mealHint === slot ? 0 : 1) - (b.mealHint === slot ? 0 : 1) : 0) || (b.uses || 0) - (a.uses || 0) || a.name.localeCompare(b.name));
  }
  function savedMealChipsHTML(slot) {
    // Only meals saved from this slot; any meal can still be logged anywhere from the Meals tab.
    const list = sortedSavedMeals(slot).filter((m) => m.mealHint === slot).slice(0, 3);
    if (!list.length) return '';
    return `<div class="meal-chips">${list.map((m) => `<button class="chip meal-chip" data-action="log-saved" data-id="${m.id}" data-meal="${slot}">+ ${esc(m.name)} <span class="muted num">${fmt(savedMealKcal(m))} kcal</span></button>`).join('')}</div>`;
  }
  /** Log every food of a saved meal. Returns how many were added. */
  function logSavedMeal(meal, date, slot) {
    let n = 0;
    for (const x of meal.items) {
      const f = foodOf(x.src, x.fid);
      if (!f) continue; // a custom food that was deleted
      addEntry(date, slot, f, x.qty, { label: x.unit, grams: x.unitGrams || x.grams / (x.qty || 1) });
      n++;
    }
    meal.uses = (meal.uses || 0) + 1;
    meal.updatedAt = Date.now();
    return n;
  }
  function suggestMealName(items, slot) {
    const names = items.map((x) => x.name.split(',')[0].replace(/^(Boiled or poached|Fried|Cooked|Raw) /, '').trim());
    const uniq = [...new Set(names)];
    const base = uniq.slice(0, 2).join(' & ') + (uniq.length > 2 ? ` + ${uniq.length - 2} more` : '');
    return (base || NL.MEALS.find((m) => m.key === slot).name).slice(0, 60);
  }
  // Calendar: jump to any day. Days with something logged get a dot.
  function sheetCalendar() {
    const sh = S.sheet;
    const [y, m] = sh.month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const start = NL.addDays(NL.ymd(first), -first.getDay()); // weeks start on Sunday
    const monthName = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    let cells = '';
    let logged = 0;
    for (let i = 0; i < 42; i++) {
      const d = NL.addDays(start, i);
      const dt = NL.parseYmd(d);
      const inMonth = dt.getMonth() === m - 1;
      if (i === 35 && !inMonth) break; // drop an empty sixth week
      const has = (byDate.get(d) || []).length > 0;
      if (has && inMonth) logged++;
      const cls = ['cal-day', inMonth ? '' : 'out', d === S.today ? 'is-today' : '', d === S.date ? 'sel' : '', d > S.today ? 'future' : '', has ? 'logged' : ''].filter(Boolean).join(' ');
      const label = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + (has ? ', logged' : '');
      cells += `<button class="${cls}" data-action="cal-pick" data-date="${d}" aria-label="${label}"${d === S.date ? ' aria-current="date"' : ''}>${dt.getDate()}</button>`;
    }
    const thisMonth = S.today.slice(0, 7);
    const body = `<div class="cal-head">
        <button class="btn ghost icon" data-action="cal-month" data-step="-1" aria-label="Previous month">‹</button>
        <b aria-live="polite">${monthName}</b>
        <button class="btn ghost icon" data-action="cal-month" data-step="1" aria-label="Next month">›</button>
      </div>
      <div class="cal-grid">${['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((w) => `<span class="dow" aria-hidden="true">${w}</span>`).join('')}${cells}</div>
      <div class="cal-foot"><span class="small muted">${logged ? `${logged} day${logged === 1 ? '' : 's'} logged this month` : 'Nothing logged this month'}</span>
        ${sh.month !== thisMonth || S.date !== S.today ? '<button class="btn small" data-action="cal-pick" data-date="' + S.today + '">Today</button>' : ''}</div>`;
    return { title: 'Go to a day', body };
  }
  function shiftMonth(month, n) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function sheetSaveMeal() {
    const sh = S.sheet;
    const items = sh.items;
    return { title: sh.id ? 'Edit saved meal' : 'Save this meal', body: `<form class="portion-pane" data-form="savemeal">
      <label class="field"><span>Name</span><input class="input" id="sm-name" maxlength="60" value="${esc(sh.name)}" data-autofocus></label>
      <ul class="list-plain">${items.map((x, i) => `<li><span>${esc(x.name)} <span class="small muted">${esc(portionText(x))}</span></span><span class="row" style="flex-wrap:nowrap"><span class="num small muted">${(() => { const f = foodOf(x.src, x.fid); return f ? fmt(kcalOf(f, x.grams)) + ' kcal' : 'food removed'; })()}</span>${items.length > 1 ? `<button type="button" class="btn ghost icon" data-action="sm-remove-item" data-i="${i}" aria-label="Remove ${esc(x.name)}">✕</button>` : ''}</span></li>`).join('')}</ul>
      <p class="small muted" style="margin:0">One tap logs all of these with the same amounts. You can still edit each entry after logging.</p>
      <p class="small" role="alert" data-auth-error style="color:var(--low);margin:0" hidden></p>
      <div class="row" style="justify-content:flex-end">${sh.id ? `<button type="button" class="btn danger" data-action="sm-delete">Delete</button>` : ''}<button type="button" class="btn ghost" data-action="close-sheet">Cancel</button><button type="submit" class="btn primary">Save</button></div>
    </form>` };
  }

  /** Everyday foods first; USDA's database-style reference entries tucked into a collapsed section when there are everyday matches. */
  function resultListHTML(res, row, q) {
    if (!res.length) return `<p class="empty">No built-in match for “${esc(q)}”. Try a simpler word (“yogurt” instead of “strawberry yogurt cup”) or search online.</p>`;
    const everyday = res.filter((f) => f.db !== 'sr28');
    const detail = res.filter((f) => f.db === 'sr28');
    if (!everyday.length || !detail.length) return `<ul class="results">${res.map(row).join('')}</ul>`;
    return `<ul class="results">${everyday.map(row).join('')}</ul>
      <details class="more-detail"><summary>More detailed USDA entries (${detail.length})</summary><p class="small muted" style="margin:6px 0 0">Lab reference entries with exact cuts, grades and preparations. Useful when you know precisely what you ate.</p><ul class="results">${detail.map(row).join('')}</ul></details>`;
  }
  function portionPaneHTML() {
    const sel = S.sheet.selected;
    const f = sel.food;
    return `<div class="portion-pane">
      <div><button class="btn ghost small" data-action="unpick">‹ Back to results</button></div>
      <div><b style="font-size:1.05rem">${esc(f.src === 'sr' ? f.familyName : f.name)}</b> ${foodTag(f)}</div>
      ${versionPickerHTML(f)}
      <div class="row">
        <label class="field" style="width:7em"><span>Amount</span><input class="input num" id="pp-qty" type="number" inputmode="decimal" min="0" step="any" value="${sel.qty}" data-autofocus></label>
        <label class="field" style="flex:1 1 12em"><span>Unit</span><select class="input" id="pp-unit">${sel.portions.map((p, j) => `<option value="${j}" ${j === sel.unitIdx ? 'selected' : ''}>${esc(p.label)}${p.label !== 'g' ? ` (${fmt(p.grams)} g)` : ''}</option>`).join('')}</select></label>
        ${S.sheet.mode !== 'ingredient' ? `<label class="field" style="flex:1 1 9em"><span>Meal</span><select class="input" id="pp-meal">${NL.MEALS.map((m) => `<option value="${m.key}" ${m.key === S.sheet.meal ? 'selected' : ''}>${m.name}</option>`).join('')}</select></label>` : ''}
      </div>
      <div id="pp-preview">${portionPreviewHTML()}</div>
      ${f.kind === 'barcode' ? `<p class="small muted" style="margin:0">Nutrition from ${f.source === 'Open Food Facts' ? '<a href="https://world.openfoodfacts.org/" target="_blank" rel="noopener">Open Food Facts</a>' : esc(f.source || 'the label')} for barcode ${esc(f.barcode)}. Labels list only some vitamins and minerals; the rest show as unknown, not zero.</p>` : ''}
      <div class="row" style="justify-content:flex-end">
        ${S.sheet.mode === 'edit' ? `<button class="btn danger" data-action="del-entry" data-id="${S.sheet.entryId}">Delete</button>` : ''}
        <button class="btn primary" data-action="confirm-add">${S.sheet.mode === 'edit' ? 'Save changes' : S.sheet.mode === 'ingredient' ? 'Add ingredient' : 'Add to log'}</button>
      </div>
    </div>`;
  }
  function portionPreviewHTML() {
    const sel = S.sheet.selected;
    const grams = (Number(sel.qty) || 0) * sel.portions[sel.unitIdx].grams;
    const v = NL.scale(sel.food.per100, grams);
    const get = (k) => v[NL.BY_KEY[k].index];
    const day = dayData(S.sheet.date || S.date);
    const micro = NL.NUTRIENTS.filter((n) => n.kind === 'min' && n.cat !== 'macro').map((n) => {
      const t = targets[n.key];
      const amt = get(n.key);
      return { n, amt, share: amt == null || !t.target ? null : amt / t.target, before: day.totals[n.key] / t.target };
    }).filter((x) => x.share != null && x.share >= 0.05).sort((a, b) => b.share - a.share).slice(0, 8);
    return `<div class="preview-grid">
        <div class="p"><span class="small muted">Calories</span><b>${fmt(get('kcal'))}</b></div>
        <div class="p"><span class="small muted">Protein</span><b>${fmt(get('protein'))} g</b></div>
        <div class="p"><span class="small muted">Carbs</span><b>${fmt(get('carbs'))} g</b></div>
        <div class="p"><span class="small muted">Fat</span><b>${fmt(get('fat'))} g</b></div>
      </div>
      <div class="eyebrow" style="margin:12px 0 6px">${micro.length ? 'Biggest contributions to your daily targets' : 'Little micronutrient value in this amount'} <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:500">· ${fmt(grams)} g</span></div>
      ${micro.length ? `<div class="mini-bars">${micro.map((x) => `<div class="m"><div class="row" style="justify-content:space-between"><span>${esc(x.n.name)}</span><span class="num muted">+${pct(x.share)}</span></div><div class="bar"><div class="fill bg-near" style="width:${Math.min(100, x.before * 100).toFixed(1)}%;opacity:.45"></div><div class="fill bg-met" style="left:${Math.min(100, x.before * 100).toFixed(1)}%;width:${Math.max(0, Math.min(100 - x.before * 100, x.share * 100)).toFixed(1)}%"></div></div></div>`).join('')}</div><p class="small muted" style="margin:6px 0 0">Faded: what you've already had this day. Solid: what this food adds.</p>` : ''}`;
  }
  function sheetAdd() {
    const sh = S.sheet;
    const title = sh.mode === 'edit' ? 'Edit entry' : sh.mode === 'ingredient' ? 'Add ingredient' : `Add to ${NL.MEALS.find((m) => m.key === sh.meal).name}`;
    if (sh.selected) return { title, body: portionPaneHTML() };
    const views = [['search', 'Search'], ['recent', 'Recent']].concat(sh.mode === 'add' ? [['meals', 'Meals']] : [], [['mine', 'My foods']]);
    return {
      title,
      body: `<div class="row" style="flex-wrap:nowrap"><input class="input" id="add-q" type="search" placeholder="Search foods, e.g. oatmeal, salmon, greek yogurt" value="${esc(sh.query)}" autocomplete="off" data-autofocus aria-label="Search foods">${canScan() && sh.mode !== 'parsed' ? `<button class="btn scan-btn" data-action="scan-open" aria-label="Scan a barcode">${BARCODE_ICON}<span>Scan</span></button>` : ''}</div>
        <div class="seg" role="group" aria-label="Food lists" style="margin-top:10px">${views.map(([k, n]) => `<button data-action="add-view" data-view="${k}" aria-pressed="${sh.view === k}">${n}</button>`).join('')}</div>
        <div id="add-results">${resultsHTML()}</div>`,
    };
  }
  function selectFood(food, qty, unitLabel, unitGrams) {
    let first = null;
    if (unitLabel && unitGrams && !NL.portionsFor(food).some((p) => p.label === unitLabel)) first = { label: unitLabel, grams: unitGrams };
    const portions = portionChoices(food, first);
    let unitIdx = unitLabel ? portions.findIndex((p) => p.label === unitLabel) : 0;
    if (unitIdx < 0) unitIdx = 0;
    S.sheet.selected = { food, qty: qty == null ? 1 : qty, portions, unitIdx };
  }

  async function searchOnline() {
    const sh = S.sheet;
    const q = sh.query.trim();
    if (!q) return;
    sh.online = { query: q, status: 'loading' };
    $('#add-results').innerHTML = resultsHTML();
    const key = (S.data.settings.apiKey || '').trim() || 'DEMO_KEY';
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(q)}&pageSize=25&dataType=${encodeURIComponent('Foundation,SR Legacy,Survey (FNDDS),Branded')}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (res.status === 429) throw new Error('rate');
      if (res.status === 403 || res.status === 401) throw new Error('key');
      if (!res.ok) throw new Error('http');
      const json = await res.json();
      sh.online = { query: q, status: 'done', results: (json.foods || []).map(NL.fromFdc).filter((f) => f.per100[0] != null) };
    } catch (err) {
      const m = String(err && err.message);
      sh.online = {
        query: q, status: 'error',
        message: m === 'rate' ? 'The shared demo key is out of searches for now. Add your own free api.data.gov key under Profile.'
          : m === 'key' ? 'USDA rejected the API key. Check it under Profile.'
            : 'Online search isn\'t reachable from this copy of the app (some hosts, including the claude.ai preview, block outside requests). The built-in USDA foods above still work, and you can add any label as a custom food.',
      };
    } finally {
      clearTimeout(timer);
    }
    if (S.sheet === sh && !sh.selected) $('#add-results').innerHTML = resultsHTML();
  }

  function confirmAdd() {
    const sh = S.sheet;
    const sel = sh.selected;
    const qty = Number(sel.qty);
    if (!(qty > 0)) { toast('Enter an amount above zero.'); return; }
    const portion = sel.portions[sel.unitIdx];
    if (sh.mode === 'ingredient') {
      sh.parent.ingredients.push({ food: sel.food, qty, portions: sel.portions, unitIdx: sel.unitIdx });
      S.sheet = sh.parent;
      renderSheet();
      return;
    }
    const meal = ($('#pp-meal') && $('#pp-meal').value) || sh.meal;
    if (sel.food.kind === 'usda' && !myById.has(sel.food.id)) { S.data.myFoods.push(stripFood(sel.food)); }
    if (sh.mode === 'edit') {
      const e = S.data.entries.find((x) => x.id === sh.entryId);
      if (e) Object.assign(e, { meal, src: sel.food.src, fid: sel.food.id, name: sel.food.name, qty, unit: portion.label, unitGrams: portion.grams, grams: Math.round(qty * portion.grams * 10) / 10 });
      toast('Entry updated');
    } else {
      addEntry(sh.date, meal, sel.food, qty, portion);
      toast(`Added to ${NL.MEALS.find((m) => m.key === meal).name}`);
    }
    S.sheet = null;
    commit();
  }
  function stripFood(f) { const o = Object.assign({}, f); delete o.tokens; delete o.lower; return o; }

  // --- Nutrient detail ------------------------------------------------------
  function sheetDetail() {
    const key = S.sheet.key;
    const n = NL.BY_KEY[key];
    const d = dayData(S.date);
    const r = d.rep.rows[n.index];
    const t = r.target;
    const contrib = NL.contributors(d.entries, resolve, key, 6);
    const gap = t && t.target != null ? t.target - r.value : 0;
    const suggestable = (n.kind === 'min' || (n.kind === 'range' && key !== 'kcal')) && key !== 'kcal';
    const sug = suggestable && gap > 0 ? NL.suggestFoods(db, key, gap, { usage }) : [];
    const goal = !t || r.state === 'info' ? 'No daily target' : n.kind === 'limit' || t.target == null ? `limit ${fmt(t.max)} ${n.unit}` : `target ${fmt(t.target)} ${n.unit}${t.max ? ` · upper limit ${fmt(t.max)} ${n.unit}` : ''}`;
    const body = `
      <div class="detail-top"><span class="big">${fmt(r.value)}</span><span class="muted">${esc(n.unit)} · ${esc(goal)}</span><span class="chip ${r.state}" style="cursor:default"><span class="dot s-${r.state}">${GLYPH[r.state]}</span>${STATE_WORD[r.state]}${r.pct != null && n.kind !== 'limit' ? ' · ' + pct(r.pct) : ''}</span></div>
      ${t ? `<p class="small muted">${esc(t.basis)}. ${esc(dateLabel(S.date))}.</p>` : ''}
      ${r.missing ? `<p class="small" style="color:var(--near)">${r.missing} of the foods you logged have no lab value for ${esc(n.name.toLowerCase())}, so the real total is probably higher.</p>` : ''}
      <h3 style="margin-top:14px">Where it came from</h3>
      ${contrib.length ? `<ul class="list-plain">${contrib.map((c) => `<li><span>${esc(c.entry.name)} <span class="small muted">${esc(portionText(c.entry))}</span></span><span class="num"><b>${fmt(c.amount)}</b> ${esc(n.unit)}</span></li>`).join('')}</ul>` : `<p class="empty">Nothing logged with ${esc(n.name.toLowerCase())} yet.</p>`}
      ${sug.length ? `<h3 style="margin-top:16px">Foods that would close the ${fmt(gap)} ${esc(n.unit)} gap</h3>
        <ul class="list-plain">${sug.map((s, i) => `<li><span><b>${esc(s.food.name)}</b><br><span class="small muted">${esc(s.portion.label)} (${fmt(s.portion.grams)} g) · ${fmt(s.kcal)} kcal</span></span><span class="row" style="flex-wrap:nowrap"><span class="num">+${fmt(s.amount)} ${esc(n.unit)}</span><button class="btn small" data-action="add-suggestion" data-i="${i}">+ Add</button></span></li>`).join('')}</ul>
        <p class="small muted">Picked from everyday USDA foods with the most ${esc(n.name.toLowerCase())} per calorie. “+ Add” logs one portion to Snacks for this day.</p>` : ''}
      ${r.state === 'over' && n.kind === 'limit' ? `<p class="small">Cutting the top source above is usually the quickest way back under the limit.</p>` : ''}`;
    S.sheet.sug = sug;
    return { title: esc(n.name), body };
  }

  // --- Custom food ------------------------------------------------------------
  const LABEL_KEYS = ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'satfat', 'chol', 'sodium'];
  function sheetCustom() {
    const sh = S.sheet;
    const v = sh.values;
    const field = (k) => { const n = NL.BY_KEY[k]; return `<label class="field"><span>${esc(n.name)} (${esc(n.unit)})</span><input class="input num" type="number" step="any" min="0" data-cf="${k}" value="${v[k] != null ? v[k] : ''}"></label>`; };
    const more = NL.KEYS.filter((k) => !LABEL_KEYS.includes(k));
    return {
      title: sh.id ? 'Edit food' : 'New food',
      body: `<p class="small muted" style="margin-top:0">Copy the numbers from a Nutrition Facts label. Blank means unknown, not zero.${sh.barcode ? ` Saved with barcode ${esc(sh.barcode)}, so scanning it again finds this food.` : ''}</p>
        <div class="grid2">
          <label class="field" style="grid-column:1/-1"><span>Name</span><input class="input" id="cf-name" value="${esc(sh.name)}" placeholder="e.g. Trader Joe's Greek yogurt, vanilla" data-autofocus></label>
          <label class="field"><span>Serving size label</span><input class="input" id="cf-label" value="${esc(sh.label)}" placeholder="1 cup, 1 bar, 2 cookies"></label>
          <label class="field"><span>Serving weight (g)</span><input class="input num" id="cf-grams" type="number" min="1" step="any" value="${sh.grams || ''}"></label>
        </div>
        <h3 style="margin:16px 0 8px">Per serving</h3>
        <div class="grid2">${LABEL_KEYS.map(field).join('')}</div>
        <details style="margin-top:14px"><summary>Vitamins and minerals (optional)</summary><div class="grid2" style="margin-top:10px">${more.map(field).join('')}</div></details>
        <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn ghost" data-action="close-sheet">Cancel</button><button class="btn primary" data-action="save-custom">Save food</button></div>`,
    };
  }
  function openCustom(food, name) {
    const s = { type: 'custom', id: null, name: name || '', label: '1 serving', grams: '', values: {}, barcode: null, parent: null };
    if (food) {
      s.barcode = food.barcode || null;
      const p = food.portions[0];
      s.id = food.id; s.name = food.name; s.label = p[1]; s.grams = p[0];
      NL.KEYS.forEach((k, i) => { const v = food.per100[i]; s.values[k] = v == null ? null : Math.round((v * p[0]) / 100 * 100) / 100; });
    }
    openSheet(s);
  }
  function saveCustom() {
    const sh = S.sheet;
    const name = $('#cf-name').value.trim();
    const grams = Number($('#cf-grams').value);
    if (!name) { toast('Give the food a name.'); return; }
    if (!(grams > 0)) { toast('Enter the serving weight in grams (it\'s on the label next to the serving size).'); return; }
    const values = {};
    for (const inp of document.querySelectorAll('[data-cf]')) values[inp.dataset.cf] = inp.value === '' ? null : Number(inp.value);
    const food = NL.customFood(sh.id || 'my_' + uid(), name, grams, $('#cf-label').value.trim() || '1 serving', values);
    if (sh.barcode) food.barcode = sh.barcode;
    upsertFood(food);
    if (sh.parent) { // made from a barcode that wasn't found: go straight on to logging it
      S.sheet = sh.parent;
      save(); reindex();
      selectFood(food, 1);
      renderSheet();
      toast('Saved. Scanning this barcode again will find it.');
      return;
    }
    S.sheet = null;
    toast(sh.id ? 'Food updated' : 'Food saved to My foods');
    commit();
  }
  function upsertFood(food) {
    const i = S.data.myFoods.findIndex((f) => f.id === food.id);
    if (i >= 0) S.data.myFoods[i] = food; else S.data.myFoods.push(food);
    for (const e of S.data.entries) if (e.src === 'my' && e.fid === food.id) e.name = food.name;
  }

  // --- Recipe -----------------------------------------------------------------
  function openRecipe(food) {
    const s = { type: 'recipe', id: null, name: '', servings: 4, ingredients: [], query: '' };
    if (food) {
      s.id = food.id; s.name = food.name; s.servings = food.servings;
      s.ingredients = food.ingredients.map((x) => {
        const f = foodOf(x.src, x.fid);
        return f ? { food: f, qty: x.grams, portions: portionChoices(f), unitIdx: portionChoices(f).findIndex((p) => p.label === 'g') } : null;
      }).filter(Boolean);
    }
    openSheet(s);
  }
  function recipeTotals(sh) {
    const ings = sh.ingredients.map((x) => ({ food: x.food, grams: x.qty * x.portions[x.unitIdx].grams }));
    return NL.recipeFood('preview', sh.name || 'Recipe', Math.max(1, Number(sh.servings) || 1), ings);
  }
  function recipeSummaryHTML() {
    const sh = S.sheet;
    if (!sh.ingredients.length) return `<p class="empty">Add ingredients with the search above.</p>`;
    const r = recipeTotals(sh);
    const g = r.portions[0][0];
    const v = NL.scale(r.per100, g);
    const get = (k) => fmt(v[NL.BY_KEY[k].index]);
    return `<div class="preview-grid"><div class="p"><span class="small muted">Per serving</span><b>${get('kcal')} kcal</b></div><div class="p"><span class="small muted">Protein</span><b>${get('protein')} g</b></div><div class="p"><span class="small muted">Carbs</span><b>${get('carbs')} g</b></div><div class="p"><span class="small muted">Fat</span><b>${get('fat')} g</b></div></div><p class="small muted">One serving is ${fmt(g)} g of the ${fmt(r.portions[1][0])} g recipe.</p>`;
  }
  function sheetRecipe() {
    const sh = S.sheet;
    const ings = sh.ingredients.map((x, i) => `<div class="pitem"><div style="min-width:0"><b>${esc(x.food.name)}</b></div><div class="small num">${fmt(x.qty * x.portions[x.unitIdx].grams)} g</div>
      <div class="controls"><input class="input qty" type="number" min="0" step="any" value="${x.qty}" data-ing-qty="${i}" aria-label="Amount"><select class="input" data-ing-unit="${i}" aria-label="Unit">${x.portions.map((p, j) => `<option value="${j}" ${j === x.unitIdx ? 'selected' : ''}>${esc(p.label)}${p.label !== 'g' ? ` (${fmt(p.grams)} g)` : ''}</option>`).join('')}</select><button class="btn ghost icon" data-action="ing-remove" data-i="${i}" aria-label="Remove ingredient">✕</button></div></div>`).join('');
    return {
      title: sh.id ? 'Edit recipe' : 'New recipe',
      body: `<div class="grid2"><label class="field" style="grid-column:span 2"><span>Recipe name</span><input class="input" id="rc-name" value="${esc(sh.name)}" placeholder="e.g. Lentil and spinach soup" data-autofocus></label><label class="field"><span>Servings</span><input class="input num" id="rc-servings" type="number" min="1" step="1" value="${sh.servings}"></label></div>
        <h3 style="margin:16px 0 8px">Ingredients</h3>
        <button class="btn" data-action="ing-add">+ Add ingredient</button>
        <div class="parsed">${ings}</div>
        <div id="rc-summary" style="margin-top:12px">${recipeSummaryHTML()}</div>
        <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn ghost" data-action="close-sheet">Cancel</button><button class="btn primary" data-action="save-recipe">Save recipe</button></div>`,
    };
  }
  function saveRecipe() {
    const sh = S.sheet;
    sh.name = $('#rc-name').value.trim();
    sh.servings = Math.max(1, Math.round(Number($('#rc-servings').value) || 1));
    if (!sh.name) { toast('Give the recipe a name.'); return; }
    if (!sh.ingredients.length) { toast('Add at least one ingredient.'); return; }
    const ings = sh.ingredients.map((x) => ({ food: x.food, grams: Math.round(x.qty * x.portions[x.unitIdx].grams * 10) / 10, label: `${fmt(x.qty)} ${x.portions[x.unitIdx].label}` }));
    upsertFood(NL.recipeFood(sh.id || 'my_' + uid(), sh.name, sh.servings, ings));
    S.sheet = null;
    toast(sh.id ? 'Recipe updated' : 'Recipe saved. Log it from any meal.');
    commit();
  }

  // ---------------------------------------------------------------------------
  // Export / import
  // ---------------------------------------------------------------------------
  async function exportData() {
    const json = JSON.stringify(S.data, null, 1);
    const filename = `simply-nutrition-${S.today}.json`;
    const dl = await downloadsP;
    if (dl) {
      try { await dl.save({ filename, data: json }); toast('Backup saved'); } catch (e) { if (e && e.code !== 'declined') toast('Couldn\'t save the backup here.'); }
      return;
    }
    try {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('Backup downloaded');
    } catch (e) { toast('Couldn\'t create the download in this browser.'); }
  }
  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (!d || !Array.isArray(d.entries) || !d.profile) throw new Error('shape');
        S.data = normalize(Object.assign(freshData(false), d));
        toast(`Imported ${d.entries.length.toLocaleString('en-US')} entries`);
        commit();
      } catch (e) { toast('That file isn\'t a Simply Nutrition backup.'); }
    };
    reader.readAsText(file);
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-action], [data-tab]');
    if (!a) return;
    if (a.dataset.tab) { S.tab = a.dataset.tab; S.confirm = null; render(); window.scrollTo(0, 0); return; }
    const act = a.dataset.action;
    const sh = S.sheet;
    switch (act) {
      case 'scrim': if (ev.target === a) closeSheet(); return;
      case 'close-sheet': if (sh && sh.type === 'add' && sh.mode === 'ingredient') { S.sheet = sh.parent; renderSheet(); } else closeSheet(); return;
      case 'day-prev': S.date = NL.addDays(S.date, -1); S.parsed = null; render(); return;
      case 'day-next': S.date = NL.addDays(S.date, 1); S.parsed = null; render(); return;
      case 'day-today': S.date = S.today; render(); return;
      case 'scan-open': {
        const parent = sh && sh.type === 'add' ? sh : null;
        const meal = a.dataset.from === 'today' ? (($('#nl-meal') && $('#nl-meal').value) || defaultMeal()) : null;
        openScan(parent, meal);
        return;
      }
      case 'scan-again': sh.status = 'camera'; sh.code = ''; renderSheet(); return;
      case 'bc-lookup': {
        const code = NL.normalizeBarcode(a.dataset.code || ($('#bc-input') && $('#bc-input').value) || '');
        if (!code) { toast('Enter the 8, 12 or 13 digits under the barcode.'); return; }
        if (sh && sh.type === 'scan') runLookup(code);
        else { openScan(sh && sh.type === 'add' ? sh : null, null, code); }
        return;
      }
      case 'bc-custom': {
        const parent = sh.parent || newAddSheet(sh.meal);
        openCustom(null, sh.productName || '');
        S.sheet.barcode = sh.code; S.sheet.parent = parent;
        renderSheet();
        return;
      }
      case 'open-cal': openSheet({ type: 'calendar', month: S.date.slice(0, 7) }); return;
      case 'cal-month': sh.month = shiftMonth(sh.month, Number(a.dataset.step)); renderSheet(); return;
      case 'cal-pick': S.date = a.dataset.date; S.parsed = null; S.tab = 'today'; S.sheet = null; render(); window.scrollTo(0, 0); return;
      case 'goto-day': S.date = a.dataset.date; S.tab = 'today'; render(); window.scrollTo(0, 0); return;
      case 'filter': S.filter = a.dataset.filter; render(); return;
      case 'toggle-micros': {
        // Toggle in place (no re-render) so the fold and the macros animate.
        const only = S.data.settings.scoreView !== 'macros';
        S.data.settings.scoreView = only ? 'macros' : 'all';
        save();
        const card = a.closest('.score');
        card.classList.toggle('macro-mode', only);
        a.setAttribute('aria-expanded', String(!only));
        for (const f of card.querySelectorAll('.fold')) f.inert = only;
        return;
      }
      case 'range': S.range = a.dataset.range; render(); return;
      case 'score-view': S.data.settings.scoreView = a.dataset.view === 'macros' ? 'macros' : 'all'; save(); render(); return;
      case 'chart-key': S.chartKey = a.dataset.key; render(); return;
      case 'detail': if (a.dataset.range) S.date = S.today; openSheet({ type: 'detail', key: a.dataset.key }); return;
      case 'start-own':
        S.data.entries = S.data.entries.filter((e) => !e.sample);
        S.data.sample = false; S.data.onboarded = false; S.tab = 'today'; S.date = S.today;
        commit();
        openWelcome(1);
        return;
      case 'load-sample':
        S.data.entries = S.data.entries.concat(NL.sampleEntries(db, S.today, 70));
        S.data.sample = true; toast('Example data added'); commit(); return;
      case 'erase':
        if (S.confirm !== 'erase') { S.confirm = 'erase'; render(); return; }
        S.confirm = null;
        if (S.user) { S.data.entries = []; S.data.myFoods = []; toast('Your log was erased'); } else { S.data = freshData(false); toast('All data erased'); }
        commit(); return;
      case 'export': exportData(); return;
      case 'units': S.data.settings.units = a.dataset.units; commit(); return;
      case 'reset-target': delete S.data.overrides[a.dataset.key]; commit(); return;
      case 'nl-parse': {
        const text = $('#nl-input').value;
        S.nlText = text; S.nlMeal = $('#nl-meal').value;
        S.parsed = buildParsed(text, S.nlMeal);
        render();
        return;
      }
      case 'parsed-remove': S.parsed.items.splice(Number(a.dataset.i), 1); render(); return;
      case 'parsed-cancel': S.parsed = null; render(); return;
      case 'parsed-search': {
        const i = Number(a.dataset.i);
        const it = S.parsed.items[i];
        openAdd({ mode: 'parsed', parsedIndex: i, meal: S.parsed.meal, query: it.food ? it.food.name.split(',')[0] : it.text.replace(/^[\d./\s]+/, '') });
        return;
      }
      case 'parsed-add': {
        const ok = S.parsed.items.filter((x) => x.food && x.qty > 0);
        for (const it of ok) addEntry(S.date, S.parsed.meal, it.food, it.qty, it.portions[it.unitIdx]);
        toast(`Added ${ok.length} food${ok.length === 1 ? '' : 's'} to ${NL.MEALS.find((m) => m.key === S.parsed.meal).name}`);
        S.parsed = null; S.nlText = '';
        commit(); return;
      }
      case 'open-add': openAdd({ meal: a.dataset.meal }); return;
      case 'save-meal': {
        const es = (byDate.get(S.date) || []).filter((e) => e.meal === a.dataset.meal);
        const items = es.map((e) => ({ src: e.src, fid: e.fid, name: e.name, qty: e.qty, unit: e.unit, unitGrams: e.unitGrams, grams: e.grams }));
        openSheet({ type: 'savemeal', id: null, slot: a.dataset.meal, name: suggestMealName(items, a.dataset.meal), items });
        return;
      }
      case 'edit-saved': {
        const m = S.data.savedMeals.find((x) => x.id === a.dataset.id);
        if (m) openSheet({ type: 'savemeal', id: m.id, slot: m.mealHint, name: m.name, items: m.items.map((x) => Object.assign({}, x)) });
        return;
      }
      case 'sm-remove-item': sh.name = $('#sm-name').value; sh.items.splice(Number(a.dataset.i), 1); renderSheet(); return;
      case 'sm-delete': S.data.savedMeals = S.data.savedMeals.filter((x) => x.id !== sh.id); S.sheet = null; toast('Saved meal deleted'); commit(); return;
      case 'del-saved': {
        const id = a.dataset.id;
        if (S.confirm !== 'meal:' + id) { S.confirm = 'meal:' + id; render(); return; }
        S.confirm = null;
        S.data.savedMeals = S.data.savedMeals.filter((x) => x.id !== id);
        toast('Saved meal deleted'); commit(); return;
      }
      case 'log-saved': {
        const m = S.data.savedMeals.find((x) => x.id === a.dataset.id);
        if (!m) return;
        const date = a.dataset.today ? S.today : (sh && sh.type === 'add' ? sh.date : S.date);
        const slot = a.dataset.meal || defaultMeal();
        const n = logSavedMeal(m, date, slot);
        if (a.dataset.today) { S.tab = 'today'; S.date = S.today; }
        S.sheet = null;
        toast(n ? `Added ${m.name} to ${NL.MEALS.find((x) => x.key === slot).name}` : 'The foods in this meal are no longer available');
        commit(); return;
      }
      case 'copy-meal': {
        const prev = (byDate.get(NL.addDays(S.date, -1)) || []).filter((e) => e.meal === a.dataset.meal);
        for (const e of prev) S.data.entries.push(Object.assign({}, e, { id: uid(), date: S.date, sample: undefined }));
        toast(`Copied ${prev.length} food${prev.length === 1 ? '' : 's'}`);
        commit(); return;
      }
      case 'edit-entry': {
        const e = S.data.entries.find((x) => x.id === a.dataset.id);
        const f = e && resolve(e);
        if (!f) { toast('That food is no longer in your saved foods.'); return; }
        openAdd({ mode: 'edit', entryId: e.id, meal: e.meal, date: e.date });
        selectFood(f, e.qty, e.unit, e.unitGrams || (e.unit === 'g' ? 1 : e.grams / (e.qty || 1)));
        renderSheet();
        return;
      }
      case 'del-entry': {
        const i = S.data.entries.findIndex((x) => x.id === a.dataset.id);
        if (i >= 0) { const [e] = S.data.entries.splice(i, 1); toast(`Removed ${e.name.split(',')[0]}`); }
        S.sheet = null; commit(); return;
      }
      case 'add-view': sh.view = a.dataset.view; renderSheet(); return;
      case 'kind': {
        sh.query = a.dataset.q;
        const inp = $('#add-q');
        if (inp) inp.value = a.dataset.q;
        $('#add-results').innerHTML = resultsHTML();
        return;
      }
      case 'pick': {
        const f = foodOf(a.dataset.src, a.dataset.src === 'sr' ? Number(a.dataset.fid) : a.dataset.fid);
        if (!f) return;
        if (sh.mode === 'parsed') { replaceParsed(f); return; }
        const last = [...S.data.entries].reverse().find((e) => e.src === f.src && e.fid === f.id);
        if (last) selectFood(f, last.qty, last.unit, last.unitGrams); else selectFood(f, 1);
        renderSheet(); return;
      }
      case 'pick-online': {
        const f = sh.online.results[Number(a.dataset.i)];
        if (sh.mode === 'parsed') { if (!myById.has(f.id)) { S.data.myFoods.push(f); save(); reindex(); } replaceParsed(f); return; }
        selectFood(f, 1); renderSheet(); return;
      }
      case 'unpick': sh.selected = null; renderSheet(); return;
      case 'quick-add': {
        const e = S.data.entries.find((x) => x.id === a.dataset.entry);
        const f = resolve(e);
        addEntry(sh.date, sh.meal, f, e.qty, { label: e.unit, grams: e.unitGrams || e.grams / (e.qty || 1) });
        save(); reindex(); render();
        toast(`Added ${f.name.split(',')[0]}`);
        return;
      }
      case 'search-online': searchOnline(); return;
      case 'new-custom-from-search': openCustom(null, sh.query); return;
      case 'confirm-add': confirmAdd(); return;
      case 'add-suggestion': {
        const s = sh.sug[Number(a.dataset.i)];
        addEntry(S.date, 'snacks', s.food, 1, s.portion);
        save(); reindex(); render();
        toast(`Added ${s.food.name.split(',')[0]} to Snacks`);
        return;
      }
      case 'new-custom': openCustom(null); return;
      case 'edit-custom': openCustom(myById.get(a.dataset.id)); return;
      case 'save-custom': saveCustom(); return;
      case 'new-recipe': openRecipe(null); return;
      case 'edit-recipe': openRecipe(myById.get(a.dataset.id)); return;
      case 'save-recipe': saveRecipe(); return;
      case 'ing-add':
        sh.name = $('#rc-name').value; sh.servings = $('#rc-servings').value;
        openAdd({ mode: 'ingredient', parent: sh });
        return;
      case 'ing-remove': sh.ingredients.splice(Number(a.dataset.i), 1); renderSheet(); return;
      case 'log-food': S.tab = 'today'; render(); openAdd({ meal: defaultMeal() }); selectFood(myById.get(a.dataset.id), 1); renderSheet(); return;
      case 'del-food': {
        const id = a.dataset.id;
        if (S.confirm !== 'food:' + id) { S.confirm = 'food:' + id; render(); return; }
        S.confirm = null;
        const used = S.data.entries.some((e) => e.src === 'my' && e.fid === id);
        if (used) { toast('This food is in your log, so it stays available for those days. Remove those entries first.'); render(); return; }
        S.data.myFoods = S.data.myFoods.filter((f) => f.id !== id);
        toast('Deleted'); commit(); return;
      }
      default:
        accountAction(act, a);
    }
  });

  function replaceParsed(f) {
    const it = S.parsed.items[S.sheet.parsedIndex];
    it.food = f; it.alternatives = it.alternatives || []; it.qty = it.qty || 1;
    it.portions = portionChoices(f); it.unitIdx = 0;
    S.sheet = null;
    render();
  }

  let searchTimer = null;
  document.addEventListener('input', (ev) => {
    const el = ev.target;
    const sh = S.sheet;
    if (el.id === 'add-q') {
      sh.query = el.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { if (S.sheet === sh) $('#add-results').innerHTML = resultsHTML(); }, 120);
      if (sh.view !== 'search') { sh.view = 'search'; for (const b of document.querySelectorAll('[data-action="add-view"]')) b.setAttribute('aria-pressed', String(b.dataset.view === 'search')); }
      return;
    }
    if (el.id === 'pp-qty') { sh.selected.qty = el.value; $('#pp-preview').innerHTML = portionPreviewHTML(); return; }
    if (el.dataset.parsedQty != null) {
      const it = S.parsed.items[Number(el.dataset.parsedQty)];
      it.qty = Number(el.value) || 0;
      return;
    }
    if (el.dataset.ingQty != null) {
      sh.ingredients[Number(el.dataset.ingQty)].qty = Number(el.value) || 0;
      $('#rc-summary').innerHTML = recipeSummaryHTML();
      return;
    }
    if (el.id === 'nl-input') { S.nlText = el.value; return; }
    if (el.id === 'rc-name') { sh.name = el.value; return; }
    if (el.id === 'rc-servings') { sh.servings = el.value; $('#rc-summary').innerHTML = recipeSummaryHTML(); }
  });

  document.addEventListener('change', (ev) => {
    const el = ev.target;
    const sh = S.sheet;
    if (el.id === 'pp-version') {
      const f = db.get(Number(el.value));
      const cur = sh.selected;
      const label = cur.portions[cur.unitIdx].label;
      const keepGrams = cur.portions[cur.unitIdx].grams;
      selectFood(f, cur.qty, label, keepGrams);
      renderSheet();
      return;
    }
    if (el.id === 'pp-unit') { sh.selected.unitIdx = Number(el.value); $('#pp-preview').innerHTML = portionPreviewHTML(); return; }
    if (el.id === 'pp-meal') { sh.meal = el.value; return; }
    if (el.id === 'nl-meal') { S.nlMeal = el.value; if (S.parsed) { S.parsed.meal = el.value; render(); } return; }
    if (el.id === 'chart-key') { S.chartKey = el.value; render(); return; }
    if (el.dataset.parsedQty != null) { render(); return; }
    if (el.dataset.parsedUnit != null) { S.parsed.items[Number(el.dataset.parsedUnit)].unitIdx = Number(el.value); render(); return; }
    if (el.dataset.parsedFood != null) {
      const it = S.parsed.items[Number(el.dataset.parsedFood)];
      const all = [it.food, ...it.alternatives];
      const f = all[Number(el.value)];
      it.alternatives = all.filter((x) => x !== f);
      it.food = f; it.portions = portionChoices(f); it.unitIdx = 0;
      render(); return;
    }
    if (el.dataset.ingUnit != null) { sh.ingredients[Number(el.dataset.ingUnit)].unitIdx = Number(el.value); renderSheet(); return; }
    if (el.dataset.ingQty != null) { renderSheet(); return; }
    if (el.id === 'import-file' && el.files[0]) { importData(el.files[0]); el.value = ''; return; }
    if (el.id === 'api-key') { S.data.settings.apiKey = el.value.trim(); save(); toast('Key saved in this browser'); return; }
    const p = S.data.profile;
    const num = (v) => Number(v);
    const prof = {
      'p-sex': () => { p.sex = el.value; }, 'p-age': () => { if (num(el.value) >= 14) p.age = num(el.value); },
      'p-activity': () => { p.activity = el.value; }, 'p-goal': () => { p.goal = el.value; },
      'p-cm': () => { if (num(el.value) > 90) p.heightCm = num(el.value); }, 'p-kg': () => { if (num(el.value) > 25) p.weightKg = num(el.value); },
      'p-lb': () => { if (num(el.value) > 55) p.weightKg = Math.round((num(el.value) / 2.20462) * 10) / 10; },
      'p-ft': () => { p.heightCm = Math.round((num(el.value) * 12 + num($('#p-in').value)) * 2.54); },
      'p-in': () => { p.heightCm = Math.round((num($('#p-ft').value) * 12 + num(el.value)) * 2.54); },
    };
    if (prof[el.id]) { prof[el.id](); commit(); toast('Targets updated'); return; }
    if (el.dataset.target || el.dataset.max) {
      const key = el.dataset.target || el.dataset.max;
      const field = el.dataset.target ? 'target' : 'max';
      const o = S.data.overrides[key] || {};
      if (el.value === '') delete o[field]; else o[field] = Number(el.value);
      if (Object.keys(o).length) S.data.overrides[key] = o; else delete S.data.overrides[key];
      commit();
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && S.sheet) { ev.preventDefault(); closeSheet(); return; }
    if (ev.target.id === 'nl-input' && ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); const b = document.querySelector('[data-action="nl-parse"]'); if (b) b.click(); }
    if (ev.target.id === 'bc-input' && ev.key === 'Enter') { ev.preventDefault(); const b = document.querySelector('#bc-form [data-action="bc-lookup"]'); if (b) b.click(); return; }
    if (ev.target.id === 'add-q' && ev.key === 'Enter' && NL.normalizeBarcode(ev.target.value)) { ev.preventDefault(); const b = document.querySelector('#add-results [data-action="bc-lookup"]'); if (b) b.click(); return; }
    if (ev.target.id === 'add-q' && ev.key === 'Enter') { ev.preventDefault(); const first = document.querySelector('#add-results [data-action="pick"]'); if (first) first.click(); }
    if (ev.target.id === 'pp-qty' && ev.key === 'Enter') { ev.preventDefault(); confirmAdd(); }
  });

  // Roll "today" over at midnight if the page stays open.
  setInterval(() => {
    const now = NL.ymd(new Date());
    if (now !== S.today) { const wasToday = S.date === S.today; S.today = now; if (wasToday) S.date = now; render(); }
  }, 60000);

  // ---------------------------------------------------------------------------
  // Accounts (Supabase email + password) and sync. Only active when config.js and
  // the Supabase library are loaded; otherwise the app runs in on-device mode.
  // ---------------------------------------------------------------------------
  const CFG = window.NL_CONFIG || null;
  const FULL_SITE = (CFG && CFG.siteUrl) || 'https://simplynutrition.app/';
  const LEGAL_BASE = CFG ? '' : FULL_SITE;
  const Acct = { client: null, engine: null, available: false, status: { state: 'idle', lastSynced: null }, importOffered: false };

  function initAccounts() {
    if (!CFG || !CFG.supabaseUrl || !CFG.supabaseKey || !window.supabase || !window.NLSync) { renderAccountButton(); return; }
    try {
      Acct.client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
        auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    } catch (e) { renderAccountButton(); return; }
    Acct.available = true;
    // Supabase advises not to call its API inside this callback directly, so defer.
    Acct.client.auth.onAuthStateChange((event, session) => { setTimeout(() => handleAuth(event, session), 0); });
    window.addEventListener('online', () => { if (Acct.engine) Acct.engine.schedule(0); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Acct.engine) Acct.engine.schedule(0); });
    setInterval(() => { if (Acct.engine && document.visibilityState === 'visible') Acct.engine.schedule(0); }, 60000);
    renderAccountButton();
    render();
    // Links from the landing page: /app/#signin and /app/#signup open the matching form.
    const openFromHash = (delay) => {
      const m = window.location.hash.match(/^#(signin|signup)$/);
      if (!m) return;
      history.replaceState(null, '', window.location.pathname + window.location.search);
      setTimeout(() => { if (!S.user) openSheet({ type: 'auth', mode: m[1], error: '', busy: false }); }, delay);
    };
    openFromHash(300);
    window.addEventListener('hashchange', () => openFromHash(0));
  }

  async function handleAuth(event, session) {
    const user = session && session.user;
    if (user && (!S.user || S.user.id !== user.id)) enterAccount(user);
    else if (!user && S.user) leaveAccount();
    else if (user) { S.user.email = user.email; renderAccountButton(); }
    if (event === 'PASSWORD_RECOVERY') openSheet({ type: 'auth', mode: 'newpass', error: '', busy: false });
  }

  function enterAccount(user) {
    if (Acct.engine) Acct.engine.stop();
    S.user = { id: user.id, email: user.email };
    const existing = load();
    S.data = normalize(existing || freshData(false));
    S.data.sample = false;
    const uidKey = META_PREFIX + user.id;
    Acct.engine = new window.NLSync.SyncEngine(window.NLSync.supabaseRemote(Acct.client, user.id), {
      getData: () => S.data,
      getMeta: () => readKey(uidKey) || window.NLSync.emptyMeta(),
      saveMeta: (m) => writeKey(uidKey, m),
      onRemoteChange: () => {
        writeKey(storeKey(), S.data);
        reindex();
        if (S.sheet) S.dirtyRender = true; else render();
      },
      onStatus: (st) => {
        Acct.status = st;
        renderAccountButton();
        if (S.sheet && S.sheet.type === 'account') renderSheet();
      },
    });
    if (S.sheet && (S.sheet.type === 'auth' || S.sheet.type === 'welcome')) S.sheet = null;
    reindex();
    render();
    const guest = readKey(STORE_KEY);
    const gEntries = guest ? (guest.entries || []).filter((e) => !e.sample) : [];
    const gFoods = guest ? guest.myFoods || [] : [];
    if (!existing && (gEntries.length || gFoods.length)) {
      openSheet({ type: 'import', entries: gEntries.length, foods: gFoods.length });
    } else {
      firstSync(false);
    }
  }

  function firstSync(imported) {
    if (!Acct.engine) return;
    Acct.engine.sync().then((r) => {
      if (r && r.firstSync && !r.remoteProfileFound && !imported && !S.sheet) openWelcome(1, { forAccount: true });
    }).catch(() => { /* status shows the error */ });
  }

  function importGuestData() {
    const guest = normalize(readKey(STORE_KEY) || freshData(false));
    const have = new Set(S.data.entries.map((e) => e.id));
    for (const e of guest.entries) if (!e.sample && !have.has(e.id)) S.data.entries.push(Object.assign({}, e));
    const haveF = new Set(S.data.myFoods.map((f) => f.id));
    for (const f of guest.myFoods) if (!haveF.has(f.id)) S.data.myFoods.push(f);
    const haveM = new Set(S.data.savedMeals.map((m) => m.id));
    for (const m of guest.savedMeals || []) if (!haveM.has(m.id)) S.data.savedMeals.push(m);
    S.data.profile = guest.profile;
    S.data.overrides = guest.overrides;
    S.data.settings = Object.assign({}, S.data.settings, { units: guest.settings.units, apiKey: guest.settings.apiKey || S.data.settings.apiKey });
    // The guest copy now lives in the account; leave a clean on-device log behind.
    writeKey(STORE_KEY, freshData(false));
    writeKey(storeKey(), S.data);
    reindex();
  }

  function leaveAccount() {
    if (Acct.engine) Acct.engine.stop();
    Acct.engine = null;
    Acct.status = { state: 'idle', lastSynced: null };
    S.user = null;
    S.data = normalize(load() || freshData(false));
    S.sheet = null;
    reindex();
    render();
  }

  function forgetAccountOnDevice(id) { removeKey(ACCT_PREFIX + id); removeKey(META_PREFIX + id); }

  function syncLine() {
    const st = Acct.status;
    const meta = S.user ? readKey(META_PREFIX + S.user.id) : null;
    const pending = meta ? window.NLSync.pendingCount(S.data, meta) : 0;
    const when = st.lastSynced ? new Date(st.lastSynced).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null;
    if (st.state === 'syncing') return { tone: 'near', text: 'Syncing…' };
    if (st.state === 'offline') return { tone: 'near', text: `You're offline. ${pending || 'Your'} change${pending === 1 ? '' : 's'} will sync when you reconnect.` };
    if (st.state === 'error') return { tone: 'low', text: `Couldn't reach your account (${st.error}). Changes are kept on this device and will retry.` };
    if (pending) return { tone: 'near', text: `${pending} change${pending === 1 ? '' : 's'} waiting to sync.` };
    return { tone: 'met', text: when ? `All changes saved to your account · last synced ${when}` : 'Connected to your account.' };
  }

  function renderAccountButton() {
    const el = $('#account-slot');
    if (!el) return;
    if (!Acct.available) {
      el.innerHTML = CFG ? '' : `<a class="btn small" href="${esc(FULL_SITE)}" target="_blank" rel="noopener">Accounts &amp; sync ↗</a>`;
      return;
    }
    if (!S.user) { el.innerHTML = `<button class="btn small primary" data-action="auth-open" data-mode="signin">Sign in</button>`; return; }
    const line = syncLine();
    el.innerHTML = `<button class="btn small" data-action="account-open" title="${esc(line.text)}"><span class="dot s-${line.tone}" aria-hidden="true"></span><span class="acct-email">${esc(S.user.email)}</span></button>`;
  }

  function authMessage(err) {
    const m = String((err && (err.message || err.error_description)) || err || '');
    if (/invalid login credentials/i.test(m)) return 'That email and password don\'t match an account. Check them, or reset your password.';
    if (/email not confirmed/i.test(m)) return 'Confirm your email first: open the link we sent you. You can resend it below.';
    if (/already registered|already been registered|user already exists/i.test(m)) return 'An account with that email already exists. Sign in instead.';
    if (/password.*(at least|short|weak)|weak password/i.test(m)) return 'Choose a stronger password: at least 8 characters, ideally a phrase.';
    if (/rate limit|too many|security purposes/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
    if (/failed to fetch|network|load failed/i.test(m)) return 'Couldn\'t reach the account server. Check your connection and try again.';
    if (/same.*password|different from the old/i.test(m)) return 'Choose a password different from your current one.';
    return m || 'Something went wrong. Try again.';
  }
  const redirectUrl = () => window.location.origin + window.location.pathname;

  function sheetAuth() {
    const sh = S.sheet;
    const err = `<p class="small" role="alert" data-auth-error style="color:var(--low);margin:0" ${sh.error ? '' : 'hidden'}>${esc(sh.error || '')}</p>`;
    const legal = `<a href="${LEGAL_BASE}privacy.html" target="_blank" rel="noopener">Privacy Policy</a> and <a href="${LEGAL_BASE}terms.html" target="_blank" rel="noopener">Terms</a>`;
    const email = (auto) => `<label class="field"><span>Email</span><input class="input" id="auth-email" type="email" autocomplete="username" required value="${esc(sh.email || '')}" ${auto ? 'data-autofocus' : ''}></label>`;
    const busy = sh.busy ? 'disabled' : '';
    if (sh.mode === 'signup') {
      return { title: 'Create your account', body: `<form class="portion-pane" data-form="signup" novalidate>
        <p class="small muted" style="margin:0">Free. Your log syncs across your devices and stays private to you.</p>
        ${email(true)}
        <label class="field"><span>Confirm email</span><input class="input" id="auth-email2" type="email" autocomplete="off" required></label>
        <label class="field"><span>Password (at least 8 characters)</span><input class="input" id="auth-password" type="password" autocomplete="new-password" minlength="8" required></label>
        <label class="row small" style="flex-wrap:nowrap;align-items:flex-start"><input type="checkbox" id="auth-agree" style="margin-top:3px"> <span>I agree to the ${legal}. Simply Nutrition is a tracking tool, not medical advice.</span></label>
        ${err}
        <button class="btn primary" type="submit" ${busy}>${sh.busy ? 'Creating…' : 'Create account'}</button>
        <p class="small muted" style="margin:0">Already have an account? <button type="button" class="btn ghost small" data-action="auth-mode" data-mode="signin">Sign in</button></p>
      </form>` };
    }
    if (sh.mode === 'forgot') {
      return { title: 'Reset your password', body: `<form class="portion-pane" data-form="forgot" novalidate>
        <p class="small muted" style="margin:0">We'll email you a link to choose a new password.</p>
        ${email(true)}${err}
        <button class="btn primary" type="submit" ${busy}>${sh.busy ? 'Sending…' : 'Send reset link'}</button>
        <p class="small muted" style="margin:0"><button type="button" class="btn ghost small" data-action="auth-mode" data-mode="signin">‹ Back to sign in</button></p>
      </form>` };
    }
    if (sh.mode === 'check-email' || sh.mode === 'reset-sent') {
      const reset = sh.mode === 'reset-sent';
      return { title: 'Check your email', body: `<div class="portion-pane">
        <p style="margin:0">${reset ? 'If an account exists for' : 'We sent a confirmation link to'} <b>${esc(sh.email)}</b>${reset ? ', we sent it a link to reset the password.' : '. Open it to finish creating your account; you can open it on any device.'}</p>
        <p class="small muted" style="margin:0">It can take a minute. Check spam if it doesn't arrive.</p>
        ${err}<p class="small s-met" data-auth-info style="margin:0" ${sh.info ? '' : 'hidden'}>${esc(sh.info || '')}</p>
        <div class="row">${reset ? '' : `<button class="btn" data-action="auth-resend" ${busy}>Resend email</button>`}<button class="btn ghost" data-action="auth-mode" data-mode="signin">Back to sign in</button></div>
      </div>` };
    }
    if (sh.mode === 'newpass') {
      return { title: 'Choose a new password', body: `<form class="portion-pane" data-form="newpass" novalidate>
        <label class="field"><span>New password (at least 8 characters)</span><input class="input" id="auth-password" type="password" autocomplete="new-password" minlength="8" required data-autofocus></label>
        ${err}<button class="btn primary" type="submit" ${busy}>${sh.busy ? 'Saving…' : 'Save password'}</button>
      </form>` };
    }
    return { title: 'Sign in', body: `<form class="portion-pane" data-form="signin" novalidate>
      ${email(true)}
      <label class="field"><span>Password</span><input class="input" id="auth-password" type="password" autocomplete="current-password" required></label>
      ${err}
      ${sh.unconfirmed ? `<button type="button" class="btn small" data-action="auth-resend">Resend confirmation email</button>` : ''}
      <button class="btn primary" type="submit" ${busy}>${sh.busy ? 'Signing in…' : 'Sign in'}</button>
      <div class="row small muted" style="justify-content:space-between"><button type="button" class="btn ghost small" data-action="auth-mode" data-mode="forgot">Forgot password?</button><span>New here? <button type="button" class="btn ghost small" data-action="auth-mode" data-mode="signup">Create an account</button></span></div>
    </form>` };
  }

  function sheetAccount() {
    const sh = S.sheet;
    const line = syncLine();
    const meta = readKey(META_PREFIX + S.user.id);
    const pending = meta ? window.NLSync.pendingCount(S.data, meta) : 0;
    const err = `<p class="small" role="alert" data-auth-error style="color:var(--low);margin:0" ${sh.error ? '' : 'hidden'}>${esc(sh.error || '')}</p>`;
    return { title: 'Your account', body: `<div class="portion-pane">
      <div><div class="eyebrow">Signed in as</div><b>${esc(S.user.email)}</b></div>
      <p class="small" style="margin:0"><span class="dot s-${line.tone}"></span> ${esc(line.text)}</p>
      <div class="row"><button class="btn" data-action="sync-now">Sync now</button></div>
      <details ${sh.pwOpen ? 'open' : ''}><summary>Change password</summary>
        <form class="row" data-form="changepw" style="margin-top:8px"><input class="input" id="acct-newpw" type="password" autocomplete="new-password" minlength="8" placeholder="New password (8+ characters)" style="flex:1 1 14em"><button class="btn" type="submit">Save</button></form>
      </details>
      ${err}<p class="small s-met" data-auth-info style="margin:0" ${sh.info ? '' : 'hidden'}>${esc(sh.info || '')}</p>
      <div class="rule" style="height:1px;background:var(--line)"></div>
      ${sh.confirmSignOut
        ? `<p class="small" style="margin:0;color:var(--near)">${pending} change${pending === 1 ? ' hasn\'t' : 's haven\'t'} reached your account yet. Signing out now would lose ${pending === 1 ? 'it' : 'them'}.</p><div class="row"><button class="btn" data-action="sync-now">Try syncing first</button><button class="btn danger" data-action="sign-out" data-force="1">Sign out anyway</button></div>`
        : `<div class="row"><button class="btn" data-action="sign-out">Sign out</button></div>`}
      <p class="small muted" style="margin:0">Signing out removes your log from this device. It stays safe in your account.</p>
      <details ${sh.deleteOpen ? 'open' : ''}><summary style="color:var(--low)">Delete account</summary>
        <form class="portion-pane" data-form="delete" style="margin-top:8px">
          <p class="small" style="margin:0">This permanently deletes your account and every entry, food and recipe in it, on all devices. Export a backup first (Profile → Your data) if you want a copy.</p>
          <label class="field"><span>Type DELETE to confirm</span><input class="input" id="acct-delete" autocomplete="off"></label>
          <button class="btn danger" type="submit" ${sh.busy ? 'disabled' : ''}>Delete my account</button>
        </form>
      </details>
      <p class="small muted" style="margin:0"><a href="${LEGAL_BASE}privacy.html" target="_blank" rel="noopener">Privacy Policy</a> · <a href="${LEGAL_BASE}terms.html" target="_blank" rel="noopener">Terms</a></p>
    </div>` };
  }

  function sheetImport() {
    const sh = S.sheet;
    return { title: 'Bring your log into your account?', body: `<div class="portion-pane">
      <p style="margin:0">This device has <b>${sh.entries.toLocaleString('en-US')} logged ${sh.entries === 1 ? 'entry' : 'entries'}</b>${sh.foods ? ` and <b>${sh.foods} saved food${sh.foods === 1 ? '' : 's'}</b>` : ''} from before you signed in.</p>
      <p class="small muted" style="margin:0">Adding them copies them into your account so they sync to your other devices. Your profile and targets from this device are used if the account doesn't have its own yet.</p>
      <div class="row"><button class="btn primary" data-action="import-yes">Add to my account</button><button class="btn" data-action="import-no">Not now</button></div>
    </div>` };
  }

  /** Update busy state and error text in place, so typed passwords and checkboxes are kept. */
  function authBusy(on, error) {
    if (!S.sheet) return;
    S.sheet.busy = on;
    if (error !== undefined) S.sheet.error = error;
    const root = $('#sheet-root');
    const errEl = root.querySelector('[data-auth-error]');
    if (!errEl) { renderSheet(); return; }
    errEl.textContent = S.sheet.error || '';
    errEl.hidden = !S.sheet.error;
    for (const b of root.querySelectorAll('button[type="submit"]')) b.disabled = on;
    const info = root.querySelector('[data-auth-info]');
    if (info) { info.textContent = S.sheet.info || ''; info.hidden = !S.sheet.info; }
  }

  async function submitAuth(form) {
    const sh = S.sheet;
    const val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
    const auth = Acct.client.auth;
    if (form === 'signin' || form === 'signup' || form === 'forgot') sh.email = val('auth-email').trim();
    if ((form === 'signin' || form === 'signup' || form === 'forgot') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sh.email)) { authBusy(false, 'Enter a valid email address.'); return; }
    try {
      if (form === 'signin') {
        authBusy(true, '');
        const { error } = await auth.signInWithPassword({ email: sh.email, password: val('auth-password') });
        if (error) {
          const unconfirmed = /not confirmed/i.test(error.message);
          if (unconfirmed !== !!sh.unconfirmed) { sh.unconfirmed = unconfirmed; sh.error = authMessage(error); sh.busy = false; renderSheet(); return; }
          throw error;
        }
        toast('Signed in');
      } else if (form === 'signup') {
        if (val('auth-email2').trim().toLowerCase() !== sh.email.toLowerCase()) { authBusy(false, 'The two email addresses don\'t match. Check for typos: this is where password resets are sent.'); return; }
        const pw = val('auth-password');
        if (pw.length < 8) { authBusy(false, 'Use at least 8 characters for your password.'); return; }
        if (!document.getElementById('auth-agree').checked) { authBusy(false, 'Please agree to the Privacy Policy and Terms to create an account.'); return; }
        authBusy(true, '');
        const { data, error } = await auth.signUp({ email: sh.email, password: pw, options: { emailRedirectTo: redirectUrl() } });
        if (error) throw error;
        if (!data.session) { Object.assign(S.sheet, { mode: 'check-email', busy: false, error: '' }); renderSheet(); } else toast('Account created');
      } else if (form === 'forgot') {
        authBusy(true, '');
        const { error } = await auth.resetPasswordForEmail(sh.email, { redirectTo: redirectUrl() });
        if (error) throw error;
        Object.assign(S.sheet, { mode: 'reset-sent', busy: false, error: '' }); renderSheet();
      } else if (form === 'newpass') {
        const pw = val('auth-password');
        if (pw.length < 8) { authBusy(false, 'Use at least 8 characters for your password.'); return; }
        authBusy(true, '');
        const { error } = await auth.updateUser({ password: pw });
        if (error) throw error;
        closeSheet(); toast('Password updated');
      } else if (form === 'changepw') {
        const pw = val('acct-newpw');
        sh.pwOpen = true;
        if (pw.length < 8) { sh.info = ''; authBusy(false, 'Use at least 8 characters for your password.'); return; }
        const { error } = await auth.updateUser({ password: pw });
        if (error) throw error;
        sh.info = 'Password changed.'; sh.pwOpen = false; document.getElementById('acct-newpw').value = ''; authBusy(false, '');
      } else if (form === 'delete') {
        sh.deleteOpen = true;
        if (val('acct-delete').trim() !== 'DELETE') { authBusy(false, 'Type DELETE in capitals to confirm.'); return; }
        authBusy(true, '');
        const { error } = await Acct.client.rpc('delete_account');
        if (error) throw error;
        const id = S.user.id;
        if (Acct.engine) Acct.engine.stop();
        forgetAccountOnDevice(id);
        await auth.signOut({ scope: 'local' }).catch(() => {});
        leaveAccount();
        toast('Your account and its data were deleted');
      }
    } catch (err) {
      if (S.sheet) { S.sheet.info = ''; authBusy(false, authMessage(err)); }
    }
  }

  async function accountAction(act, a) {
    if (!Acct.available && act !== 'noop') return;
    const sh = S.sheet;
    switch (act) {
      case 'auth-open': openSheet({ type: 'auth', mode: a.dataset.mode || 'signin', error: '', busy: false }); return;
      case 'auth-mode': {
        const emailEl = document.getElementById('auth-email');
        openSheet({ type: 'auth', mode: a.dataset.mode, email: emailEl ? emailEl.value : sh && sh.email, error: '', busy: false });
        return;
      }
      case 'auth-resend': {
        const emailEl = document.getElementById('auth-email');
        const email = (emailEl && emailEl.value.trim()) || sh.email;
        try {
          const { error } = await Acct.client.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectUrl() } });
          if (error) throw error;
          sh.info = 'Sent. Check your inbox.'; authBusy(false, '');
        } catch (err) { authBusy(false, authMessage(err)); }
        return;
      }
      case 'account-open': openSheet({ type: 'account', error: '', info: '' }); return;
      case 'sync-now':
        if (Acct.engine) { sh.confirmSignOut = false; Acct.engine.sync().then(() => { if (S.sheet && S.sheet.type === 'account') renderSheet(); }).catch(() => {}); }
        return;
      case 'sign-out': {
        const id = S.user.id;
        const meta = readKey(META_PREFIX + id);
        const pending = meta ? window.NLSync.pendingCount(S.data, meta) : 0;
        if (pending && !a.dataset.force) {
          try { await Acct.engine.sync(); } catch (e) { /* fall through */ }
          const left = window.NLSync.pendingCount(S.data, readKey(META_PREFIX + id) || meta);
          if (left) { sh.confirmSignOut = true; renderSheet(); return; }
        }
        if (Acct.engine) Acct.engine.stop();
        forgetAccountOnDevice(id);
        await Acct.client.auth.signOut({ scope: 'local' }).catch(() => {});
        if (S.user) leaveAccount();
        toast('Signed out');
        return;
      }
      case 'import-yes': importGuestData(); S.sheet = null; render(); firstSync(true); toast('Added to your account'); return;
      case 'import-no': closeSheet(); firstSync(false); return;
      default:
    }
  }

  document.addEventListener('submit', (ev) => {
    const form = ev.target.closest('form[data-form]');
    if (!form) return;
    ev.preventDefault();
    if (form.dataset.form === 'savemeal') { saveMealFromSheet(); return; }
    if (Acct.available) submitAuth(form.dataset.form);
  });
  function saveMealFromSheet() {
    const sh = S.sheet;
    const name = $('#sm-name').value.trim();
    if (!name) { const e = document.querySelector('#sheet-root [data-auth-error]'); e.textContent = 'Give the meal a name, like "Usual breakfast".'; e.hidden = false; return; }
    if (sh.id) {
      const m = S.data.savedMeals.find((x) => x.id === sh.id);
      Object.assign(m, { name, items: sh.items, updatedAt: Date.now() });
      toast('Saved meal updated');
    } else {
      S.data.savedMeals.push({ id: 'meal_' + uid(), kind: 'meal', name, mealHint: sh.slot, items: sh.items, uses: 0, createdAt: Date.now() });
      toast(`Saved. It'll appear on empty ${NL.MEALS.find((x) => x.key === sh.slot).name.toLowerCase()} slots for one-tap logging.`);
    }
    S.sheet = null;
    commit();
  }

  // ---------------------------------------------------------------------------
  // Guided first visit: welcome → about you → your goal → first meal.
  // Shown once, to people with no saved log (and to new accounts with no saved profile).
  // ---------------------------------------------------------------------------
  const MEAL_EXAMPLES = ['2 eggs and a slice of toast', 'Greek yogurt with blueberries', 'Coffee with milk and a banana', 'Turkey sandwich and an apple'];
  function openWelcome(step, opts) {
    openSheet(Object.assign({ type: 'welcome', step: step || 0, mealText: '', parsed: null, meal: defaultMeal(), error: '' }, opts));
  }
  function finishWelcome(message) {
    S.data.onboarded = true;
    S.data.sample = false;
    S.sheet = null;
    S.tab = 'today';
    S.date = S.today;
    commit();
    window.scrollTo(0, 0);
    if (message) toast(message);
  }
  function welcomeSteps(step) {
    return `<div class="w-steps" aria-label="Step ${step} of 3">${[1, 2, 3].map((n) => `<span class="${n === step ? 'on' : n < step ? 'done' : ''}"></span>`).join('')}<span class="w-stepnum">Step ${step} of 3</span></div>`;
  }
  /** Read step 1 into the profile. Returns an error message, or '' when valid. */
  function readWelcomeProfile() {
    const p = S.data.profile;
    const num = (id) => { const el = document.getElementById(id); return el ? Number(el.value) : NaN; };
    const age = num('w-age');
    if (!(age >= 14 && age <= 110)) return 'Enter an age between 14 and 110. Targets here are for teens and adults.';
    let cm, kg;
    if (S.data.settings.units === 'us') {
      cm = (num('w-ft') * 12 + (num('w-in') || 0)) * 2.54;
      kg = num('w-lb') / 2.20462;
    } else {
      cm = num('w-cm');
      kg = num('w-kg');
    }
    if (!(cm >= 120 && cm <= 230)) return 'Check your height.';
    if (!(kg >= 30 && kg <= 320)) return 'Check your weight.';
    Object.assign(p, { age: Math.round(age), heightCm: Math.round(cm), weightKg: Math.round(kg * 10) / 10 });
    return '';
  }
  function welcomeTargetsHTML() {
    const t = NL.computeTargets(S.data.profile, S.data.overrides);
    return `<div class="w-summary"><div class="eyebrow">Your daily targets</div>
      <div class="w-sumrow"><b class="num">${fmt(t.kcal.target)}</b><span>calories</span></div>
      <div class="w-sumrow"><b class="num">${fmt(t.protein.target)} g</b><span>protein</span></div>
      <div class="w-sumrow"><b class="num">${fmt(t.fiber.target)} g</b><span>fiber</span></div>
      <p class="small muted" style="margin:6px 0 0">Plus 13 vitamins, 9 minerals and limits for sodium and saturated fat: 29 targets in all. You can change any of them later in Profile.</p></div>`;
  }
  function sheetWelcome() {
    const sh = S.sheet;
    const p = S.data.profile;
    const err = `<p class="small" role="alert" data-auth-error style="color:var(--low);margin:0" ${sh.error ? '' : 'hidden'}>${esc(sh.error || '')}</p>`;
    if (sh.step === 0) {
      return { title: 'Welcome', body: `<div class="portion-pane w-intro">
        <div class="w-hero"><svg class="mark" viewBox="0 0 23 23" aria-hidden="true">${[0, 1, 2].map((r) => [0, 1, 2].map((c) => `<rect x="${c * 8.5}" y="${r * 8.5}" width="6" height="6" rx="1.6"${r === 2 && c === 2 ? ' class="miss"' : ''}/>`).join('')).join('')}</svg>
          <h2>A stat sheet of what you eat.</h2>
          <p class="muted" style="margin:0">Three quick steps: about you, your goal, and your first meal. About a minute.</p></div>
        <button class="btn primary w-big" data-action="welcome-start" data-autofocus>Get started</button>
        <button class="btn ghost" data-action="welcome-example">Just looking? See an example day</button>
        ${Acct.available ? `<p class="small muted" style="margin:0;text-align:center">Already have an account? <button class="btn ghost small" data-action="auth-open" data-mode="signin">Sign in</button></p>` : ''}
      </div>` };
    }
    if (sh.step === 1) {
      const us = S.data.settings.units === 'us';
      const ft = Math.floor(p.heightCm / 30.48), inch = Math.round(p.heightCm / 2.54 - ft * 12);
      return { title: sh.forAccount ? 'Set up your targets' : 'About you', body: `<div class="portion-pane">
        ${welcomeSteps(1)}
        <p class="muted" style="margin:0">Daily needs depend on your age, sex and size. This stays on your device${S.user ? ' and in your account' : ''}.</p>
        <div class="field"><span>Sex (for nutrient guidelines)</span><div class="seg w-seg" role="group">${[['female', 'Female'], ['male', 'Male']].map(([k, n]) => `<button type="button" data-action="welcome-sex" data-sex="${k}" aria-pressed="${p.sex === k}">${n}</button>`).join('')}</div></div>
        <div class="grid2">
          <label class="field"><span>Age</span><input class="input num" id="w-age" type="number" inputmode="numeric" min="14" max="110" value="${p.age}"></label>
          ${us ? `<div class="field"><span>Height</span><div class="row" style="flex-wrap:nowrap"><input class="input num" id="w-ft" type="number" inputmode="numeric" min="3" max="7" value="${ft}" aria-label="Feet"><span class="muted">ft</span><input class="input num" id="w-in" type="number" inputmode="numeric" min="0" max="11" value="${inch}" aria-label="Inches"><span class="muted">in</span></div></div>
            <label class="field"><span>Weight (lb)</span><input class="input num" id="w-lb" type="number" inputmode="decimal" min="60" max="700" value="${Math.round(p.weightKg * 2.20462)}"></label>`
            : `<label class="field"><span>Height (cm)</span><input class="input num" id="w-cm" type="number" inputmode="numeric" min="120" max="230" value="${Math.round(p.heightCm)}"></label>
            <label class="field"><span>Weight (kg)</span><input class="input num" id="w-kg" type="number" inputmode="decimal" min="30" max="320" value="${Math.round(p.weightKg)}"></label>`}
        </div>
        <button type="button" class="btn ghost small" style="align-self:flex-start" data-action="welcome-units">${us ? 'Use kg and cm' : 'Use lb and ft'}</button>
        ${err}
        <div class="row" style="justify-content:space-between"><button class="btn ghost" data-action="welcome-skip-profile">Skip, use typical values</button><button class="btn primary" data-action="welcome-next">Next</button></div>
      </div>` };
    }
    if (sh.step === 2) {
      return { title: 'Your goal', body: `<div class="portion-pane">
        ${welcomeSteps(2)}
        <div class="w-choices" role="radiogroup" aria-label="Goal">${NL.GOALS.map((g) => `<button type="button" class="w-choice" role="radio" aria-checked="${p.goal === g.key}" data-action="welcome-goal" data-goal="${g.key}"><b>${esc(g.name.split(' (')[0])}</b>${g.name.includes('(') ? `<span>${esc(g.name.split(' (')[1].replace(')', ''))}</span>` : ''}</button>`).join('')}</div>
        <label class="field"><span>How active are you?</span><select class="input" id="w-activity">${NL.ACTIVITY.map((a) => `<option value="${a.key}" ${a.key === p.activity ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
        <div id="w-targets">${welcomeTargetsHTML()}</div>
        <div class="row" style="justify-content:space-between"><button class="btn ghost" data-action="welcome-back">Back</button><button class="btn primary" data-action="welcome-next">Next</button></div>
      </div>` };
    }
    // Step 3: first meal
    const parsed = sh.parsed;
    const ok = parsed ? parsed.items.filter((x) => x.food) : [];
    const preview = parsed ? (ok.length
      ? `<ul class="list-plain">${ok.map((it) => `<li><span>${esc(it.food.name)} <span class="small muted">${fmt(it.qty)} × ${esc(it.portions[it.unitIdx].label)}</span></span><span class="num">${fmt(kcalOf(it.food, it.qty * it.portions[it.unitIdx].grams))} kcal</span></li>`).join('')}</ul>
         ${parsed.items.length > ok.length ? `<p class="small muted" style="margin:0">Couldn't match: ${parsed.items.filter((x) => !x.food).map((x) => '“' + esc(x.text) + '”').join(', ')}. You can add those from search later.</p>` : ''}
         <div class="row" style="justify-content:space-between"><button class="btn ghost" data-action="welcome-edit-meal">Change it</button><button class="btn primary" data-action="welcome-add-meal">Add to my log</button></div>`
      : `<p class="small" style="color:var(--low);margin:0">No foods found in that. Try something like “2 eggs and toast”.</p>`) : '';
    return { title: 'Your first meal', body: `<div class="portion-pane">
      ${welcomeSteps(3)}
      <p class="muted" style="margin:0">What did you last eat? Type it the way you'd say it.</p>
      <textarea class="input" id="w-meal-text" rows="2" placeholder="2 eggs and a slice of toast" data-autofocus>${esc(sh.mealText)}</textarea>
      <div class="row">${MEAL_EXAMPLES.map((x) => `<button type="button" class="chip" data-action="welcome-example-meal" data-text="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <div class="row"><select class="input" id="w-meal" style="width:auto" aria-label="Meal">${NL.MEALS.map((m) => `<option value="${m.key}" ${m.key === sh.meal ? 'selected' : ''}>${m.name}</option>`).join('')}</select>${parsed && ok.length ? '' : `<button class="btn accent" data-action="welcome-read">Find foods</button>`}</div>
      ${preview}
      <div class="row" style="justify-content:space-between"><button class="btn ghost" data-action="welcome-back">Back</button><button class="btn ghost" data-action="welcome-finish">Skip, I'll log later</button></div>
    </div>` };
  }
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-action^="welcome-"]');
    if (!a || !S.sheet || S.sheet.type !== 'welcome') return;
    const sh = S.sheet;
    const p = S.data.profile;
    const keepTyped = () => { if (sh.step === 1) { const e = readWelcomeProfile(); if (e) return e; } return ''; };
    switch (a.dataset.action) {
      case 'welcome-start': sh.step = 1; renderSheet(); return;
      case 'welcome-example':
        S.data.entries = S.data.entries.concat(NL.sampleEntries(db, S.today, 70));
        S.data.sample = true;
        S.data.onboarded = false; // "Start my own log" brings them back here
        S.sheet = null;
        commit();
        return;
      case 'welcome-sex': keepTyped(); p.sex = a.dataset.sex; sh.error = ''; renderSheet(); return;
      case 'welcome-units': keepTyped(); S.data.settings.units = S.data.settings.units === 'us' ? 'metric' : 'us'; sh.error = ''; renderSheet(); return;
      case 'welcome-skip-profile': Object.assign(p, { age: NL.DEFAULT_PROFILE.age, heightCm: NL.DEFAULT_PROFILE.heightCm, weightKg: NL.DEFAULT_PROFILE.weightKg }); sh.step = 2; sh.error = ''; save(); reindex(); renderSheet(); return;
      case 'welcome-next': {
        if (sh.step === 1) {
          const e = readWelcomeProfile();
          if (e) { sh.error = e; renderSheet(); return; }
        }
        sh.error = '';
        sh.step += 1;
        save(); reindex();
        renderSheet();
        return;
      }
      case 'welcome-back': sh.step = Math.max(1, sh.step - 1); sh.error = ''; renderSheet(); return;
      case 'welcome-goal':
        p.goal = a.dataset.goal;
        for (const b of document.querySelectorAll('.w-choice')) b.setAttribute('aria-checked', String(b.dataset.goal === p.goal));
        document.getElementById('w-targets').innerHTML = welcomeTargetsHTML();
        return;
      case 'welcome-example-meal': sh.mealText = a.dataset.text; sh.parsed = null; renderSheet(); return;
      case 'welcome-read': {
        const el = document.getElementById('w-meal-text');
        sh.mealText = el ? el.value : sh.mealText;
        sh.meal = document.getElementById('w-meal').value;
        sh.parsed = sh.mealText.trim() ? buildParsed(sh.mealText, sh.meal) : { items: [] };
        renderSheet();
        return;
      }
      case 'welcome-edit-meal': sh.parsed = null; renderSheet(); return;
      case 'welcome-add-meal': {
        const meal = (document.getElementById('w-meal') || {}).value || sh.meal;
        const ok = sh.parsed.items.filter((x) => x.food && x.qty > 0);
        for (const it of ok) addEntry(S.today, meal, it.food, it.qty, it.portions[it.unitIdx]);
        finishWelcome(`Logged ${ok.length} food${ok.length === 1 ? '' : 's'}. Here's your day so far.`);
        return;
      }
      case 'welcome-finish': finishWelcome("You're set. Log your meals here whenever you like."); return;
      default:
    }
  });
  document.addEventListener('change', (ev) => {
    if (ev.target.id === 'w-activity' && S.sheet && S.sheet.type === 'welcome') {
      S.data.profile.activity = ev.target.value;
      document.getElementById('w-targets').innerHTML = welcomeTargetsHTML();
    }
    if (ev.target.id === 'w-meal' && S.sheet && S.sheet.type === 'welcome') S.sheet.meal = ev.target.value;
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'w-meal-text' && S.sheet && S.sheet.type === 'welcome') { S.sheet.mealText = ev.target.value; if (S.sheet.parsed) { S.sheet.parsed = null; } }
  });

  // ---------------------------------------------------------------------------
  // Installable app (PWA): service worker, update notice, install tips.
  // Only on the hosted site (config.js present); the claude.ai version can't install.
  // ---------------------------------------------------------------------------
  const PWA = { deferred: null, isIOS: false, standalone: false, updating: false };
  const INSTALL_DISMISS_KEY = 'nutrient-ledger:install-dismissed';
  function installDismissed() {
    try { const t = Number(window.localStorage.getItem(INSTALL_DISMISS_KEY) || 0); return Date.now() - t < 30 * 86400000; } catch (e) { return false; }
  }
  /** iPhone/iPad Safari can only install from the Share menu, so explain it; Chrome/Android get a button. */
  function installTipHTML() {
    if (!CFG || PWA.standalone || installDismissed() || (S.data && (S.data.sample || S.data.onboarded === false))) return '';
    const icon = `<img src="/apple-touch-icon.png" alt="">`;
    const later = `<button class="btn small ghost" data-action="install-dismiss">Not now</button>`;
    if (PWA.deferred) {
      return `<div class="install">${icon}<div><b>Install Simply Nutrition</b><p>Open it from your home screen like any app. Works offline too.</p></div><div class="row">${later}<button class="btn small primary" data-action="install-app">Install</button></div></div>`;
    }
    if (PWA.isIOS) {
      const share = `<svg class="share" viewBox="0 0 24 24" aria-label="Share" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>`;
      return `<div class="install">${icon}<div><b>Add Simply Nutrition to your home screen</b><p>In Safari, tap ${share} Share, then <b>Add to Home Screen</b>. It opens full-screen and works offline.</p></div><div class="row">${later}</div></div>`;
    }
    return '';
  }
  function showUpdateBar(reg) {
    if (document.querySelector('.updatebar')) return;
    const bar = document.createElement('div');
    bar.className = 'updatebar';
    bar.setAttribute('role', 'status');
    bar.innerHTML = '<span>A new version is ready.</span><button class="btn small" data-action="apply-update">Refresh</button>';
    document.body.appendChild(bar);
    bar.querySelector('button').addEventListener('click', () => { PWA.updating = true; if (reg.waiting) reg.waiting.postMessage('skip-waiting'); });
  }
  function initPWA() {
    const ua = navigator.userAgent || '';
    PWA.isIOS = /iPhone|iPad|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    PWA.standalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); PWA.deferred = e; if (S.tab === 'today') render(); });
    window.addEventListener('appinstalled', () => { PWA.deferred = null; PWA.standalone = true; render(); toast('Installed. Open it from your home screen.'); });
    if (!CFG || !('serviceWorker' in navigator)) return;
    let reloading = false;
    // Reload only when the person chose to update; the first install takes over silently.
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!PWA.updating || reloading) return; reloading = true; window.location.reload(); });
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // A newer version already downloaded and waiting (only when an older one is running this page).
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdateBar(reg); });
      });
      // Check for a new version when the app comes back to the foreground.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => { /* offline support unavailable; the app still works online */ });
  }
  document.addEventListener('click', async (ev) => {
    const a = ev.target.closest('[data-action="install-app"], [data-action="install-dismiss"]');
    if (!a) return;
    if (a.dataset.action === 'install-dismiss') {
      try { window.localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now())); } catch (e) { /* ignore */ }
      render();
      return;
    }
    if (PWA.deferred) {
      PWA.deferred.prompt();
      try { await PWA.deferred.userChoice; } catch (e) { /* ignore */ }
      PWA.deferred = null;
      render();
    }
  });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  async function boot() {
    try {
      const res = await fetch('data/foods.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      db = new NL.FoodDB(await res.json());
    } catch (e) {
      $('#main').innerHTML = `<div class="card"><h2>The food database didn't load</h2><p>${esc(e.message)}. Reload the page to try again. If you opened index.html straight from your disk, serve the folder instead (for example <code>npx serve .</code>), because browsers block local file reads.</p></div>`;
      return;
    }
    const stored = load();
    S.data = normalize(stored || freshData(false));
    if (!stored) S.data.onboarded = false; // first visit: guided setup instead of a blank log
    save();
    reindex();
    render();
    initAccounts();
    initPWA();
    if (S.data.onboarded === false && !S.data.sample && !S.user) openWelcome(0);
  }
  window.NutrientLedger = { state: S, get db() { return db; }, get account() { return Acct; } };
  boot();
})();
