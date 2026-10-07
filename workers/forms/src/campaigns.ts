// Tiger Soul — email campaigns (announcements) through Resend
//
//   POST /api/send-campaign { test: true, subject, contentHtml, previewText }  test to yourself
//   POST /api/send-campaign { campaignId }                                     send a saved campaign
//   GET|POST /unsubscribe?u=<profile id>&t=<token>                             one-click opt-out
//   cron (wrangler.toml)                                                       sends due scheduled campaigns
//
// Ported from supabase/functions/{send-campaign,dispatch-scheduled,unsubscribe}.

import { insertRow, decodeRow } from "./db";
import { escapeHtml, type Env } from "./shared";

const FROM_NAME = "Tiger Soul Retreats";
const REPLY_TO = "hello@tigersoulretreats.com";
const RESEND_BATCH = "https://api.resend.com/emails/batch";

type Rec = { id: string; email: string; first_name: string | null; last_name: string | null };
type Campaign = {
  id: string; subject: string; content_html: string; preview_text?: string | null;
  audience_type: string; audience_program?: string | null; audience_ids?: string[] | null; status: string;
};

/** The verified Resend address with a chosen display name. */
function senderFrom(env: Env, displayName: string): string {
  const addr = (env.RESEND_FROM.match(/<([^>]+)>/)?.[1] ?? env.RESEND_FROM).trim();
  return `${displayName} <${addr}>`;
}

/** Unsubscribe token: HMAC-SHA256 of the profile id, keyed by UNSUB_SECRET. */
async function unsubToken(env: Env, profileId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.UNSUB_SECRET ?? ""),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(profileId));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function unsubUrl(env: Env, base: string, profileId: string): Promise<string> {
  return `${base}/unsubscribe?u=${encodeURIComponent(profileId)}&t=${await unsubToken(env, profileId)}`;
}

function dedupe(rows: Rec[]): Rec[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const e = (r.email || "").toLowerCase();
    if (!e || seen.has(e)) return false;
    seen.add(e); return true;
  });
}

const chunk = <T,>(a: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

/** Resolve a campaign's audience. Always has an email and isn't unsubscribed. */
async function resolveRecipients(db: D1Database, c: Campaign): Promise<Rec[]> {
  const base = "SELECT id, email, first_name, last_name FROM profiles WHERE unsubscribed_at IS NULL AND email IS NOT NULL AND email <> ''";
  let rows: Rec[];
  if (c.audience_type === "handpick") {
    const ids = c.audience_ids ?? [];
    if (!ids.length) return [];
    rows = (await db.prepare(`${base} AND id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)).all<Rec>()).results;
  } else if (c.audience_type === "program") {
    rows = (await db.prepare(`${base} AND id IN (SELECT profile_id FROM screenings WHERE offering = ?)`)
      .bind(c.audience_program ?? "").all<Rec>()).results;
  } else if (c.audience_type === "no_intake") {
    rows = (await db.prepare(`${base} AND id NOT IN (SELECT profile_id FROM screenings WHERE profile_id IS NOT NULL)`).all<Rec>()).results;
  } else {
    rows = (await db.prepare(base).all<Rec>()).results;
  }
  return dedupe(rows ?? []);
}

/** Merge tags + a guaranteed unsubscribe link + optional hidden preheader. */
function renderFor(contentHtml: string, previewText: string, r: Rec, url: string): string {
  let html = contentHtml
    .replaceAll("{{first_name}}", escapeHtml(r.first_name || "there"))
    .replaceAll("{{last_name}}", escapeHtml(r.last_name || ""))
    .replaceAll("{{email}}", escapeHtml(r.email))
    .replaceAll("{{unsubscribe_url}}", url);

  if (!contentHtml.includes("{{unsubscribe_url}}")) {
    html += `<div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:#888;
      text-align:center;padding:22px 16px;">Tiger Soul Medicine Retreats · Tulum, Mexico<br />
      You're receiving this because you contacted Tiger Soul.
      <a href="${url}" style="color:#a3813f;">Unsubscribe</a></div>`;
  }
  if (previewText) {
    html = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(previewText)}</div>` + html;
  }
  return html;
}

const setStatus = (db: D1Database, id: string, fields: Record<string, unknown>) => {
  const cols = Object.keys(fields);
  return db.prepare(`UPDATE campaigns SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .bind(...cols.map((c) => fields[c]), new Date().toISOString(), id).run();
};

async function sendSavedCampaign(db: D1Database, env: Env, base: string, camp: Campaign, sentBy: string) {
  const recipients = await resolveRecipients(db, camp);
  if (!recipients.length) {
    await setStatus(db, camp.id, { status: "sent", sent_at: new Date().toISOString(), sent_by: sentBy, recipient_count: 0 });
    return { sent: 0, failed: 0, total: 0 };
  }
  await setStatus(db, camp.id, { status: "sending" });

  const from = senderFrom(env, FROM_NAME);
  let sent = 0; let failed = 0;
  for (const group of chunk(recipients, 100)) {
    const payload = await Promise.all(group.map(async (r) => {
      const url = await unsubUrl(env, base, r.id);
      return {
        from, to: [r.email], subject: camp.subject, reply_to: REPLY_TO,
        html: renderFor(camp.content_html, camp.preview_text ?? "", r, url),
        headers: { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      };
    }));
    let ids: Array<{ id?: string }> = [];
    let error: string | null = null;
    try {
      const res = await fetch(RESEND_BATCH, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const out = await res.json<{ data?: Array<{ id?: string }> }>().catch(() => ({} as { data?: Array<{ id?: string }> }));
      if (!res.ok) throw new Error(JSON.stringify(out));
      ids = Array.isArray(out?.data) ? out.data : [];
    } catch (err) {
      error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    }
    for (const [i, r] of group.entries()) {
      if (error) failed++; else sent++;
      await insertRow(db, "campaign_recipients", {
        campaign_id: camp.id, profile_id: r.id, email: r.email,
        status: error ? "error" : "sent", provider_id: ids[i]?.id ?? null, error,
      });
    }
  }
  await setStatus(db, camp.id, { status: "sent", sent_at: new Date().toISOString(), sent_by: sentBy, recipient_count: sent });
  return { sent, failed, total: recipients.length };
}

/** POST /api/send-campaign, admins only (checked by the caller). */
export async function sendCampaign(db: D1Database, env: Env, base: string, senderEmail: string, userId: string, body: Record<string, unknown>) {
  if (body.test === true) {
    const subject = String(body.subject ?? "").trim().slice(0, 200);
    const contentHtml = String(body.contentHtml ?? "");
    const previewText = String(body.previewText ?? "").slice(0, 200);
    if (!subject) return { status: 400, body: { error: "Add a subject first." } };
    if (!contentHtml.trim()) return { status: 400, body: { error: "Add some email content first." } };
    const me: Rec = { id: userId, email: senderEmail, first_name: "there", last_name: "" };
    const res = await fetch(RESEND_BATCH, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify([{
        from: senderFrom(env, FROM_NAME), to: [senderEmail], subject: `[TEST] ${subject}`,
        html: renderFor(contentHtml, previewText, me, await unsubUrl(env, base, me.id)), reply_to: REPLY_TO,
      }]),
    });
    if (!res.ok) return { status: 502, body: { error: "Test send failed: " + (await res.text()) } };
    return { status: 200, body: { ok: true, test: true, sent: 1 } };
  }

  const campaignId = String(body.campaignId ?? "");
  if (!campaignId) return { status: 400, body: { error: "Save the campaign first." } };
  const row = await db.prepare("SELECT * FROM campaigns WHERE id = ?").bind(campaignId).first<Record<string, unknown>>();
  if (!row) return { status: 404, body: { error: "Campaign not found." } };
  const camp = decodeRow(row) as unknown as Campaign;
  if (camp.status === "sent") return { status: 409, body: { error: "This campaign was already sent." } };
  if (!camp.subject?.trim()) return { status: 400, body: { error: "The campaign needs a subject." } };
  if (!camp.content_html?.trim()) return { status: 400, body: { error: "The campaign has no content." } };

  try {
    const r = await sendSavedCampaign(db, env, base, camp, senderEmail);
    if (!r.total) return { status: 400, body: { error: "No recipients match this audience." } };
    return { status: 200, body: { ok: true, ...r } };
  } catch (e) {
    await setStatus(db, campaignId, { status: "draft" });
    return { status: 500, body: { error: "Send failed: " + (e instanceof Error ? e.message : e) } };
  }
}

/** Cron: send every scheduled campaign that's due. */
export async function dispatchScheduled(db: D1Database, env: Env, base: string): Promise<void> {
  const due = (await db.prepare("SELECT * FROM campaigns WHERE status = 'scheduled' AND scheduled_at <= ?")
    .bind(new Date().toISOString()).all<Record<string, unknown>>()).results ?? [];
  for (const row of due) {
    const camp = decodeRow(row) as unknown as Campaign;
    try {
      await sendSavedCampaign(db, env, base, camp, "scheduled");
    } catch (e) {
      console.error("dispatch: campaign failed", camp.id, e);
      await setStatus(db, camp.id, { status: "scheduled" });
    }
  }
}

function page(title: string, message: string): Response {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex" /><title>${title} · Tiger Soul</title></head>
<body style="margin:0;background:#faf7f0;font-family:Helvetica,Arial,sans-serif;color:#15150f;">
  <div style="max-width:520px;margin:12vh auto;padding:36px 32px;background:#fffdf8;
              border:1px solid rgba(21,21,15,.1);border-radius:14px;text-align:center;">
    <div style="font-family:Georgia,serif;font-size:22px;color:#0f1c14;">Tiger Soul</div>
    <div style="font-size:10px;letter-spacing:.26em;text-transform:uppercase;color:rgba(21,21,15,.5);margin-top:4px;">Medicine Retreats</div>
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:24px;margin:26px 0 10px;">${title}</h1>
    <p style="font-size:15px;line-height:1.7;color:rgba(21,21,15,.75);margin:0;">${message}</p>
    <p style="margin-top:24px;"><a href="https://tigersoulretreats.com" style="color:#a3813f;text-decoration:none;">tigersoulretreats.com</a></p>
  </div>
</body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

/** GET (link click) or POST (one-click from the mail client). */
export async function unsubscribe(req: Request, db: D1Database, env: Env): Promise<Response> {
  const url = new URL(req.url);
  let u = url.searchParams.get("u") ?? "";
  let t = url.searchParams.get("t") ?? "";
  if (req.method === "POST" && (!u || !t)) {
    try {
      const form = await req.formData();
      u = u || String(form.get("u") ?? "");
      t = t || String(form.get("t") ?? "");
    } catch { /* ignore */ }
  }

  let ok = false;
  if (u && t && t === (await unsubToken(env, u))) {
    const r = await db.prepare("UPDATE profiles SET unsubscribed_at = ? WHERE id = ?").bind(new Date().toISOString(), u).run();
    ok = r.success;
  }

  if (req.method === "POST") return new Response(ok ? "unsubscribed" : "invalid", { status: ok ? 200 : 400 });
  return ok
    ? page("You're unsubscribed", "You won't receive any more announcements from us. If this was a mistake, just email hello@tigersoulretreats.com and we'll add you back.")
    : page("Link not valid", "This unsubscribe link has expired or isn't valid. Email hello@tigersoulretreats.com and we'll take care of it.");
}
