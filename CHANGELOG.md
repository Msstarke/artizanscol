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
