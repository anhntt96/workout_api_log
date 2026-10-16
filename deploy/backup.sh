#!/usr/bin/env bash
# Dumps the database (pg_dump custom format) and uploads it to R2, or to BACKUP_REMOTE. workout-backup.timer runs
# it daily at 03:00 UTC; run it by hand with `sudo systemctl start workout-backup.service`. The bucket's lifecycle
# rule deletes dumps after 14 days.
set -euo pipefail
cd "${DEPLOY_DIR:-/opt/workout}"
# shellcheck source=r2-env.sh
source ./r2-env.sh

name=workout-$(date -u +%Y%m%dT%H%M%SZ).dump
# Dump to a local file first, so a failed pg_dump never uploads a partial dump.
dump=$(mktemp)
trap 'rm -f "$dump"' EXIT
docker compose exec -T db pg_dump --username workout --dbname workout --format custom > "$dump"
rclone copyto "$dump" "$BACKUP_REMOTE/$name"
echo "Uploaded $name to $BACKUP_REMOTE"

if [[ -n ${BACKUP_PING_URL:-} ]]; then
  curl -fsS --max-time 10 --retry 3 "$BACKUP_PING_URL" > /dev/null
fi
