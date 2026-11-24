# COINXCHANGE Phase 3 — recovery and launch verification

Development-only checklist, prepared November 23, 2026. This document is not approval to deploy.

## Verified in repository source (phase3/accounts-db)
- `coinxchange/accounts.js` includes a six-digit recovery-code form and enables it in `enablePublicForms`.
- Recovery codes are passed to Supabase `auth.verifyOtp({email,token,type:'recovery'})`; no client-side code verification or hardcoded live OTP is used.
- `tests/accounts.spec.js` includes a simulated second-browser recovery test and an invalid-code rejection test.
- `docs/ACCOUNTS_SETUP.md` describes `{{ .Token }}` in Supabase Recovery email template, hosted callback URLs and SMTP configuration.
- `coinxchange/account-config.js` contains a public Supabase project URL and publishable (not secret) browser key.
- These are source-review findings only; simulated tests cannot prove hosted email delivery or database configuration.

## Outstanding release gates
1. Run `npm ci`, `npm run test:accounts`, `npm run test:database`, and other appropriate Playwright checks on this development branch. Record actual results.
2. Configure and verify the real Supabase Recovery email template to include `{{ .Token }}`, plus a verified sending domain and production-capable SMTP. Keep credentials outside GitHub.
3. On a stable staging HTTPS origin, request recovery in browser/device A, enter the received code in browser/device B, change password, sign in with the new password, and confirm expired/reused codes cannot change it.
4. Verify an additional user cannot read/write another user's collection or watchlist against the deployed Supabase backend; check existing real data is intact.
5. Confirm the chosen public host (GitHub Pages vs Cloudflare Pages), published directory and precise Auth callback URLs. Do not rely on a temporary Codespace URL.
6. Confirm original homepage, Founder Edition visual design and all intended launch features with the owner. The root `index.html` is the earlier prototype; the Phase 3 member app lives in `coinxchange/`.
7. Obtain explicit owner approval before merging into `main`, changing production Auth/database settings or publishing a replacement.

## Preservation
Do not alter `main`, delete Supabase records, rotate credentials casually, expose SMTP secrets, or represent simulated tests as end-to-end validation.
