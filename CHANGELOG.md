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
