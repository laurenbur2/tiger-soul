# Website forms Worker

The contact form, health screening, Academy enroll form and waiver post here.
It emails each submission to hello@ through Resend and sends the visitor a
confirmation. It replaced the Supabase Edge Functions in October 2026, when the
Supabase account was banned. Unlike the old functions, it stores nothing in a
database: the notification email is the only record.

## Deploy

```bash
cd workers/forms
npx wrangler login                        # opens the browser, sign in to Cloudflare
npx wrangler secret put RESEND_API_KEY    # paste the key from resend.com/api-keys
npx wrangler deploy
```

`wrangler deploy` prints the URL (https://tiger-soul-forms.<account>.workers.dev).
The site points at it in three places: `FUNCTIONS_BASE` in js/forms.js, `ENDPOINT`
in waiver/index.html, and `ENDPOINT` in academy/js/enroll.js.

## Logs

```bash
npx wrangler tail
```

## Allowed sites

Only the origins in `ALLOWED_ORIGINS` (src/shared.ts) can post from a browser.
Add a domain there and redeploy if the forms move.
