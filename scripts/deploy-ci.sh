#!/usr/bin/env bash
# Forced SSH command: accepts only the verified main commit, never arbitrary shell.
set -euo pipefail
cd "$(dirname "$0")/.."
REQUESTED_SHA="${SSH_ORIGINAL_COMMAND:-${1:-}}"
[[ "$REQUESTED_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a commit SHA' >&2; exit 1; }
exec 9>/tmp/rudefi-deploy.lock
flock -n 9 || { echo 'Another deployment is running' >&2; exit 1; }
git fetch --quiet origin main
[[ "$REQUESTED_SHA" == "$(git rev-parse origin/main)" ]] || { echo 'Only current main can be deployed' >&2; exit 1; }
# GitHub already gates this SSH request on a successful Checks workflow.
git merge --ff-only origin/main
export RUDEFI_VERIFIED_SHA="$REQUESTED_SHA"
exec bash scripts/update.sh
