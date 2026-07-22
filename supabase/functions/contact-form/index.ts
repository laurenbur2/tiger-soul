// Tiger Soul — contact form -> Resend
//
// pages/contact.html POSTs JSON here. We email the enquiry to Tiger Soul
// (reply-to set to the sender, so hitting Reply just works) and send the
// visitor a short confirmation.
//
// Secrets (see supabase/functions/README-forms.md):
//   RESEND_API_KEY, RESEND_FROM, NOTIFY_TO (optional)
//
// Deploy: supabase functions deploy contact-form --project-ref werkohszkcytdvljafha --no-verify-jwt

import {
  corsHeaders,
  emailShell,
  fieldRow,
  headerSafe,
  isAllowedOrigin,
  isEmail,
  json,
  notifyAddress,
  paragraph,
  readBody,
  sendEmail,
  str,
} from "../_shared/forms.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });
  if (!isAllowedOrigin(req)) return json(req, 403, { error: "Forbidden" });

  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch {
    return json(req, 400, { error: "We couldn't read that submission." });
  }

  // Honeypot: a field hidden from humans. Anything filled in is a bot.
  // Answer 200 so the bot believes it succeeded and doesn't retry.
  if (str(body.website)) return json(req, 200, { ok: true });

  const firstName = str(body.firstName, 120);
  const lastName = str(body.lastName, 120);
  const email = str(body.email, 200);
  const phone = str(body.phone, 60);
  const offering = str(body.offering, 120);
  const message = str(body.message, 8000);

  if (!firstName || !lastName) return json(req, 400, { error: "Please include your name." });
  if (!isEmail(email)) return json(req, 400, { error: "Please include a valid email address." });
  if (!message) return json(req, 400, { error: "Please include a message." });

  const fullName = `${firstName} ${lastName}`;
  const rows = [
    fieldRow("Name", fullName),
    fieldRow("Email", email),
    fieldRow("Phone", phone || "—"),
    fieldRow("Asking about", offering || "Not specified"),
    fieldRow("Message", message),
  ].join("");

  const notification = emailShell(
    "New enquiry from the website",
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`,
  );

  try {
    await sendEmail({
      to: notifyAddress(),
      subject: `Contact form — ${headerSafe(fullName)}${offering ? ` (${headerSafe(offering)})` : ""}`,
      html: notification,
      replyTo: email,
    });
  } catch (err) {
    console.error("contact-form: notification failed", err);
    return json(req, 502, { error: "We couldn't send that just now. Please email us directly." });
  }

  // Courtesy confirmation. If it fails the enquiry is already safely delivered,
  // so we log it and still report success.
  try {
    await sendEmail({
      to: email,
      subject: "We received your message — Tiger Soul",
      html: emailShell(
        `Thank you, ${firstName}`,
        paragraph("Your message reached us. Someone from Tiger Soul reads every one personally, and we'll be in touch within a few days.") +
          paragraph("If your question is time-sensitive, you can always reply straight to this email.") +
          paragraph('<em style="color:rgba(21,21,15,.6)">In the meantime, if you\'re ready to begin, every offering starts with the health screening at <a href="https://tigersoulretreats.com/pages/health-screening.html" style="color:#a3813f;">tigersoulretreats.com</a>.</em>'),
      ),
      replyTo: notifyAddress(),
    });
  } catch (err) {
    console.error("contact-form: confirmation to sender failed", err);
  }

  return json(req, 200, { ok: true });
});
