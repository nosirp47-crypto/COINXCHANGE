# COINXCHANGE — MVP Blueprint
Prepared for Johnathan L. Hill | November 2026

## Vision
A mobile-first hybrid of (1) everyday coin discovery, (2) social community for collectors, and (3) research-grade coin market intelligence, followed by a verified marketplace. The working brand in this version is COINXCHANGE. The previously selected name Coin Stac’s remains an alternate; choose one only after clearance.

## Product promise
"Before you spend your change, check your change." Make coin collecting approachable without promising that ordinary coins are valuable. Explain the difference between face value, asking price, realized sale, estimate, and exceptional auction records.

## Audience and jobs-to-be-done
- Beginner: identify a coin, learn what to check, ask for help.
- Enthusiast: catalog collection, share finds, join groups, track research.
- Dealer: build reputation, showcase inventory, access seller tools.
- Researcher: inspect comparable verified sales, varieties, grading references.

## Prototype scope (included)
- Responsive dark-and-gold landing page and navigation.
- Photo preview in browser; **no AI inference**.
- Six educational coin reference entries and guided identification clues.
- Local-only social posting and likes.
- Local-only coin vault and research watchlist.
- Search by coin name/type.
- Explicit demo-data labeling and ownership attribution.

The prototype uses localStorage. It is not a real shared network: posts, likes, watchlists, and vault items remain on the same browser/device. Clearing site data may erase them. No login, server, payments, AI identification, or live pricing is included.

## Production MVP (recommended first paid build)
### P0 (launch-critical)
1. Accounts: email/passkey authentication, profiles, account recovery, rate limiting.
2. Database: users, coins, uploads, collections, posts, comments, likes, follows, reports, moderation actions.
3. Photo uploads: secure object storage, file validation, image moderation, EXIF stripping, malware checks.
4. Coin discovery: curated search and assisted identification with uncertainty; always require both sides, date, mintmark, condition and variant checks.
5. Social: feeds, follows, comments, group discussions, reporting/blocking, anti-spam moderation.
6. Market research: permitted/licensed sources, timestamps, realized-sale vs listing separation, provenance, condition/grade filters.
7. Legal/privacy: terms, privacy policy, DMCA/contact process, minors policy, seller rules, data retention and deletion.
8. Analytics: activation, 7-day retention, discovery-to-save, posting rate, false-claim reports.

### P1 (after validation)
- Professional collections with export, valuation notes and alerts.
- Dealer verification, inventory listings, messaging.
- Paid research plans, subscription billing and customer support.
- Trust & safety workflows for fraud and counterfeit claims.

### P2 (regulated operational complexity)
- Payments via established provider, escrow/hold rules as supported, refunds/disputes, shipping/insurance, taxes, KYC/KYB where applicable.
- Marketplace listing verification and certification checks.
- Live auction feeds and partnership integrations with contractual permission.

## Architecture recommendation
- Frontend: Next.js + TypeScript, accessible responsive design.
- Backend: Postgres with row-level access controls; managed auth (e.g., Supabase or equivalent).
- Media: object storage with signed upload URLs and content scanning.
- Search: Postgres full-text initially; dedicated search later.
- AI: optional vision service for suggestions, confidence bands and human-review pathway; do not state a definitive grade/value from a photograph.
- Data ingestion: source-specific licensed adapters, audit logs, source timestamps, deduplication, grade normalization.
- Hosting: managed web hosting with staging and production environments.
- Observability: error tracking, moderation queue, backups and incident response.

## Core data model
User(id, handle, email, role, verification_status)
CoinReference(id, denomination, year, mint, variety, diagnostics, source)
CoinPhoto(id, owner_id, storage_key, side, moderation_status)
CollectionItem(id, owner_id, reference_id, notes, condition_claim, visibility)
Post(id, author_id, body, images, visibility, created_at)
Comment(id, post_id, author_id, body)
Follow(follower_id, followee_id)
MarketObservation(id, coin_reference_id, source, sale_type, amount, currency, sale_date, grade, provenance_url, licensed)
WatchlistItem(user_id, reference_id)
Listing(id, seller_id, coin_reference_id, ask_price, status, authenticity_disclosure)
Report(id, reporter_id, target_type, target_id, reason, status)

## Suggested main pages
/ (overview), /discover, /coins/[id], /feed, /groups, /market, /vault, /profile/[handle], /dealers, /trust, /admin.

## Launch sequence
**Week 1–2:** Validate brand/name/domain, interviews with 15–25 collectors and 5 dealers, landing page, email waitlist, clickable prototype testing.
**Weeks 3–6:** Build accounts, profiles, uploads, reference library, social feed, moderation and analytics.
**Weeks 7–10:** Beta with 100–300 invited users; fix trust, onboarding and retention problems.
**Weeks 11–14:** Introduce permitted market comparisons and premium pilot. Marketplace only after legal and operational readiness.
Timelines are estimates contingent on team, scope, budget, approvals and technical decisions.

## Go/no-go metrics (initial hypotheses, not forecasts)
- At least 40% of new beta users complete one coin discovery session.
- At least 20% of activated beta users return in week 2.
- At least 10% of activated beta users post, comment, or save a coin.
- Track the percentage of coin value claims that need correction; prioritize user trust.

## Revenue experiments
- Free core community and educational lookups.
- Collector Pro: advanced catalog, exports, watchlists, alerts (test willingness to pay).
- Dealer Pro: verified storefront and inventory tools.
- Later: transparent marketplace fee and approved sponsorships.
Pricing and economics must be tested; no guarantee of revenue or valuation.

## Data and legal requirements
- Do not scrape or redistribute proprietary pricing guides or platform data without permission.
- Use official/authorized APIs or negotiated licenses and maintain source attribution.
- Have counsel review brand trademark availability, company structure, contracts, copyright assignments, privacy laws, sales tax, payment rules and marketplace liabilities.
- Have a numismatic advisor review coin-identification claims and disclaimers.
- Do not use "stock exchange" to imply regulated securities trading or guaranteed liquidity.

## Founder intellectual property
Project prepared for Johnathan L. Hill with an intended © 2026 Johnathan L. Hill notice. The notice is not proof of registration, trademark ownership, or an assignment from third-party contributors. See OWNERSHIP_NOTICE.md.

## How to run this package
1. Unzip the package.
2. Open `index.html` in a modern desktop browser. On mobile, local HTML downloads may be restricted; hosting is more reliable.
3. Use navigation tabs. Select a reference coin in Discovery; try publishing a local post, adding a vault coin, and starring a watchlist item.
4. For a public preview, deploy `index.html` to a static host such as Netlify or Cloudflare Pages. Do not present it as a functioning exchange.
5. For a real public product, implement the production MVP above with secure accounts, licensed data, and moderation before onboarding real users.
