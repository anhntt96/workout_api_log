#!/usr/bin/env bash
# Rehearses deploy/deploy.sh on this machine with the production Compose file and locally built images:
# a malformed tag, a failed first deploy, a good release, then a broken release that must roll back.
# It uses its own Compose project with nginx on 127.0.0.1:8081, and removes its containers, volume and
# images at the end. Needs Docker, curl and jq; takes a few minutes.
# Usage: deploy/test-deploy.sh
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
API=ghcr.io/anhntt96/workout-api
WEB=ghcr.io/anhntt96/workout-web
export DEPLOY_DIR=$WORK WAIT_TIMEOUT=60
export COMPOSE_PROJECT_NAME=workout-rehearsal COMPOSE_FILE=compose.yaml:compose.rehearsal.yaml

cleanup() {
  # IMAGE_TAG may be empty after a failed deploy, and Compose refuses to read the file without it.
  (cd "$WORK" && IMAGE_TAG=cleanup docker compose down --volumes --remove-orphans > /dev/null 2>&1) || true
  docker image rm "$API:rehearsal-good" "$API:rehearsal-broken" "$WEB:rehearsal-good" "$WEB:rehearsal-broken" \
    > /dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

expect_tag() { # expect_tag TAG LABEL
  local actual
  actual=$(sed -n 's/^IMAGE_TAG=//p' "$WORK/.env")
  [[ $actual == "$1" ]] || fail "$2: IMAGE_TAG is '$actual', expected '$1'"
}

echo '--- Building the rehearsal images'
docker build --quiet --tag "$API:rehearsal-good" "$ROOT" > /dev/null
docker build --quiet --tag "$WEB:rehearsal-good" "$ROOT/frontend" > /dev/null
# A release whose API exits at startup.
printf 'FROM %s\nCMD ["node", "-e", "process.exit(1)"]\n' "$API:rehearsal-good" |
  docker build --quiet --tag "$API:rehearsal-broken" - > /dev/null
docker tag "$WEB:rehearsal-good" "$WEB:rehearsal-broken"

cp "$ROOT/deploy/compose.yaml" "$ROOT/deploy/compose.rehearsal.yaml" "$ROOT/deploy/deploy.sh" "$WORK/"
printf 'IMAGE_TAG=\nPOSTGRES_PASSWORD=rehearsal\nTUNNEL_TOKEN=unused\n' > "$WORK/.env"

echo '--- A malformed tag is refused'
if "$WORK/deploy.sh" 'main;echo'; then fail 'deploy.sh accepted a malformed tag'; fi
expect_tag '' 'after a malformed tag'

echo '--- A failed first deploy leaves no tag behind'
if "$WORK/deploy.sh" rehearsal-missing; then fail 'deploy.sh reported success for images that do not exist'; fi
expect_tag '' 'after a failed first deploy'

echo '--- A good release deploys'
"$WORK/deploy.sh" rehearsal-good
expect_tag rehearsal-good 'after the good release'
"$ROOT/scripts/smoke-test.sh" http://127.0.0.1:8081

echo '--- A broken release rolls back'
if "$WORK/deploy.sh" rehearsal-broken; then fail 'deploy.sh reported success for a broken release'; fi
expect_tag rehearsal-good 'after the rollback'
"$ROOT/scripts/smoke-test.sh" http://127.0.0.1:8081

echo 'deploy.sh rehearsal passed'
