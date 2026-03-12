# Feature Fix List

Prioritized list of product and platform fixes still worth doing.

## P0: Core Product Reliability

- [ ] Make account setup and settings fully server-authoritative with no client-side fallback behavior.
- [ ] Ensure every account/profile save path preserves typed values if the API fails.
- [ ] Add explicit error states anywhere `/v1/*` returns invalid JSON, HTML, or times out.
- [ ] Finish cross-browser verification for:
  - profile edits
  - profile visibility
  - saved artists
  - bookings
  - messages
  - notifications
- [ ] Add a clear empty-state strategy for new/low-data production environments so the site never feels broken when there are few live artists.

## P0: Profile Publishing and Discovery

- [ ] Make public artist profiles fully reflect saved account + artist settings on every refresh.
- [ ] Add a proper public profile completeness model so incomplete drafts do not look broken when published.
- [ ] Ensure Explore always shows all live profiles by default with no accidental hidden filters.
- [ ] Add server-side validation for required publishable profile fields before allowing `Show profile`.
- [ ] Add a clear review/publish state model that is user-friendly and not internally worded.

## P0: Account Settings Flow

- [ ] Replace the current signed-in wall of settings with the guided step-by-step account setup flow.
- [ ] Persist setup progress server-side and resume from the correct step after refresh/sign-in.
- [ ] Split post-setup settings into focused sections instead of rendering everything at once.
- [ ] Make artist profile setup optional but cleanly reachable later from settings.
- [ ] Add stronger validation and success/error feedback for every settings section.

## P1: Booking and Messaging

- [ ] Tighten booking UX so users always understand what happens after submitting a request.
- [ ] Improve booking failure errors so they explain the exact issue instead of generic failure copy.
- [ ] Add a cleaner booking history view for both user and artist sides.
- [ ] Improve message thread UX so it is easier to see context, latest activity, and unread state.
- [ ] Add polling/refresh behavior that feels live without requiring manual refreshes everywhere.

## P1: Public Marketplace UX

- [ ] Add real portfolio imagery/media handling instead of placeholder-heavy profile presentation.
- [ ] Improve homepage featured-profile logic so strong live profiles are surfaced more consistently.
- [ ] Add stronger trust signals:
  - testimonials
  - review summaries
  - verification explanation
  - booking confidence cues
- [ ] Improve Explore filtering and sorting UX for real browsing at scale.
- [ ] Make artist cards more useful for quick comparison on mobile and desktop.

## P1: Auth and Security UX

- [ ] Add abuse controls for sign-in and password reset:
  - rate limiting
  - CAPTCHA or equivalent challenge
  - generic auth recovery responses
- [ ] Stop storing sensitive auth/session data in browser-accessible storage if possible.
- [ ] Add clearer password requirements in sign-up and reset flows.
- [ ] Add session expiry/re-auth messaging that is clear instead of abrupt.
- [ ] Audit all public-facing copy so no internal AWS/Cognito wording leaks into the UI.

## P1: Legal and Trust

- [ ] Replace the current legal stub with real:
  - privacy policy
  - terms of service
  - acceptable use / trust and safety policy
  - refund / dispute policy if needed later
- [ ] Expand FAQ into a real launch-ready help page.
- [ ] Improve contact flow with required fields, validation, response confirmation, and expected reply time.
- [ ] Add a better footer with trust/legal/help navigation.

## P2: Frontend Polish

- [ ] Continue cleaning public placeholder/default values from profiles and cards.
- [ ] Improve mobile navigation and responsive behavior across all public/account pages.
- [ ] Add loading/skeleton states where content fetches are visible to users.
- [ ] Improve blog/about/contact pages so they do not feel like low-detail stubs.
- [ ] Add better empty/error states for bookings, messages, saved artists, and notifications.

## P2: Accessibility

- [ ] Run a focused WCAG pass on forms, nav, and profile pages.
- [ ] Add/verify ARIA semantics for tabs, toggles, and interactive collections.
- [ ] Improve focus management for auth/setup/state transitions.
- [ ] Review heading order and landmark usage across pages.
- [ ] Add alt text strategy for uploaded portfolio media once media handling is implemented.

## P2: Infrastructure and Deployment

- [ ] Update GitHub Actions to newer action/runtime versions before Node 20 deprecation becomes a hard failure.
- [ ] Keep backend/static deploy smoke checks strict enough to catch stale or misrouted releases.
- [ ] Add direct live smoke coverage for the most important user flows after deploy.
- [ ] Continue cleaning certificate/domain/canonical host configuration drift.
- [ ] Document a production rollback checklist that covers both backend and static deploys.

## Immediate Next Best Sequence

1. Guided account setup flow
2. Publishable profile completeness + stricter `Show profile` validation
3. Booking/messages UX cleanup
4. Legal/FAQ/contact production content
5. Auth abuse controls and token-storage hardening
