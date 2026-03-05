# ARTIZANS Full Functional Platform Plan (Step-by-Step Execution File Plan)

## Progress Tracker
- [x] Step 0: Plan file created in repo root
- [x] Phase 1: Backend foundation and repo structure
- [x] Phase 2: AWS infrastructure extension (CloudFormation)
- [x] Phase 3: Authentication and authorization
- [x] Phase 4: Data model and persistence contracts
- [ ] Phase 5: Public and discovery APIs
- [ ] Phase 6: User workspace APIs
- [ ] Phase 7: Artist workspace APIs
- [ ] Phase 8: Messaging APIs (near realtime polling)
- [ ] Phase 9: Admin and system APIs
- [ ] Phase 10: Stripe and financial flow
- [ ] Phase 11: Frontend integration (replace localStorage domain state)
- [ ] Phase 12: Security hardening and compliance baseline
- [ ] Phase 13: CI/CD and deployment pipeline
- [ ] Phase 14: QA, UAT, and cutover

## Summary
Build a complete production backend and integrate it across **all existing routes** (public, user, artist, admin, reports, system), replacing browser-localStorage business state with AWS server-side APIs.

Locked decisions used in this plan:
- Feature coverage: **all existing routes now**
- Payments: **Stripe integrated**
- Updates: **near realtime polling**
- Infra style: **CloudFormation + Serverless**
- Data start: **fresh backend data** (no migration of old local browser data)

This plan is decision-complete and designed to execute step-by-step from a single plan file.

## Step 0: Plan File Creation (first implementation task)
1. Create root file `IMPLEMENTATION_PLAN.md`.
2. Paste this full plan into that file.
3. Add a checkbox list for each phase so we can execute one phase at a time with commits.

## Phase 1: Backend Foundation and Repo Structure
1. Add backend workspace `backend/` using Node.js + TypeScript.
2. Add folders: `backend/src/handlers`, `backend/src/domain`, `backend/src/repos`, `backend/src/middleware`, `backend/src/lib`, `backend/tests`.
3. Add `backend/package.json`, `tsconfig.json`, and scripts for `build`, `test`, `lint`.
4. Add shared API response contract: `{ ok: boolean, data?: any, error?: { code: string, message: string } }`.
5. Add environment contract file for API runtime config (table names, Stripe keys, Cognito issuer/client ids).

## Phase 2: AWS Infrastructure Extension (CloudFormation)
1. Extend `aws/cloudformation/artizans-aws-stack.yaml` with:
- API Gateway HTTP API
- Lambda functions by domain area
- DynamoDB tables
- SQS queue for async jobs (notifications/webhook retries)
- CloudWatch log groups + alarms
- Secrets Manager params for Stripe and app secrets
2. Add API custom domain option under current domain strategy.
3. Keep existing S3 + CloudFront static deployment unchanged.
4. Add outputs for API URL, table names, function names.

## Phase 3: Authentication and Authorization
1. Use Cognito JWT authorizer on API Gateway.
2. Add middleware to extract identity (`sub`, `email`) from JWT.
3. Add role model in backend (`user`, `artist`, `admin`) with role assignment table.
4. Enforce route-level auth and ownership checks server-side.
5. Remove trust in client session role for privileged operations.

## Phase 4: Data Model and Persistence Contracts
1. Create DynamoDB tables:
- `Users`
- `Artists`
- `Services`
- `Bookings`
- `Messages`
- `Notifications`
- `Reports`
- `Categories`
- `Invoices`
- `Payouts`
- `SystemConfig`
2. Standardize each record fields:
- `id`, `createdAt`, `updatedAt`, `createdBy`, `version`
3. Keep booking status enum:
- `requested`, `accepted`, `declined`, `confirmed`, `payment_pending`, `paid`, `completed`, `cancelled`
4. Add GSIs for core queries:
- bookings by user
- bookings by artist
- messages by thread
- notifications by owner/read state
- artists by category/location/rating/popularity
- reports by status/type

## Phase 5: Public and Discovery APIs
1. Implement endpoints:
- `GET /v1/categories`
- `GET /v1/artists` (search, filter, sort, pagination)
- `GET /v1/artists/{id}` (profile + services + reviews summary + availability)
2. Add server-side validation and pagination contracts.
3. Add response caching headers for public reads.

## Phase 6: User Workspace APIs
1. Implement endpoints:
- `GET /v1/me`
- `PATCH /v1/me/profile`
- `GET /v1/me/saved-artists`
- `POST /v1/me/saved-artists/{artistId}`
- `DELETE /v1/me/saved-artists/{artistId}`
- `GET /v1/me/bookings`
- `POST /v1/bookings`
- `POST /v1/bookings/{id}/status`
- `GET /v1/me/notifications`
- `POST /v1/me/notifications/read-all`
2. Enforce booking state transitions server-side only.
3. Emit notifications from booking events.

## Phase 7: Artist Workspace APIs
1. Implement endpoints:
- `GET /v1/artist/me`
- `PATCH /v1/artist/me/profile`
- `PUT /v1/artist/me/onboarding`
- `POST /v1/artist/me/services`
- `PATCH /v1/artist/me/services/{id}`
- `DELETE /v1/artist/me/services/{id}`
- `GET /v1/artist/me/bookings`
- `POST /v1/artist/me/bookings/{id}/accept`
- `POST /v1/artist/me/bookings/{id}/decline`
- `GET /v1/artist/me/earnings`
- `GET /v1/artist/me/analytics`
2. Compute analytics on read from persisted booking/message metrics.
3. Keep earnings derived from paid/completed records.

## Phase 8: Messaging APIs (Near Realtime Polling)
1. Implement thread/message endpoints:
- `GET /v1/threads`
- `GET /v1/threads/{id}/messages?cursor=...`
- `POST /v1/threads/{id}/messages`
2. Implement polling endpoints:
- `GET /v1/me/updates?since=timestamp`
- Return unread counts + booking deltas + latest message snippet.
3. Add anti-spam limits and payload size limits.

## Phase 9: Admin and System APIs (all existing admin routes)
1. Implement admin endpoints:
- `GET /v1/admin/artists/review`
- `POST /v1/admin/artists/{id}/verify`
- `POST /v1/admin/artists/{id}/reject`
- `GET /v1/admin/reports`
- `POST /v1/admin/reports/{id}/status`
- `GET /v1/admin/platform/users`
- `PATCH /v1/admin/platform/categories/{id}`
- `GET /v1/admin/system`
- `PATCH /v1/admin/system/maintenance`
- `GET /v1/admin/system/errors`
2. Enforce admin-only policy in middleware.
3. Persist maintenance mode in `SystemConfig` and expose read endpoint for frontend banner.

## Phase 10: Stripe and Financial Flow
1. Implement Stripe backend integration:
- `POST /v1/payments/checkout-session` (or PaymentIntent flow)
- `POST /v1/webhooks/stripe`
2. On payment success:
- booking status -> `paid`
- create invoice
- update payout ledger
- create notifications for both parties
3. Add webhook signature verification and idempotency handling.
4. Add failure and refund handling pathways.

## Phase 11: Frontend Integration (replace localStorage domain state)
1. Keep UI routes/pages; replace `js/store.js` domain writes with API client calls.
2. Add `js/api-client.js` with auth token attachment and retry policy.
3. Update page modules:
- `explore`, `artist-preview`, `account-settings`
- all `user/*`
- all `artist/*`
- all `admin/*`
4. Keep localStorage only for low-risk UI prefs (non-authoritative), not platform data.
5. Maintain existing Cognito sign-in UX, but all business actions move to API.

## Phase 12: Security Hardening and Compliance Baseline
1. Add request validation (schema-based) for every mutating endpoint.
2. Add CSRF strategy where cookie-based flows are used; keep bearer-token flows strict.
3. Add WAF rules for API rate limiting and abuse patterns.
4. Add audit logging for admin actions and booking/payment state changes.
5. Add secrets rotation process for Stripe/webhook secrets.

## Phase 13: CI/CD and Deployment Pipeline
1. Add backend workflow:
- build
- unit/integration tests
- deploy CloudFormation updates
- deploy Lambda artifacts
2. Keep current static deploy workflow for frontend.
3. Add environment strategy:
- `dev` stack and `prod` stack
- protected deploy to prod from `main`
4. Add rollback playbook (stack change set + previous Lambda versions).

## Phase 14: QA, UAT, and Cutover
1. Validate complete end-to-end flows:
- signup/login
- browse/search/filter artists
- save artist
- book artist
- artist accept/decline
- payment success
- messaging updates via polling
- admin moderation/report actions
2. Remove/disable legacy localStorage data paths after parity verified.
3. Launch checklist:
- DNS/API health
- CloudWatch alarms green
- Stripe webhook receiving
- monitoring dashboards active

## Public APIs / Interfaces Added
1. New API namespace: `/v1/*` for all business operations.
2. Auth contract: Cognito JWT required for protected routes.
3. Error contract: structured `error.code` and `error.message`.
4. Pagination contract: `limit`, `cursor`, `nextCursor`.
5. Idempotency contract: payment and webhook operations require idempotency keys/events.

## Test Cases and Scenarios
1. Auth:
- valid token access
- invalid/expired token denied
- role-restricted endpoint access denied/allowed correctly
2. Booking lifecycle:
- valid transitions succeed
- invalid transitions rejected with explicit code
3. Messaging:
- message appears in both participants' thread views
- polling endpoint returns deltas since timestamp
4. Payments:
- checkout creation success
- webhook duplicate events do not duplicate invoice/payout updates
5. Admin:
- verify/reject artist updates public verified state
- report status transitions persist
- maintenance mode blocks mutating non-admin actions
6. Reliability:
- retry-safe handlers
- API throttling behavior under burst traffic

## Acceptance Criteria
1. Every existing page route reads/writes real backend data.
2. No business-critical state is stored authoritatively in localStorage.
3. End-to-end booking + payment + messaging + moderation demo succeeds on prod stack.
4. Monitoring, alarms, and rollback path are present before production cutover.

## Assumptions and Defaults Chosen
1. Runtime: Node.js + TypeScript on AWS Lambda.
2. Infra remains CloudFormation-centric (no CDK/Terraform migration now).
3. Stripe is the payment processor for first functional release.
4. Near realtime means polling-based updates first, not WebSockets.
5. Existing static frontend hosting (S3 + CloudFront) remains in place.
6. Existing local browser data is not migrated; fresh backend data starts at cutover.
