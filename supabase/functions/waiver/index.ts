// Tiger Soul — signed waiver -> Resend
//
// waiver/index.html POSTs the signed Informed Consent & Liability Waiver here.
// We email Tiger Soul a notification ("we received their waiver") with the
// participant's name, email, and the moment they signed, and attach the
// signature image as proof. Reply-to is the signer, so hitting Reply just works.
//
// Secrets (shared with the other forms): RESEND_API_KEY, RESEND_FROM, NOTIFY_TO.
//
// Deploy: supabase functions deploy waiver --project-ref werkohszkcytdvljafha --no-verify-jwt

import {
  adminClient,
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
  upsertProfile,
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

  const fullName = str(body.fullName, 200);
  const email = str(body.email, 200);
  const phone = str(body.phone, 60);
  const country = str(body.country, 80);
  const dateSigned = str(body.date, 40);
  const signedAt = str(body.signedAt, 60);
  const signature = str(body.signature, 400_000); // "data:image/png;base64,...."

  if (!fullName) return json(req, 400, { error: "Please include your full legal name." });
  if (!isEmail(email)) return json(req, 400, { error: "Please include a valid email address." });

  // Split the legal name into first / last for the notification.
  const parts = fullName.split(/\s+/);
  const firstName = parts[0] || fullName;
  const lastName = parts.slice(1).join(" ");

  // Turn the data URL into a Resend attachment, if present and well-formed.
  const attachments: { filename: string; content: string }[] = [];
  const match = signature.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (match) {
    attachments.push({
      filename: `waiver-signature-${fullName.replace(/[^A-Za-z0-9]+/g, "-")}.png`,
      content: match[1],
    });
  }

  const rows = [
    fieldRow("First name", firstName),
    fieldRow("Last name", lastName || "—"),
    fieldRow("Email", email),
    fieldRow("Phone", phone || "—"),
    fieldRow("Country", country || "—"),
    fieldRow("Date signed", dateSigned || "—"),
    fieldRow("Signed at", signedAt || "—"),
  ].join("");

  const portalUrl = `https://www.tigersoulretreats.com/admin/?email=${encodeURIComponent(email.toLowerCase())}`;
  const portalButton =
    `<p style="margin:22px 0 4px;"><a href="${portalUrl}" style="display:inline-block;background:#c6a769;color:#15271c;` +
    `font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;` +
    `text-decoration:none;padding:13px 30px;border-radius:999px;">View in portal</a></p>`;

  const notification = emailShell(
    "A signed waiver was received",
    paragraph(
      `<strong>${headerSafe(fullName)}</strong> has read and signed the Informed Consent &amp; Liability Waiver.`,
    ) +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>` +
      paragraph(
        attachments.length
          ? '<em style="color:rgba(21,21,15,.6)">Their signature is attached to this email.</em>'
          : '<em style="color:rgba(21,21,15,.6)">No signature image was attached.</em>',
      ) +
      portalButton,
  );

  try {
    await sendEmail({
      to: notifyAddress(),
      subject: `Signed waiver — ${headerSafe(fullName)}`,
      html: notification,
      replyTo: email,
      attachments,
    });
  } catch (err) {
    console.error("waiver: notification failed", err);
    return json(req, 502, { error: "We couldn't record that just now. Please try again." });
  }

  // Store in the admin portal (best-effort; the notification email above stays
  // the reliable record even if the tables aren't created yet).
  try {
    const sb = adminClient();
    const profileId = await upsertProfile(sb, { email, firstName, lastName, phone, country });
    await sb.from("waivers").insert({
      profile_id: profileId,
      full_name: fullName,
      email: email.toLowerCase(),
      phone,
      signature,
      date_signed: dateSigned,
      signed_at: signedAt || new Date().toISOString(),
    });
  } catch (err) {
    console.error("waiver: store failed", err);
  }

  // Courtesy copy to the signer. If it fails, the waiver is already safely
  // delivered to us, so we log it and still report success.
  try {
    await sendEmail({
      to: email,
      subject: "We received your signed waiver — Tiger Soul",
      html: emailShell(
        `Thank you, ${headerSafe(firstName)}`,
        paragraph("We've received your signed Informed Consent &amp; Liability Waiver. Thank you for taking the time to read it in full.") +
          paragraph("We will be in touch about your next steps. If anything changes or you have any questions, simply reply to this email.") +
          (attachments.length
            ? paragraph('<em style="color:rgba(21,21,15,.6)">A copy of your signature is attached for your records.</em>')
            : ""),
      ),
      replyTo: notifyAddress(),
      attachments,
    });
  } catch (err) {
    console.error("waiver: confirmation to signer failed", err);
  }

  return json(req, 200, { ok: true });
});
