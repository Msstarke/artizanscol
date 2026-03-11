# Repository Rules

These rules are mandatory for all future changes in this repo.

1. Every code or content change must end with a Git commit.
2. Every commit must be pushed to `origin` immediately after it is created.
3. Keep commits scoped to one task or fix; do not bundle unrelated changes.
4. Use clear commit messages in the format: `type: short summary`.
5. Update `CHANGELOG.md` for user-visible behavior, UI, or deployment changes.
6. Run relevant checks (at minimum syntax/lint for touched files) before commit.
7. Never commit secrets, keys, or credentials.
8. Do not force-push `main`; use normal push only.
9. If a hotfix skips checks, add a follow-up commit that runs and documents checks.
10. After push, confirm `git status` is clean and `git log -1` matches the task.
11. After every push, check the relevant GitHub Actions deploy/test workflow for that commit; if it fails, inspect the failing step, fix the cause, commit the fix, and push again before considering the task complete.

## Standard Change Flow

1. Make changes.
2. Run checks.
3. `git add -A`
4. `git commit -m "type: summary"`
5. `git push origin main`
6. Check the workflow status for the pushed commit in GitHub Actions.
7. If the deploy/test workflow failed, review the failing job/step, fix it, commit, and push again.
