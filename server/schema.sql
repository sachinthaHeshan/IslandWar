CREATE TABLE IF NOT EXISTS users (
 id BIGSERIAL PRIMARY KEY,
 username TEXT NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,20}$'),
 password_hash TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS groups (
 id BIGSERIAL PRIMARY KEY,
 name TEXT NOT NULL,
 owner_id BIGINT NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS group_members (
 group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK(status IN ('invited', 'accepted')),
 PRIMARY KEY(group_id, user_id)
);
CREATE TABLE IF NOT EXISTS matches (
 id BIGSERIAL PRIMARY KEY,
 group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
 started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 ended_at TIMESTAMPTZ,
 status TEXT NOT NULL CHECK(status IN ('running','finished','aborted'))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_running_match_per_group ON matches(group_id) WHERE status='running';
CREATE TABLE IF NOT EXISTS match_scores (
 match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
 user_id BIGINT NOT NULL REFERENCES users(id),
 kills INTEGER NOT NULL DEFAULT 0,
 deaths INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(match_id, user_id)
);
