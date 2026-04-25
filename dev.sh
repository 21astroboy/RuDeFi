#!/usr/bin/env bash
# dev.sh — quick rebuild + restart loop for cryptoapp.
#
# Usage:
#   ./dev.sh             # build (incremental) + restart serve on default port
#   ./dev.sh scan 0x...  # build + run a one-off scan
#   ./dev.sh build       # just build
#   ./dev.sh stop        # stop any running server
#   ./dev.sh ui          # don't rebuild, just (re)start the server. UI changes
#                        # are live without a rebuild — only this is needed.
#
# Tip: keep this terminal open. After Claude edits a C++ file, hit ↑ Enter
# to repeat the last `./dev.sh` command. UI edits don't even need that —
# just refresh the browser.

set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8787}"
BIN="./build/cryptoapp"

stop_running() {
    # Match by full command line; safer than just "cryptoapp".
    pkill -f "build/cryptoapp serve" 2>/dev/null || true
    sleep 0.2
}

ensure_configured() {
    if [[ ! -d build ]]; then
        echo "→ first build: configuring CMake…"
        cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
    fi
}

cmd="${1:-serve}"

case "$cmd" in
    build)
        ensure_configured
        cmake --build build -j
        ;;
    stop)
        stop_running
        echo "stopped"
        ;;
    ui)
        stop_running
        if [[ ! -x "$BIN" ]]; then
            echo "binary not found — running build first"
            ensure_configured
            cmake --build build -j
        fi
        exec "$BIN" serve --port "$PORT"
        ;;
    scan)
        shift
        ensure_configured
        cmake --build build -j
        exec "$BIN" scan "$@"
        ;;
    serve|"")
        ensure_configured
        cmake --build build -j
        stop_running
        echo "→ http://127.0.0.1:${PORT}/"
        exec "$BIN" serve --port "$PORT"
        ;;
    *)
        echo "unknown command: $cmd"
        echo "use:  ./dev.sh [serve|build|ui|stop|scan 0x…]"
        exit 1
        ;;
esac
