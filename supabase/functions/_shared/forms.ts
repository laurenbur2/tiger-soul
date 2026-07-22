// Tiger Soul — shared helpers for the public website forms
//
// Used by `contact-form` and `health-screening`. Both are deployed with
// --no-verify-jwt (the public site posts to them with no user session), so the
// protections here are: an origin allow-list, a honeypot field, and a body size
// cap. None of that is airtight against a determined curl, but it stops the
// drive-by spam that public form endpoints attract.

const ALLOWED_ORIGINS = [
  "https://laurenbur2.github.io",
  "https://tigersoulretreats.com",
  "https://www.tigersoulretreats.com",
  // Local preview (see .claude/launch.json)
  "http://localhost:4321",
  "http://127.0.0.1:4321",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

/** Max request body we will read, in bytes. The screening is ~47 answers. */
export const MAX_BODY_BYTES = 120_000;

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  // Non-browser callers send no Origin at all; let those through so the
  // function stays testable with curl.
  return !origin || ALLOWED_ORIGINS.includes(origin);
}

export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "content-type": "application/json" },
  });
}

/** Reads and parses the JSON body, refusing anything oversized. */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) throw new Error("Body too large");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escaped, with newlines turned into <br> — for free-text answers. */
export function escapeMultiline(value: unknown): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br />");
}

export function str(value: unknown, max = 4000): string {
  return String(value ?? "").trim().slice(0, max);
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** A name safe to drop into a header value (no CR/LF injection). */
export function headerSafe(value: string): string {
  return value.replace(/[\r\n<>"]/g, " ").trim().slice(0, 120);
}

// ---------------------------------------------------------------- Resend ----

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
};

/**
 * Sends through Resend. Throws on a non-2xx so the caller can decide whether
 * the failure is fatal (the notification to Tiger Soul) or ignorable (the
 * courtesy auto-reply to the applicant).
 */
export async function sendEmail({ to, subject, html, replyTo }: SendArgs): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM");
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");
  if (!from) throw new Error("RESEND_FROM is not set");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Resend responded ${res.status}: ${detail}`);
  }
}

/** Where submissions land. Overridable so staging can point elsewhere. */
export function notifyAddress(): string {
  return Deno.env.get("NOTIFY_TO") ?? "hello@tigersoulretreats.com";
}

// ------------------------------------------------------------- email skin ---

const GOLD = "#a3813f";
const INK = "#15150f";
const CREAM = "#faf7f0";

/** Wraps content in the Tiger Soul email shell (used for both audiences). */
export function emailShell(title: string, inner: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:${CREAM};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:640px;background:#fffdf8;border:1px solid rgba(21,21,15,.10);border-radius:12px;overflow:hidden;">
        <tr><td style="background:#0f1c14;padding:22px 28px;">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;letter-spacing:.02em;color:#c6a769;">Tiger Soul</div>
          <div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:.26em;text-transform:uppercase;color:rgba(250,247,240,.65);margin-top:4px;">Medicine Retreats</div>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:24px;color:${INK};">${escapeHtml(title)}</h1>
          ${inner}
        </td></tr>
        <tr><td style="padding:16px 28px 24px;border-top:1px solid rgba(21,21,15,.08);
                       font-family:Helvetica,Arial,sans-serif;font-size:11px;color:rgba(21,21,15,.55);">
          Tiger Soul Medicine Retreats &middot; Tulum, Mexico &middot;
          <a href="mailto:hello@tigersoulretreats.com" style="color:${GOLD};">hello@tigersoulretreats.com</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** One label/answer pair as a table row. */
export function fieldRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid rgba(21,21,15,.07);">
      <div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:.16em;
                  text-transform:uppercase;color:${GOLD};margin-bottom:5px;">${escapeHtml(label)}</div>
      <div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:${INK};
                  white-space:normal;">${escapeMultiline(value) || "<em style='color:rgba(21,21,15,.4)'>— not answered —</em>"}</div>
    </td>
  </tr>`;
}

export function sectionHeading(text: string): string {
  return `<tr><td style="padding:22px 0 6px;">
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:17px;color:${INK};
                border-bottom:2px solid ${GOLD};display:inline-block;padding-bottom:3px;">${escapeHtml(text)}</div>
  </td></tr>`;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:15px;
                    line-height:1.7;color:${INK};">${text}</p>`;
}
