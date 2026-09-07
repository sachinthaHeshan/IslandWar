# Admin Dashboard Design

Date: 2026-09-07

## Goal

Give seeded admin accounts a `/dashboard` page that shows live game state and lets them manage users, groups, matches, and sessions. Regular players cannot register as admin or use these APIs.

## Out of scope

- Promoting an existing player to admin from the UI
- Password recovery, email, or a second auth system
- Deleting match history (aborting a running match is in scope)
- Kicking a player from a lobby without revoking their session
- Loading the Three.js game on `/dashboard`

## Schema

Extend `users` (applied on API startup with `IF NOT EXISTS` so existing databases migrate):

- `is_admin BOOLEAN NOT NULL DEFAULT false`
- `deactivated_at TIMESTAMPTZ` — `NULL` means active

Public `/api/register` always inserts `is_admin = false`. Only the seed command can set `is_admin`.

`/api/me` and login responses include `isAdmin`. Deactivated users fail login the same way a wrong password does (same 401 copy, dummy bcrypt compare so existence is not leaked).

Existing foreign keys do not all cascade from `users`. User delete must, in order: delete groups they own (cascades that group's matches and scores), delete remaining `match_scores` rows for the user, then delete the user (sessions and memberships already cascade).

## Seed command

```
just seed-admin-user <username> <password>
```

Loads `.env` for `DATABASE_URL`, then runs `go run . seed-admin <username> <password>` from `server/`. Username must match `^[a-z0-9_]{3,20}$` (lowercased). Password must be 10–72 bytes. Upsert: create the user if missing, otherwise update `password_hash` and set `is_admin = true`. Re-running on the same username is safe. The HTTP server does not start for this subcommand.

## Routing and page

`frontend/dashboard/index.html` is a second Vite entry. Production nginx `try_files $uri $uri/ /index.html` already serves `/dashboard` from `dashboard/index.html`. Vite build must list this HTML file as an input so the file exists in `dist/`. The page does not import Three.js or game modules.

The dashboard uses the existing HttpOnly `session` cookie and `/api/login`, with `credentials: 'include'` and the same `VITE_API_ORIGIN` pattern as `frontend/src/multiplayer.js`. After login, it calls `/api/me`. If `isAdmin` is false, show an error, do not call `/api/admin/*`, and offer sign out. Admins see the ops UI.

Visual language matches the multiplayer lobby: olive/lime, Barlow Condensed / DM Sans, existing button classes.

## Admin APIs

All `/api/admin/*` routes require a valid session and `is_admin`. Non-admins get 403. CORS allow-methods include GET, POST, DELETE, OPTIONS.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/admin/overview` | Counts: live WebSocket players (connected peers across rooms), unexpired sessions, users, groups, running matches, finished matches |
| GET | `/api/admin/users` | All users: id, username, isAdmin, deactivatedAt, createdAt |
| POST | `/api/admin/users/{id}/deactivate` | Set `deactivated_at = now()`, delete that user's sessions, disconnect them from the hub |
| POST | `/api/admin/users/{id}/activate` | Set `deactivated_at = NULL` |
| DELETE | `/api/admin/users/{id}` | Delete the user after owned-group cleanup (see Schema) |
| GET | `/api/admin/groups` | All groups with owner username, members, createdAt |
| DELETE | `/api/admin/groups/{id}` | Delete the group; close and remove any live room |
| GET | `/api/admin/matches` | All matches with group name, status, timestamps, per-player kills/deaths |
| POST | `/api/admin/matches/{id}/abort` | If status is `running`, set `aborted` + `ended_at` and close the room. If not running, return 409. Do not write scores. |
| GET | `/api/admin/sessions` | Unexpired sessions: `id` (the `token_hash` value), username, expiresAt |
| DELETE | `/api/admin/sessions/{id}` | Delete the row whose `token_hash` equals `id`, then disconnect that user if connected |

Sessions are keyed by `token_hash`. That hash is the JSON `id` used to revoke. The dashboard shows username and expiry only — not the hash.

### Guardrails

- An admin cannot deactivate or delete themselves.
- An admin cannot deactivate or delete the last remaining admin.
- Confirm dialogs on the dashboard before every mutation.

## Dashboard layout

1. Login form (username / password) when there is no admin session.
2. Header with signed-in username and sign out (`POST /api/logout`).
3. Stat cards from overview, refreshed every 5 seconds while the page is visible.
4. Tables: Users, Groups, Matches, Sessions, each with the actions listed above. API error strings render above the tables.

## Tests

Extend `server/integration_test.go` (skipped unless `TEST_DATABASE_URL` is set):

- Non-admin session on `/api/admin/overview` returns 403.
- A user with `is_admin` set in the test database can list users, groups, matches, and sessions.
- Admin can deactivate a player; that player cannot log in; activate restores login.
- Admin can delete a player and a group.
- Admin can abort a running match and revoke a session.
- Admin cannot delete or deactivate themselves.

Unit-test the last-admin and self-protection rules if they are extracted as helpers; otherwise cover them in the integration test.

## Files

- `server/schema.sql` — new columns
- `server/auth.go` — `isAdmin` on `User`, login blocks deactivated accounts
- `server/admin.go` — admin routes and handlers (new)
- `server/main.go` — `seed-admin` subcommand, route registration, CORS methods
- `server/game.go` — hub helpers for live count, disconnect, abort room by match/group
- `server/integration_test.go` — admin cases
- `justfile` — `seed-admin-user`
- `frontend/dashboard/index.html`, `frontend/dashboard/dashboard.js`, `frontend/dashboard/dashboard.css`
- `frontend/vite.config.js` — second HTML input
- `README.md` — how to seed and open `/dashboard`
