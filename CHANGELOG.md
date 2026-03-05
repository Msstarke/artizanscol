# Changelog

All notable project changes are tracked via Git commits and summarized here.

## 2026-03-04
- Initialized Git repository.
- Added `.gitignore` for local state, secrets, and generated artifacts.
- Added this changelog to keep a human-readable change history.
- Baseline committed as `chore: initialize repository and tracking`.
- Reworked `/account-settings.html` to remove the account picker UI and use workspace settings actions instead.
- Added `REPO_RULES.md` with mandatory commit-and-push workflow rules for all future changes.
- Updated all site brand labels from `Artizans.com` / `Artizans.CO` to `ARTIZANS.COLLECTIVE`.
- Redesigned `/account-settings.html` for production UX with clearer sign-in flow, session metadata, dashboard access cards, and profile summaries.
- Simplified `/account-settings.html` to a login-first flow with inline sign-up, verification, forgot-password, continue routing, and hidden dashboard switching.
- Improved global responsive behavior across shared styles so layouts/forms/tables/media scale more cleanly under browser zoom.
- Removed role selection from account access and updated guards/actions so any signed-in account can both submit jobs and hire without role switching.
- Hardened security baseline: fixed auth open-redirect validation, moved Cognito tokens to sessionStorage, escaped artist preview HTML injections, strengthened booking/contact validation, added security headers + rate limiting to CloudFront/WAF template, added 404 page, robots/sitemap, favicon, and `.well-known/security.txt`.
- Updated artist preview booking CTA so logged-in users see direct booking action, while signed-out users are prompted to sign in.
- Made Explore page booking CTA auth-aware so signed-in users get a direct artist booking link and signed-out users see a sign-in prompt.
- Improved zoom/overflow behavior for account and header UI by truncating long session chips, allowing account metadata wrapping, and removing extra bottom section spacing.
- Stabilized account-settings layout to prevent post-load flicker into extra footer-bar space by using consistent card height and tighter account-page spacing.

## 2026-03-05
- Expanded `/account-settings.html` into a fuller account center with editable profile details, notification preferences, live workspace stats, password-reset shortcut, account data export, saved-artists cleanup, and matching `auth.js` logic/persistence updates.
- Added root `CATALOG.md` and mirrored it in root `README.md` so GitHub repo landing README displays the catalog content.
- Upgraded `/index.html` to production-ready metadata/canonical/social tags, removed dev-facing landing copy, and improved shared nav behavior so logout buttons only render when signed in.
- Added `IMPLEMENTATION_PLAN.md` with phase-by-phase backend execution checklist and implemented Phase 1 backend scaffolding in `backend/` (Node.js/TypeScript workspace, contracts, env loader, starter handler, and tests).
- Implemented Phase 2 CloudFormation backend infrastructure scaffold: serverless API parameters/conditions, API Gateway HTTP API routes/integrations, domain-area Lambda stubs, DynamoDB tables with GSIs, SQS queue + DLQ, Secrets Manager secrets, CloudWatch log groups/alarms, API custom domain resources, and expanded stack outputs.
- Implemented Phase 3 authentication/authorization scaffold: Cognito JWT authorizer on protected API routes, backend identity extraction middleware, role-assignment repository contract, role/ownership guard utilities, and unit tests for auth/authorization behavior.
- Implemented Phase 4 data/persistence contracts: canonical persisted-record metadata helpers, booking status enum + transition map, typed entity models for all backend tables, index key helpers, repository interface contracts aligned to GSIs, and supporting unit tests.
- Implemented Phase 5 public/discovery API scaffold in backend code: `/v1/categories`, `/v1/artists`, `/v1/artists/{artistId}` route handler with server-side query validation, pagination cursor contract, and cache-control headers for public reads.
- Implemented Phase 6 user workspace API scaffold in backend code: `/v1/me`, profile updates, saved-artist add/remove/list endpoints, booking create/list/status transition endpoints with server-side lifecycle enforcement, user notification list/read-all endpoints, plus notification emission and unit tests.
- Implemented Phase 7 artist workspace API scaffold in backend code: `/v1/artist/me` profile/onboarding routes, artist service CRUD, artist booking queue with accept/decline state transitions, derived earnings/analytics endpoints, artist workspace repository contract, and unit tests.
- Implemented Phase 8 messaging/polling API scaffold in backend code: `/v1/threads`, `/v1/threads/{threadId}/messages`, and `/v1/me/updates` with participant access checks, cursor pagination, anti-spam rate limits, payload-size validation, update-delta responses, repository contract, and unit tests.
