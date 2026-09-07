set shell := ["bash", "-cu"]

# Start the Go API and the Vite frontend together.
# Set DATABASE_URL (and APP_ORIGIN if needed) in .env before running this.
run-all:
    #!/usr/bin/env bash
    set -euo pipefail

    if [[ -f .env ]]; then
        set -a
        source .env
        set +a
    fi

    cleanup() {
        trap - INT TERM EXIT
        kill 0 2>/dev/null || true
    }
    trap cleanup INT TERM EXIT

    (cd server && go run .) &
    (cd frontend && npm run dev) &
    wait
