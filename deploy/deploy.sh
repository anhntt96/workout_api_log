#!/usr/bin/env bash
# Deploys one release on the server: the API and web images tagged with a commit SHA. If the release doesn't
# become healthy, it puts the previous release back and exits 1.
#
# Usage: deploy.sh <image tag>
#   The Deploy workflow runs it over ssh. Run it by hand with an earlier SHA to roll back.
# Env:
#   DEPLOY_DIR    the directory with compose.yaml and .env (default /opt/workout)
#   WAIT_TIMEOUT  seconds to wait for the containers to become healthy (default 180)
set -euo pipefail

new_tag=${1:-}
# Tags are commit SHAs. Checking the shape also keeps the tag safe inside the sed expression below.
if [[ ! $new_tag =~ ^[A-Za-z0-9._-]{1,128}$ ]]; then
  echo "usage: deploy.sh <image tag> (letters, digits, '.', '_' or '-'); got '$new_tag'" >&2
  exit 2
fi

cd "${DEPLOY_DIR:-/opt/workout}"
previous_tag=$(sed -n 's/^IMAGE_TAG=//p' .env)
wait_timeout=${WAIT_TIMEOUT:-180}

set_tag() {
  # -i.bak works with both GNU and BSD sed, and both keep the file's 600 mode.
  sed -i.bak "s/^IMAGE_TAG=.*/IMAGE_TAG=$1/" .env
  rm -f .env.bak
}

start() {
  # A release's images never change under its tag, so only missing images are pulled.
  docker compose pull --quiet --policy missing &&
    docker compose up --detach --wait --wait-timeout "$wait_timeout" --remove-orphans
}

echo "Deploying $new_tag (running: ${previous_tag:-nothing})"
set_tag "$new_tag"
if start; then
  # Removes this app's images that no container uses and that are over a week old; newer ones stay for rollbacks.
  docker image prune --all --force --filter until=168h \
    --filter label=org.opencontainers.image.source=https://github.com/anhntt96/workout_api_log > /dev/null
  echo "Deployed $new_tag"
  exit 0
fi

echo "Deploying $new_tag failed" >&2
docker compose logs --tail 50 api >&2 || true
set_tag "$previous_tag"
if [[ -n $previous_tag ]]; then
  docker compose up --detach --wait --wait-timeout "$wait_timeout" --remove-orphans
  echo "Rolled back to $previous_tag" >&2
fi
exit 1
