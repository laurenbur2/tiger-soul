// Ancestral Encounters — contact form -> Resend
//
// ancestralencounters.org (js/main.js) POSTs JSON here. We email the message to
// the team with reply-to set to the sender. Replies use { success } rather than
// { ok }, because that's what the Ancestral Encounters page reads.

import { escapeHtml, escapeMultiline, isAllowedOrigin, isEmail, json, sendEmail, str, type Env } from "./shared";

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });
  if (!isAllowedOrigin(req)) return json(req, 403, { error: "Forbidden" });

  let data: Record<string, unknown>;
  try {
    data = await req.json();
  } catch {
    return json(req, 400, { error: "Invalid JSON" });
  }

  // Honeypot: bots fill the hidden "website" field. Pretend success, drop it.
  if (str(data.website)) return json(req, 200, { success: true });

  const name = str(data.name, 200);
  const email = str(data.email, 200);
  const message = str(data.message, 8000);
  const interest = str(data.interest, 200);

  if (!name || !email || !message) return json(req, 400, { error: "Missing required fields" });
  if (!isEmail(email)) return json(req, 400, { error: "Invalid email" });

  const html =
    `<h2>New message from the Ancestral Encounters website</h2>` +
    `<p><strong>Name:</strong> ${escapeHtml(name)}</p>` +
    `<p><strong>Email:</strong> ${escapeHtml(email)}</p>` +
    (interest ? `<p><strong>Drawn to:</strong> ${escapeHtml(interest)}</p>` : "") +
    `<p><strong>Message:</strong></p>` +
    `<p>${escapeMultiline(message)}</p>`;

  try {
    const to = (env.AE_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
    for (const addr of to) {
      await sendEmail({ ...env, RESEND_FROM: env.AE_FROM || env.RESEND_FROM }, {
        to: addr,
        subject: `New website message from ${name.replace(/[\r\n]/g, " ")}`,
        html,
        replyTo: email,
      });
    }
  } catch (err) {
    console.error("ancestral: send failed", err);
    return json(req, 502, { success: false, error: "Email send failed" });
  }

  return json(req, 200, { success: true });
}
