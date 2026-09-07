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

# Upsert an admin account. Usage: just seed-admin-user admin SuperSecret123
seed-admin-user username password:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -f .env ]]; then
        set -a
        source .env
        set +a
    fi
    if [[ -z "${DATABASE_URL:-}" ]]; then
        echo "DATABASE_URL is required; see .env.example" >&2
        exit 1
    fi
    (cd server && go run . seed-admin "{{username}}" "{{password}}")

# Rebuild the Vite game and copy it into the Android and iOS projects.
# Override the API with VITE_API_ORIGIN=http://... just mobile-sync
mobile-sync:
    #!/usr/bin/env bash
    set -euo pipefail
    export VITE_API_ORIGIN="${VITE_API_ORIGIN:-https://island-war-api.orionlabs.lk}"
    npm --prefix frontend run build
    (cd mobile && npx cap sync)

# Open the Android project in Android Studio.
mobile-android:
    cd mobile && npx cap open android

# Open the iOS project in Xcode.
mobile-ios:
    cd mobile && npx cap open ios
