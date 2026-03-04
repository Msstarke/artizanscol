#!/usr/bin/env bash
set -euo pipefail

# Watches frontend files and deploys automatically when they change.
#
# Usage:
#   ./scripts/auto-deploy-watch.sh
#
# Optional env vars:
#   ARTIZANS_WATCH_INTERVAL_SECONDS (default: 4)
#   ARTIZANS_STACK_NAME             (default: artizans-stack)
#   ARTIZANS_BUCKET                 (optional override)
#   ARTIZANS_DISTRIBUTION_ID        (optional override)
#   ARTIZANS_PROJECT_ROOT           (default: .)

WATCH_INTERVAL="${ARTIZANS_WATCH_INTERVAL_SECONDS:-4}"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required."
  exit 1
fi

aws sts get-caller-identity >/dev/null

fingerprint() {
  find . \
    -type f \
    \( -name "*.html" -o -name "*.css" -o -name "*.js" -o -name "*.json" -o -name "*.svg" -o -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" -o -name "*.webp" -o -name "*.ico" \) \
    -not -path "./.git/*" \
    -not -path "./.codex_state/*" \
    -not -path "./output/*" \
    -not -path "./aws/*" \
    -not -path "./node_modules/*" \
    -print0 \
    | sort -z \
    | xargs -0 shasum
}

LAST_HASH="$(fingerprint | shasum | awk '{print $1}')"

echo "Auto deploy watcher started."
echo "Interval: ${WATCH_INTERVAL}s"
echo "Press Ctrl+C to stop."

while true; do
  sleep "$WATCH_INTERVAL"
  NEXT_HASH="$(fingerprint | shasum | awk '{print $1}')"

  if [[ "$NEXT_HASH" != "$LAST_HASH" ]]; then
    echo "Change detected at $(date '+%Y-%m-%d %H:%M:%S'). Deploying..."

    if ./aws/scripts/cloudshell-deploy.sh; then
      echo "Deploy succeeded."
      LAST_HASH="$NEXT_HASH"
    else
      echo "Deploy failed. Will retry after next file change."
    fi
  fi
done
