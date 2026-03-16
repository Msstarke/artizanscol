# Phase 14 QA, UAT, and Cutover

## Automated Verification
- Command: `./scripts/phase14-qa-cutover-checks.sh`
- What it validates:
1. Required page routes exist on disk.
2. Legacy `artizans.db.v1` runtime business-state key is removed from `js/`.
3. Backend `lint` and `test` pass.

## API Smoke Verification
- Command: `./aws/scripts/api-smoke.sh <api-base-url>`
- Optional env vars:
1. `AUTH_BEARER_TOKEN` for signed-in core marketplace checks.

## Manual UAT Checklist
1. Sign up and verify email from `/account-settings.html`.
2. Log in and confirm session banner updates correctly.
3. Browse artists in `/explore.html` with search/filter/sort.
4. Save an artist and confirm it remains saved after refresh.
5. Create a booking from `/artist-preview.html`.
6. Accept/decline the booking from the account workspace flow.
7. Confirm messaging appears on both sides in `/account-settings.html`.
8. Confirm notifications update and can be marked read in `/account-settings.html`.
9. Refresh browser and confirm state consistency from backend APIs.
10. Open a second browser/device and confirm saved state matches.
11. Confirm empty states remain honest when there are no artists/bookings/messages.

## Launch Checklist
1. CloudFormation stack status is `UPDATE_COMPLETE` for target environment.
2. Backend workflow `Deploy AWS Backend` is green for latest commit.
3. Frontend workflow `Deploy AWS Static Site` is green for latest commit.
4. Public domain responds with JSON API envelopes on `/v1/categories`, `/v1/artists`, and auth error JSON on `/v1/me`.
5. CloudWatch alarms are green for API 5xx and Lambda errors.
6. Core categories are seeded via `aws/scripts/seed-core-categories.sh`.
7. At least one real artist profile has been created and published through the live account flow.
8. Rollback steps are ready: `aws/ROLLBACK_PLAYBOOK.md`.

## Cutover Notes
- This repo now treats backend API as source of truth for business state.
- Local storage remains only for low-risk UI/session/auth state in this phase.
- Payments, invoices, payouts, and admin tooling are not part of the first workable marketplace cutover.
