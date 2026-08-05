// Tiger Soul — send a campaign to portal clients (admin presses Send / Test).
//
// The admin portal POSTs the admin's Supabase access token plus either:
//   { test:true, subject, contentHtml, previewText }   → send one copy to me
//   { campaignId }                                      → send the saved campaign
//
// (1) verify the caller is a signed-in admin, (2) hand off to the shared sender
// which resolves the audience server-side, renders each copy (merge tags +
// guaranteed unsubscribe link), sends via Resend, logs delivery, marks sent.
//
// Deployed with --no-verify-jwt so the browser CORS preflight (no auth header)
// isn't rejected by the gateway; the admin check below is the real gate.
//   supabase functions deploy send-campaign --project-ref werkohszkcytdvljafha --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adminClient, senderFrom, str, unsubUrl } from "../_shared/forms.ts";
import { REPLY_TO, renderFor, sendSavedCampaign, type Rec } from "../_shared/campaigns.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
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
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });

  // 1. Auth — must be a signed-in admin.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(req, 401, { error: "Sign in first." });
  const asUser = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: me } = await asUser.auth.getUser();
  if (!me?.user) return json(req, 401, { error: "Your session has expired. Sign in again." });
  const { data: isAdmin } = await asUser.rpc("is_admin");
  if (!isAdmin) return json(req, 403, { error: "Admins only." });
  const senderEmail = me.user.email ?? "";

  // 2. Input
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(req, 400, { error: "Bad request." }); }
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return json(req, 500, { error: "RESEND_API_KEY is not set." });
  const svc = adminClient();

  // ---- TEST: one copy to the admin, using the current editor content -------
  if (body.test === true) {
    const subject = str(body.subject, 200);
    const contentHtml = String(body.contentHtml ?? "");
    const previewText = str(body.previewText, 200);
    if (!subject) return json(req, 400, { error: "Add a subject first." });
    if (!contentHtml.trim()) return json(req, 400, { error: "Add some email content first." });
    const me2: Rec = { id: me.user.id, email: senderEmail, first_name: "there", last_name: "" };
    const url = await unsubUrl(me2.id);
    const res = await fetch(RESEND_BATCH, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify([{
        from: senderFrom("Tiger Soul Retreats"), to: [senderEmail], subject: `[TEST] ${subject}`,
        html: renderFor(contentHtml, previewText, me2, url), reply_to: REPLY_TO,
      }]),
    });
    if (!res.ok) return json(req, 502, { error: "Test send failed: " + (await res.text()) });
    return json(req, 200, { ok: true, test: true, sent: 1 });
  }

  // ---- REAL SEND: a saved campaign ----------------------------------------
  const campaignId = str(body.campaignId, 60);
  if (!campaignId) return json(req, 400, { error: "Save the campaign first." });
  const { data: camp, error: cErr } = await svc.from("campaigns").select("*").eq("id", campaignId).single();
  if (cErr || !camp) return json(req, 404, { error: "Campaign not found." });
  if (camp.status === "sent") return json(req, 409, { error: "This campaign was already sent." });
  if (!camp.subject?.trim()) return json(req, 400, { error: "The campaign needs a subject." });
  if (!camp.content_html?.trim()) return json(req, 400, { error: "The campaign has no content." });

  try {
    const r = await sendSavedCampaign(svc, apiKey, camp, senderEmail);
    if (!r.total) return json(req, 400, { error: "No recipients match this audience." });
    return json(req, 200, { ok: true, ...r });
  } catch (e) {
    await svc.from("campaigns").update({ status: "draft" }).eq("id", campaignId);
    return json(req, 500, { error: "Send failed: " + (e instanceof Error ? e.message : e) });
  }
});
