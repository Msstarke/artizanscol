#!/usr/bin/env bash
set -euo pipefail

# Usage patterns:
#   ./aws/scripts/cloudshell-deploy.sh <bucket> <distribution-id> [project_root]
#   ./aws/scripts/cloudshell-deploy.sh                     # resolves from CloudFormation stack
#
# Optional env vars:
#   ARTIZANS_STACK_NAME (default: artizans-stack)
#   ARTIZANS_BUCKET
#   ARTIZANS_DISTRIBUTION_ID
#   ARTIZANS_PROJECT_ROOT (default: .)

STACK_NAME="${ARTIZANS_STACK_NAME:-artizans-stack}"
ROOT_DIR="${3:-${ARTIZANS_PROJECT_ROOT:-.}}"

BUCKET="${1:-${ARTIZANS_BUCKET:-}}"
DISTRIBUTION_ID="${2:-${ARTIZANS_DISTRIBUTION_ID:-}}"

resolve_output() {
  local key="$1"
  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue | [0]" \
    --output text
}

if [[ -z "$BUCKET" || "$BUCKET" == "None" ]]; then
  BUCKET="$(resolve_output "BucketName")"
fi

if [[ -z "$DISTRIBUTION_ID" || "$DISTRIBUTION_ID" == "None" ]]; then
  DISTRIBUTION_ID="$(resolve_output "CloudFrontDistributionId")"
fi

if [[ -z "$BUCKET" || "$BUCKET" == "None" ]]; then
  echo "Could not determine S3 bucket name."
  echo "Pass it directly or set ARTIZANS_BUCKET / stack outputs."
  exit 1
fi

if [[ -z "$DISTRIBUTION_ID" || "$DISTRIBUTION_ID" == "None" ]]; then
  echo "Could not determine CloudFront distribution id."
  echo "Pass it directly or set ARTIZANS_DISTRIBUTION_ID / stack outputs."
  exit 1
fi

echo "Deploying from: $ROOT_DIR"
echo "S3 bucket: $BUCKET"
echo "CloudFront distribution: $DISTRIBUTION_ID"

aws s3 sync "$ROOT_DIR" "s3://$BUCKET" \
  --delete \
  --exclude ".git/*" \
  --exclude ".codex_state/*" \
  --exclude "output/*" \
  --exclude "aws/*"

aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*"

echo "Deployment complete."
