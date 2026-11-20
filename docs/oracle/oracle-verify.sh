#!/usr/bin/env bash
# oracle-verify.sh
# Run in an Oracle SSH terminal or locally against the published origin.
# It checks the same public outcomes the staged deploy should preserve:
#   health, source files, font catalog, public API, and CSP header.
set -euo pipefail

ORIGIN="${ORACLE_ORIGIN:-https://nameflare.bxne.dev}"
HTTP="curl -fsSL"
HTTP_HEAD="curl -fsSL -I"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  FAILED=1
}

PASSED=0
FAILED=0

check_http() {
  local label="$1" url="$2" expected="$3" extra_args="${4:-}"
  local out
  if out=$(eval "$HTTP $extra_args \"$url\"" 2>/dev/null); then
    if [ -n "$expected" ]; then
      if [ "$out" = "$expected" ]; then
        printf 'OK: %s\n' "$label"
        PASSED=$((PASSED + 1))
      else
        fail "$label: unexpected body (expected '$expected', got '$out')"
      fi
    else
      printf 'OK: %s\n' "$label"
      PASSED=$((PASSED + 1))
    fi
  else
    fail "$label: connection or HTTP error for $url"
  fi
}

check_http_code() {
  local label="$1" url="$2" expected_code="$3"
  local code
  code=$(curl -fsSL -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo "000")
  if [ "$code" = "$expected_code" ]; then
    printf 'OK: %s -> %s\n' "$label" "$code"
    PASSED=$((PASSED + 1))
  else
    fail "$label: expected $expected_code, got $code for $url"
  fi
}

check_header() {
  local label="$1" url="$2" pattern="$3"
  local header
  header=$(curl -fsSL -I "$url" 2>/dev/null | tr -d '\r' || true)
  if echo "$header" | grep -qiE "$pattern"; then
    printf 'OK: %s\n' "$label"
    PASSED=$((PASSED + 1))
  else
    fail "$label: header pattern not found in response for $url"
  fi
}

echo "Verifying live service at: $ORIGIN"
echo "---"

check_http "healthz" "$ORIGIN/healthz" '{"status":"ok"}'
check_http_code "fonts.js" "$ORIGIN/fonts.js" "200"
check_http_code "google-fonts.json" "$ORIGIN/google-fonts.json" "200"
check_http_code "public artists list" "$ORIGIN/api/v1/artists" "200"
check_http_code "guide page" "$ORIGIN/guide" "200"
check_http_code "studio page" "$ORIGIN/studio" "200"
check_http_code "discover page" "$ORIGIN/discover" "200"
check_header "CSP allows Google Fonts" "$ORIGIN/style.css" "fonts\.gstatic\.com|fonts\.googleapis\.com"
check_header "CSP restricts default sources" "$ORIGIN/style.css" "default-src 'self'"

# Public API sanity: the artists endpoint should return JSON with a users array.
if out=$(eval "$HTTP \"$ORIGIN/api/v1/artists\"" 2>/dev/null); then
  if echo "$out" | grep -q '"users"'; then
    printf 'OK: /api/v1/artists returns users array\n'
    PASSED=$((PASSED + 1))
  else
    fail "/api/v1/artists unexpected JSON shape"
  fi
else
  fail "/api/v1/artists fetch failed"
fi

echo
if [ "$FAILED" -eq 0 ]; then
  echo "All checked endpoints passed locally reachable checks."
else
  echo "$FAILED check(s) failed."
  exit 1
fi
