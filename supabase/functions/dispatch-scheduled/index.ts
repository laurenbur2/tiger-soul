// Tiger Soul — send any campaigns whose scheduled time has arrived.
//
// Invoked on a schedule by pg_cron (see supabase/campaigns-cron.sql). Runs with
// verify_jwt ON, so only a caller bearing the service-role key (the cron) or a
// valid session reaches it. It picks up status='scheduled' campaigns that are
// due and sends each through the shared sender.
//
// Deploy (keep JWT verification ON — do NOT pass --no-verify-jwt):
//   supabase functions deploy dispatch-scheduled --project-ref werkohszkcytdvljafha

import { adminClient } from "../_shared/forms.ts";
import { sendSavedCampaign, type Campaign } from "../_shared/campaigns.ts";

Deno.serve(async (_req) => {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: "RESEND_API_KEY is not set." }), { status: 500 });

  const svc = adminClient();
  const nowIso = new Date().toISOString();
  const { data: due, error } = await svc.from("campaigns")
    .select("*").eq("status", "scheduled").lte("scheduled_at", nowIso);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const results: Array<{ id: string; sent: number; failed: number }> = [];
  for (const camp of (due ?? []) as Campaign[]) {
    try {
      const r = await sendSavedCampaign(svc, apiKey, camp, "scheduled");
      results.push({ id: camp.id, sent: r.sent, failed: r.failed });
    } catch (e) {
      // Leave it scheduled so the next run retries.
      await svc.from("campaigns").update({ status: "scheduled" }).eq("id", camp.id);
      results.push({ id: camp.id, sent: 0, failed: -1 });
    }
  }
  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    status: 200, headers: { "content-type": "application/json" },
  });
});
