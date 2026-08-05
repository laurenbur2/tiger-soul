// Tiger Soul — shared campaign send logic.
// Used by `send-campaign` (admin presses Send) and `dispatch-scheduled` (cron).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { escapeHtml, senderFrom, unsubUrl } from "./forms.ts";

export const FROM_NAME = "Tiger Soul Retreats";
export const REPLY_TO = "hello@tigersoulretreats.com";
const RESEND_BATCH = "https://api.resend.com/emails/batch";

export type Rec = { id: string; email: string; first_name: string | null; last_name: string | null };
export type Campaign = {
  id: string; subject: string; content_html: string; preview_text?: string | null;
  audience_type: string; audience_program?: string | null; audience_ids?: string[] | null; status: string;
};

function dedupe(rows: Rec[]): Rec[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const e = (r.email || "").toLowerCase();
    if (!e || seen.has(e)) return false;
    seen.add(e); return true;
  });
}
function chunk<T>(a: T[], n: number): T[][] { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

/** Resolve a campaign's audience server-side. Always email-present + not unsubscribed. */
export async function resolveRecipients(svc: SupabaseClient, c: Campaign): Promise<Rec[]> {
  let q = svc.from("profiles").select("id, email, first_name, last_name").is("unsubscribed_at", null).not("email", "is", null);

  if (c.audience_type === "handpick") {
    const ids = c.audience_ids ?? [];
    if (!ids.length) return [];
    q = q.in("id", ids);
  } else if (c.audience_type === "program") {
    const { data: sc } = await svc.from("screenings").select("profile_id").eq("offering", c.audience_program ?? "");
    const ids = [...new Set((sc ?? []).map((r: { profile_id: string }) => r.profile_id).filter(Boolean))];
    if (!ids.length) return [];
    q = q.in("id", ids);
  } else if (c.audience_type === "no_intake") {
    const { data: sc } = await svc.from("screenings").select("profile_id");
    const withIntake = new Set((sc ?? []).map((r: { profile_id: string }) => r.profile_id));
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return dedupe((data as Rec[] ?? []).filter((r) => !withIntake.has(r.id)));
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return dedupe(data as Rec[] ?? []);
}

/** Merge tags + a guaranteed unsubscribe link + optional hidden preheader. */
export function renderFor(contentHtml: string, previewText: string, r: Rec, url: string): string {
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

/**
 * Send an already-saved campaign to its resolved audience, log delivery, and
 * mark it sent. Returns counts. Flips status to 'sending' while it runs.
 */
export async function sendSavedCampaign(
  svc: SupabaseClient, apiKey: string, camp: Campaign, sentBy: string,
): Promise<{ sent: number; failed: number; total: number }> {
  const recipients = await resolveRecipients(svc, camp);
  if (!recipients.length) {
    await svc.from("campaigns").update({ status: "sent", sent_at: new Date().toISOString(), sent_by: sentBy, recipient_count: 0 }).eq("id", camp.id);
    return { sent: 0, failed: 0, total: 0 };
  }
  await svc.from("campaigns").update({ status: "sending" }).eq("id", camp.id);

  const from = senderFrom(FROM_NAME);
  let sent = 0; let failed = 0; const logRows: Record<string, unknown>[] = [];

  for (const group of chunk(recipients, 100)) {
    const payload = await Promise.all(group.map(async (r) => {
      const url = await unsubUrl(r.id);
      return {
        from, to: [r.email], subject: camp.subject, reply_to: REPLY_TO,
        html: renderFor(camp.content_html, camp.preview_text ?? "", r, url),
        headers: { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      };
    }));
    try {
      const res = await fetch(RESEND_BATCH, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(JSON.stringify(out));
      const ids: Array<{ id?: string }> = Array.isArray(out?.data) ? out.data : [];
      group.forEach((r, i) => { sent++; logRows.push({ campaign_id: camp.id, profile_id: r.id, email: r.email, status: "sent", provider_id: ids[i]?.id ?? null }); });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      group.forEach((r) => { failed++; logRows.push({ campaign_id: camp.id, profile_id: r.id, email: r.email, status: "error", error: msg.slice(0, 500) }); });
    }
  }

  if (logRows.length) await svc.from("campaign_recipients").insert(logRows);
  await svc.from("campaigns").update({
    status: "sent", sent_at: new Date().toISOString(), sent_by: sentBy, recipient_count: sent,
  }).eq("id", camp.id);

  return { sent, failed, total: recipients.length };
}
