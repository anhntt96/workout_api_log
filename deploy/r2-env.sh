# shellcheck shell=bash
# Sourced by backup.sh and restore.sh from the deploy directory. It loads .env and sets BACKUP_REMOTE, the rclone
# location of the dumps. rclone's "r2" remote is configured with environment variables, so the server needs no
# rclone config file. deploy/test-deploy.sh points BACKUP_REMOTE at a local directory instead.
set -a
# shellcheck source=/dev/null
source ./.env
set +a
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY
export RCLONE_CONFIG_R2_ENDPOINT=https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com
# A token scoped to one bucket may not check or create buckets.
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
BACKUP_REMOTE=${BACKUP_REMOTE:-r2:$R2_BUCKET}
