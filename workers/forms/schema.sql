-- Tiger Soul admin portal: Cloudflare D1 schema
--
-- Mirrors the old Supabase tables (supabase/admin-portal.sql, programs.sql,
-- campaigns.sql) closely enough that admin/index.html runs unchanged on top
-- of admin/tsdb.js. Ids are UUID strings, timestamps ISO-8601 text, and the
-- old jsonb / uuid[] columns are JSON text (see JSON_COLUMNS in src/db.ts).
--
-- Apply: npx wrangler d1 execute tiger-soul --remote --file=schema.sql

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profiles (
  id              TEXT PRIMARY KEY,
  first_name      TEXT,
  last_name       TEXT,
  email           TEXT UNIQUE NOT NULL COLLATE NOCASE,
  phone           TEXT,
  country         TEXT,
  notes           TEXT DEFAULT '',
  unsubscribed_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS waivers (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  full_name   TEXT,
  email       TEXT,
  phone       TEXT,
  signature   TEXT,          -- data:image/png;base64,... of the drawn signature
  date_signed TEXT,
  signed_at   TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS waivers_profile_idx ON waivers(profile_id);

CREATE TABLE IF NOT EXISTS screenings (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  full_name   TEXT,
  email       TEXT,
  phone       TEXT,
  offering    TEXT,
  answers     TEXT,          -- JSON: [{ key, question, answer }]
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS screenings_profile_idx ON screenings(profile_id);

-- Contact form and Academy enroll messages. New with the move: Supabase never
-- stored these, they only went to hello@.
CREATE TABLE IF NOT EXISTS contact_messages (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT,
  email       TEXT,
  phone       TEXT,
  topic       TEXT,
  message     TEXT,
  source      TEXT,          -- 'contact' | 'academy'
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS contact_messages_profile_idx ON contact_messages(profile_id);

CREATE TABLE IF NOT EXISTS program_sessions (
  id          TEXT PRIMARY KEY,
  program     TEXT NOT NULL,
  label       TEXT,
  starts_on   TEXT,
  ends_on     TEXT,
  location    TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS program_sessions_prog_idx ON program_sessions(program);

CREATE TABLE IF NOT EXISTS program_enrollments (
  id             TEXT PRIMARY KEY,
  profile_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  program        TEXT NOT NULL,
  session_id     TEXT REFERENCES program_sessions(id) ON DELETE SET NULL,
  accommodation  TEXT CHECK (accommodation IN ('shared','private')),
  payment_plan   TEXT,
  payment_link   TEXT,
  payment_status TEXT CHECK (payment_status IN ('unpaid','deposit','paying','paid')),
  status         TEXT NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled','removed')),
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (profile_id, program)
);
CREATE INDEX IF NOT EXISTS program_enrollments_prog_idx ON program_enrollments(program);
CREATE INDEX IF NOT EXISTS program_enrollments_profile_idx ON program_enrollments(profile_id);

CREATE TABLE IF NOT EXISTS campaigns (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL DEFAULT 'Untitled campaign',
  subject           TEXT NOT NULL DEFAULT '',
  preview_text      TEXT DEFAULT '',
  content_html      TEXT NOT NULL DEFAULT '',
  audience_type     TEXT NOT NULL DEFAULT 'all'
                      CHECK (audience_type IN ('all','program','no_intake','handpick')),
  audience_program  TEXT,
  audience_ids      TEXT NOT NULL DEFAULT '[]',   -- JSON array of profile ids
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','scheduled','sending','sent')),
  scheduled_at      TEXT,
  recipient_count   INTEGER NOT NULL DEFAULT 0,
  sent_by           TEXT,
  sent_at           TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns(status);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id           TEXT PRIMARY KEY,
  campaign_id  TEXT REFERENCES campaigns(id) ON DELETE CASCADE,
  profile_id   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  email        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'sent',
  provider_id  TEXT,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS campaign_recipients_campaign_idx ON campaign_recipients(campaign_id);

-- Who may sign in to /admin/.
CREATE TABLE IF NOT EXISTS admins ( email TEXT PRIMARY KEY COLLATE NOCASE );
INSERT OR IGNORE INTO admins (email) VALUES
  ('tigersoulretreat@gmail.com'),
  ('lburandt2@gmail.com'),
  ('admin@tigersoulretreats.com');

-- Email login links (single use, short-lived) and the sessions they open.
-- Only SHA-256 hashes of the tokens are stored.
CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  email       TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
