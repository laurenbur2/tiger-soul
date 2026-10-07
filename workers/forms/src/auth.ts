// Tiger Soul — admin sign-in by email link
//
//   POST /api/auth/request { email, redirect }  emails a one-time link to an admin
//   POST /api/auth/verify  { token }            trades the link's token for a session
//   GET  /api/auth/me                           who the session belongs to
//   POST /api/auth/logout
//
// Sessions are bearer tokens the portal keeps in localStorage (the portal and
// this Worker are on different domains, so cookies would be third-party).
// Only SHA-256 hashes of tokens are stored, in login_tokens and sessions.

import { emailShell, paragraph, sendEmail, type Env } from "./shared";

const LINK_MINUTES = 20;
const SESSION_DAYS = 30;

/** Pages that may receive a login link. Anything else falls back to the first. */
const REDIRECTS = [
  "https://www.tigersoulretreats.com/admin/",
  "https://tigersoulretreats.com/admin/",
  "http://localhost:4321/admin/",
  "http://127.0.0.1:4321/admin/",
  "http://localhost:8000/admin/",
];

export type Session = { userId: string; email: string };

function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

export async function isAdmin(db: D1Database, email: string): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 FROM admins WHERE email = ?").bind(email.trim().toLowerCase()).first());
}

/** Reads the bearer token and returns the live session, or null. */
export async function sessionFrom(req: Request, db: D1Database): Promise<Session | null> {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return null;
  const row = await db.prepare("SELECT user_id, email FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await sha256(h.slice(7)), new Date().toISOString())
    .first<{ user_id: string; email: string }>();
  return row ? { userId: row.user_id, email: row.email } : null;
}

export async function requestLink(db: D1Database, env: Env, body: Record<string, unknown>): Promise<void> {
  const email = String(body.email ?? "").trim().toLowerCase();
  // Same answer whether or not the address is an admin, so the form can't be
  // used to find out who is.
  if (!email || !(await isAdmin(db, email))) return;

  const redirect = REDIRECTS.includes(String(body.redirect)) ? String(body.redirect) : REDIRECTS[0];
  const token = randomToken();
  await db.batch([
    db.prepare("DELETE FROM login_tokens WHERE expires_at < ?").bind(new Date().toISOString()),
    db.prepare("INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)")
      .bind(await sha256(token), email, inMinutes(LINK_MINUTES)),
  ]);

  const link = `${redirect}?login=${token}`;
  await sendEmail(env, {
    to: email,
    subject: "Your Tiger Soul admin login link",
    html: emailShell(
      "Sign in to the admin portal",
      paragraph("Use the button below to sign in. The link works once and expires in 20 minutes.") +
        `<p style="margin:22px 0;"><a href="${link}" style="display:inline-block;background:#c6a769;color:#15271c;` +
        `font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;` +
        `text-decoration:none;padding:13px 30px;border-radius:999px;">Sign in</a></p>` +
        paragraph('<em style="color:rgba(21,21,15,.6)">If you didn\'t ask for this, you can ignore it.</em>'),
    ),
  });
}

export async function verifyLink(db: D1Database, body: Record<string, unknown>) {
  const token = String(body.token ?? "");
  if (!token) return null;
  const row = await db.prepare("DELETE FROM login_tokens WHERE token_hash = ? AND expires_at > ? RETURNING email")
    .bind(await sha256(token), new Date().toISOString())
    .first<{ email: string }>();
  if (!row || !(await isAdmin(db, row.email))) return null;

  // A stable id per admin, so the portal can tell when the account changes.
  const userId = (await sha256("admin:" + row.email)).slice(0, 32);
  const session = randomToken();
  const expiresAt = inMinutes(SESSION_DAYS * 24 * 60);
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(new Date().toISOString()),
    db.prepare("INSERT INTO sessions (token_hash, user_id, email, expires_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256(session), userId, row.email, expiresAt),
  ]);
  return { access_token: session, expires_at: expiresAt, user: { id: userId, email: row.email } };
}

export async function logout(req: Request, db: D1Database): Promise<void> {
  const h = req.headers.get("authorization") || "";
  if (h.startsWith("Bearer ")) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(h.slice(7))).run();
}
