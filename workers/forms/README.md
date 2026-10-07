# Tiger Soul backend Worker

Everything that used to run on Supabase, rebuilt on Cloudflare in October 2026
after the Supabase account was banned:

- **Website forms.** The contact form, health screening, waiver, Academy enroll
  form and the Ancestral Encounters contact form post here. Each submission is
  emailed to hello@ through Resend (the visitor gets a confirmation) and saved
  to the database.
- **Admin portal data.** `admin/index.html` reads and writes through
  `admin/tsdb.js`, which keeps the supabase-js call shapes and sends them to
  `/api/db` (src/db.ts).
- **Admin sign-in.** An email link from `/api/auth/request`. Only addresses in
  the `admins` table can sign in.
- **Campaigns.** Sends, test sends, scheduled sends (cron, every 5 minutes) and
  one-click unsubscribe.

The data lives in the D1 database `tiger-soul` (schema.sql). It includes health
screenings, so it stays in Cloudflare and is never committed.

## Deploy

```bash
cd workers/forms
npm install                               # first time: TypeScript + Workers types
npx wrangler login
npx wrangler deploy
```

Secrets, set once with `npx wrangler secret put <NAME>`:

- `RESEND_API_KEY`: from the **lburandt2** team at resend.com/api-keys (that team
  has tigersoulretreats.com verified)
- `UNSUB_SECRET`: any long random string; it signs unsubscribe links

The site calls this Worker at https://tiger-soul-forms.casadanovavida.workers.dev
from js/forms.js, waiver/index.html, academy/js/enroll.js, admin/tsdb.js, and the
Ancestral Encounters site's js/main.js.

## Database

```bash
npx wrangler d1 execute tiger-soul --remote --file=schema.sql       # create tables (safe to re-run)
npx wrangler d1 execute tiger-soul --remote --command "select count(*) from profiles"
npx wrangler d1 export tiger-soul --remote --output=backup.sql      # full backup; keep it out of git
```

Add an admin:

```bash
npx wrangler d1 execute tiger-soul --remote --command "insert into admins (email) values ('name@example.com')"
```

`import/build_import.py` rebuilt the records from the hello@ email export and
data recovered from old Claude Code transcripts. It reads from
~/Documents/Tiger-soul-data and only needs running again if that rebuild is redone.

## Logs

```bash
npx wrangler tail
```

## Allowed sites

Only the origins in `ALLOWED_ORIGINS` (src/shared.ts) can call this from a
browser, and login links only go to the pages in `REDIRECTS` (src/auth.ts).
Add a domain to both and redeploy if the site moves.
