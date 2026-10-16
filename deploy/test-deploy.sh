#!/usr/bin/env bash
# Rehearses deploy/deploy.sh on this machine with the production Compose file and locally built images:
# a malformed tag, a failed first deploy, a good release, a backup restored into a scratch database, then a
# broken release that must roll back. It uses its own Compose project with nginx on 127.0.0.1:8081, keeps
# backups in a temporary directory instead of R2, and removes its containers, volume and images at the end.
# Needs Docker, curl, jq and rclone; takes a few minutes.
# Usage: deploy/test-deploy.sh
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
API=ghcr.io/anhntt96/workout-api
WEB=ghcr.io/anhntt96/workout-web
export DEPLOY_DIR=$WORK WAIT_TIMEOUT=60 BACKUP_REMOTE=$WORK/backups
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

cp "$ROOT/deploy/compose.yaml" "$ROOT/deploy/compose.rehearsal.yaml" "$ROOT/deploy/deploy.sh" \
  "$ROOT/deploy/backup.sh" "$ROOT/deploy/restore.sh" "$ROOT/deploy/r2-env.sh" "$WORK/"
cat > "$WORK/.env" << 'EOF'
IMAGE_TAG=
POSTGRES_PASSWORD=rehearsal
TUNNEL_TOKEN=unused
R2_ACCOUNT_ID=unused
R2_ACCESS_KEY_ID=unused
R2_SECRET_ACCESS_KEY=unused
R2_BUCKET=unused
EOF

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

echo '--- A backup restores into a scratch database'
curl -fsS -o /dev/null -X POST \
  http://127.0.0.1:8081/api/users/0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e/workout-entries \
  -H 'Content-Type: application/json' \
  -d '{"entries":[{"date":"2026-01-05","exerciseName":"Bench Press","sets":[{"reps":5,"weight":100,"unit":"kg"}]}]}'
"$WORK/backup.sh"
dumps=("$WORK"/backups/*.dump)
[[ ${#dumps[@]} == 1 && -f ${dumps[0]} ]] || fail "backup.sh should write one dump to $WORK/backups"
(cd "$WORK" && docker compose exec -T db createdb --username workout restore_check)
"$WORK/restore.sh" "${dumps[0]##*/}" restore_check
entries=$(cd "$WORK" && docker compose exec -T db psql --username workout --dbname restore_check -tAc \
  'SELECT count(*) FROM workout_entries')
[[ $entries == 1 ]] || fail "the restored database has $entries workout entries, expected 1"

echo '--- A broken release rolls back'
if "$WORK/deploy.sh" rehearsal-broken; then fail 'deploy.sh reported success for a broken release'; fi
expect_tag rehearsal-good 'after the rollback'
"$ROOT/scripts/smoke-test.sh" http://127.0.0.1:8081

echo 'deploy.sh rehearsal passed'
