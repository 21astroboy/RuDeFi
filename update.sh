#!/usr/bin/env bash
# Compatibility entry point for existing installations.
set -euo pipefail
exec "$(dirname "$0")/scripts/update.sh" "$@"
