# COINXCHANGE Phase 3 — recovery and launch verification

Development-only checklist, updated November 27, 2026 (America/Los_Angeles).
This document is not approval to merge or deploy.

## Baseline findings
- `coinxchange/accounts.js` includes a recovery-code form and enables it in `enablePublicForms`.
- Recovery codes are passed to Supabase `auth.verifyOtp({email,token,type:'recovery'})`; no client-side code verification or hardcoded live OTP is used.
- `tests/accounts.spec.js` includes a simulated second-browser recovery test and an invalid-code rejection test.
- `docs/ACCOUNTS_SETUP.md` describes `{{ .Token }}` in Supabase Recovery email template, hosted callback URLs and SMTP configuration.
- The deployed `preview/cloudflare-coinxchange` configuration is intentionally blank, so real accounts are disabled. The older `staging-accounts-recovery` branch contains staging configuration. These are different deployable states.
- These are source-review findings only; simulated tests cannot prove hosted email delivery or database configuration.

## Outstanding release gates
1. Run `npm ci`, `npm run test:accounts`, `npm run test:database`, and other appropriate Playwright checks on this development branch. Record actual results.
2. Configure and verify the real Supabase Recovery email template to include `{{ .Token }}`, plus a verified sending domain and production-capable SMTP. Keep credentials outside GitHub.
3. On a stable staging HTTPS origin, request recovery in browser/device A, enter the received code in browser/device B, change password, sign in with the new password, and confirm expired/reused codes cannot change it.
4. Verify an additional user cannot read/write another user's collection or watchlist against the deployed Supabase backend; check existing real data is intact.
5. Use the already chosen Cloudflare host. Verify the exact publish directory, build provenance, and precise Auth callback URLs using `docs/CLOUDFLARE_VISUAL_PREVIEW.md`. Do not rely on a temporary Codespace URL or confuse the visual-preview configuration with account-enabled staging.
6. Confirm original homepage, Founder Edition visual design and all intended launch features with the owner. The root `index.html` is the earlier prototype; the Phase 3 member app lives in `coinxchange/`.
7. Obtain explicit owner approval before merging into `main`, changing production Auth/database settings or publishing a replacement.

## Founder signup counter

The deployed visual preview has collection and watchlist totals, not a founder
member counter. The repair branch adds `coinxchange/founder-dashboard.js` and
the additive `20261128074147_founder_signup_counts.sql` migration. The backend
returns aggregate account totals only. It does not return a member directory,
coin records, names, email addresses, or account identifiers.

| Metric | Meaning |
| --- | --- |
| Total members | Nonanonymous, nondeleted accounts with an email, including pending confirmation and the founder account |
| Confirmed members | Those accounts whose email has been confirmed |
| Joined in 7 / 30 days | Accounts created in the indicated interval, including pending confirmation |
| As of | Backend timestamp for the snapshot |

The founder UUID allowlist `coinxchange_private.founder_members` starts empty.
After verifying the actual owner's confirmed Auth identity, a trusted
administrator must provision that UUID. No email, display name, signup
metadata, or client-side flag grants access. The public RPC wrapper
`founder_signup_counts()` calls a guarded private implementation; both ordinary
members and signed-out callers are denied. `npm run test:founder` covers the
SQL authorization and counting behavior in isolated Postgres, and browser
tests cover the dashboard. Hosted access and owner provisioning are separate
gates. Until those complete, do not claim the live counter is enabled.

## Staging schema history and expected advisor finding

The separate staging project has these additive migrations recorded in its
remote history. The filenames match those recorded versions:

- `20261128073948_private_coin_photos.sql`
- `20261128074147_founder_signup_counts.sql`

The original account tables already existed before this repair. The baseline
`20261122000100_accounts_and_private_data.sql` is present in the repository,
but its version was not present in the inspected staging migration history.
Do not run an unreviewed `supabase db push` or reset against that project: a
missing history entry does not mean the corresponding tables are absent.
Compare the actual baseline schema and policies with the migration before
planning any history reconciliation. Supabase's
[migration history repair reference](https://supabase.com/docs/reference/cli/supabase-migration-repair)
describes changing migration history; this document is not an instruction to
mark an unchecked migration as applied.

The advisor's informational `0008_rls_enabled_no_policy` finding on
`coinxchange_private.founder_members` is expected. That table deliberately has
RLS enabled, no client policies, and revoked client table privileges. Clients
must not read or modify the founder allowlist. The guarded backend function
checks membership before returning aggregate totals. Do not add a permissive
policy to silence the informational finding. Reassess it if the table,
privileges, RPC authorization, or intended access model changes. See
[Supabase's advisor guidance](https://supabase.com/docs/guides/observability/advisors?lint=0008_rls_enabled_no_policy).

## Preservation
Do not alter `main`, delete Supabase records, rotate credentials casually, expose SMTP secrets, or represent simulated tests as end-to-end validation.
