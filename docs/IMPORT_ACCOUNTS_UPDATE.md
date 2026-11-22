# Import the Phase 3 account update

This update is supplied as `COINXCHANGE-phase3-accounts.bundle`, a Git package containing the existing project history and the prepared account changes. It targets the existing `phase3/accounts-db` branch. The changes were prepared from commit `18836677c46afc92166495a9294a9df7c62678b8`.

## Import in the existing Codespace

1. Save the bundle to your device, then upload it into the COINXCHANGE repository folder in Codespaces, alongside `package.json`.
2. Open a terminal in that folder. If you have made other edits since the screenshots, save and commit those edits before importing.
3. Run this block:

```sh
git switch phase3/accounts-db &&
git fetch ./COINXCHANGE-phase3-accounts.bundle refs/heads/phase3/accounts-db &&
git merge --ff-only FETCH_HEAD &&
git push origin phase3/accounts-db
```

Each command runs only if the previous one succeeds. The merge requires a fast-forward: it will stop if the branch has diverged or tracked edits would be overwritten. If any command fails, keep the terminal output and resolve that specific problem before continuing. Do not use force-push, hard reset, or replace the project folder to make the update import.

The upload file is ignored by Git. The import uses the prepared commit; no `git add` or new commit is needed. These commands update the development branch only. They do not merge to `main` or publish the website.

## Check the imported work

After a successful push, open the repository's **Actions** tab and look for **Verify accounts and existing website**. That workflow checks the browser bundle, database rules, and the existing and new browser tests. A green result must be observed before treating those checks as passed.

To run the same checks in the Codespace with Node.js 24:

```sh
npm ci &&
npm run build:accounts &&
npm run test:database &&
npx playwright install --with-deps chromium webkit &&
npm test
```

## What is ready and what remains

The update includes configurable email/password accounts, confirmation handling, password recovery, profiles, private collections, private watchlists, and owner-only database rules. The existing design and device-local guest records are preserved. Shared social features, passkeys, payments, and image storage are outside this update.

The database migration and ownership checks passed locally in an isolated Postgres-compatible PGlite engine with Auth fixtures. Browser test discovery and JavaScript syntax checks passed. Browser execution was blocked before any page opened in the preparation environment, so no browser application assertions have been reported as passed. The included suite contains 105 cases across three browser projects, including 33 new account cases.

The account configuration is deliberately blank. No Supabase project was provisioned, no cloud migration was applied, and no live email or account flow was verified during preparation. Follow [ACCOUNTS_SETUP.md](ACCOUNTS_SETUP.md) to connect the managed backend and complete the hosted acceptance checks. Until configuration is supplied, the website retains its existing guest/demo behavior.
