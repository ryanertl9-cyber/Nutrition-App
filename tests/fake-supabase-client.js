/* Test double for the supabase-js browser client. Served in place of src/vendor/supabase-*.js
 * during end-to-end tests. Every call goes to window.__fakeSupabase(op, args), a function the
 * test runner exposes from Node, so several browser contexts share one fake server. */
(function () {
  const SESSION_KEY = 'fake-sb-session';
  const call = (op, args) => window.__fakeSupabase(op, args);
  function createClient() {
    let session = null;
    try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { session = null; }
    const listeners = [];
    const emit = (event) => listeners.forEach((cb) => cb(event, session));
    const setSession = (s, event) => {
      session = s;
      try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
      emit(event);
    };
    const token = () => (session ? session.access_token : null);
    const wrap = async (op, args) => {
      const r = await call(op, Object.assign({ token: token() }, args));
      return r.error ? { data: r.data || null, error: { message: r.error } } : { data: r.data, error: null };
    };
    // Simulate a password-recovery link: the test sets this hash before loading the page.
    if (location.hash.includes('fake_recovery=')) {
      const t = decodeURIComponent(location.hash.split('fake_recovery=')[1]);
      history.replaceState(null, '', location.pathname);
      setTimeout(async () => {
        const r = await call('recover', { code: t });
        if (r.data) { setSession(r.data.session, 'SIGNED_IN'); emit('PASSWORD_RECOVERY'); }
      }, 0);
    }
    const auth = {
      onAuthStateChange(cb) { listeners.push(cb); setTimeout(() => cb('INITIAL_SESSION', session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
      async getSession() { return { data: { session }, error: null }; },
      async signUp({ email, password }) {
        const r = await wrap('signUp', { email, password });
        if (!r.error && r.data.session) setSession(r.data.session, 'SIGNED_IN');
        return r;
      },
      async signInWithPassword({ email, password }) {
        const r = await wrap('signIn', { email, password });
        if (!r.error) setSession(r.data.session, 'SIGNED_IN');
        return r;
      },
      async signOut() { setSession(null, 'SIGNED_OUT'); return { error: null }; },
      async resetPasswordForEmail(email) { return wrap('reset', { email }); },
      async resend({ email }) { return wrap('resend', { email }); },
      async updateUser({ password }) { return wrap('updateUser', { password }); },
    };
    function query(table) {
      const q = { table, filters: [], orders: [], limit: null, single: false, op: 'select' };
      const b = {
        select() { return b; },
        order(col, o) { q.orders.push([col, !o || o.ascending !== false]); return b; },
        limit(n) { q.limit = n; return b; },
        gte(col, v) { q.filters.push(['gte', col, v]); return b; },
        gt(col, v) { q.filters.push(['gt', col, v]); return b; },
        eq(col, v) { q.filters.push(['eq', col, v]); return b; },
        maybeSingle() { q.single = true; return b; },
        upsert(rows) { q.op = 'upsert'; q.rows = Array.isArray(rows) ? rows : [rows]; return b; },
        then(res, rej) { return wrap('query', { q }).then(res, rej); },
      };
      return b;
    }
    return { auth, from: query, rpc: (name) => wrap('rpc', { name }) };
  }
  window.supabase = { createClient };
})();
