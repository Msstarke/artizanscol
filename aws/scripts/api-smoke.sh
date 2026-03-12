#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <base-url>"
  echo "Example: $0 https://www.artizanscollective.com"
  echo "Example: $0 https://abcd123.execute-api.ap-southeast-2.amazonaws.com"
  exit 1
fi

BASE_URL="${1%/}"
AUTH_BEARER_TOKEN="${AUTH_BEARER_TOKEN:-}"

check_endpoint() {
  local method="$1"
  local path="$2"
  local expected_status="$3"
  local expected_ok="$4"
  local token="${5:-}"
  local body="${6:-}"

  local tmp_body tmp_headers status
  tmp_body="$(mktemp)"
  tmp_headers="$(mktemp)"

  local -a curl_args=(
    -sS
    -D "${tmp_headers}"
    -o "${tmp_body}"
    -w "%{http_code}"
    -X "${method}"
  )

  if [[ -n "${token}" ]]; then
    curl_args+=(-H "Authorization: Bearer ${token}")
  fi

  if [[ -n "${body}" ]]; then
    curl_args+=(-H "Content-Type: application/json" -d "${body}")
  fi

  status="$(curl "${curl_args[@]}" "${BASE_URL}${path}")"

  if [[ "${status}" != "${expected_status}" ]]; then
    echo "FAIL ${method} ${path}: expected ${expected_status}, got ${status}" >&2
    echo "Headers:" >&2
    cat "${tmp_headers}" >&2
    echo "Body:" >&2
    cat "${tmp_body}" >&2
    rm -f "${tmp_body}" "${tmp_headers}"
    exit 1
  fi

  python3 - "$tmp_headers" "$tmp_body" "$expected_ok" "$expected_status" "$method" "$path" <<'PY'
import json
import sys
from pathlib import Path

headers_path, body_path, expected_ok, expected_status, method, path = sys.argv[1:]
headers_text = Path(headers_path).read_text(errors="ignore").lower()
body_text = Path(body_path).read_text(errors="ignore")

if "content-type: application/json" not in headers_text:
    print(f"FAIL {method} {path}: response is not JSON.", file=sys.stderr)
    print("Headers:", file=sys.stderr)
    print(headers_text, file=sys.stderr)
    print("Body:", file=sys.stderr)
    print(body_text, file=sys.stderr)
    sys.exit(1)

try:
    payload = json.loads(body_text)
except json.JSONDecodeError:
    print(f"FAIL {method} {path}: invalid JSON body.", file=sys.stderr)
    print(body_text, file=sys.stderr)
    sys.exit(1)

if not isinstance(payload, dict):
    print(f"FAIL {method} {path}: JSON response is not an object.", file=sys.stderr)
    print(body_text, file=sys.stderr)
    sys.exit(1)

if "ok" not in payload:
    # API Gateway HTTP API JWT authorizers return {"message":"Unauthorized"} before Lambda runs.
    if expected_status == "401" and payload.get("message") == "Unauthorized":
        sys.exit(0)

    print(f"FAIL {method} {path}: missing API envelope.", file=sys.stderr)
    print(body_text, file=sys.stderr)
    sys.exit(1)

expected = expected_ok.lower() == "true"
if bool(payload.get("ok")) != expected:
    print(f"FAIL {method} {path}: expected ok={expected}, got ok={payload.get('ok')}.", file=sys.stderr)
    print(body_text, file=sys.stderr)
    sys.exit(1)
PY

  echo "PASS ${method} ${path} -> ${status} (ok=${expected_ok})"
  rm -f "${tmp_body}" "${tmp_headers}"
}

echo "[smoke] Public marketplace endpoints..."
check_endpoint "GET" "/v1/categories" "200" "true"
check_endpoint "GET" "/v1/artists" "200" "true"
check_endpoint "GET" "/v1/me" "401" "false"

echo "[smoke] Authenticated core marketplace endpoints..."
if [[ -n "${AUTH_BEARER_TOKEN}" ]]; then
  check_endpoint "GET" "/v1/me" "200" "true" "${AUTH_BEARER_TOKEN}"
  check_endpoint "GET" "/v1/me/bookings" "200" "true" "${AUTH_BEARER_TOKEN}"
  check_endpoint "GET" "/v1/me/notifications" "200" "true" "${AUTH_BEARER_TOKEN}"
  check_endpoint "GET" "/v1/threads" "200" "true" "${AUTH_BEARER_TOKEN}"
  check_endpoint "GET" "/v1/artist/me" "200" "true" "${AUTH_BEARER_TOKEN}"
  check_endpoint "GET" "/v1/artist/me/bookings" "200" "true" "${AUTH_BEARER_TOKEN}"
  check_endpoint "GET" "/v1/artist/me/notifications" "200" "true" "${AUTH_BEARER_TOKEN}"
else
  echo "SKIP authenticated marketplace endpoints (set AUTH_BEARER_TOKEN to run)."
fi

echo "[smoke] Core marketplace API smoke checks completed."
