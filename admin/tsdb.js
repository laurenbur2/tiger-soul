/* ============================================================
   TIGER SOUL — admin portal data client

   A small stand-in for the slice of supabase-js the portal uses, talking to
   the Cloudflare Worker in workers/forms instead (the Supabase account was
   banned in Oct 2026). It keeps the same call shapes, so admin/index.html
   reads exactly as it did:

     sb.from("profiles").select("*").eq("id", x).order("created_at", { ascending: false })
     sb.from("campaigns").insert(row).select().single()
     sb.auth.signInWithOtp / getSession / onAuthStateChange / signOut
     sb.rpc("is_admin")

   Every query resolves to { data, error } like supabase-js; nothing throws.
   ============================================================ */

export const API = "https://tiger-soul-forms.casadanovavida.workers.dev";
const STORE = "ts_admin_session";

function readSession() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || "null");
    if (s && s.expires_at && new Date(s.expires_at) > new Date()) return s;
  } catch (_e) { /* storage blocked or corrupt */ }
  return null;
}
function writeSession(s) {
  try { s ? localStorage.setItem(STORE, JSON.stringify(s)) : localStorage.removeItem(STORE); } catch (_e) {}
}

const listeners = new Set();
let loginError = null;
function emit(event, session) { listeners.forEach((cb) => { try { cb(event, session); } catch (e) { console.error(e); } }); }

async function call(path, body, method = "POST") {
  const s = readSession();
  const headers = { "content-type": "application/json" };
  if (s) headers.authorization = "Bearer " + s.access_token;
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body || {}) });
  } catch (_e) {
    return { ok: false, status: 0, out: { error: "Couldn't reach the server. Check your connection." } };
  }
  const out = await res.json().catch(() => ({}));
  if (res.status === 401 && s) { writeSession(null); emit("SIGNED_OUT", null); }
  return { ok: res.ok, status: res.status, out };
}

/* A login link lands on /admin/?login=<token>. Trade it for a session once,
   before anything asks for the session, and tidy the URL. */
const ready = (async () => {
  const url = new URL(location.href);
  const token = url.searchParams.get("login");
  if (!token) return;
  url.searchParams.delete("login");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  const { ok, out } = await call("/api/auth/verify", { token });
  if (ok && out.session) writeSession(out.session);
  else loginError = out.error || "That login link didn't work. Request a new one.";
})();

class Query {
  constructor(table) { this.q = { table, op: "select", filters: [], order: [] }; }
  select(columns) {
    if (this.q.op === "select") this.q.columns = columns || "*";
    else this.q.returning = true;
    return this;
  }
  insert(values) { this.q.op = "insert"; this.q.values = values; return this; }
  upsert(values, opts) { this.q.op = "upsert"; this.q.values = values; this.q.onConflict = opts && opts.onConflict; return this; }
  update(values) { this.q.op = "update"; this.q.values = values; return this; }
  delete() { this.q.op = "delete"; return this; }
  _f(col, op, val) { this.q.filters.push({ col, op, val }); return this; }
  eq(c, v) { return this._f(c, "eq", v); }
  neq(c, v) { return this._f(c, "neq", v); }
  in(c, v) { return this._f(c, "in", v); }
  is(c, v) { return this._f(c, "is", v); }
  lt(c, v) { return this._f(c, "lt", v); }
  lte(c, v) { return this._f(c, "lte", v); }
  gt(c, v) { return this._f(c, "gt", v); }
  gte(c, v) { return this._f(c, "gte", v); }
  order(col, opts) { this.q.order.push({ col, asc: !opts || opts.ascending !== false }); return this; }
  limit(n) { this.q.limit = n; return this; }
  single() { this.q.single = true; this.q.returning = true; return this; }
  maybeSingle() { this.q.maybeSingle = true; this.q.returning = true; return this; }
  async run() {
    await ready;
    const { ok, out } = await call("/api/db", this.q);
    if (!ok) return { data: null, error: { message: out.error || "Request failed" } };
    return { data: out.data ?? null, error: out.error || null };
  }
  then(resolve, reject) { return this.run().then(resolve, reject); }
}

export function createClient() {
  return {
    from: (table) => new Query(table),

    async rpc(name) {
      if (name !== "is_admin") return { data: null, error: { message: "Unknown function " + name } };
      await ready;
      const { ok, out } = await call("/api/auth/me", null, "GET");
      return ok ? { data: !!out.is_admin, error: null } : { data: false, error: { message: out.error || "Not signed in" } };
    },

    auth: {
      async getSession() {
        await ready;
        return { data: { session: readSession() }, error: null };
      },
      onAuthStateChange(cb) {
        listeners.add(cb);
        ready.then(() => cb("INITIAL_SESSION", readSession()));
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
      },
      async signInWithOtp({ email, options }) {
        const redirect = (options && options.emailRedirectTo) || location.origin + "/admin/";
        const { ok, out } = await call("/api/auth/request", { email, redirect });
        return { data: null, error: ok ? null : { message: out.error || "Couldn't send the login email." } };
      },
      async signOut() {
        await call("/api/auth/logout", {});
        writeSession(null);
        emit("SIGNED_OUT", null);
        return { error: null };
      },
      /** The error from a failed login link, once. */
      takeLoginError() {
        const e = loginError;
        loginError = null;
        return e;
      },
    },
  };
}
