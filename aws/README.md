# Artizans AWS Integration Pack

This folder makes your current multi-page prototype AWS-ready.

## Services covered
- EC2
- Billing and Cost Management
- AWS Health Dashboard
- Certificate Manager (ACM)
- CloudFront
- AWS Private Certificate Authority (ACM PCA)
- Cognito
- WAF & Shield (Shield Standard applies automatically on CloudFront)
- CloudShell
- S3
- IAM
- Support

## What this adds
1. CloudFormation starter stack:
- `aws/cloudformation/artizans-aws-stack.yaml`
- Includes S3, CloudFront, WAF, Cognito, IAM roles, optional EC2 API host, optional private CA.
- Includes serverless backend scaffold: API Gateway HTTP API, domain Lambda stubs, DynamoDB tables, SQS + DLQ, Secrets Manager, CloudWatch log groups and alarms.
- Includes API JWT auth scaffold: Cognito-backed API Gateway JWT authorizer attached to protected `/v1/*` routes.

2. CloudShell deployment script:
- `aws/scripts/cloudshell-deploy.sh`
- Syncs site to S3 and invalidates CloudFront cache.

3. API smoke script:
- `aws/scripts/api-smoke.sh`
- Runs public + optional authenticated endpoint health checks.

4. In-app AWS admin page:
- Route: `/admin/aws.html`
- Lets you store AWS IDs/ARNs in localStorage and open one-click console links.

5. Secret rotation runbook:
- `aws/STRIPE_SECRETS_ROTATION.md`
- Covers Stripe/API secret rotation, validation, and rollback steps.

6. Backend rollback playbook:
- `aws/ROLLBACK_PLAYBOOK.md`
- Covers CloudFormation change set rollback and Lambda version rollback.

## Quick start (CloudShell)
1. Upload this repo to CloudShell.
2. Deploy infrastructure (example):

```bash
aws cloudformation deploy \
  --stack-name artizans-stack \
  --template-file aws/cloudformation/artizans-aws-stack.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides ProjectName=artizans EnvironmentName=prod
```

3. After stack create/update, fetch outputs:

```bash
aws cloudformation describe-stacks \
  --stack-name artizans-stack \
  --query "Stacks[0].Outputs" \
  --output table
```

4. Deploy static site to S3 + CloudFront:

```bash
./aws/scripts/cloudshell-deploy.sh <bucket-name> <distribution-id> .
```

You can also let the script resolve targets from CloudFormation outputs:

```bash
./aws/scripts/cloudshell-deploy.sh
```

## Auto deploy options
### Option A (recommended): deploy on every push
This repo includes a workflow at `.github/workflows/deploy-aws-static-site.yml` that deploys automatically on push to `main`/`master`.

Required GitHub repository secrets:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Optional secrets:
- `AWS_REGION` (defaults to `ap-southeast-2`)
- `AWS_STACK_NAME` (defaults to `artizans-stack`)

Once secrets are set, every qualifying push triggers:
1. Resolve `BucketName` and `CloudFrontDistributionId` from the stack.
2. `aws s3 sync` to the site bucket.
3. CloudFront invalidation.

### Option B: backend CI + deploy pipeline (dev/prod)
This repo includes `.github/workflows/deploy-aws-backend.yml`:
- Runs backend lint/tests on PRs and backend-related pushes.
- Deploys `dev` from `develop` (or manual dispatch with `environment=dev`).
- Deploys `prod` from `main` (or manual dispatch with `environment=prod`).
- Applies CloudFormation updates and then publishes Lambda code versions.

Required GitHub repository secrets:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Recommended additional secrets/vars:
- `AWS_REGION` (defaults to `ap-southeast-2`)
- `AWS_STACK_NAME_DEV` (defaults to `artizans-stack-dev`)
- `AWS_STACK_NAME_PROD` (defaults to `artizans-stack`)
- Repository variable `AWS_PROJECT_NAME` (defaults to `artizans`)

Recommended GitHub environments:
- `dev`
- `prod` (configure required reviewers for protected production deploys)

### Option C: local auto deploy on file save
Use the watcher script to deploy whenever local files change:

```bash
./scripts/auto-deploy-watch.sh
```

Optional env vars:
- `ARTIZANS_WATCH_INTERVAL_SECONDS` (default `4`)
- `ARTIZANS_STACK_NAME` (default `artizans-stack`)
- `ARTIZANS_BUCKET` (override bucket)
- `ARTIZANS_DISTRIBUTION_ID` (override distribution)
- `ARTIZANS_PROJECT_ROOT` (default `.`)

## Notes
- For custom domains on CloudFront, use an ACM certificate in `us-east-1` and set `CertificateArn`.
- To enforce canonical host redirect (for example `artizanscollective.com -> www.artizanscollective.com`), set:
  - `DomainName=www.artizanscollective.com`
  - `RedirectFromDomainName=artizanscollective.com`
- To attach an existing CloudFront WAF (recommended when stack region is not `us-east-1`), set:
  - `CloudFrontWebAclArn=arn:aws:wafv2:us-east-1:<account-id>:global/webacl/<name>/<id>`
- This template now applies no-store caching headers and disabled edge caching for:
  - `account-settings.html`
  - `js/auth.js`
  - `js/cognito-auth.js`
- For API custom domain, set `ApiDomainName` + `ApiCertificateArn` (+ `ApiHostedZoneId` if you want Route53 alias creation).
- For payment security operations, follow `aws/STRIPE_SECRETS_ROTATION.md`.
- For rollback procedures, follow `aws/ROLLBACK_PLAYBOOK.md`.
- Billing, Health, CloudShell, IAM, and Support are account-level consoles and are linked from `/admin/aws.html`.
- This prototype is still frontend/localStorage-first; EC2 is optional if you want to move workflows to a server API.
