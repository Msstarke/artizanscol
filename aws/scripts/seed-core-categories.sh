#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="${ARTIZANS_STACK_NAME:-artizans-stack}"
AWS_REGION="${AWS_REGION:-ap-southeast-2}"
CREATED_BY="${ARTIZANS_SEED_CREATED_BY:-seed:core-categories}"

resolve_output() {
  local key="$1"
  aws cloudformation describe-stacks \
    --region "${AWS_REGION}" \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue | [0]" \
    --output text
}

TABLE_NAME="${ARTIZANS_CATEGORIES_TABLE:-$(resolve_output "CategoriesTableName")}"

if [[ -z "${TABLE_NAME}" || "${TABLE_NAME}" == "None" ]]; then
  echo "Could not resolve Categories table name."
  echo "Set ARTIZANS_CATEGORIES_TABLE or ensure stack output CategoriesTableName exists."
  exit 1
fi

timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

seed_category() {
  local id="$1"
  local name="$2"
  local sort_name="$3"

  aws dynamodb put-item \
    --region "${AWS_REGION}" \
    --table-name "${TABLE_NAME}" \
    --item "{
      \"id\": {\"S\": \"${id}\"},
      \"createdAt\": {\"S\": \"${timestamp}\"},
      \"updatedAt\": {\"S\": \"${timestamp}\"},
      \"createdBy\": {\"S\": \"${CREATED_BY}\"},
      \"version\": {\"N\": \"1\"},
      \"name\": {\"S\": \"${name}\"},
      \"sortName\": {\"S\": \"${sort_name}\"},
      \"active\": {\"BOOL\": true},
      \"activeStatus\": {\"S\": \"active\"}
    }" \
    >/dev/null
  echo "Seeded category: ${name}"
}

seed_category "cat_illustration" "Illustration" "illustration"
seed_category "cat_branding" "Branding" "branding"
seed_category "cat_editorial" "Editorial" "editorial"
seed_category "cat_photography" "Photography" "photography"
seed_category "cat_animation" "Animation" "animation"
seed_category "cat_mural" "Mural" "mural"
seed_category "cat_packaging" "Packaging" "packaging"
seed_category "cat_lettering" "Lettering" "lettering"

echo "Core category bootstrap complete for table ${TABLE_NAME}."
