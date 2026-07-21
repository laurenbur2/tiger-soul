// Tiger Soul Academy — Stripe deposit webhook -> Resend welcome email
//
// Flow: customer pays via the Stripe Payment Link -> Stripe sends a
// `checkout.session.completed` event here -> we verify it and send the
// branded "deposit received" email through Resend.
//
// Required environment variables (set as Supabase secrets, see README):
//   STRIPE_WEBHOOK_SECRET   whsec_...      (from the Stripe webhook you create)
//   RESEND_API_KEY          re_...         (from Resend)
//   RESEND_FROM             e.g.  Tiger Soul Academy <academy@tigersoulacademy.com>
//   RESEND_REPLY_TO         (optional) an inbox you actually read, e.g. hello@tigersoulretreats.com
//
// Note: no Stripe API key is needed. We only *verify* the webhook signature
// (which uses STRIPE_WEBHOOK_SECRET); we never call the Stripe API.

import Stripe from "npm:stripe@^17";

// The SDK requires some key to construct; it is unused for signature verification.
const stripe = new Stripe("sk_unused_signature_verification_only", {
  apiVersion: "2024-06-20",
});
// Deno needs the async SubtleCrypto signature verifier
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const EMAIL_SUBJECT = "Your deposit has been received";

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  if (!signature) return new Response("Missing signature", { status: 400 });

  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return new Response("Server not configured", { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret,
      undefined,
      cryptoProvider,
    );
  } catch (err) {
    console.error("Signature verification failed:", (err as Error).message);
    return new Response(`Webhook Error: ${(err as Error).message}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    // Only send when the payment actually succeeded
    if (session.payment_status === "paid") {
      const email = session.customer_details?.email ?? undefined;
      const fullName = session.customer_details?.name ?? "";
      const firstName = fullName.trim().split(/\s+/)[0] || "there";

      if (email) {
        try {
          await sendWelcomeEmail(email, firstName);
          console.log("Welcome email sent to", email);
        } catch (err) {
          console.error("Resend send failed:", (err as Error).message);
          // Return 200 anyway so Stripe doesn't retry forever on a mail hiccup.
        }
      } else {
        console.warn("checkout.session.completed had no customer email");
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});

async function sendWelcomeEmail(to: string, firstName: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: Deno.env.get("RESEND_FROM"),
      to,
      reply_to: Deno.env.get("RESEND_REPLY_TO") || undefined,
      subject: EMAIL_SUBJECT,
      html: renderEmail(firstName),
    }),
  });

  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`);
  }
}

function renderEmail(firstName: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;padding:0;background:#e8e0cf;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#f7f2e9;border-radius:6px;overflow:hidden;border:1px solid #e2d7bf;">

        <tr>
          <td background="https://laurenbur2.github.io/tiger-soul/academy-portal/emails/header-bg.jpg" bgcolor="#15271c" align="center" style="background-color:#15271c;background-image:url('https://laurenbur2.github.io/tiger-soul/academy-portal/emails/header-bg.jpg');background-size:cover;background-position:center;padding:40px 24px 34px;">
            <img src="https://laurenbur2.github.io/tiger-soul/assets/images/logo/tiger-mark-alpha.png" width="72" alt="Tiger Soul Academy" style="display:block;width:72px;height:auto;margin:0 auto 12px;" />
            <div style="font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:25px;line-height:1;color:#e6cf9d;letter-spacing:1px;">Tiger Soul</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:5px;text-transform:uppercase;color:#d8c4a0;padding-top:8px;">Academy</div>
          </td>
        </tr>

        <tr>
          <td style="padding:40px 46px 8px;font-family:Georgia,'Times New Roman',serif;color:#2c2c22;font-size:16px;line-height:1.75;">
            <p style="margin:0 0 20px;">Dear ${firstName},</p>

            <p style="margin:0 0 20px;">
              Your deposit has been received, and your place in the Bufo Practitioner Training is now
              reserved. Congratulations, and welcome.
            </p>

            <p style="margin:0 0 20px;">
              For many, choosing this path is a profound step, and often one that has been a long time in
              the making. We know what it takes to arrive here, and it is a true honor to hold your place.
              We are so glad you are joining us.
            </p>

            <p style="margin:0 0 20px;">
              We will gather <strong style="color:#15150f;">March 6 to 18, 2027</strong> at our jungle
              retreat in Puerto Morelos, Mexico, for thirteen days of deep personal healing and hands-on
              training. This covers your deposit only; details for your remaining tuition and how to
              prepare will follow as the program approaches.
            </p>

            <p style="margin:0 0 30px;">
              If you have any questions, simply reply to this email.
            </p>

            <p style="margin:0 0 6px;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:20px;color:#15150f;">With gratitude,</p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#a3813f;">Tiger Soul Academy</p>
          </td>
        </tr>

        <tr>
          <td style="padding:26px 46px 34px;">
            <div style="height:1px;background:#e2d7bf;margin-bottom:18px;"></div>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#928c7d;">
              Tiger Soul is a spiritual community; our ceremonies are a spiritual practice and the sacred
              medicines sacraments of that belief. Not medical treatment or advice; participation is
              voluntary and at your own responsibility. &copy; 2026 Tiger Soul Academy.
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
