#!/usr/bin/env bash
# Verify this repository inside an instabox.
#
# The pristine gentle-pi bytes are not in the repo, and the digest tests skip without them -
# a skip reads as a pass in a summary line. So the copy is made and hashed **here**, and the
# run stops if a single file did not arrive or does not match. No manual step to remember.
#
#   scripts/box-verify.sh [box]        (default: port)
set -euo pipefail

BOX="${1:-port}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_REPO=/data/workspace/loon
REMOTE_PRISTINE=/data/workspace/pristine46
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say() { printf '%s\n' "$*"; }

instabox start "$BOX" >/dev/null 2>&1 || true

PRISTINE_ROOT="$(cd "$REPO" && node scripts/box-pristine.mjs prepare)" || {
	say "no pristine gentle-pi sources on this machine: the digest tests would skip, so this run stops here"
	exit 1
}
say "pristine source: $PRISTINE_ROOT"

(cd "$REPO" && tar czf "$WORK/loon.tgz" --exclude=node_modules --exclude=.git --exclude=dist --exclude=.pi .)
(cd "$PRISTINE_ROOT" && tar czf "$WORK/pristine.tgz" .)

(cd "$REPO" && instabox ssh "$BOX" -- "rm -rf $REMOTE_REPO && mkdir -p $REMOTE_REPO && tar xzf - -C $REMOTE_REPO" < "$WORK/loon.tgz")
instabox ssh "$BOX" -- "rm -rf $REMOTE_PRISTINE && mkdir -p $REMOTE_PRISTINE && tar xzf - -C $REMOTE_PRISTINE" < "$WORK/pristine.tgz"

# The guarantee: the copy is hashed before anything runs on it.
instabox ssh "$BOX" -- "cd $REMOTE_REPO && node scripts/box-pristine.mjs verify $REMOTE_PRISTINE" || {
	say "the pristine copy in $BOX did not verify; nothing was run"
	exit 1
}

instabox ssh "$BOX" -- "cd $REMOTE_REPO && npm ci > /tmp/box-ci.log 2>&1; echo \"CI_EXIT=\$?\"
export GENTLE_PI_ROOT=$REMOTE_PRISTINE
npm run typecheck > /tmp/box-typecheck.log 2>&1; echo \"TYPECHECK_EXIT=\$?\"; grep -c 'error TS' /tmp/box-typecheck.log || true
npm test > /tmp/box-suite.log 2>&1; echo \"SUITE_EXIT=\$?\"
grep -E '^# (tests|pass|fail|skipped)' /tmp/box-suite.log
echo '--- digest tests ---'
grep -E '^(ok|not ok) [0-9]+ - (every pinned digest|every accepted digest|every digest that shipped)' /tmp/box-suite.log || echo 'NOT RUN'
echo '--- skipped ---'
grep -oE '^ok [0-9]+ - .+# SKIP .*' /tmp/box-suite.log | sed -E 's/^ok [0-9]+ - //' | cut -c1-70 || true
echo '--- failures ---'
grep -E '^not ok' /tmp/box-suite.log || echo 'none'"
