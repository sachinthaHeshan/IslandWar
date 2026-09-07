set shell := ["bash", "-cu"]

# Full Docker stack on local ports 8200 (frontend) and 8201 (API).
run-docker:
    docker network inspect dokploy-network >/dev/null 2>&1 || docker network create dokploy-network
    docker compose -f compose.yaml -f compose.local.yaml up --build

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
