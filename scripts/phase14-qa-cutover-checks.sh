#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

echo "[phase14] Verifying required route files..."
required_routes=(
  "index.html"
  "explore.html"
  "artist-preview.html"
  "account-settings.html"
  "about.html"
  "faq.html"
  "blog.html"
  "contact.html"
  "legal.html"
  "user/setup.html"
  "user/discovery.html"
  "user/interaction.html"
  "user/account.html"
  "user/notifications.html"
  "user/history.html"
  "artist/onboarding.html"
  "artist/profile.html"
  "artist/bookings.html"
  "artist/communication.html"
  "artist/earnings.html"
  "artist/analytics.html"
)

for route in "${required_routes[@]}"; do
  if [[ ! -f "${route}" ]]; then
    echo "Missing required route: ${route}" >&2
    exit 1
  fi
done
echo "[phase14] Route file check passed."

echo "[phase14] Ensuring legacy local business-state key is removed from runtime JS..."
if rg -n "artizans\\.db\\.v1" js --glob "*.js"; then
  echo "Legacy business-state key artizans.db.v1 still present in runtime JS." >&2
  exit 1
fi
echo "[phase14] Legacy key check passed."

echo "[phase14] Running backend lint/tests..."
(
  cd backend
  npm run lint
  npm test
)
echo "[phase14] Backend checks passed."

echo "[phase14] All automated QA/cutover checks passed."
