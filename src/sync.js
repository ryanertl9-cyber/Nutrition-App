/* Simply Nutrition: account sync. Local-first: the app always reads and writes its local copy;
 * this engine pushes local changes to the account and pulls changes made on other devices.
 * Works in the browser (window.NLSync) and Node (module.exports) for tests. */
(function (global) {
  'use strict';

  /** JSON with sorted keys, so the same data always produces the same string (Postgres jsonb reorders keys). */
  function stable(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }

  // What gets stored remotely for each kind of record.
  function entryData(e) { const o = Object.assign({}, e); delete o.sample; return o; }
  function foodData(f) { const o = Object.assign({}, f); delete o.tokens; delete o.lower; delete o.branded; return o; }
  function profileData(d) { return { profile: d.profile, overrides: d.overrides || {}, settings: { units: (d.settings && d.settings.units) || 'us' } }; }

  function emptyMeta() { return { hash: { entries: {}, foods: {}, profile: null }, cursor: { entries: null, foods: null }, lastSynced: null }; }

  /**
   * Local changes not yet on the server, found by comparing each record with the
   * fingerprint recorded at its last successful sync. Example entries are never synced.
   */
  function diff(data, meta) {
    const out = { entries: { upsert: [], remove: [] }, foods: { upsert: [], remove: [] }, profile: false };
    const scan = (list, kind, toData, skip) => {
      const seen = new Set();
      for (const item of list) {
        if (skip && skip(item)) continue;
        seen.add(item.id);
        const d = toData(item);
        if (meta.hash[kind][item.id] !== stable(d)) out[kind].upsert.push(d);
      }
      for (const id of Object.keys(meta.hash[kind])) if (!seen.has(id)) out[kind].remove.push(id);
    };
    scan(data.entries, 'entries', entryData, (e) => e.sample);
    scan(data.myFoods, 'foods', foodData);
    out.profile = meta.hash.profile !== stable(profileData(data));
    return out;
  }
  function pendingCount(data, meta) {
    const d = diff(data, meta);
    return d.entries.upsert.length + d.entries.remove.length + d.foods.upsert.length + d.foods.remove.length + (d.profile ? 1 : 0);
  }

  /**
   * Apply rows pulled from the server. Records changed locally since the last sync are left alone
   * (they are pushed right after, so unsynced local edits win). Returns the number of local changes.
   */
  function applyRemote(data, meta, kind, rows, dirtyIds) {
    const list = kind === 'entries' ? data.entries : data.myFoods;
    const index = new Map(list.map((x, i) => [x.id, i]));
    let changed = 0;
    const removeIds = new Set();
    for (const r of rows) {
      if (dirtyIds.has(r.id)) continue;
      if (r.deleted) {
        if (index.has(r.id)) { removeIds.add(r.id); changed++; }
        delete meta.hash[kind][r.id];
        continue;
      }
      const d = r.data;
      const h = stable(d);
      if (index.has(r.id)) {
        const i = index.get(r.id);
        const cur = kind === 'entries' ? entryData(list[i]) : foodData(list[i]);
        if (stable(cur) !== h) { list[i] = d; changed++; }
      } else {
        index.set(r.id, list.length);
        list.push(d);
        changed++;
      }
      meta.hash[kind][r.id] = h;
    }
    if (removeIds.size) {
      const keep = list.filter((x) => !removeIds.has(x.id));
      list.length = 0;
      Array.prototype.push.apply(list, keep);
    }
    return changed;
  }

  const OVERLAP_MS = 60 * 1000; // re-read the last minute to cover writes that committed out of order
  function minusOverlap(ts) { return ts ? new Date(new Date(ts).getTime() - OVERLAP_MS).toISOString() : null; }
  function maxTs(a, b) { if (!a) return b; if (!b) return a; return new Date(a) >= new Date(b) ? a : b; }

  /**
   * Engine. remote: { pull(kind, sinceIso) -> rows[], push(kind, rows), getProfile() -> {data}|null, putProfile(data) }
   * host:   { getData() -> data, onRemoteChange(count), getMeta() -> meta, saveMeta(meta), onStatus(status) }
   */
  class SyncEngine {
    constructor(remote, host) {
      this.remote = remote;
      this.host = host;
      this.running = null;
      this.again = false;
      this.timer = null;
      this.status = { state: 'idle', lastSynced: null, error: null };
    }
    setStatus(s) { this.status = Object.assign({}, this.status, s); this.host.onStatus && this.host.onStatus(this.status); }
    schedule(ms) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.sync().catch(() => {}), ms == null ? 1200 : ms);
    }
    stop() { clearTimeout(this.timer); this.stopped = true; }
    /** Run one sync; concurrent calls coalesce into one extra pass. */
    sync() {
      if (this.stopped) return Promise.resolve(null);
      if (this.running) { this.again = true; return this.running; }
      this.running = (async () => {
        let result = null;
        try {
          do { this.again = false; result = await this.pass(); } while (this.again && !this.stopped);
          this.setStatus({ state: 'synced', lastSynced: new Date().toISOString(), error: null });
        } catch (err) {
          const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
          this.setStatus({ state: offline ? 'offline' : 'error', error: String((err && err.message) || err) });
          throw err;
        } finally {
          this.running = null;
        }
        return result;
      })();
      return this.running;
    }
    async pass() {
      this.setStatus({ state: 'syncing' });
      const data = this.host.getData();
      const meta = this.host.getMeta();
      const firstSync = !meta.lastSynced;
      let remoteChanges = 0;

      // 1. Pull. Profile: on a device's first sync the account's saved profile wins.
      const before = diff(data, meta);
      const remoteProfile = await this.remote.getProfile();
      if (remoteProfile && (firstSync || !before.profile)) {
        const p = remoteProfile.data || {};
        if (p.profile) data.profile = p.profile;
        data.overrides = p.overrides || {};
        data.settings = Object.assign({}, data.settings, p.settings || {});
        const h = stable(profileData(data));
        if (h !== meta.hash.profile) remoteChanges++;
        meta.hash.profile = h;
      }
      for (const kind of ['entries', 'foods']) {
        const dirty = new Set(before[kind].upsert.map((x) => x.id).concat(before[kind].remove));
        const rows = await this.remote.pull(kind, minusOverlap(meta.cursor[kind]));
        remoteChanges += applyRemote(data, meta, kind, rows, dirty);
        for (const r of rows) meta.cursor[kind] = maxTs(meta.cursor[kind], r.server_updated_at);
      }
      if (remoteChanges && this.host.onRemoteChange) this.host.onRemoteChange(remoteChanges);

      // 2. Push whatever is still different.
      const d = diff(data, meta);
      for (const kind of ['entries', 'foods']) {
        const rows = d[kind].upsert.map((x) => (kind === 'entries' ? { id: x.id, date: x.date || null, data: x, deleted: false } : { id: x.id, data: x, deleted: false }))
          .concat(d[kind].remove.map((id) => (kind === 'entries' ? { id, date: null, data: {}, deleted: true } : { id, data: {}, deleted: true })));
        for (let i = 0; i < rows.length; i += 500) {
          const batch = rows.slice(i, i + 500);
          await this.remote.push(kind, batch);
          for (const r of batch) { if (r.deleted) delete meta.hash[kind][r.id]; else meta.hash[kind][r.id] = stable(r.data); }
          this.host.saveMeta(meta);
        }
      }
      if (d.profile || !remoteProfile) {
        const p = profileData(data);
        await this.remote.putProfile(p);
        meta.hash.profile = stable(p);
      }
      meta.lastSynced = new Date().toISOString();
      this.host.saveMeta(meta);
      return { firstSync, remoteProfileFound: !!remoteProfile, remoteChanges, pushed: d.entries.upsert.length + d.entries.remove.length + d.foods.upsert.length + d.foods.remove.length };
    }
  }

  /** Remote adapter over a supabase-js client. */
  function supabaseRemote(client, userId) {
    const PAGE = 1000;
    return {
      async pull(kind, since) {
        const out = [];
        const seen = new Set();
        let cursor = since;
        for (;;) {
          let q = client.from(kind).select('id,data,deleted,server_updated_at').order('server_updated_at', { ascending: true }).order('id', { ascending: true }).limit(PAGE);
          if (cursor) q = q.gte('server_updated_at', cursor);
          const { data, error } = await q;
          if (error) throw new Error(error.message);
          let fresh = 0;
          for (const r of data) if (!seen.has(r.id + '|' + r.server_updated_at)) { seen.add(r.id + '|' + r.server_updated_at); out.push(r); fresh++; }
          if (data.length < PAGE || !fresh) break;
          cursor = data[data.length - 1].server_updated_at;
        }
        return out;
      },
      async push(kind, rows) {
        const { error } = await client.from(kind).upsert(rows.map((r) => Object.assign({ user_id: userId }, r)), { onConflict: 'user_id,id' });
        if (error) throw new Error(error.message);
      },
      async getProfile() {
        const { data, error } = await client.from('profiles').select('data,server_updated_at').eq('user_id', userId).maybeSingle();
        if (error) throw new Error(error.message);
        return data;
      },
      async putProfile(p) {
        const { error } = await client.from('profiles').upsert({ user_id: userId, data: p }, { onConflict: 'user_id' });
        if (error) throw new Error(error.message);
      },
    };
  }

  const api = { stable, diff, pendingCount, applyRemote, emptyMeta, entryData, foodData, profileData, SyncEngine, supabaseRemote };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.NLSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
