#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <api-base-url>"
  echo "Example: $0 https://abcd123.execute-api.ap-southeast-2.amazonaws.com"
  exit 1
fi

API_BASE_URL="${1%/}"
AUTH_BEARER_TOKEN="${AUTH_BEARER_TOKEN:-}"
ADMIN_BEARER_TOKEN="${ADMIN_BEARER_TOKEN:-}"

check_endpoint() {
  local method="$1"
  local path="$2"
  local expected="$3"
  local token="${4:-}"
  local body="${5:-}"

  local tmp_file
  tmp_file="$(mktemp)"
  local status

  if [[ -n "${token}" ]]; then
    if [[ -n "${body}" ]]; then
      status="$(curl -sS -o "${tmp_file}" -w "%{http_code}" -X "${method}" \
        -H "Authorization: Bearer ${token}" \
        -H "Content-Type: application/json" \
        -d "${body}" \
        "${API_BASE_URL}${path}")"
    else
      status="$(curl -sS -o "${tmp_file}" -w "%{http_code}" -X "${method}" \
        -H "Authorization: Bearer ${token}" \
        "${API_BASE_URL}${path}")"
    fi
  else
    if [[ -n "${body}" ]]; then
      status="$(curl -sS -o "${tmp_file}" -w "%{http_code}" -X "${method}" \
        -H "Content-Type: application/json" \
        -d "${body}" \
        "${API_BASE_URL}${path}")"
    else
      status="$(curl -sS -o "${tmp_file}" -w "%{http_code}" -X "${method}" "${API_BASE_URL}${path}")"
    fi
  fi

  if [[ "${status}" != "${expected}" ]]; then
    echo "FAIL ${method} ${path}: expected ${expected}, got ${status}" >&2
    echo "Body:" >&2
    cat "${tmp_file}" >&2
    rm -f "${tmp_file}"
    exit 1
  fi

  echo "PASS ${method} ${path} -> ${status}"
  rm -f "${tmp_file}"
}

echo "[smoke] Public endpoints..."
check_endpoint "GET" "/v1/categories" "200"
check_endpoint "GET" "/v1/artists" "200"

echo "[smoke] Protected endpoints..."
if [[ -n "${AUTH_BEARER_TOKEN}" ]]; then
  check_endpoint "GET" "/v1/me" "200" "${AUTH_BEARER_TOKEN}"
  check_endpoint "GET" "/v1/me/bookings" "200" "${AUTH_BEARER_TOKEN}"
  check_endpoint "GET" "/v1/threads" "200" "${AUTH_BEARER_TOKEN}"
else
  echo "SKIP protected user endpoints (set AUTH_BEARER_TOKEN to run)."
fi

if [[ -n "${ADMIN_BEARER_TOKEN}" ]]; then
  check_endpoint "GET" "/v1/admin/system" "200" "${ADMIN_BEARER_TOKEN}"
  check_endpoint "GET" "/v1/admin/reports" "200" "${ADMIN_BEARER_TOKEN}"
else
  echo "SKIP admin endpoints (set ADMIN_BEARER_TOKEN to run)."
fi

echo "[smoke] API smoke checks completed."
