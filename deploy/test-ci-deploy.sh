#!/usr/bin/env bash
# Tests deploy/ci-deploy.sh, the runner side of a deploy, against stand-ins for ssh, scp and docker. The ssh stand-in
# runs the remote command with bash, as the server's login shell would, so a tag that breaks out of its quoting
# really runs. The real deploy.sh runs "on the server" against the docker stand-in. Needs only bash.
# Usage: deploy/test-ci-deploy.sh
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SANDBOX=$(mktemp -d)
trap 'rm -rf "$SANDBOX"' EXIT
export SANDBOX LOG=$SANDBOX/calls.log REMOTE_DIR=$SANDBOX/server DEPLOY_DIR=$SANDBOX/server
export GHCR_TOKEN=secret-token GHCR_USER=octocat
mkdir -p "$SANDBOX/bin" "$REMOTE_DIR"
printf 'IMAGE_TAG=\n' > "$REMOTE_DIR/.env"
touch "$LOG"

cat > "$SANDBOX/bin/ssh" << 'EOF'
#!/usr/bin/env bash
# Stand-in for ssh: records the call, then runs the remote command with bash in the "server" directory.
opts=''
while [[ $1 == -o ]]; do
  opts="$opts $2"
  shift 2
done
target=$1
shift
echo "ssh$opts $target :: $*" >> "$LOG"
cd "$REMOTE_DIR" && bash -c "$*"
EOF
cat > "$SANDBOX/bin/scp" << 'EOF'
#!/usr/bin/env bash
# Stand-in for scp: copies the files to the path after "host:".
files=()
while (($# > 1)); do
  case $1 in
    -p) ;;
    -o) shift ;;
    *) files+=("$1") ;;
  esac
  shift
done
echo "scp ${files[*]} -> $1" >> "$LOG"
cp "${files[@]}" "${1#*:}"
EOF
cat > "$SANDBOX/bin/docker" << 'EOF'
#!/usr/bin/env bash
# Stand-in for docker: records the call; `login` keeps the password it reads from stdin.
echo "docker $*" >> "$LOG"
if [[ $1 == login ]]; then cat > "$SANDBOX/password"; fi
EOF
chmod +x "$SANDBOX"/bin/*
export PATH=$SANDBOX/bin:$PATH

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cd "$ROOT"

echo '--- A tag that breaks out of its quoting is refused before anything reaches the server'
if deploy/ci-deploy.sh deploy@server "x'; touch $SANDBOX/injected; '"; then fail 'ci-deploy.sh accepted the tag'; fi
[[ ! -e $SANDBOX/injected ]] || fail 'the tag ran a command'
[[ ! -s $LOG ]] || fail "ssh or scp ran for a bad tag: $(cat "$LOG")"

echo '--- A short SHA is refused'
if deploy/ci-deploy.sh deploy@server 0123abc; then fail 'ci-deploy.sh accepted a short SHA'; fi

echo '--- A full SHA deploys'
sha=0123456789abcdef0123456789abcdef01234567
deploy/ci-deploy.sh deploy@server "$sha"
grep -q 'ConnectTimeout=15 ServerAliveInterval=15' "$LOG" || fail "ssh runs without timeouts: $(cat "$LOG")"
grep -qF "$REMOTE_DIR/deploy.sh $sha" "$LOG" || fail "deploy.sh was not run with the SHA: $(cat "$LOG")"
[[ $(cat "$SANDBOX/password") == secret-token ]] || fail 'the registry token did not reach docker login on stdin'
grep -q 'docker logout ghcr.io' "$LOG" || fail 'the server stays logged in to GHCR'
[[ $(sed -n 's/^IMAGE_TAG=//p' "$REMOTE_DIR/.env") == "$sha" ]] || fail 'IMAGE_TAG was not set to the SHA'
cmp -s deploy/compose.yaml "$REMOTE_DIR/compose.yaml" || fail 'the release Compose file was not swapped in'
[[ ! -e $REMOTE_DIR/compose.yaml.new ]] || fail 'compose.yaml.new was left behind'

echo 'ci-deploy.sh tests passed'
