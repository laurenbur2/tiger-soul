# Admin portal — campaigns (a small campaign manager)

Create, save, and send email campaigns from the admin portal. You build the
newsletter HTML however you like (e.g. in Claude), paste it into a campaign,
pick who it goes to, and send now or schedule it. Every campaign is stored with
a Draft / Scheduled / Sent status and a per-recipient delivery log.

```
Admin portal → Campaigns
  • list of campaigns (draft / scheduled / sent) — new, edit, duplicate, delete
  • editor: name, subject, preview text, paste HTML (+ live preview),
            audience (all / by program / no intake / hand-pick), merge tags
  • send test to self · send now · schedule
        │ POST access token
        ▼
  send-campaign Edge Function ── verifies admin ── resolves audience server-side
        ── Resend batch (personalised, per-recipient unsubscribe) ── logs + marks sent
  dispatch-scheduled Edge Function ── (cron) sends campaigns whose time has come
  unsubscribe Edge Function ── public one-click opt-out
```

## One-time setup

### 1. Database
Supabase → SQL Editor → paste **`supabase/campaigns.sql`** → Run. Adds the
`unsubscribed_at` column and the `campaigns` / `campaign_recipients` tables.

### 2. Deploy the functions
From the repo root, signed into the Tiger Soul Supabase account:

```bash
supabase functions deploy send-campaign      --project-ref werkohszkcytdvljafha --no-verify-jwt
supabase functions deploy unsubscribe        --project-ref werkohszkcytdvljafha --no-verify-jwt
supabase functions deploy dispatch-scheduled --project-ref werkohszkcytdvljafha
```

- `send-campaign` / `unsubscribe` use `--no-verify-jwt` (the browser preflight
  and email clicks carry no auth header). `send-campaign` checks the admin token
  itself; `unsubscribe` verifies a signed token.
- `dispatch-scheduled` keeps JWT verification **on** — only the cron (bearing the
  service-role key) should call it.

### 3. Optional — make "Schedule" fire automatically
Only needed if you want scheduled campaigns to send on their own. Edit
**`supabase/campaigns-cron.sql`** (paste your service-role key), then run it in
the SQL Editor. Without this, a scheduled campaign just waits and you can send it
with **Send now** any time.

### Secrets
No new secrets — reuses `RESEND_API_KEY` / `RESEND_FROM` (already set for the
website forms) plus the auto-injected `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY`.

## Using it
Admin portal → **Campaigns** → **New campaign**.

- **Name** is internal (for your list); **Subject** is what recipients see.
- **Email HTML**: paste your newsletter. Live preview on the right.
- **Merge tags**: `{{first_name}}`, `{{last_name}}`, `{{email}}`,
  `{{unsubscribe_url}}`. If you omit `{{unsubscribe_url}}`, a compliant
  unsubscribe footer is added automatically. Every send also carries a
  `List-Unsubscribe` header for one-click opt-out in Gmail/Outlook.
- **Audience**: all clients, by program interest, clients with no intake, or a
  hand-picked list. Unsubscribed clients are always skipped, and recipients
  never see each other (each gets their own copy).
- **Send test to myself** first, then **Send now** or **Schedule**.

## Note on consent
These contacts came from website form submissions, not an explicit newsletter
opt-in. Emailing them retreat news is reasonable (they reached out), and the
one-click unsubscribe keeps it compliant and good for deliverability. Keep the
content relevant to why they contacted you.
