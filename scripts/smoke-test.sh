#!/usr/bin/env bash
# Checks a running stack through its front door (nginx, or Cloudflare in front of it): the UI, the /api proxy,
# the security headers, and nginx's own errors in the API's error format. Stores nothing: every POST is invalid.
#
# Usage: scripts/smoke-test.sh [BASE_URL] [--rate-limit]
#   BASE_URL      default http://localhost:8080 (docker compose); production is https://workout.albertnguyen.dev
#   --rate-limit  also bursts POSTs until nginx answers 429. It sends CF-Connecting-IP, which nginx trusts, so
#                 use it only against a local stack: in production Cloudflare replaces that header.
# Needs curl and jq.
set -euo pipefail

BASE_URL=${1:-http://localhost:8080}
MODE=${2:-}
# Any UUID works: the API rejects every POST below before storing anything.
ENTRIES_PATH=/api/users/00000000-0000-4000-8000-000000000000/workout-entries
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# request METHOD PATH [curl args...]: saves the headers and body under $WORK and prints the status code.
request() {
  local method=$1 path=$2
  shift 2
  curl -sS -X "$method" "$BASE_URL$path" -D "$WORK/headers" -o "$WORK/body" -w '%{http_code}' "$@"
}

expect_status() { # expect_status ACTUAL EXPECTED LABEL
  [[ $1 == "$2" ]] || fail "$3: expected HTTP $2, got $1: $(head -c 300 "$WORK/body")"
}

expect_header() { # expect_header NAME VALUE_PREFIX LABEL
  grep -qiF "$1: $2" "$WORK/headers" || fail "$3: no '$1: $2' header"
}

expect_error_code() { # expect_error_code CODE LABEL
  local code
  code=$(jq -r .code "$WORK/body" 2> /dev/null) || fail "$2: the body is not JSON: $(head -c 300 "$WORK/body")"
  [[ $code == "$1" ]] || fail "$2: expected error code $1, got $code"
}

expect_security_headers() { # expect_security_headers LABEL
  expect_header content-security-policy "default-src 'self'" "$1"
  expect_header x-content-type-options nosniff "$1"
  expect_header x-frame-options DENY "$1"
  expect_header referrer-policy strict-origin-when-cross-origin "$1"
}

# 1. The app shell: revalidated on every load, no inline code for the CSP to block, no nginx version.
status=$(request GET /)
expect_status "$status" 200 'GET /'
expect_header cache-control no-cache 'GET /'
expect_security_headers 'GET /'
inline_scripts=$(grep -oE '<script[^>]*>' "$WORK/body" | grep -v ' src=' || true)
[[ -z $inline_scripts ]] || fail "GET /: index.html has an inline script, which the CSP blocks: $inline_scripts"
if grep -qiE '<style|style=' "$WORK/body"; then fail 'GET /: index.html has inline styles, which the CSP blocks'; fi
if grep -qiE '^server: nginx/[0-9]' "$WORK/headers"; then fail 'GET /: the Server header shows the nginx version'; fi
html=$(< "$WORK/body")
asset_pattern='/assets/[^"]+\.js'
[[ $html =~ $asset_pattern ]] || fail 'GET /: index.html loads no /assets/*.js script'
asset=${BASH_REMATCH[0]}
echo "ok   GET / serves the app with security headers"

# 2. A hashed build asset, cached for a year.
status=$(request GET "$asset")
expect_status "$status" 200 "GET $asset"
expect_header cache-control 'public, max-age=31536000, immutable' "GET $asset"
expect_security_headers "GET $asset"
echo "ok   GET $asset is cached as immutable"

# 3. A client-side route loads the app.
status=$(request GET /history)
expect_status "$status" 200 'GET /history'
grep -q '<div id="root">' "$WORK/body" || fail 'GET /history: not the app shell'
echo "ok   GET /history serves the app"

# 4. The API through the proxy.
status=$(request GET /api/health)
expect_status "$status" 200 'GET /api/health'
[[ $(jq -r .status "$WORK/body") == ok ]] || fail 'GET /api/health: status is not ok'
expect_header x-content-type-options nosniff 'GET /api/health'
status=$(request GET /api/exercises)
expect_status "$status" 200 'GET /api/exercises'
[[ $(jq '.data | length' "$WORK/body") -gt 0 ]] || fail 'GET /api/exercises: the catalog is empty'
echo "ok   the API answers under /api"

# 5. A body over the API's 1 MB limit gets the API's own 413, not nginx's HTML page.
{
  printf '{"entries":"'
  head -c 1500000 /dev/zero | tr '\0' a
  printf '"}'
} > "$WORK/large.json"
status=$(request POST "$ENTRIES_PATH" -H 'Content-Type: application/json' --data-binary "@$WORK/large.json")
expect_status "$status" 413 'POST a 1.5 MB body'
expect_error_code PAYLOAD_TOO_LARGE 'POST a 1.5 MB body'
echo "ok   an oversized body gets the API's JSON 413"

# 6. Optional: the per-client write limit, keyed by CF-Connecting-IP.
if [[ $MODE == --rate-limit ]]; then
  limited=''
  for _ in $(seq 1 40); do
    status=$(request POST "$ENTRIES_PATH" -H 'CF-Connecting-IP: 198.51.100.1' -H 'Content-Type: application/json' -d '{}')
    if [[ $status == 429 ]]; then
      limited=yes
      break
    fi
    expect_status "$status" 400 'POST {} from 198.51.100.1'
  done
  [[ -n $limited ]] || fail '40 quick POSTs from one client were never rate limited'
  expect_error_code TOO_MANY_REQUESTS 'POST burst'
  expect_header retry-after 10 'POST burst'
  expect_security_headers 'POST burst'
  status=$(request POST "$ENTRIES_PATH" -H 'CF-Connecting-IP: 198.51.100.2' -H 'Content-Type: application/json' -d '{}')
  expect_status "$status" 400 'POST {} from another client'
  echo "ok   writes are limited per client, in the API's error format"
fi

echo "All smoke checks passed against $BASE_URL"
