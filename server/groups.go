package main

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type Member struct {
	User
	Status string `json:"status"`
}
type Group struct {
	ID      int64    `json:"id"`
	Name    string   `json:"name"`
	OwnerID int64    `json:"ownerId"`
	Status  string   `json:"status"`
	Members []Member `json:"members"`
}

func (s *Server) listGroups(w http.ResponseWriter, r *http.Request) {
	rows, e := s.db.Query(r.Context(), "SELECT g.id,g.name,g.owner_id,m.status FROM groups g JOIN group_members m ON m.group_id=g.id WHERE m.user_id=$1 ORDER BY g.id DESC", user(r).ID)
	if e != nil {
		fail(w, 500, "Could not load groups")
		return
	}
	groups := []Group{}
	for rows.Next() {
		var g Group
		if rows.Scan(&g.ID, &g.Name, &g.OwnerID, &g.Status) != nil {
			rows.Close()
			fail(w, 500, "Could not load groups")
			return
		}
		g.Members = []Member{}
		groups = append(groups, g)
	}
	rows.Close()
	for i := range groups {
		g := &groups[i]
		members, e := s.db.Query(r.Context(), "SELECT u.id,u.username,m.status FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=$1 ORDER BY u.username", g.ID)
		if e != nil {
			fail(w, 500, "Could not load members")
			return
		}
		for members.Next() {
			var m Member
			if members.Scan(&m.ID, &m.Username, &m.Status) == nil {
				g.Members = append(g.Members, m)
			}
		}
		members.Close()
	}
	reply(w, 200, groups)
}
func (s *Server) createGroup(w http.ResponseWriter, r *http.Request) {
	if !s.allowed(r, "groups", 20) {
		fail(w, 429, "Please slow down")
		return
	}
	var v struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &v) {
		return
	}
	v.Name = strings.TrimSpace(v.Name)
	if len(v.Name) < 2 || len(v.Name) > 40 {
		fail(w, 400, "Group name must be 2–40 characters")
		return
	}
	tx, e := s.db.Begin(r.Context())
	if e != nil {
		fail(w, 500, "Could not create group")
		return
	}
	defer tx.Rollback(r.Context())
	// Serialize group limits per account.
	var id int64
	if e = tx.QueryRow(r.Context(), "SELECT id FROM users WHERE id=$1 FOR UPDATE", user(r).ID).Scan(&id); e != nil {
		fail(w, 500, "Could not create group")
		return
	}
	var count int
	_ = tx.QueryRow(r.Context(), "SELECT count(*) FROM groups WHERE owner_id=$1", id).Scan(&count)
	if count >= 10 {
		fail(w, 409, "You can own up to 10 groups. Leave one to make space.")
		return
	}
	if e = tx.QueryRow(r.Context(), "INSERT INTO groups(name,owner_id) VALUES($1,$2) RETURNING id", v.Name, id).Scan(&id); e != nil {
		fail(w, 500, "Could not create group")
		return
	}
	if _, e = tx.Exec(r.Context(), "INSERT INTO group_members VALUES($1,$2,'accepted')", id, user(r).ID); e != nil {
		fail(w, 500, "Could not create group")
		return
	}
	if tx.Commit(r.Context()) != nil {
		fail(w, 500, "Could not create group")
		return
	}
	reply(w, 201, map[string]int64{"id": id})
}
func lockedGroup(ctx context.Context, tx pgx.Tx, id int64) (int64, error) {
	var owner int64
	e := tx.QueryRow(ctx, "SELECT owner_id FROM groups WHERE id=$1 FOR UPDATE", id).Scan(&owner)
	return owner, e
}
func (s *Server) invite(w http.ResponseWriter, r *http.Request) {
	id, ok := groupID(w, r)
	if !ok {
		return
	}
	if !s.allowed(r, "invite", 60) {
		fail(w, 429, "Please slow down")
		return
	}
	var v struct {
		Username string `json:"username"`
	}
	if !decode(w, r, &v) {
		return
	}
	tx, e := s.db.Begin(r.Context())
	if e != nil {
		fail(w, 500, "Could not invite")
		return
	}
	defer tx.Rollback(r.Context())
	owner, e := lockedGroup(r.Context(), tx, id)
	if e != nil || owner != user(r).ID {
		fail(w, 403, "Only the group owner can invite players")
		return
	}
	var count int
	if tx.QueryRow(r.Context(), "SELECT count(*) FROM group_members WHERE group_id=$1", id).Scan(&count) != nil {
		fail(w, 500, "Could not invite")
		return
	}
	if count >= 8 {
		fail(w, 409, "Group is full (8 members including invitations)")
		return
	}
	var uid int64
	if tx.QueryRow(r.Context(), "SELECT id FROM users WHERE username=$1", strings.ToLower(strings.TrimSpace(v.Username))).Scan(&uid) != nil {
		fail(w, 404, "Username not found")
		return
	}
	tag, e := tx.Exec(r.Context(), "INSERT INTO group_members VALUES($1,$2,'invited') ON CONFLICT DO NOTHING", id, uid)
	if e != nil {
		fail(w, 500, "Could not invite")
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 409, "Player is already a member or invited")
		return
	}
	if tx.Commit(r.Context()) != nil {
		fail(w, 500, "Could not invite")
		return
	}
	reply(w, 200, map[string]bool{"ok": true})
}
func (s *Server) accept(w http.ResponseWriter, r *http.Request) {
	id, ok := groupID(w, r)
	if !ok {
		return
	}
	tag, e := s.db.Exec(r.Context(), "UPDATE group_members SET status='accepted' WHERE group_id=$1 AND user_id=$2 AND status='invited'", id, user(r).ID)
	if e != nil {
		fail(w, 500, "Could not accept invitation")
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 404, "Invitation not found")
		return
	}
	reply(w, 200, map[string]bool{"ok": true})
}
func (s *Server) leave(w http.ResponseWriter, r *http.Request) {
	id, ok := groupID(w, r)
	if !ok {
		return
	}
	s.hub.mu.Lock()
	defer s.hub.mu.Unlock()
	if room := s.hub.rooms[id]; room != nil && (room.State == "running" || room.State == "saving") {
		fail(w, 409, "Wait until the match finishes before leaving this group")
		return
	}
	tx, e := s.db.Begin(r.Context())
	if e != nil {
		fail(w, 500, "Could not leave group")
		return
	}
	defer tx.Rollback(r.Context())
	owner, e := lockedGroup(r.Context(), tx, id)
	if e != nil {
		fail(w, 404, "Group not found")
		return
	}
	tag, e := tx.Exec(r.Context(), "DELETE FROM group_members WHERE group_id=$1 AND user_id=$2", id, user(r).ID)
	if e != nil || tag.RowsAffected() == 0 {
		fail(w, 404, "Membership not found")
		return
	}
	deleted := false
	if owner == user(r).ID {
		var next int64
		e = tx.QueryRow(r.Context(), "SELECT user_id FROM group_members WHERE group_id=$1 AND status='accepted' ORDER BY user_id LIMIT 1", id).Scan(&next)
		if e == pgx.ErrNoRows {
			_, e = tx.Exec(r.Context(), "DELETE FROM groups WHERE id=$1", id)
			deleted = true
		} else if e == nil {
			_, e = tx.Exec(r.Context(), "UPDATE groups SET owner_id=$1 WHERE id=$2", next, id)
		}
		if e != nil {
			fail(w, 500, "Could not transfer ownership")
			return
		}
		owner = next
	}
	if tx.Commit(r.Context()) != nil {
		fail(w, 500, "Could not leave group")
		return
	}
	if room := s.hub.rooms[id]; room != nil {
		room.OwnerID = owner
		if p := room.peers[user(r).ID]; p != nil {
			p.conn.Close()
			delete(room.peers, user(r).ID)
		}
		delete(room.players, user(r).ID)
		if deleted {
			for _, p := range room.peers {
				p.conn.Close()
			}
			delete(s.hub.rooms, id)
		}
	}
	reply(w, 200, map[string]bool{"ok": true})
}
func (s *Server) startMatch(w http.ResponseWriter, r *http.Request) {
	id, ok := groupID(w, r)
	if !ok {
		return
	}
	s.hub.mu.Lock()
	defer s.hub.mu.Unlock()
	room := s.hub.rooms[id]
	if room == nil || room.OwnerID != user(r).ID {
		fail(w, 403, "Connect to your group lobby as owner first")
		return
	}
	if room.State == "running" || room.State == "saving" {
		fail(w, 409, "The current round is still active or saving")
		return
	}
	if len(room.peers) < 2 {
		fail(w, 409, "At least two players must be connected to the lobby")
		return
	}
	var mid int64
	if s.db.QueryRow(r.Context(), "INSERT INTO matches(group_id,status) VALUES($1,'running') RETURNING id", id).Scan(&mid) != nil {
		fail(w, 500, "Could not create match")
		return
	}
	room.start(time.Now(), mid, 180*time.Second)
	reply(w, 200, map[string]int64{"matchId": mid})
}
func (s *Server) history(w http.ResponseWriter, r *http.Request) {
	rows, e := s.db.Query(r.Context(), `SELECT m.id,g.name,m.started_at,m.ended_at,s.kills,s.deaths FROM match_scores s JOIN matches m ON m.id=s.match_id JOIN groups g ON g.id=m.group_id WHERE s.user_id=$1 AND m.status='finished' ORDER BY m.id DESC LIMIT 20`, user(r).ID)
	if e != nil {
		fail(w, 500, "Could not load match history")
		return
	}
	defer rows.Close()
	result := []map[string]any{}
	for rows.Next() {
		var id int64
		var name string
		var started, ended time.Time
		var kills, deaths int
		if rows.Scan(&id, &name, &started, &ended, &kills, &deaths) == nil {
			result = append(result, map[string]any{"id": id, "group": name, "startedAt": started, "endedAt": ended, "kills": kills, "deaths": deaths})
		}
	}
	reply(w, 200, result)
}
