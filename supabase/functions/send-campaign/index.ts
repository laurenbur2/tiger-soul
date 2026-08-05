// Tiger Soul — send an announcement campaign to portal clients.
//
// The admin portal POSTs { subject, bodyHtml, audience, ids?, test? } with the
// admin's Supabase access token in the Authorization header. We:
//   1. verify the caller is a signed-in admin (is_admin RPC under their JWT),
//   2. gather recipients server-side (service role) — never trusting the client
//      for the address list — skipping anyone unsubscribed or without an email,
//   3. send each a personalised copy via Resend (batched), each with its own
//      one-click unsubscribe link + List-Unsubscribe header,
//   4. log the campaign and per-recipient delivery for the portal's history.
//
// Deployed with --no-verify-jwt so the browser CORS preflight (which carries no
// Authorization header) isn't rejected by the gateway; the admin check below is
// the real gate — every real POST must carry a signed-in admin's access token.
//   supabase functions deploy send-campaign --project-ref werkohszkcytdvljafha --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  adminClient,
  campaignShell,
  escapeMultiline,
  senderFrom,
  str,
  unsubUrl,
} from "../_shared/forms.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const FROM_NAME = "Tiger Soul Retreats";
const REPLY_TO = "hello@tigersoulretreats.com";
const RESEND_BATCH = "https://api.resend.com/emails/batch";

function cors(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "content-type": "application/json" },
  });
}
const fullName = (r: { first_name?: string | null; last_name?: string | null }) =>
  `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim();

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });

  // ---- 1. Auth: must be a signed-in admin ----------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(req, 401, { error: "Sign in first." });
  const asUser = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: me } = await asUser.auth.getUser();
  if (!me?.user) return json(req, 401, { error: "Your session has expired. Sign in again." });
  const { data: isAdmin } = await asUser.rpc("is_admin");
  if (!isAdmin) return json(req, 403, { error: "Admins only." });
  const senderEmail = me.user.email ?? "";

  // ---- 2. Input ------------------------------------------------------------
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(req, 400, { error: "Bad request." }); }
  const subject = str(body.subject, 200);
  const rawMessage = str(body.bodyText, 20000);
  const audience = str(body.audience, 20) || "all";
  const isTest = body.test === true;
  const selectedIds = Array.isArray(body.ids) ? (body.ids as unknown[]).map(String) : [];
  if (!subject) return json(req, 400, { error: "Please add a subject." });
  if (!rawMessage) return json(req, 400, { error: "Please write a message." });

  // Turn the composed plain text into paragraphs (blank line = new paragraph).
  const bodyHtml = rawMessage
    .split(/\n\s*\n/)
    .map((para) =>
      `<p style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#15150f;">${escapeMultiline(para)}</p>`
    ).join("");

  const svc = adminClient();

  // ---- 3. Recipients (server-side; skip unsubscribed / no email) ----------
  type Rec = { id: string; email: string; first_name: string | null; last_name: string | null };
  let recipients: Rec[];
  if (isTest) {
    // A test goes only to the admin who pressed send.
    recipients = [{ id: me.user.id, email: senderEmail, first_name: "there", last_name: "" }];
  } else {
    let q = svc.from("profiles")
      .select("id, email, first_name, last_name")
      .is("unsubscribed_at", null)
      .not("email", "is", null);
    if (audience === "selected" && selectedIds.length) q = q.in("id", selectedIds);
    const { data, error } = await q;
    if (error) return json(req, 500, { error: "Could not load recipients: " + error.message });
    // De-dupe by lower-cased email.
    const seen = new Set<string>();
    recipients = (data as Rec[] ?? []).filter((r) => {
      const e = (r.email || "").toLowerCase();
      if (!e || seen.has(e)) return false;
      seen.add(e);
      return true;
    });
  }
  if (!recipients.length) return json(req, 400, { error: "No recipients to send to." });

  // ---- 4. Log the campaign first, so recipients can reference it ----------
  let campaignId: string | null = null;
  if (!isTest) {
    const { data: c } = await svc.from("campaigns")
      .insert({ subject, body_html: bodyHtml, audience, recipient_count: recipients.length, sent_by: senderEmail })
      .select("id").single();
    campaignId = c?.id ?? null;
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return json(req, 500, { error: "RESEND_API_KEY is not set." });
  const from = senderFrom(FROM_NAME);

  // ---- 5. Build + send in batches of 100 ----------------------------------
  let sent = 0;
  const failures: { email: string; error: string }[] = [];
  const logRows: Record<string, unknown>[] = [];

  for (const group of chunk(recipients, 100)) {
    const payload = await Promise.all(group.map(async (r) => {
      const url = await unsubUrl(r.id);
      const html = campaignShell({
        subject,
        bodyHtml,
        greetingName: fullName(r) || undefined,
        unsubscribeUrl: url,
      });
      return {
        from,
        to: [r.email],
        subject,
        html,
        reply_to: REPLY_TO,
        headers: {
          "List-Unsubscribe": `<${url}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
    }));

    try {
      const res = await fetch(RESEND_BATCH, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof out === "object" ? JSON.stringify(out) : String(out));
      const ids: Array<{ id?: string }> = Array.isArray(out?.data) ? out.data : [];
      group.forEach((r, i) => {
        sent++;
        if (campaignId) logRows.push({ campaign_id: campaignId, profile_id: r.id, email: r.email, status: "sent", provider_id: ids[i]?.id ?? null });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      group.forEach((r) => {
        failures.push({ email: r.email, error: msg });
        if (campaignId) logRows.push({ campaign_id: campaignId, profile_id: r.id, email: r.email, status: "error", error: msg.slice(0, 500) });
      });
    }
  }

  if (logRows.length) await svc.from("campaign_recipients").insert(logRows);
  if (campaignId && sent !== recipients.length) {
    await svc.from("campaigns").update({ recipient_count: sent }).eq("id", campaignId);
  }

  return json(req, 200, { ok: true, sent, failed: failures.length, test: isTest, total: recipients.length });
});
