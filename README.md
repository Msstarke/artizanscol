# ARTIZANS.COLLECTIVE

This repository uses the changelog as the main running record of product, backend, and deploy changes.

- Main update log: [CHANGELOG.md](./CHANGELOG.md)
- Repo catalog: [CATALOG.md](./CATALOG.md)
- Feature backlog: [FEATURE_FIX_LIST.md](./FEATURE_FIX_LIST.md)
- Implementation roadmap: [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)
- QA and cutover checklist: [QA_UAT_CUTOVER.md](./QA_UAT_CUTOVER.md)
- Repo workflow rules: [REPO_RULES.md](./REPO_RULES.md)

## Latest Changes

Current focus is profile publishing and account/settings reliability:

- Artist profiles now use an explicit `draft` / `ready` / `live` publish model.
- Incomplete profiles save as drafts and cannot accidentally publish.
- Public discovery only shows live profiles.
- Completed accounts now skip the setup flash on refresh and go straight to settings.

For the full history, read [CHANGELOG.md](./CHANGELOG.md).
