# Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seeded admins get a `/dashboard` page and `/api/admin/*` APIs to view live counts and manage users, groups, matches, and sessions.

**Architecture:** `is_admin` and `deactivated_at` on `users`. Session cookie auth plus an admin wrapper. Separate Vite HTML entry at `frontend/dashboard/` so `/dashboard` does not load Three.js. `just seed-admin-user <user> <pass>` runs `go run . seed-admin`.

**Tech Stack:** Go 1.23, PostgreSQL 17, pgx, vanilla JS, Vite 8, just.

## Global Constraints

- Admin flag cannot be set via `/api/register`.
- Deactivated login uses the same 401 copy as a wrong password, with dummy bcrypt compare.
- Dashboard uses `credentials: 'include'` and `VITE_API_ORIGIN` like `frontend/src/multiplayer.js`.
- An admin cannot deactivate or delete themselves or the last remaining admin.
- User delete: owned groups first, then leftover `match_scores`, then the user.
- Do not commit unless the user asks.
- Match existing Go style: short names, `fail`/`reply` helpers, no extra frameworks.

## File map

- `server/schema.sql` — columns
- `server/auth.go` — `User.IsAdmin`, deactivated login, auth SELECT
- `server/admin.go` — admin HTTP handlers
- `server/admin_test.go` — integration tests
- `server/main.go` — seed-admin, routes, CORS DELETE
- `server/game.go` — `liveCount`, `closeGroup`, `abortMatch`
- `justfile` — `seed-admin-user`
- `frontend/dashboard/index.html`, `dashboard.js`, `dashboard.css`
- `frontend/vite.config.js`, `frontend/Dockerfile`
- `README.md`

---

### Task 1: Schema and auth identity

**Files:**
- Modify: `server/schema.sql`
- Modify: `server/auth.go`
- Modify: `server/main.go` (`User` struct)
- Test: `server/admin_test.go` (start file; login/me cases)

**Produces:**
- `User` JSON field `isAdmin bool`
- Columns `users.is_admin`, `users.deactivated_at`
- Login 401 for deactivated accounts

- [ ] **Step 1:** Add columns to `schema.sql` both in `CREATE TABLE users` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- [ ] **Step 2:** Write `TestAdminAuth` that registers a user, asserts `/api/me` has `"isAdmin":false`, promotes via SQL, asserts true, deactivates, asserts login 401 with `"Incorrect username or password"`.
- [ ] **Step 3:** Run the test; expect fail on missing column / missing `isAdmin`.
- [ ] **Step 4:** Update `User`, register/login/auth queries, deactivated login path.
- [ ] **Step 5:** Re-run until pass. Do not commit.

### Task 2: Admin APIs and hub helpers

**Files:**
- Create: `server/admin.go`
- Modify: `server/game.go`, `server/main.go` routes + CORS
- Test: `server/admin_test.go`

**Produces:**
- `func (s *Server) requireAdmin(next http.HandlerFunc) http.Handler`
- Routes listed in the spec
- `func (h *Hub) liveCount() int`
- `func (h *Hub) closeGroup(gid int64)`
- `func (h *Hub) abortMatch(matchID int64)`

- [ ] **Step 1:** Extend integration tests: non-admin 403 on GET `/api/admin/overview`; admin lists users/groups/matches/sessions; deactivate/activate; delete user and group; abort running match; revoke session; self-deactivate and self-delete 403; last-admin 403.
- [ ] **Step 2:** Run tests; expect 404/403 on missing routes.
- [ ] **Step 3:** Implement handlers and hub helpers. CORS `Allow-Methods` includes DELETE.
- [ ] **Step 4:** Tests pass. Do not commit.

### Task 3: Seed command

**Files:**
- Modify: `server/main.go`
- Modify: `justfile`
- Test: `server/admin_test.go` calling `seedAdminUser(ctx, db, name, pass)` extracted from main so tests can invoke it without starting HTTP.

**Produces:**
- `func seedAdminUser(ctx context.Context, db *pgxpool.Pool, username, password string) error`
- `just seed-admin-user username password`

- [ ] **Step 1:** Test upsert creates admin, second call updates password and keeps `is_admin`.
- [ ] **Step 2:** Implement seed + just recipe (load `.env`, `cd server && go run . seed-admin "{{username}}" "{{password}}"`).
- [ ] **Step 3:** Tests pass. Do not commit.

### Task 4: Dashboard page

**Files:**
- Create: `frontend/dashboard/index.html`, `dashboard.js`, `dashboard.css`
- Modify: `frontend/vite.config.js` (second rollup input)
- Modify: `frontend/Dockerfile` (COPY dashboard)
- Modify: `README.md`

**Produces:** `/dashboard` login + ops UI matching lobby look, polling overview every 5s, confirm before mutations.

- [ ] **Step 1:** Vite MPA input `dashboard/index.html`.
- [ ] **Step 2:** Page: login, stats, four tables, sign out. Non-admin sees error and no admin fetches.
- [ ] **Step 3:** README seed + open `/dashboard`. Verify in browser against local Vite if the stack is up.

## Spec coverage

| Spec item | Task |
| --- | --- |
| Schema columns | 1 |
| Login / me isAdmin, deactivated 401 | 1 |
| Admin APIs, guardrails, abort, sessions | 2 |
| Seed just command | 3 |
| `/dashboard` page, Vite, nginx/Dockerfile | 4 |
| README | 4 |
