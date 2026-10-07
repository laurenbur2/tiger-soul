// Tiger Soul — website forms + admin portal backend (Cloudflare Worker)
//
// Public forms (no sign-in), at the same paths the Supabase Edge Functions used:
//   POST /contact-form      js/forms.js (contact page) and academy/js/enroll.js
//   POST /health-screening  js/forms.js (health screening)
//   POST /waiver            waiver/index.html
//   POST /contact           Ancestral Encounters contact form
//   GET  /unsubscribe       campaign opt-out link
//
// Admin portal (admin/index.html via admin/tsdb.js), signed-in admins only:
//   POST /api/auth/request, /api/auth/verify, /api/auth/logout, GET /api/auth/me
//   POST /api/db             data reads and writes (see db.ts)
//   POST /api/send-campaign  campaign test sends and sends
//
// The cron trigger in wrangler.toml sends scheduled campaigns.

import { corsHeaders, isAllowedOrigin, json, type Env } from "./shared";
import { handle as contact } from "./contact";
import { handle as screening } from "./screening";
import { handle as waiver } from "./waiver";
import { handle as ancestral } from "./ancestral";
import { isAdmin, logout, requestLink, sessionFrom, verifyLink } from "./auth";
import { runQuery, type DbRequest } from "./db";
import { dispatchScheduled, sendCampaign, unsubscribe } from "./campaigns";

const FORMS: Record<string, (req: Request, env: Env) => Promise<Response>> = {
  "/contact-form": contact,
  "/health-screening": screening,
  "/waiver": waiver,
  "/contact": ancestral,
};

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    return v && typeof v === "object" ? v as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function api(req: Request, env: Env, path: string, base: string): Promise<Response> {
  if (!isAllowedOrigin(req)) return json(req, 403, { error: "Forbidden" });

  if (path === "/api/auth/request" && req.method === "POST") {
    try {
      await requestLink(env.DB, env, await readJson(req));
    } catch (err) {
      console.error("auth: send link failed", err);
      return json(req, 502, { error: "We couldn't send the login email. Try again in a minute." });
    }
    return json(req, 200, { ok: true });
  }
  if (path === "/api/auth/verify" && req.method === "POST") {
    const session = await verifyLink(env.DB, await readJson(req));
    return session ? json(req, 200, { session }) : json(req, 401, { error: "That login link has expired or was already used. Request a new one." });
  }

  const me = await sessionFrom(req, env.DB);
  if (!me) return json(req, 401, { error: "Your session has expired. Sign in again." });

  if (path === "/api/auth/me") return json(req, 200, { email: me.email, is_admin: await isAdmin(env.DB, me.email) });
  if (path === "/api/auth/logout" && req.method === "POST") { await logout(req, env.DB); return json(req, 200, { ok: true }); }

  if (!(await isAdmin(env.DB, me.email))) return json(req, 403, { error: "Admins only." });

  if (path === "/api/db" && req.method === "POST") {
    return json(req, 200, await runQuery(env.DB, await readJson(req) as unknown as DbRequest));
  }
  if (path === "/api/send-campaign" && req.method === "POST") {
    const out = await sendCampaign(env.DB, env, base, me.email, me.userId, await readJson(req));
    return json(req, out.status, out.body);
  }
  return json(req, 404, { error: "Not found" });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
    try {
      if (path === "/unsubscribe") return await unsubscribe(req, env.DB, env);
      if (path.startsWith("/api/")) return await api(req, env, path, url.origin);
      const form = FORMS[path];
      if (form) return await form(req, env);
      return json(req, 404, { error: "Not found" });
    } catch (err) {
      console.error("worker: unhandled", err);
      return json(req, 500, { error: "Something went wrong. Please email us directly." });
    }
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await dispatchScheduled(env.DB, env, "https://tiger-soul-forms.casadanovavida.workers.dev");
  },
};
