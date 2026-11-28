# COINXCHANGE repair handoff

Prepared November 27, 2026 (America/Los_Angeles).

## Decisions already made

Cloudflare remains the selected host. Preserve the Founder Edition design,
the existing production Supabase project, and the main production website.
The owner has authorized implementation and verification; a merge or public
launch still needs approval. Do not ask the owner to choose a hosting provider
again or repeat the project setup history.

Repository: `nosirp47-crypto/COINXCHANGE`.
Repair branch: `fix/staging-photos-recovery-20261128`.
Base: `preview/cloudflare-coinxchange` at
`7461d34900a9f50e83f87b40900c723dc829b1bc`.

## Confirmed causes

1. The Cloudflare preview configuration deliberately has empty Supabase URL
   and key fields. It is a visual preview with accounts disabled, even though
   account code exists in the repository.
2. The photographed-coin flow saved the description and notes only. Its image
   was a temporary browser object URL, and collection rows displayed a generic
   icon. There was no private cloud photo bucket or photo-path column.
3. Verification originally ran only on pushes to `phase3/accounts-db`, so the
   newer recovery, staging and preview branches were not covered by that gate.
4. A real hosted email-to-recovery round trip has not been demonstrated. The
   current tools can inspect the database but cannot administer the hosted
   SMTP, template and redirect settings. Both dashboard pages require sign-in.

## Implemented repairs

- Save a bounded JPEG with the coin's description; show the actual photo in
  the collection and retain it after reload. Guest storage errors preserve
  the draft and do not claim success.
- Store account photos in the private `coin-photos` bucket, with owner-scoped
  paths and database/Storage enforcement. Read images with the authenticated
  SDK into temporary object URLs. Never put account images in guest storage.
- Preserve photos while editing details; delete the record before its image;
  keep coin details visible and offer Retry if an image cannot load.
- Provide confirmation and recovery code forms with server verification and
  prepared email templates. Expired or reused codes cannot authorize a reset.
- Serialize account loads. Cancel pending authentication intent at logout,
  suppress late SDK events, and remove any session written by a delayed
  authentication response before allowing a new attempt.
- Add a founder-only aggregate member counter with registered, confirmed,
  seven-day and thirty-day totals. Its trusted founder allowlist is empty.
  An actual verified owner account must be assigned by an administrator.
- Build a deterministic, separately configured staging artifact and verify
  the actual publish root, runtime files, backend identity and file hashes.
  Expand repository checks to repair branches and pull requests.

## Hosted changes already completed

Only the separate staging project `uyccxknjcugtvgoiukoh` was changed.

- `20261128073948_private_coin_photos.sql` applied and verified: private bucket,
  JPEG only, 512,000-byte limit, owner-path policies and nullable photo column.
- `20261128074147_founder_signup_counts.sql` applied and verified: anonymous
  callers cannot call the count RPC; members cannot read or assign founder
  roles. No founder identities were provisioned. Staging has zero users.
- The public Auth settings endpoint accepted the existing staging public key
  and confirmed email authentication and required email confirmation.

The private founder allowlist intentionally has no client RLS policies and
no client table grants. Its advisor INFO finding is explained in
`PHASE3_LAUNCH_READINESS.md`. The pre-existing baseline schema was not recorded
in migration history; do not blindly reapply it or run a database reset.

## Verification and its limits

The account SDK tests use controlled Auth, PostgREST and Storage HTTP
responses; database tests execute the actual migration SQL in isolated
Postgres. These checks do not prove real email delivery or hosted user login.
The initial combined desktop/mobile Chromium run passed 94 checks with six
intended skips for welcome screens absent from the old root prototype.
After the race fixes, all 44 account cases passed (22 scenarios on desktop
and mobile Chromium, including the new races). The actual publish-root smoke
passed four checks: visual and configured staging builds on both viewports.
Photo helper tests passed eight cases; private-photo SQL passed 20 checks;
founder SQL passed 16 checks; existing account/RLS SQL passed. These results
precede the review commit. Read the PR checks for independent hosted-runner
verification of that exact commit.

Local browser coverage uses Chromium, including an iPhone-sized viewport.
It is not a Safari result. The repository workflow runs actual Chromium,
WebKit and an iPhone WebKit configuration when its hosted runner is available.

## Exact remaining sequence

1. Restore authenticated access to the existing Cloudflare account and the
   separate staging Supabase dashboard. The open pages are sign-in pages,
   not proof that the previous session persists.
2. Inspect the already onboarded sending domain and account entitlement.
   Install the SMTP values, templates and exact return URLs described in
   `CLOUDFLARE_EMAIL_SETUP.md`. No sender identity or domain has been invented.
3. Build the reviewed clean commit using `npm run build:staging`; validate
   `npm run check:staging -- --require-clean`. Review the output before
   publishing to the existing staging project. The existing visual preview
   stays unchanged until that step.
4. Verify a real confirmation/recovery code received in an authorized inbox,
   use it in a different browser, update the test password, sign in again,
   and check rejected expired/reused codes. Test real private photo save,
   second-device load, edit, deletion, logout and two-account isolation.
5. Confirm the owner's authenticated account identity and provision only its
   UUID for the founder dashboard. Verify the displayed totals.
6. Present the verified staging result for the owner's merge/launch approval.

All repair commits use the documented `[CF-Pages-Skip]` prefix so GitHub
verification can run without an automatic Cloudflare deployment. Do not use
`[skip ci]`, which would also suppress the test workflow.
