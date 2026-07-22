# Website forms → Resend — setup runbook

Two forms on the public site now send email:

| Form | Page | Edge Function | Lands on |
|---|---|---|---|
| Contact enquiry | `pages/contact.html` | `contact-form` | `pages/thank-you.html` |
| Health screening / application | `pages/health-screening.html` | `health-screening` | `pages/thank-you-screening.html` |

Flow for both:

```
visitor submits → js/forms.js POSTs JSON → Supabase Edge Function → Resend
                                                     ├─ notification to hello@tigersoulretreats.com
                                                     └─ confirmation to the visitor
```

The code is written. What's left is the account work below — creating the API key
and adding DNS records, which only you can do.

---

## 1. Resend — verify `tigersoulretreats.com`

The Academy already sends from `tigersoulacademy.com`. These forms send from the
retreats domain, so it needs verifying too.

1. Resend → **Domains** → **Add Domain** → `tigersoulretreats.com`
2. Resend gives you DNS records (SPF, DKIM, usually a return-path). Add them at
   whoever hosts DNS for `tigersoulretreats.com`.
3. Wait for **Verified** (minutes to a couple of hours).
4. Resend → **API Keys** → create one if you don't already have the key you used
   for the Academy. Either key works — it's the domain that has to be verified,
   not the key.

Sending address: `forms@tigersoulretreats.com` (no inbox required — it's send-only).

> Until the domain is verified, Resend rejects the send and the form shows
> "We couldn't send that just now." That's the expected failure, not a bug.

## 2. Supabase — set the secrets

Project: **Tiger Soul**, ref `werkohszkcytdvljafha`.

```bash
supabase secrets set --project-ref werkohszkcytdvljafha \
  RESEND_API_KEY="re_..." \
  RESEND_FROM="Tiger Soul <forms@tigersoulretreats.com>" \
  NOTIFY_TO="hello@tigersoulretreats.com"
```

`NOTIFY_TO` is optional — it defaults to `hello@tigersoulretreats.com`. Set it if
you ever want submissions going somewhere else (a staging inbox, a second reader).

## 3. Deploy

Both must be public: the website posts to them with no user session, so JWT
verification has to be off. The functions do their own origin check and honeypot
filtering instead.

```bash
supabase functions deploy contact-form --project-ref werkohszkcytdvljafha --no-verify-jwt
supabase functions deploy health-screening --project-ref werkohszkcytdvljafha --no-verify-jwt
```

## 4. Test

Submit each form on the live site. You should get:

- an email at `hello@tigersoulretreats.com` — hitting **Reply** replies to the
  person who submitted, not to Resend
- a confirmation in the submitter's inbox
- the browser on the matching thank-you page

Logs if something doesn't arrive:

```bash
supabase functions logs contact-form --project-ref werkohszkcytdvljafha
supabase functions logs health-screening --project-ref werkohszkcytdvljafha
```

---

## Notes

- **The screening emails contain health information.** Keep `NOTIFY_TO` pointed at
  an inbox only the facilitators read, and don't forward those emails around.
  Nothing is written to the database — the email is the only copy.
- **Adding a new allowed domain.** When the site moves off
  `laurenbur2.github.io` to `tigersoulretreats.com`, both origins are already in
  `ALLOWED_ORIGINS` in `_shared/forms.ts`. Any other origin needs adding there and
  a redeploy, or the browser blocks the request with a CORS error.
- **Changing a screening question.** The wording in the email comes from
  `QUESTIONS` in `health-screening/index.ts`, deliberately — not from the browser,
  so a forged request can't rewrite the questions. Edit the HTML *and* that map
  together, keeping the `q5`…`q47` names in sync.
- **Spam.** Each form carries a hidden honeypot field that js/forms.js injects.
  If spam ever gets through anyway, the next step is a rate limit keyed on IP.
