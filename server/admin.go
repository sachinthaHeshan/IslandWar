package main

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type adminOverview struct {
	LivePlayers     int `json:"livePlayers"`
	Sessions        int `json:"sessions"`
	Users           int `json:"users"`
	Groups          int `json:"groups"`
	RunningMatches  int `json:"runningMatches"`
	FinishedMatches int `json:"finishedMatches"`
}

type adminUserRow struct {
	ID            int64      `json:"id"`
	Username      string     `json:"username"`
	IsAdmin       bool       `json:"isAdmin"`
	DeactivatedAt *time.Time `json:"deactivatedAt"`
	CreatedAt     time.Time  `json:"createdAt"`
}

type adminGroupRow struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	OwnerID   int64     `json:"ownerId"`
	Owner     string    `json:"owner"`
	CreatedAt time.Time `json:"createdAt"`
	Members   []Member  `json:"members"`
}

type adminScoreRow struct {
	UserID   int64  `json:"userId"`
	Username string `json:"username"`
	Kills    int    `json:"kills"`
	Deaths   int    `json:"deaths"`
}

type adminMatchRow struct {
	ID        int64           `json:"id"`
	GroupID   int64           `json:"groupId"`
	Group     string          `json:"group"`
	Status    string          `json:"status"`
	StartedAt time.Time       `json:"startedAt"`
	EndedAt   *time.Time      `json:"endedAt"`
	Scores    []adminScoreRow `json:"scores"`
}

type adminSessionRow struct {
	ID        string    `json:"id"`
	UserID    int64     `json:"userId"`
	Username  string    `json:"username"`
	ExpiresAt time.Time `json:"expiresAt"`
}

func (s *Server) requireAdmin(next http.HandlerFunc) http.Handler {
	return s.auth(func(w http.ResponseWriter, r *http.Request) {
		if !user(r).IsAdmin {
			fail(w, 403, "Admin access required")
			return
		}
		next(w, r)
	})
}

func parseID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, e := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if e != nil || id < 1 {
		fail(w, 400, "Invalid id")
		return 0, false
	}
	return id, true
}

func seedAdminUser(ctx context.Context, db *pgxpool.Pool, username, password string) error {
	username = strings.ToLower(strings.TrimSpace(username))
	if !usernamePattern.MatchString(username) || len(password) < 10 || len(password) > 72 {
		return fmt.Errorf("use a 3–20 character username (letters, numbers, underscore) and a 10–72 byte password")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = db.Exec(ctx, `INSERT INTO users(username,password_hash,is_admin) VALUES($1,$2,true)
		ON CONFLICT (username) DO UPDATE SET password_hash=excluded.password_hash, is_admin=true, deactivated_at=NULL`, username, string(hash))
	return err
}

func (s *Server) protectAdminTarget(ctx context.Context, actor User, targetID int64) (int, string) {
	if targetID == actor.ID {
		return 403, "You cannot change your own admin account"
	}
	var isAdmin bool
	if s.db.QueryRow(ctx, "SELECT is_admin FROM users WHERE id=$1", targetID).Scan(&isAdmin) != nil {
		return 404, "User not found"
	}
	if !isAdmin {
		return 0, ""
	}
	var n int
	_ = s.db.QueryRow(ctx, "SELECT count(*) FROM users WHERE is_admin AND deactivated_at IS NULL").Scan(&n)
	if n <= 1 {
		return 403, "Cannot remove the last admin"
	}
	return 0, ""
}

func (s *Server) adminOverview(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	out := adminOverview{LivePlayers: s.hub.liveCount()}
	_ = s.db.QueryRow(ctx, "SELECT count(*) FROM sessions WHERE expires_at>now()").Scan(&out.Sessions)
	_ = s.db.QueryRow(ctx, "SELECT count(*) FROM users").Scan(&out.Users)
	_ = s.db.QueryRow(ctx, "SELECT count(*) FROM groups").Scan(&out.Groups)
	_ = s.db.QueryRow(ctx, "SELECT count(*) FROM matches WHERE status='running'").Scan(&out.RunningMatches)
	_ = s.db.QueryRow(ctx, "SELECT count(*) FROM matches WHERE status='finished'").Scan(&out.FinishedMatches)
	reply(w, 200, out)
}

func (s *Server) adminListUsers(w http.ResponseWriter, r *http.Request) {
	rows, e := s.db.Query(r.Context(), "SELECT id,username,is_admin,deactivated_at,created_at FROM users ORDER BY id")
	if e != nil {
		fail(w, 500, "Could not load users")
		return
	}
	defer rows.Close()
	list := []adminUserRow{}
	for rows.Next() {
		var u adminUserRow
		if rows.Scan(&u.ID, &u.Username, &u.IsAdmin, &u.DeactivatedAt, &u.CreatedAt) != nil {
			fail(w, 500, "Could not load users")
			return
		}
		list = append(list, u)
	}
	reply(w, 200, list)
}

func (s *Server) adminDeactivateUser(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	if status, msg := s.protectAdminTarget(r.Context(), user(r), id); status != 0 {
		fail(w, status, msg)
		return
	}
	tag, e := s.db.Exec(r.Context(), "UPDATE users SET deactivated_at=now() WHERE id=$1", id)
	if e != nil {
		fail(w, 500, "Could not deactivate user")
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 404, "User not found")
		return
	}
	_, _ = s.db.Exec(r.Context(), "DELETE FROM sessions WHERE user_id=$1", id)
	s.hub.disconnect(id)
	reply(w, 200, map[string]bool{"ok": true})
}

func (s *Server) adminActivateUser(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	tag, e := s.db.Exec(r.Context(), "UPDATE users SET deactivated_at=NULL WHERE id=$1", id)
	if e != nil {
		fail(w, 500, "Could not activate user")
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 404, "User not found")
		return
	}
	reply(w, 200, map[string]bool{"ok": true})
}

func (s *Server) adminDeleteUser(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	if status, msg := s.protectAdminTarget(r.Context(), user(r), id); status != 0 {
		fail(w, status, msg)
		return
	}
	ctx := r.Context()
	rows, e := s.db.Query(ctx, "SELECT id FROM groups WHERE owner_id=$1", id)
	if e != nil {
		fail(w, 500, "Could not delete user")
		return
	}
	var gids []int64
	for rows.Next() {
		var gid int64
		if rows.Scan(&gid) == nil {
			gids = append(gids, gid)
		}
	}
	rows.Close()
	tx, e := s.db.Begin(ctx)
	if e != nil {
		fail(w, 500, "Could not delete user")
		return
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "DELETE FROM groups WHERE owner_id=$1", id); e != nil {
		fail(w, 500, "Could not delete user")
		return
	}
	if _, e = tx.Exec(ctx, "DELETE FROM match_scores WHERE user_id=$1", id); e != nil {
		fail(w, 500, "Could not delete user")
		return
	}
	tag, e := tx.Exec(ctx, "DELETE FROM users WHERE id=$1", id)
	if e != nil || tag.RowsAffected() == 0 {
		fail(w, 404, "User not found")
		return
	}
	if tx.Commit(ctx) != nil {
		fail(w, 500, "Could not delete user")
		return
	}
	for _, gid := range gids {
		s.hub.closeGroup(gid)
	}
	s.hub.disconnect(id)
	reply(w, 200, map[string]bool{"ok": true})
}

func (s *Server) adminListGroups(w http.ResponseWriter, r *http.Request) {
	rows, e := s.db.Query(r.Context(), "SELECT g.id,g.name,g.owner_id,u.username,g.created_at FROM groups g JOIN users u ON u.id=g.owner_id ORDER BY g.id DESC")
	if e != nil {
		fail(w, 500, "Could not load groups")
		return
	}
	groups := []adminGroupRow{}
	for rows.Next() {
		var g adminGroupRow
		if rows.Scan(&g.ID, &g.Name, &g.OwnerID, &g.Owner, &g.CreatedAt) != nil {
			rows.Close()
			fail(w, 500, "Could not load groups")
			return
		}
		g.Members = []Member{}
		groups = append(groups, g)
	}
	rows.Close()
	for i := range groups {
		members, e := s.db.Query(r.Context(), "SELECT u.id,u.username,m.status FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=$1 ORDER BY u.username", groups[i].ID)
		if e != nil {
			fail(w, 500, "Could not load members")
			return
		}
		for members.Next() {
			var m Member
			if members.Scan(&m.ID, &m.Username, &m.Status) == nil {
				groups[i].Members = append(groups[i].Members, m)
			}
		}
		members.Close()
	}
	reply(w, 200, groups)
}

func (s *Server) adminDeleteGroup(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	tag, e := s.db.Exec(r.Context(), "DELETE FROM groups WHERE id=$1", id)
	if e != nil {
		fail(w, 500, "Could not delete group")
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 404, "Group not found")
		return
	}
	s.hub.closeGroup(id)
	reply(w, 200, map[string]bool{"ok": true})
}

func (s *Server) adminListMatches(w http.ResponseWriter, r *http.Request) {
	rows, e := s.db.Query(r.Context(), "SELECT m.id,m.group_id,g.name,m.status,m.started_at,m.ended_at FROM matches m JOIN groups g ON g.id=m.group_id ORDER BY m.id DESC")
	if e != nil {
		fail(w, 500, "Could not load matches")
		return
	}
	list := []adminMatchRow{}
	for rows.Next() {
		var m adminMatchRow
		if rows.Scan(&m.ID, &m.GroupID, &m.Group, &m.Status, &m.StartedAt, &m.EndedAt) != nil {
			rows.Close()
			fail(w, 500, "Could not load matches")
			return
		}
		m.Scores = []adminScoreRow{}
		list = append(list, m)
	}
	rows.Close()
	for i := range list {
		scores, e := s.db.Query(r.Context(), "SELECT s.user_id,u.username,s.kills,s.deaths FROM match_scores s JOIN users u ON u.id=s.user_id WHERE s.match_id=$1 ORDER BY s.kills DESC, u.username", list[i].ID)
		if e != nil {
			fail(w, 500, "Could not load scores")
			return
		}
		for scores.Next() {
			var row adminScoreRow
			if scores.Scan(&row.UserID, &row.Username, &row.Kills, &row.Deaths) == nil {
				list[i].Scores = append(list[i].Scores, row)
			}
		}
		scores.Close()
	}
	reply(w, 200, list)
}

func (s *Server) adminAbortMatch(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	tag, e := s.db.Exec(r.Context(), "UPDATE matches SET status='aborted', ended_at=now() WHERE id=$1 AND status='running'", id)
	if e != nil {
		fail(w, 500, "Could not abort match")
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 409, "Match is not running")
		return
	}
	s.hub.abortMatch(id)
	reply(w, 200, map[string]bool{"ok": true})
}

func (s *Server) adminListSessions(w http.ResponseWriter, r *http.Request) {
	rows, e := s.db.Query(r.Context(), "SELECT s.token_hash,s.user_id,u.username,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.expires_at>now() ORDER BY s.expires_at")
	if e != nil {
		fail(w, 500, "Could not load sessions")
		return
	}
	defer rows.Close()
	list := []adminSessionRow{}
	for rows.Next() {
		var row adminSessionRow
		if rows.Scan(&row.ID, &row.UserID, &row.Username, &row.ExpiresAt) != nil {
			fail(w, 500, "Could not load sessions")
			return
		}
		list = append(list, row)
	}
	reply(w, 200, list)
}

func (s *Server) adminRevokeSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if len(id) != 64 {
		fail(w, 400, "Invalid session")
		return
	}
	var uid int64
	e := s.db.QueryRow(r.Context(), "DELETE FROM sessions WHERE token_hash=$1 RETURNING user_id", id).Scan(&uid)
	if e != nil {
		fail(w, 404, "Session not found")
		return
	}
	s.hub.disconnect(uid)
	reply(w, 200, map[string]bool{"ok": true})
}
