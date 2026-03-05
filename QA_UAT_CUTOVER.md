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
1. `AUTH_BEARER_TOKEN` for signed-in user endpoint checks.
2. `ADMIN_BEARER_TOKEN` for admin endpoint checks.

## Manual UAT Checklist
1. Sign up and verify email from `/account-settings.html`.
2. Log in and confirm session banner updates correctly.
3. Browse artists in `/explore.html` with search/filter/sort.
4. Save an artist and confirm it appears in `/user/discovery.html`.
5. Create a booking from `/artist-preview.html`.
6. Accept/decline the booking from `/artist/bookings.html`.
7. Move booking through payment/completion path.
8. Confirm messaging appears on both sides (`/user/interaction.html` and `/artist/communication.html`).
9. Confirm notifications and booking history update in `/user/notifications.html` and `/user/history.html`.
10. Confirm moderation/report flows on admin routes.
11. Refresh browser and confirm state consistency from backend APIs.

## Launch Checklist
1. CloudFormation stack status is `UPDATE_COMPLETE` for target environment.
2. Backend workflow `Deploy AWS Backend` is green for latest commit.
3. Frontend workflow `Deploy AWS Static Site` is green for latest commit.
4. `ApiBaseUrl` and custom domain respond with expected TLS cert and `200` on `/v1/categories`.
5. CloudWatch alarms are green (API 5xx, Lambda errors, queue depth).
6. Stripe webhook endpoint configured and receiving signed events.
7. WAF Web ACLs are attached and metrics are emitting.
8. Rollback steps are ready: `aws/ROLLBACK_PLAYBOOK.md`.

## Cutover Notes
- This repo now treats backend API as source of truth for business state.
- Local storage remains only for low-risk UI/session preferences.
