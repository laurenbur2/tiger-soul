# Tiger Soul — follow-ups

Site went live on GitHub Pages 2026-07-22. These are what's left.

## 1. Tick "Enforce HTTPS"

GitHub → repo Settings → Pages → **Enforce HTTPS**. The certificate is issued and
covers both `www.tigersoulretreats.com` and the apex; the box just hasn't been
ticked. Until it is, `http://` requests are served over plain HTTP rather than
redirected to `https://`.

## 2. Rotate the Resend API key to a domain-scoped one

The live key (`tiger-soul-forms`) appeared in a screenshot and is in shell history.
Resend's "restrict this key to one domain" form was erroring on 2026-07-22, and an
all-domains key was refused on purpose — that Resend account holds domains for
unrelated projects, so an unscoped key could send mail as any of them.

Retry the domain-scoped key. When it works:

```bash
read "k?Paste Resend key: " && supabase secrets set --project-ref werkohszkcytdvljafha RESEND_API_KEY="$k"
```

Test both forms before deleting the old key in Resend.

## 3. Google Search Console

Submit `https://www.tigersoulretreats.com/sitemap.xml` and request indexing on the
main pages. Cuts the post-migration recrawl from weeks to days.

Note the property must be the **www** host — that is the canonical one now.

## 4. Cancel Squarespace

Only after clicking through every page and both forms yourself, including on a
phone. DNS no longer depends on Squarespace, so this is safe whenever you're
ready — but their servers are the only way back to the old site.

---

## Done

- Contact form and health screening wired to Resend, with confirmations to the
  sender and a thank-you page each
- DNS moved from Squarespace to GoDaddy, ProtonMail intact
- New site live on the domain
- URLs flattened to the slugs Google already indexed (`/about`, not
  `/pages/about.html`) — 12 old URLs are now real pages with no redirect
- `www` made canonical, which killed the redirect loop that cached Squarespace
  redirects were causing in returning visitors' browsers
