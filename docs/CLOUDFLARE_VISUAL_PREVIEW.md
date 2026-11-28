# COINXCHANGE Cloudflare staging

Cloudflare is the chosen host. The existing staging site is
<https://coinxchange-staging.pages.dev/>. This document describes the deployed
visual preview and preparation of an account-enabled staging artifact. It is
not approval to merge, deploy, change production Auth, or replace the main site.

## What is deployed

GitHub's Cloudflare Pages check for commit
[`7461d34900a9f50e83f87b40900c723dc829b1bc`](https://github.com/nosirp47-crypto/COINXCHANGE/commit/7461d34900a9f50e83f87b40900c723dc829b1bc)
reports a successful deployment at 2026-11-26 06:20:11 UTC. Its exact preview is
<https://b0c0dba2.coinxchange-staging.pages.dev/>.

| Setting | Existing visual preview |
| --- | --- |
| GitHub repository | `nosirp47-crypto/COINXCHANGE` |
| Staging Pages project | `coinxchange-staging` |
| Tracked branch | `preview/cloudflare-coinxchange` |
| Framework | None |
| Build command | Empty |
| Output directory | `coinxchange` — lowercase |
| Supabase configuration | Intentionally blank in `account-config.js` |

This deployed revision stores guest coin descriptions in the current browser.
Its photo input makes a temporary preview but does not persist the photograph.
Its real member sign-in and recovery forms are disabled because no backend is
configured. A successful Pages deployment means the files were published; it
does not establish that accounts, email delivery, or private photo storage work.

The recovery source is already included in the visual branch. Compared with
`phase3/recovery-verification-20261123`, that branch added the blank preview
configuration, this deployment guidance, and `robots.txt`. The older
`staging-accounts-recovery` branch has the staging configuration but lacks newer
discovery and recovery changes; using it wholesale would lose work.

## Prepare the account-enabled staging artifact

The source `coinxchange/account-config.js` stays blank. A separate build injects
only the known staging project's public browser key into `dist/staging`.

1. Read the publishable key from the existing `COINXCHANGE-staging` project,
   reference `uyccxknjcugtvgoiukoh`, into the local environment variable
   `COINXCHANGE_STAGING_PUBLISHABLE_KEY`. Do not substitute a secret or service
   role key. No new project or credential rotation is needed.
2. Run `npm run build:staging`. The script verifies the key against that exact
   project's public Auth settings and requires email confirmation. It never
   sends mail, applies migrations, or deploys anything.
3. Run `npm run check:staging`, then
   `COINXCHANGE_DEPLOY_TEST_MODE=staging npm run test:deploy`. These checks use
   the generated artifact at `/`, as Cloudflare will serve it. The root smoke
   test reads the actual configuration rather than replacing it with a fixture.
4. Inspect `dist/staging/build-info.json` for the source commit, dirty-source
   flag, staging project reference, and hashes of every deployed file. If
   `sourceDirty` is true, the artifact is for local review. After committing the
   reviewed changes, rebuild and run
   `npm run check:staging -- --require-clean` before any deployment.

The builder refuses the production project
`xjwjacihfrnslivolaml`. It copies the Founder Edition app, assets, and vendored
SDK, not the earlier repository-root prototype or old ZIP archives. It writes
`robots.txt` and no-index response headers. These indexing controls do not
provide access control.

If this artifact is approved for the separate staging Pages project, its build
command is `npm ci && npm run build:staging`, with output directory
`dist/staging` and the staging publishable key configured in the build
environment. The branch and settings must be reviewed before changing them:
Cloudflare Git integration can deploy on push, including branch previews.
Creating a development branch is not authorization to publish it.

## Save repair commits without publishing

Until deployment is approved, prefix every repair commit message with
`[CF-Pages-Skip]`. Cloudflare documents this specific prefix as omitting the
Pages deployment. GitHub's documented Actions skip strings do not include it,
so repository verification can still run. Do not use `[skip ci]`, which also
suppresses the verification workflow. Review commit checks after the push; a
skipped Pages build has no Cloudflare check-run. Sources:
[Cloudflare GitHub integration](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/)
and [GitHub workflow skip behavior](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs).

## Verification and release gates

Repository CI now covers pull requests and pushes to the working branches,
checks the published directory, runs the database isolation tests and browser
suite, and tests the visual app served at `/`. It records the exact tested
checkout in `verification-summary.md`. The workflow has read-only repository
permissions and no deploy step.

The default CI uses the intentionally blank visual configuration. Its account
behavior tests simulate provider responses, and database tests use isolated
Postgres. They cannot prove hosted email delivery, hosted Storage policies, or
cross-device persistence. Keep those distinct from the staging build's
read-only public-settings probe.

Before hosted acceptance testing, the separate staging backend must have the
reviewed private-photo schema and Storage policies, signup/recovery email
templates, verified sending configuration, and the exact staging origin in its
Auth redirect allowlist. Then verify actual signup confirmation, recovery on
another device, password change and new sign-in, private photo persistence after
reload/sign-in elsewhere, and rejection of another member's reads and writes.
The exact Cloudflare SMTP values, recipient restrictions, return URLs, and
acceptance steps are in [CLOUDFLARE_EMAIL_SETUP.md](CLOUDFLARE_EMAIL_SETUP.md).

Preserve existing production data and the Founder Edition design. Obtain the
owner's approval before merging into `main`, changing production settings, or
publishing a replacement. Cloudflare has already been selected; do not reopen
the provider-choice question.
