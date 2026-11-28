# COINXCHANGE staging email and recovery setup

Prepared November 27, 2026 (America/Los_Angeles). Cloudflare is the selected
provider. These are the exact settings to apply after access to the existing
account is restored; this document does not claim they are already configured.
It authorizes no purchase or production change.

## Why the website deployment alone cannot fix recovery

Supabase's default email service currently sends only to addresses belonging to
the project's organization team and is limited to two messages per hour. It is
intended for initial testing. Public member signup and recovery require a
configured mail sender. See [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

The separate `COINXCHANGE-staging` project's reference is
`uyccxknjcugtvgoiukoh`. The staging build's public-settings probe confirmed that
email authentication and email confirmation are enabled. That probe does not
expose SMTP credentials, prove the templates are installed, or test delivery.
The currently deployed visual preview still has blank backend configuration.

## 1. Inspect the existing Cloudflare account

Open the existing Cloudflare account's **Compute → Email Service → Email
Sending** area. Identify the sender domain already onboarded for this project;
do not infer a domain or sender address from a project label. Verify the account
owns that domain and its sending DNS records are healthy. Cloudflare Email
Service requires Cloudflare DNS; its onboarding prepares SPF, DKIM and related
records. Review existing records before approving changes. See
[Cloudflare Email Sending setup](https://developers.cloudflare.com/email-service/get-started/send-emails/).

Record the actual Workers plan. On the Workers Free plan, sending is limited to
verified destination addresses. That can support a verified test recipient but
does not establish unrestricted public member email. Inspect the existing
entitlement and price before proposing any paid change; no purchase has been
authorized. The same [setup guide](https://developers.cloudflare.com/email-service/get-started/send-emails/)
documents the recipient restriction.

## 2. Configure the separate staging project's SMTP sender

Use the following settings in the staging project's Supabase custom SMTP
configuration. Obtain a token scoped to the correct Cloudflare account and
**Email Sending: Edit**. Put it only in the SMTP password field or an approved
server-side secret store; it is unrelated to the public Supabase browser key.

| Supabase SMTP setting | Value |
| --- | --- |
| Sender display name | `COINXCHANGE` |
| Sender email | The actual approved address on the verified sending domain; still to be inspected |
| Host | `smtp.mx.cloudflare.net` |
| Port | `465` |
| Connection | Implicit TLS |
| Username | `api_token` — this literal string |
| Password | The scoped Cloudflare API token with Email Sending: Edit |

These connection values and permission requirements come from
[Cloudflare's SMTP documentation](https://developers.cloudflare.com/email-service/examples/email-sending/smtp/).
The domain must be onboarded on the account that owns the token. Never place
the SMTP token in GitHub, `account-config.js`, a Pages build artifact, a URL, or
a browser console. Test with an authorized recipient before treating the
configuration as working.

## 3. Set the staging Auth return URLs

Use the staging project only. Preserve the production project's current URL
configuration.

| Setting | Exact staging value |
| --- | --- |
| Site URL | `https://coinxchange-staging.pages.dev/` |
| Allowed signup return URL | `https://coinxchange-staging.pages.dev/` |
| Allowed recovery return URL | `https://coinxchange-staging.pages.dev/?account=recovery` |

The app derives signup and recovery URLs from the page it is running on. If an
approved test uses a specific Cloudflare branch-preview URL, add that exact
origin and recovery URL too. A historical deployment URL is not permission to
allow every Pages domain. Supabase's Site URL supplies a fallback, while its
redirect allowlist controls requested return destinations. See
[Supabase redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).

## 4. Install the prepared email templates

The templates are versioned with the app:

- **Confirm sign up:** `supabase/templates/confirmation.html`
- **Reset password:** `supabase/templates/recovery.html`

Paste each into its corresponding staging Auth email template, not into the
website HTML. Both must retain `{{ .Token }}` so the recipient can enter the
email code on another device. The app verifies the submitted code with
Supabase. An ordinary homepage link is not a verification code and cannot
authorize a password change.

Keep any `{{ .ConfirmationURL }}` fallback supplied by the reviewed template;
it is the provider-generated verification link, not a hardcoded old GitHub
homepage. Confirm the configured OTP length and expiry match the app's
supported input. See [Supabase email template variables](https://supabase.com/docs/guides/auth/auth-email-templates).

## 5. Record actual hosted acceptance results

After the account-enabled staging artifact is approved and deployed, use an
authorized staging test account and record results without recording passwords
or one-time codes:

1. Request signup confirmation, receive the actual email, and enter its code in
   a second clean browser. Confirm a session is established only after provider
   verification succeeds.
2. Request recovery in browser A, receive the actual reset email, and enter its
   code with the same email address in browser B. Change the password and verify
   a fresh sign-in with the new password.
3. Check invalid, expired and already used codes are rejected. Check an
   unrelated signed-in session cannot turn a failed callback into a password
   reset authorization.
4. Save a coin photograph, reload, and sign in on another device. Confirm the
   image is available to that member and inaccessible to a different member.
5. Record the exact deployed commit and the Supabase project, plus email
   delivery and test timestamps. Keep screenshots and logs free of secrets.

The automated suite and build checks are useful evidence, but they do not send
email or establish these hosted results. Account access, sender identity, plan
entitlement, and delivery must be observed before those steps can be marked
complete.
