// Node side of the fake Supabase used by tests/e2e.cjs. Mirrors the parts of Supabase the app
// uses, including row-level security: every query is scoped to the caller's user id.
function createFakeSupabase(opts) {
  const o = Object.assign({ requireConfirmation: true }, opts);
  const users = new Map(); // email -> { id, email, password, confirmed }
  const tokens = new Map(); // token -> user id
  const recovery = new Map(); // code -> user id
  const tables = { profiles: [], entries: [], foods: [] };
  const mail = [];
  let n = 0;
  let clock = Date.now();
  const now = () => new Date((clock += 7)).toISOString();
  const sessionFor = (u) => { const t = 'tok_' + (++n); tokens.set(t, u.id); return { access_token: t, user: { id: u.id, email: u.email } }; };
  const who = (token) => tokens.get(token) || null;
  const userById = (id) => [...users.values()].find((u) => u.id === id);

  async function handle(op, a) {
    switch (op) {
      case 'signUp': {
        if (users.has(a.email)) return { data: { user: null, session: null } }; // Supabase hides existing accounts
        const u = { id: 'u_' + (++n) + '_' + a.email.replace(/\W/g, ''), email: a.email, password: a.password, confirmed: !o.requireConfirmation };
        users.set(a.email, u);
        if (o.requireConfirmation) { mail.push({ to: a.email, type: 'confirm' }); return { data: { user: { id: u.id, email: u.email }, session: null } }; }
        return { data: { user: { id: u.id, email: u.email }, session: sessionFor(u) } };
      }
      case 'signIn': {
        const u = users.get(a.email);
        if (!u || u.password !== a.password) return { error: 'Invalid login credentials' };
        if (!u.confirmed) return { error: 'Email not confirmed' };
        return { data: { session: sessionFor(u), user: { id: u.id, email: u.email } } };
      }
      case 'resend': mail.push({ to: a.email, type: 'confirm' }); return { data: {} };
      case 'reset': {
        const u = users.get(a.email);
        if (u) { const code = 'rec_' + (++n); recovery.set(code, u.id); mail.push({ to: a.email, type: 'recovery', code }); }
        return { data: {} };
      }
      case 'recover': {
        const id = recovery.get(a.code);
        if (!id) return { error: 'expired' };
        recovery.delete(a.code);
        return { data: { session: sessionFor(userById(id)) } };
      }
      case 'updateUser': {
        const id = who(a.token);
        if (!id) return { error: 'Not signed in' };
        userById(id).password = a.password;
        return { data: { user: { id } } };
      }
      case 'rpc': {
        const id = who(a.token);
        if (a.name !== 'delete_account' || !id) return { error: 'Not signed in' };
        const u = userById(id);
        users.delete(u.email);
        for (const t of Object.keys(tables)) tables[t] = tables[t].filter((r) => r.user_id !== id);
        for (const [t, uid] of tokens) if (uid === id) tokens.delete(t);
        return { data: null };
      }
      case 'query': {
        const id = who(a.token);
        if (!id) return { error: 'JWT expired or missing' };
        const q = a.q;
        const t = tables[q.table];
        if (!t) return { error: 'relation does not exist' };
        if (q.op === 'upsert') {
          for (const row of q.rows) {
            if (row.user_id && row.user_id !== id) return { error: 'new row violates row-level security policy' };
            const key = q.table === 'profiles' ? (r) => r.user_id === id : (r) => r.user_id === id && r.id === row.id;
            const i = t.findIndex(key);
            const rec = Object.assign({}, i >= 0 ? t[i] : {}, JSON.parse(JSON.stringify(row)), { user_id: id, server_updated_at: now() });
            if (i >= 0) t[i] = rec; else t.push(rec);
          }
          return { data: null };
        }
        let rows = t.filter((r) => r.user_id === id); // row-level security
        for (const [kind, col, v] of q.filters) rows = rows.filter((r) => (kind === 'eq' ? String(r[col]) === String(v) : kind === 'gte' ? r[col] >= v : r[col] > v));
        for (const [col, asc] of [...q.orders].reverse()) rows.sort((x, y) => (x[col] < y[col] ? -1 : x[col] > y[col] ? 1 : 0) * (asc ? 1 : -1));
        if (q.limit) rows = rows.slice(0, q.limit);
        rows = JSON.parse(JSON.stringify(rows));
        if (q.single) return { data: rows[0] || null };
        return { data: rows };
      }
      default: return { error: 'unknown op ' + op };
    }
  }
  return {
    handle, users, tables, mail,
    confirm(email) { const u = users.get(email); if (u) u.confirmed = true; },
    lastRecoveryCode(email) { const m = mail.filter((x) => x.to === email && x.type === 'recovery').pop(); return m && m.code; },
  };
}
module.exports = { createFakeSupabase };
