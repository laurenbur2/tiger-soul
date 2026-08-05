// Tiger Soul — one-click unsubscribe.
//
// Reached from the link (and List-Unsubscribe header) in every campaign email.
//   GET  ?u=<profileId>&t=<token>  → verify, opt out, show a confirmation page
//   POST (RFC 8058 one-click, params in query or body) → verify, opt out, 200
//
// Deploy publicly (no session needed to unsubscribe):
//   supabase functions deploy unsubscribe --project-ref werkohszkcytdvljafha --no-verify-jwt

import { adminClient, verifyUnsubToken } from "../_shared/forms.ts";

const CREAM = "#faf7f0", INK = "#15150f", GOLD = "#a3813f";

function page(title: string, message: string): Response {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex" /><title>${title} — Tiger Soul</title></head>
<body style="margin:0;background:${CREAM};font-family:Helvetica,Arial,sans-serif;color:${INK};">
  <div style="max-width:520px;margin:12vh auto;padding:36px 32px;background:#fffdf8;
              border:1px solid rgba(21,21,15,.1);border-radius:14px;text-align:center;">
    <div style="font-family:Georgia,serif;font-size:22px;color:#0f1c14;">Tiger Soul</div>
    <div style="font-size:10px;letter-spacing:.26em;text-transform:uppercase;color:rgba(21,21,15,.5);margin-top:4px;">Medicine Retreats</div>
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:24px;margin:26px 0 10px;">${title}</h1>
    <p style="font-size:15px;line-height:1.7;color:rgba(21,21,15,.75);margin:0;">${message}</p>
    <p style="margin-top:24px;"><a href="https://tigersoulretreats.com" style="color:${GOLD};text-decoration:none;">tigersoulretreats.com</a></p>
  </div>
</body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

async function optOut(profileId: string, token: string): Promise<boolean> {
  if (!(await verifyUnsubToken(profileId, token))) return false;
  const svc = adminClient();
  const { error } = await svc.from("profiles")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("id", profileId);
  return !error;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  let u = url.searchParams.get("u") ?? "";
  let t = url.searchParams.get("t") ?? "";

  // One-click POST may send the params in the form body instead.
  if (req.method === "POST" && (!u || !t)) {
    try {
      const form = await req.formData();
      u = u || String(form.get("u") ?? "");
      t = t || String(form.get("t") ?? "");
    } catch { /* ignore */ }
  }

  const ok = await optOut(u, t);

  if (req.method === "POST") {
    // Mail clients doing RFC 8058 one-click just want a 200.
    return new Response(ok ? "unsubscribed" : "invalid", { status: ok ? 200 : 400 });
  }
  return ok
    ? page("You're unsubscribed", "You won't receive any more announcements from us. If this was a mistake, just email hello@tigersoulretreats.com and we'll add you back.")
    : page("Link not valid", "This unsubscribe link has expired or isn't valid. Email hello@tigersoulretreats.com and we'll take care of it.");
});
