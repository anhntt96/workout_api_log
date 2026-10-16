#!/usr/bin/env bash
# Restores a dump from R2 (or BACKUP_REMOTE) into a database in the db container, replacing what is there.
# Stop the API before restoring over the live database (docs/deployment.md).
# Usage: restore.sh --list
#        restore.sh <dump name> [database, default workout]
set -euo pipefail
cd "${DEPLOY_DIR:-/opt/workout}"
# shellcheck source=r2-env.sh
source ./r2-env.sh

if [[ ${1:-} == --list ]]; then
  rclone lsl "$BACKUP_REMOTE"
  exit 0
fi
dump=${1:?usage: restore.sh --list | restore.sh <dump name> [database]}
database=${2:-workout}

rclone cat "$BACKUP_REMOTE/$dump" |
  docker compose exec -T db pg_restore --username workout --dbname "$database" \
    --clean --if-exists --no-owner --single-transaction
echo "Restored $dump into $database"
