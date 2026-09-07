# Island War

A Three.js third-person browser shooter with a Go multiplayer server and PostgreSQL accounts, private groups, invitations, and match history. Solo target practice remains available without signing in.

## Play multiplayer

1. Open the game and click **Multiplayer**.
2. Create an account (3–20 character username, 10–72 byte password).
3. Create a group, search for your friend's username, and invite them.
4. Your friend signs in from another browser profile or device, opens Multiplayer, and accepts the invitation.
5. Both players select the group and click **Connect to lobby**. The group owner starts the round.
6. Click **Deploy to island** to capture the mouse and play.

A group holds 2–8 players, including pending invitations in its capacity. Accounts use case-insensitive usernames. One browser connection controls each account; another connection replaces the first. Friends cannot enter a running round unless they were in its starting roster. Reconnecting restores the current character and scores.

Rounds last **3 minutes**. Each player has 100 health. A hit deals 25 damage; each elimination earns 1 point. Death adds to the death count and triggers a 3-second respawn. Respawning grants 2 seconds of protection, which ends when shooting. Highest elimination score wins; equal scores tie. The owner can start another round after scores are saved. Escape releases the mouse but **does not pause a multiplayer match**. Disconnected players cannot move or be hit; their scores remain in the round.

**Controls:** WASD move · mouse aim · left click shoot · Shift sprint · R reload · Escape release mouse. Twelve-round magazine, unlimited reserve. Keyboard and mouse required; touch controls are not implemented.

## Run everything with Docker

Requires Docker Compose.

```sh
cp .env.example .env
# Edit POSTGRES_PASSWORD in .env before running.
docker compose up --build
```

Open **https://island-war.orionlabs.lk**. Nginx serves the built frontend; the browser calls **https://island-war-api.orionlabs.lk** for `/api` and WebSockets. Locally those map to ports **8200** and **8201**. Point DNS (and TLS termination) at those ports. PostgreSQL uses a persistent Docker volume and is bound to localhost. `docker compose down` stops the services and preserves the database volume. The root `Dockerfile` still builds a single image that serves both from Go if you want that layout.

Set `GAME_ORIGIN` to the exact frontend URL (`https://island-war.orionlabs.lk`) and `API_ORIGIN` to the exact API URL (`https://island-war-api.orionlabs.lk`), then rebuild so Vite bakes the API host into the client. For local Vite development, `APP_ORIGINS` accepts a comma-separated list of exact browser origins. Only configured browser origins are accepted. Internet hosting should use HTTPS and `COOKIE_SECURE=true`; provide a PostgreSQL connection with the appropriate TLS settings. The server supports WebSocket upgrades and needs a persistent Go process, so a static frontend host alone is insufficient.

## Local development

Requires Node.js 22+, Go 1.23+, and PostgreSQL 17 (or the Compose database).

After PostgreSQL is running and `.env` contains `DATABASE_URL`, start both the Go API and Vite frontend with one command:

```sh
just run-all
```

The recipe loads `.env`, starts Go on port 8080, starts Vite on port 5173, and stops both processes together when you press Ctrl-C. Vite requires port 5173 and exits if it is already occupied; it will not silently switch to another port that is missing from the API origin allowlist. Use the existing server at http://localhost:5173 when it is already running.

```sh
cp .env.example .env
cd frontend
npm install
cd ..
docker compose up -d postgres
```

Start Go from the project root:

```sh
set -a
. ./.env
set +a
cd server
go run .
```

In a second terminal from the project root:

```sh
cd frontend
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api`, including WebSockets, to Go on port 8080. Restart Vite after changing its configuration. Go applies the idempotent schema on startup; the database must exist first. `.env` is read by Compose or by the shell commands above, not automatically by Go.

### Existing native database prepared on this machine

An isolated development PostgreSQL cluster was created at `/private/tmp/island-war-pg`, listening only on `127.0.0.1:55432`. It contains `islandwar` and `islandwar_test`, owned by `islandwar`. This temporary local cluster uses trust authentication and must not be exposed to other hosts. Temporary-directory data may be removed by the operating system; use the Compose volume for durable development data.

To restart it if needed:

```sh
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /private/tmp/island-war-pg -l /private/tmp/island-war-pg.log -o '-h 127.0.0.1 -p 55432 -k /private/tmp' start
```

Then start the Go server:

```sh
cd server
DATABASE_URL='postgres://islandwar@127.0.0.1:55432/islandwar?sslmode=disable' APP_ORIGIN='http://localhost:5173' go run .
```

## Build and tests

```sh
cd frontend
npm run build
cd ..
cd server
go test -race ./...
go vet ./...
```

Run the database-backed integration test against a **dedicated test database**:

```sh
cd server
TEST_DATABASE_URL='postgres://islandwar@127.0.0.1:55432/islandwar_test?sslmode=disable' go test -race -v ./...
```

The integration test creates uniquely named test accounts and groups, then exercises registration/login failures, username search, invitations, membership checks, same-origin protection, two WebSocket clients, owner-only match start, network shooting, timeout, score persistence, and logout. It is skipped when `TEST_DATABASE_URL` is unset. Test data remains in the isolated test database. Unit tests cover hit detection, cover, spawn protection, cooldowns, reloads, movement limits, stale input, and timeout.

## Design

- `server/auth.go`: bcrypt passwords; opaque HttpOnly, SameSite session cookies; hashed session tokens in PostgreSQL; authentication/search rate limits.
- `server/groups.go`: group ownership, username invitations, explicit acceptance, member limits, owner transfer on leaving, and match history.
- `server/game.go`: 20 Hz authoritative simulation and snapshots over authenticated WebSockets. Clients send movement intentions, aim, shoot, and reload requests. Go owns positions, movement speed, island/crate collision, hit detection, ammunition, health, respawns, scores, and timeout. Client-supplied positions, health, and scores are never accepted.
- `server/schema.sql`: users, sessions, groups, memberships, matches, and score records.
- `frontend/src/multiplayer.js`: account/group lobby, invitation flow, WebSocket connection, scoreboard, history, and error states.
- `frontend/src/main.js`: procedural Three.js world, local/remote character rendering, interpolation, effects, input, and solo mode.

The authoritative hitboxes are simple standing boxes; crates provide server-side cover. Decorative palms, foliage, and boundary posts do not block multiplayer shots. There is no lag compensation or client movement prediction yet; the current client interpolates server positions. Active rooms run in one Go process. Restarting it aborts unfinished rounds; accounts and completed scores persist. Do not run multiple game replicas against the same database without adding shared room ownership. Pending invitations count toward group capacity; invitees can decline, and owners cannot leave during a running/saving round. When the last accepted member leaves a group it is deleted, including its match history. Password recovery and email verification are not included.

Environment variables are documented in `.env.example`. `ADDR` defaults to `:8080`, `APP_ORIGIN` to `http://localhost:5173`, and `STATIC_DIR` to `../dist` relative to the Go process working directory. Built assets are output to `dist/`. Fonts use Google Fonts with local fallbacks.
# IslandWar
