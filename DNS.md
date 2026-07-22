# tigersoulretreats.com — DNS

Registered at **GoDaddy**. DNS currently served by **Squarespace**
(`ns01–04.squarespacedns.com`), moving to GoDaddy.

Captured live 2026-07-22, before the nameserver move. This is the list to rebuild
at GoDaddy — **every line below has to exist there before the nameservers change**,
or the website and the hello@ inbox go down with them.

## Current zone

| Type | Host | Value | Priority | Serves |
|---|---|---|---|---|
| A | `@` | `198.185.159.144` | — | Squarespace website |
| A | `@` | `198.185.159.145` | — | Squarespace website |
| A | `@` | `198.49.23.144` | — | Squarespace website |
| A | `@` | `198.49.23.145` | — | Squarespace website |
| CNAME | `www` | `ext-sq.squarespace.com` | — | Squarespace website |
| MX | `@` | `mail.protonmail.ch` | 10 | **hello@ inbox** |
| MX | `@` | `mailsec.protonmail.ch` | 20 | **hello@ inbox** |
| TXT | `@` | `v=spf1 include:_spf.protonmail.ch ~all` | — | ProtonMail SPF |
| TXT | `@` | `protonmail-verification=098a12bc6983249fba411d60f4b06f3369043f58` | — | ProtonMail ownership |
| CNAME | `protonmail._domainkey` | `protonmail.domainkey.d73sc4xm4vlmak7wh43744zyoz7rqsu6cnwzzijixtz25bqhsjpha.domains.proton.ch` | — | ProtonMail DKIM |
| CNAME | `protonmail2._domainkey` | `protonmail2.domainkey.d73sc4xm4vlmak7wh43744zyoz7rqsu6cnwzzijixtz25bqhsjpha.domains.proton.ch` | — | ProtonMail DKIM |
| CNAME | `protonmail3._domainkey` | `protonmail3.domainkey.d73sc4xm4vlmak7wh43744zyoz7rqsu6cnwzzijixtz25bqhsjpha.domains.proton.ch` | — | ProtonMail DKIM |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine` | — | DMARC policy |

## To add for Resend

Values come from Resend → Domains → `tigersoulretreats.com`. All on subdomains, so
nothing above is touched — in particular the apex SPF stays ProtonMail's alone.

| Type | Host | Value |
|---|---|---|
| MX | `send` | `feedback-smtp.<region>.amazonses.com` (priority 10) |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| TXT | `resend._domainkey` | the `p=MIGfMA0…` key Resend generates |

## Things that will bite

- **`_dmarc` is `p=quarantine`, not `p=none`.** Mail claiming to be from this domain
  that isn't properly authenticated gets quarantined — straight to spam. Resend's
  DKIM record isn't optional here; without `resend._domainkey` in place and verified,
  the form emails will silently land in junk. Verify in Resend before trusting it.
- **One SPF record per name.** The apex already has ProtonMail's. Never add a second
  there. Resend's lives on `send`, which is a different name, so they coexist.
- **Don't flip nameservers on an empty zone.** Build the whole table above at GoDaddy
  first, then change the nameservers. A partial zone means bounced mail, and bounced
  mail doesn't queue up and arrive later — it's gone.
- **Keep the Squarespace A/CNAME records until the new site is actually live.** They
  point at Squarespace's servers, which keep serving the current site regardless of
  who hosts the DNS. Only swap them for GitHub Pages when the new site is ready to
  take over.

## After the move

Confirm with:

```bash
dig +short NS tigersoulretreats.com
dig +short MX tigersoulretreats.com
dig +short TXT tigersoulretreats.com
dig +short TXT resend._domainkey.tigersoulretreats.com
```

Nameservers should be GoDaddy's; MX must still be ProtonMail. Send a test to hello@
and submit both website forms.
