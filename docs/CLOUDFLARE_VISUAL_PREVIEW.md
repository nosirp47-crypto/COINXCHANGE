# COINXCHANGE Cloudflare visual staging preview

This branch is a **non-production visual preview** of the Founder Edition.
It includes the new research, saving, sharing, hashtag and ad-placeholder UI.

**Deliberate limitation:** `coinxchange/account-config.js` has blank Supabase configuration to prevent this preview from touching live member accounts or private coins. Guest collections are saved only in the current browser. Actual photo uploads, automatic photo identification, real advertising, and working account password reset are NOT enabled by this deployment.

## Cloudflare Pages: deploy safely
1. In Cloudflare dashboard open **Workers & Pages** and create a **Pages** project by connecting your GitHub account.
2. Choose GitHub repo `nosirp47-crypto/COINXCHANGE`.
3. Set the production branch **for this separate staging Pages project** to `preview/cloudflare-coinxchange`. Do **not** change the existing live site or its hosting settings.
4. Use **Framework preset: None**, **Build command: (blank)**, **Build output directory: coinxchange**. The deploy root must contain `index.html`, `accounts.js`, `discovery-collection-market.js` and `assets/`.
5. Deploy and use the issued `*.pages.dev` URL to verify the preview. Do not enter real passwords in preview mode.

Cloudflare Pages branch previews can be public to anyone with the link unless Cloudflare Access is configured. This branch includes a robots.txt request not to index it, but that is not access control.

## Before enabling real accounts
Use the separate Supabase staging project, configure its publishable browser key, recovery email template and SMTP, add its **exact** HTTPS origin to Auth redirect allowlist, and test hosted recovery. Do not point this test branch at the existing production project by mistake.
