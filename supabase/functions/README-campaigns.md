# Admin portal — email campaigns (announcements)

Lets you compose an announcement in the admin portal and send it to your clients
through Resend (the same sender your website forms already use). Each recipient
gets their own copy (nobody sees anyone else's address), with a one-click
unsubscribe link, and every send is logged under **Campaigns → Sent history**.

```
Admin portal (Campaigns) ──POST access token──▶ send-campaign Edge Function
                                                   ├─ verifies you're a signed-in admin
                                                   ├─ pulls recipients (skips unsubscribed)
                                                   ├─ Resend batch send (personalised)
                                                   └─ logs campaign + recipients
email footer / List-Unsubscribe ─────────────▶ unsubscribe Edge Function (public)
```

## One-time setup

### 1. Database
Supabase → SQL Editor → paste **`supabase/campaigns.sql`** → Run. Adds the
`unsubscribed_at` column and the `campaigns` / `campaign_recipients` tables.

### 2. Deploy the two functions
From the repo root, signed into the Tiger Soul Supabase account:

```bash
supabase functions deploy send-campaign --project-ref werkohszkcytdvljafha --no-verify-jwt
supabase functions deploy unsubscribe   --project-ref werkohszkcytdvljafha --no-verify-jwt
```

`--no-verify-jwt` on **send-campaign** is intentional: the browser's CORS
preflight carries no auth header, so the function does the admin check itself
(it verifies the caller's access token + `is_admin` before doing anything).

### 3. Secrets
No new secrets. It reuses `RESEND_API_KEY` and `RESEND_FROM` (already set for the
website forms) and the auto-injected `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY`.

## Sending
Admin portal → **Campaigns** → write a subject + message → **Send test to
myself** first → when it looks right, **Send to N clients**.

- The message is plain text; blank line = new paragraph. It's wrapped in the
  Tiger Soul email template with a greeting and unsubscribe footer added.
- Recipients = every client with an email on file who hasn't unsubscribed.
- Unsubscribes are honoured automatically and skipped on the next send.

## Note on consent
These contacts came from website form submissions, not an explicit newsletter
opt-in. Sending them retreat news is reasonable (they reached out to you), and
the one-click unsubscribe keeps it compliant and good for deliverability. Keep
the content relevant to why they contacted you.
