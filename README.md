# ARTIZANS.COLLECTIVE Catalog

This catalog is the primary index for the repository.

## Product
- Multi-page web app for artist discovery, hiring, and booking flows.
- Stack: static frontend (HTML/CSS/JavaScript) + backend workspace (Node.js/TypeScript).
- Auth: Cognito-based browser auth flows.

## Top-Level Structure
- `index.html`, `explore.html`, `artist-preview.html`, `account-settings.html`: main public/app entry pages.
- `artist/`: artist workspace pages.
- `user/`: client workspace pages.
- `admin/`: admin/support pages.
- `js/`: app logic modules.
- `backend/`: backend API workspace and tests (TypeScript).
- `styles/`: shared and page-level styles.
- `aws/`: CloudFormation and deploy scripts for AWS hosting.
- `.github/workflows/`: CI/CD workflows.
- `.well-known/`: security metadata.

## Core Runtime Modules
- `js/auth.js`: account access flows and account settings logic.
- `js/cognito-auth.js`: Cognito API calls and token session handling.
- `js/session.js`: browser session model.
- `js/store.js`: local data state and domain operations.
- `js/shared-nav.js`: header/nav/session UI wiring across pages.

## Deployment
- Auto deploy pipeline: `.github/workflows/deploy-aws-static-site.yml`
- Infrastructure template: `aws/cloudformation/artizans-aws-stack.yaml`
- CloudShell deploy script: `aws/scripts/cloudshell-deploy.sh`
- Stack now includes serverless backend scaffolding (HTTP API, Lambda domain functions, DynamoDB tables, SQS, Secrets Manager, CloudWatch alarms).

## Backend Foundation
- API response contract: `backend/src/domain/api-response.ts`
- Runtime environment contract: `backend/src/lib/env.ts`
- Starter Lambda handler: `backend/src/handlers/health.ts`
- Execution roadmap: `IMPLEMENTATION_PLAN.md`

## Repo Rules
- Operational workflow rules: `REPO_RULES.md`
- Human-readable change history: `CHANGELOG.md`
