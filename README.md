# COINXCHANGE

Coin discovery and collecting prototype prepared for Johnathan L. Hill. The current development branch adds configurable member accounts and private collections to the existing Founder Edition design.

## Open the current website

Serve the repository and visit `/coinxchange/`, or publish the `coinxchange` directory to a static host. The repository-root `index.html` is the earlier local demonstration.

## Accounts and private data

The account integration is disabled until `coinxchange/account-config.js` contains a valid HTTPS Supabase project URL and a public publishable/anon key. Never put a service-role key, secret key, database password, or personal access token in browser files.

See [the account setup guide](docs/ACCOUNTS_SETUP.md) for the migration, email configuration, redirect URLs, and activation checks. The new tables have owner-only database policies. Signup/sign-in, confirmation, password recovery, profile editing, vault editing, and watchlists use the managed backend once configured. Guest records are preserved separately. Shared social posts, passkeys, image storage, trading, and payments are not included in this batch.

## Verify changes

Use Node.js 24:

```sh
npm ci
npm run build:accounts
npm run test:database
npx playwright install --with-deps chromium webkit
npm test
```

The browser SDK is pinned and served from `coinxchange/vendor/`; the published site does not need an npm build or a runtime CDN. Rebuild the vendor bundle when its locked dependency changes.

The database tests execute real Postgres SQL in an isolated PGlite engine with Supabase-shaped Auth fixtures. Browser tests exercise the real SDK against controlled HTTP responses and preserve the existing guest regressions. Neither replaces the hosted email/Auth/Data API checks described in the setup guide.

GitHub Actions runs these checks on pushes to `phase3/accounts-db`. The workflow performs testing only and has read-only repository permissions.

© 2026 Johnathan L. Hill. See [the ownership notice](coinxchange/OWNERSHIP_NOTICE.md).
