#!/usr/bin/env bash
# The runner side of a deploy (.github/workflows/deploy.yml). It copies the scripts and the release's Compose file to
# the server, logs the server in to GHCR for the length of the deploy, and runs deploy.sh there over ssh.
#
# Usage: deploy/ci-deploy.sh <user@host> <full commit SHA>
# Env:
#   GHCR_USER, GHCR_TOKEN  registry credentials; the token reaches the server on stdin only
#   REMOTE_DIR             the deploy directory on the server (default /opt/workout)
set -euo pipefail

target=${1:?usage: ci-deploy.sh <user@host> <full commit SHA>}
tag=${2:-}
# Releases are tagged with full commit SHAs. Checking here, before anything reaches the server's shell, stops a
# rollback tag typed into the workflow form from running commands there.
if [[ ! $tag =~ ^[0-9a-f]{40}$ ]]; then
  echo "The image tag must be a full 40-character commit SHA; got '$tag'" >&2
  exit 2
fi
remote_dir=${REMOTE_DIR:-/opt/workout}
# Give up on an unreachable or dead connection instead of holding the deploy queue.
ssh_opts=(-o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)

scp -p "${ssh_opts[@]}" deploy/deploy.sh deploy/backup.sh deploy/restore.sh deploy/r2-env.sh "$target:$remote_dir/"
# deploy.sh swaps this in, and puts the running compose.yaml back if the release fails.
scp "${ssh_opts[@]}" deploy/compose.yaml "$target:$remote_dir/compose.yaml.new"

trap 'ssh "${ssh_opts[@]}" "$target" "docker logout ghcr.io" > /dev/null || true' EXIT
# The remote commands expand here on purpose: every value in them is validated above or quoted with printf %q.
# shellcheck disable=SC2029
printf '%s' "$GHCR_TOKEN" |
  ssh "${ssh_opts[@]}" "$target" "docker login ghcr.io --username $(printf %q "$GHCR_USER") --password-stdin"
# shellcheck disable=SC2029
ssh "${ssh_opts[@]}" "$target" "$(printf %q "$remote_dir")/deploy.sh $tag"
