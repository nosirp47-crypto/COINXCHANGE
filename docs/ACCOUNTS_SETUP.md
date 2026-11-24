# COINXCHANGE account and database setup

This batch connects the Founder Edition app in `coinxchange/` to Supabase Auth and a private Postgres database. It covers member sign-in, registration, password recovery, a display-name profile, a private coin collection, and a private watchlist. The existing standalone root `index.html` remains the earlier prototype.

**A Supabase project must be configured and the hosted flows verified before these features can be used by members.** Blank values in `coinxchange/account-config.js` keep the existing demonstration available. Committing this code does not create a database, enable email delivery, or deploy the site.

## What this batch stores

| Table | Data | Member access |
| --- | --- | --- |
| `profiles` | Auth user ID, display name, created/updated timestamps | Read own profile; change own display name |
| `collection_items` | Generated item ID, owner ID, coin name, notes, optional reference ID, creation timestamp | Read, add, edit, and delete own items |
| `watchlist_items` | Owner ID, reference ID, creation timestamp | Read, add, and remove own references |

Email addresses and password credentials stay in Supabase Auth. There are no public profile reads and no member-controlled administrator role. Database row policies use the authenticated user ID; column permissions also prevent a member from changing ownership, record IDs, or audit timestamps. Supabase documents how [grants and row-level security work together](https://supabase.com/docs/guides/database/postgres/row-level-security).

Community posts, likes, replies, and photo previews remain browser-local demonstrations in this batch. They are not copied into the online database. Guest collections and watchlists also remain local and are not silently imported into an account. The broader blueprint's passkeys, public community, media storage, moderation, and payments are separate work.

## 1. Create the project and apply the migration

1. Create a Supabase project owned by the founder's account or organization. Use a separate project for testing before enabling member accounts on the public site. Record the database password privately in your password manager.
2. In the project's SQL Editor, run the complete contents of [`supabase/migrations/20261122000100_accounts_and_private_data.sql`](../supabase/migrations/20261122000100_accounts_and_private_data.sql) once. Alternatively, apply that migration through an already configured Supabase CLI project.
3. Confirm the three tables above exist and row-level security is enabled on each. The migration also installs a restricted trigger that creates a profile when an Auth user signs up. The trigger sanitizes the supplied display name; user metadata does not control access permissions.

The migration is written for a fresh project and deliberately fails if a conflicting table already exists. Do not delete existing tables or disable RLS to make it run. Review an existing database before applying schema changes. Existing Auth users receive a private profile during the migration.

The `coinxchange_private` schema holds trigger functions and must remain outside the Data API's exposed schemas. Do not grant it to `anon` or `authenticated`. The signup trigger uses an empty `search_path`, schema-qualified references, and restricted execution privileges, following Supabase's [user-data](https://supabase.com/docs/guides/auth/managing-user-data) and [function-security](https://supabase.com/docs/guides/database/functions) guidance.

## 2. Configure account email and callbacks

Enable the email/password provider and **keep email confirmation enabled**. Review the Auth password settings and rate limits for the intended beta size. The app's field validation is only a user aid; Supabase Auth must enforce the password and request limits.

Under Auth URL Configuration, set the **Site URL** to the exact directory that serves the Founder Edition app. Add that same directory URL and its `?account=recovery` variant to the allowed redirect URLs. Include the trailing slash. Use explicit production/staging URLs rather than broad wildcards. See [Supabase redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).

| Hosting layout | App directory / Site URL | Additional recovery redirect |
| --- | --- | --- |
| Cloudflare Pages publishes the `coinxchange` folder | `https://coinxchange-private-beta.pages.dev/` | `https://coinxchange-private-beta.pages.dev/?account=recovery` |
| GitHub Pages publishes the repository root | `https://nosirp47-crypto.github.io/COINXCHANGE/coinxchange/` | `https://nosirp47-crypto.github.io/COINXCHANGE/coinxchange/?account=recovery` |

Use the row that matches the deployment actually being tested. If the hostname, preview deployment, or publish directory changes, enter the new exact URLs. Only add origins you control. This batch computes callbacks from the currently loaded app directory and does not accept a user-supplied redirect destination.

The client uses the PKCE authentication flow. Open confirmation and recovery links in the **same browser profile that requested them**, where the temporary verifier is stored. On another browser or device, open Forgot Password and enter the email address and recovery code. If only a link was delivered, request another email from the browser you intend to use. An expired or already-used link must produce an error and a new-link path, not a successful password-change message. Supabase explains the [PKCE browser requirement](https://supabase.com/docs/guides/auth/sessions/pkce-flow) and [password recovery flow](https://supabase.com/docs/guides/auth/passwords).

### Optional six-digit recovery codes (mobile / cross-browser)

The Phase 3 app also accepts a six-digit recovery code directly on the Forgot Password screen. The browser sends the account email, code and `type: 'recovery'` to Supabase `verifyOtp`; only a Supabase-verified recovery session can unlock the new-password form. Existing email-link recovery remains available.

**Required before real-world use:** configure the Supabase **Reset Password / Recovery** email template to visibly include the one-time `{{ .Token }}` code. The default email contains a link but not necessarily a visible code. For reliable public delivery, configure and test a trusted SMTP provider; SMTP credentials stay server-side. Do not advertise code-only recovery as operational until SMTP, template, delivery, expiry, rate limits and mobile end-to-end tests have been verified. Never place SMTP credentials or secret API keys in browser code.

For a staging project using six-digit codes, set the Recovery email body to the following and disable email-provider link tracking. Send a fresh recovery email after saving the template.

```html
<p>Your COINXCHANGE password recovery code is <strong>{{ .Token }}</strong>.</p>
<p>On any device, open COINXCHANGE, select Forgot Password, and enter your email and this code.</p>
<p>Or use the browser where you made the request and <a href="{{ .ConfirmationURL }}">reset your password</a>.</p>
```

The six-digit code is sensitive, single-use, and must not be logged, copied into screenshots or stored in the collection database. Codes from a different user or an expired email must not authorize password changes. Keep the app on a stable HTTPS origin; a Codespace URL is not a production recovery destination.

### Email delivery before inviting people

Configure a custom SMTP service and verify the sending domain before inviting people outside the project team. Supabase's built-in email service is intended for setup/testing, restricts recipients, and has low limits; see [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp). Keep SMTP credentials in Supabase/provider settings. They do not belong in the repository or browser config.

Check confirmation and recovery delivery using the actual sender address. Review provider [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits), email-link expiry, and abuse controls. CAPTCHA requires both a configured provider in Supabase and a client widget that passes a valid CAPTCHA token. This batch does not include that widget: do not simply enable CAPTCHA and assume the existing forms can submit. Wire and test [CAPTCHA protection](https://supabase.com/docs/guides/auth/auth-captcha) before opening unrestricted public registration if it is part of the selected abuse controls. An invited beta still needs enforced rate limits and monitored email delivery.

## 3. Connect the browser to this project

Edit `coinxchange/account-config.js` with the **project URL** and **publishable key** from Supabase:

```js
window.COINXCHANGE_CONFIG = Object.freeze({
  supabaseUrl: 'https://YOUR_PROJECT_REF.supabase.co',
  supabasePublishableKey: 'YOUR_PUBLISHABLE_KEY'
});
```

The public publishable key is designed to be present in browser code; a legacy `anon` key is also accepted by this app. Database policies, together with the signed-in user's session, protect the rows. **Never use a `service_role`, `sb_secret_...`, database password, personal access token, or SMTP credential here.** Such credentials have different privileges and must remain server-side. See [Supabase API keys](https://supabase.com/docs/guides/api/api-keys).

Serve the complete `coinxchange/` folder, including its JavaScript and assets. If Cloudflare Pages is used, verify its output directory is `coinxchange` or use the nested `/coinxchange/` app URL when publishing the repository root. Test over HTTPS at the exact URL registered above.

With valid public configuration, guests can browse reference material but must sign in to write an online vault or watchlist. Do not treat a visible sign-in form as proof that the database migration, email delivery, or account authorization has been verified.

## 4. Verify database isolation

### Reproducible local check

From the repository root, install its locked dependencies and run the database test:

```sh
npm ci
npm run test:database
```

[`scripts/test-database.mjs`](../scripts/test-database.mjs) starts an isolated in-memory PGlite/Postgres engine with Supabase-shaped Auth tables, roles, and the `auth.uid()` helper. It executes the exact migration and [`supabase/tests/accounts_rls.sql`](../supabase/tests/accounts_rls.sql), checks existing-user profile backfill, and verifies that the test fixtures roll back. No Supabase credentials, Docker installation, network connection, or live database are needed to run the test after the package dependencies are installed.

This check exercises Postgres grants, triggers, constraints, and RLS. Its Auth bootstrap is a minimal test fixture: it does not run Supabase's hosted Auth server, validate real JWTs, exercise the Data API, send confirmation/recovery emails, or prove that a live project is configured correctly.

### Verify the actual staging project

Run `supabase/tests/accounts_rls.sql` as the database owner **in a disposable test project**. It requires the migration and the standard Supabase Auth roles/schema. It creates randomly identified fixture users inside a transaction, exercises real row policies under `anon` and `authenticated`, then rolls back all fixtures. Keep its final `ROLLBACK` statement.

For a configured test connection using `psql`:

```sh
psql "$COINXCHANGE_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/accounts_rls.sql
```

Store that test connection string privately; do not put it in JavaScript, source control, screenshots, or chat. The script also works as one complete SQL Editor run. Any failed expectation raises an error. A successful run ends with `COINXCHANGE account/RLS checks passed` and a rollback.

The checks cover anonymous rejection, owner reads and writes, cross-account isolation including known row IDs, rejected impersonation, immutable identity/audit fields, text constraints, safe profile creation from user metadata, missing-session isolation, and account-deletion cascades. They verify database rules, not email delivery or the complete hosted Auth service.

## 5. Complete a hosted acceptance check

Use two dedicated test member accounts, in separate browser profiles:

1. Register and confirm email. Verify an unconfirmed account cannot sign in when confirmation is required.
2. Sign in, change the display name, save a coin with notes, and add/remove a watchlist reference. Reload and sign in again to verify persistence.
3. Sign in as the second member. Confirm the first member's private profile, coins, and watchlist are absent. Attempt a database API request with the first member's known item ID while authenticated as the second member; it must not return or modify the item.
4. Sign out and confirm private content disappears immediately. Switch accounts without refreshing and confirm no private content leaks from the previous session. Confirm a failed or expired session does not fall back to writing private data into guest storage.
5. Request a recovery link, open it in the requesting browser, set a new password, and confirm the new password works. In a fresh browser profile on a second device, enter the emailed code, change the password, and verify the new password works. Check wrong, expired and reused codes, and different-browser PKCE link failure.
6. Interrupt the network during a save. Confirm the app reports failure and retains the user's typed input without claiming success. Restore the connection and retry.
7. Verify the welcome, account, profile, collection, and watchlist screens on an iPad and phone. Run the repository's automated tests as an additional check.

Record the deployed URL, migration identifier, date, and outcomes. This code batch alone is not a claim that these hosted checks have passed. Public launch still requires the remaining product work in `coinxchange/MVP_BLUEPRINT.md`, including an operational privacy/deletion process and moderation before enabling a shared community.

## Client query contract

- Read private data with `select` queries; every result is additionally limited by database RLS.
- Update a profile with `update({ display_name }).eq('id', user.id)`. Profiles are created by the Auth trigger; a client must not insert or upsert them.
- Insert a collection item with `name`, `notes`, optional `reference_id`, and optionally the current user's `owner_id`. Let the database generate `id` and `created_at`; use `.select()` to obtain the inserted row. Only `name`, `notes`, and `reference_id` can be updated.
- Insert a watchlist reference with `reference_id` and optionally the current user's `owner_id`. For repeated saves, `upsert` must use `onConflict: 'owner_id,reference_id', ignoreDuplicates: true`; updates to the watchlist key are intentionally not granted. Remove and add a reference to change it.
- Use member-scoped filters as an additional client safeguard, but never rely on a client-provided owner ID as the authorization decision. Do not broaden grants or policies to work around an error.

Official references checked November 22, 2026. Provider screens and limits can change; follow the linked documentation when configuring a live project.
