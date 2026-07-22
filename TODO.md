# Tiger Soul — follow-ups

## 1. Flatten URLs to match what Google already indexed

**Why:** the old Squarespace site used clean URLs (`/about`, `/retreats`,
`/medical-health-screening`). The new site serves `/pages/about.html` and puts a
redirect stub at the old path. Every visitor arriving from a search result takes
an extra hop, and a meta-refresh passes ranking signal more weakly than a real
301 — which GitHub Pages cannot issue.

**The fix:** make the old URL the real page. `/about/index.html` becomes the
actual About page rather than a stub pointing at `/pages/about.html`. The URLs
Google has indexed then resolve directly — no redirect, no signal loss.

**Scope:** ~20 pages. Move each `pages/x.html` to `<old-slug>/index.html`, fix
the relative asset paths (`../assets` becomes `../assets` still, since both are
one level deep — verify), update internal links, regenerate sitemap.xml, and
keep stubs only where the old slug and new page genuinely differ (e.g.
`/bufo-preparation` and `/about-bufo` both land on the Bufo page).

**Watch out for:** pages with no old-Squarespace equivalent (liberation-program,
reclamation-retreat, renewal-retreat, faq, thank-you pages) — those pick a clean
slug of their own. And `pages/health-screening.html` is linked from the forms'
redirect target in `js/forms.js`, so that path is referenced in code, not just
markup.

**Do it after** the launch has settled and Search Console shows the new URLs
indexed — changing URLs twice in a fortnight is worse than either state.

## 2. Rotate the Resend API key to a domain-scoped one

The live key (`tiger-soul-forms`) was shown in a screenshot and is in shell
history. Resend's "create key restricted to one domain" form was erroring on
2026-07-22; an all-domains key was rejected deliberately because the Resend
account holds domains for unrelated projects.

Retry the domain-scoped key. When it works:

```bash
read "k?Paste Resend key: " && supabase secrets set --project-ref werkohszkcytdvljafha RESEND_API_KEY="$k"
```

Then test both forms before deleting the old key in Resend.

## 3. Cancel Squarespace

Only after the new site is confirmed live over HTTPS and clicked through. DNS no
longer depends on Squarespace, so this is now safe — but their servers are what
rendered the old site, so don't cancel until you're sure you won't want it back.

## 4. Google Search Console

Submit `https://tigersoulretreats.com/sitemap.xml` and request indexing on the
main pages. Speeds recrawl from weeks to days after the migration.
