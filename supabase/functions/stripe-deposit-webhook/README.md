# Deposit welcome email — setup runbook

When someone pays the Bufo Practitioner Training deposit on Stripe, this Supabase
Edge Function sends them the branded "deposit received" email via Resend.

`customer pays → Stripe checkout.session.completed → this function → Resend → email`

You do the account/credential steps (I can't create accounts or enter keys); the
code is already written in `index.ts`.

---

## 1. Resend (sending the email)

1. Create an account at https://resend.com
2. **Add & verify `tigersoulacademy.com`** (Resend → Domains → Add Domain).
   Resend gives you DNS records (SPF, DKIM, and usually a return-path). Add them at
   your domain registrar/DNS. Wait for "Verified" (minutes to a couple hours).
   - Sending from: `academy@tigersoulacademy.com`
3. **Create an API key** (Resend → API Keys). Copy it (`re_...`).

## 2. Stripe (the trigger)

1. Get your **Secret key**: Stripe → Developers → API keys → Secret key (`sk_live_...`).
2. Create the **webhook**: Stripe → Developers → Webhooks → Add endpoint.
   - Endpoint URL (from step 3 below):
     `https://<your-project-ref>.supabase.co/functions/v1/stripe-deposit-webhook`
   - Events to send: **`checkout.session.completed`**
   - After creating it, copy the **Signing secret** (`whsec_...`).
3. (Recommended) On the Payment Link, turn on **collect customer name** so the email
   can greet them by first name. Stripe → Payment Links → your link → Edit →
   "Collect customers' names". Without it, the email opens with "Dear there,".

## 3. Supabase (running the function)

Requires the Supabase CLI (`brew install supabase/tap/supabase`) and being logged in
(`supabase login`), then link the project (`supabase link --project-ref <ref>`).

Set the secrets:

```bash
supabase secrets set \
  STRIPE_SECRET_KEY="sk_live_..." \
  STRIPE_WEBHOOK_SECRET="whsec_..." \
  RESEND_API_KEY="re_..." \
  RESEND_FROM="Tiger Soul Academy <academy@tigersoulacademy.com>" \
  RESEND_REPLY_TO="hello@tigersoulretreats.com"
```

Deploy the function. It must be public (Stripe calls it unauthenticated; we verify
the Stripe signature ourselves):

```bash
supabase functions deploy stripe-deposit-webhook --no-verify-jwt
```

The deployed URL is what you paste into the Stripe webhook in step 2.

## 4. Test

- Stripe → Webhooks → your endpoint → "Send test event" → `checkout.session.completed`
  (a test event has no real email, so it just confirms a 200 response), **or**
- Make a real $1,500 payment (or a test-mode payment with test keys) and confirm the
  email arrives.
- Logs: `supabase functions logs stripe-deposit-webhook` (or the Supabase dashboard).

## Notes

- Live vs test: use `sk_live_`/live webhook secret for real payments; `sk_test_` +
  a test-mode webhook to trial it without charging.
- The email HTML lives inside `index.ts` (`renderEmail`). Edit there to change copy.
  The header image and logo are pulled from the live GitHub Pages URLs.
- Idempotency: Stripe may retry. If you ever see rare duplicates, we can add an
  event-id dedupe table in Supabase.
