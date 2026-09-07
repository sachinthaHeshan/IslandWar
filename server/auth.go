package main

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

var usernamePattern = regexp.MustCompile(`^[a-z0-9_]{3,20}$`)
var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("not-a-real-account-password"), bcrypt.DefaultCost)

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	if !s.allowed(r, "auth", 15) {
		fail(w, 429, "Too many attempts. Try again in a minute.")
		return
	}
	var c credentials
	if !decode(w, r, &c) {
		return
	}
	c.Username = strings.ToLower(strings.TrimSpace(c.Username))
	if !usernamePattern.MatchString(c.Username) || len(c.Password) < 10 || len(c.Password) > 72 {
		fail(w, 400, "Use a 3–20 character username (letters, numbers, underscore) and a 10–72 byte password.")
		return
	}
	h, err := bcrypt.GenerateFromPassword([]byte(c.Password), bcrypt.DefaultCost)
	if err != nil {
		fail(w, 500, "Could not create account")
		return
	}
	var u User
	err = s.db.QueryRow(r.Context(), "INSERT INTO users(username,password_hash) VALUES($1,$2) RETURNING id,username,is_admin", c.Username, string(h)).Scan(&u.ID, &u.Username, &u.IsAdmin)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			fail(w, 409, "Username is already taken")
		} else {
			fail(w, 500, "Could not create account")
		}
		return
	}
	s.newSession(w, r, u)
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if !s.allowed(r, "auth", 15) {
		fail(w, 429, "Too many attempts. Try again in a minute.")
		return
	}
	var c credentials
	if !decode(w, r, &c) {
		return
	}
	var u User
	var hash string
	var deactivated *time.Time
	err := s.db.QueryRow(r.Context(), "SELECT id,username,password_hash,is_admin,deactivated_at FROM users WHERE username=$1", strings.ToLower(strings.TrimSpace(c.Username))).Scan(&u.ID, &u.Username, &hash, &u.IsAdmin, &deactivated)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		fail(w, 503, "Database unavailable")
		return
	}
	if hash == "" || deactivated != nil {
		hash = string(dummyHash)
		u = User{}
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(c.Password)) != nil || u.ID == 0 {
		fail(w, 401, "Incorrect username or password")
		return
	}
	s.newSession(w, r, u)
}
func (s *Server) newSession(w http.ResponseWriter, r *http.Request, u User) {
	value := token()
	expires := time.Now().Add(7 * 24 * time.Hour)
	if _, err := s.db.Exec(r.Context(), "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)", hashToken(value), u.ID, expires); err != nil {
		fail(w, 500, "Could not start session")
		return
	}
	if old, err := r.Cookie("session"); err == nil {
		_, _ = s.db.Exec(r.Context(), "DELETE FROM sessions WHERE token_hash=$1", hashToken(old.Value))
	}
	http.SetCookie(w, &http.Cookie{Name: "session", Value: value, Path: "/", HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteStrictMode, MaxAge: 7 * 24 * 3600, Expires: expires})
	reply(w, 200, u)
}
func (s *Server) auth(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, e := r.Cookie("session")
		if e != nil || len(c.Value) != 64 {
			fail(w, 401, "Sign in to continue")
			return
		}
		var u User
		e = s.db.QueryRow(r.Context(), "SELECT u.id,u.username,u.is_admin FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.deactivated_at IS NULL", hashToken(c.Value)).Scan(&u.ID, &u.Username, &u.IsAdmin)
		if e != nil {
			if !errors.Is(e, pgx.ErrNoRows) {
				fail(w, 503, "Database unavailable")
			} else {
				fail(w, 401, "Session expired. Please sign in again.")
			}
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), authKey{}, u)))
	})
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	c, _ := r.Cookie("session")
	if _, err := s.db.Exec(r.Context(), "DELETE FROM sessions WHERE token_hash=$1", hashToken(c.Value)); err != nil {
		fail(w, 503, "Could not sign out. Try again.")
		return
	}
	s.hub.disconnect(user(r).ID)
	http.SetCookie(w, &http.Cookie{Name: "session", Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteStrictMode})
	reply(w, 200, map[string]bool{"ok": true})
}
func (s *Server) searchUsers(w http.ResponseWriter, r *http.Request) {
	if !s.allowed(r, "search", 120) {
		fail(w, 429, "Please slow down")
		return
	}
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	if len(q) < 2 || len(q) > 20 {
		reply(w, 200, []User{})
		return
	}
	rows, e := s.db.Query(r.Context(), "SELECT id,username,is_admin FROM users WHERE strpos(username,$1)>0 AND id<>$2 ORDER BY username LIMIT 12", q, user(r).ID)
	if e != nil {
		fail(w, 500, "Search unavailable")
		return
	}
	defer rows.Close()
	list := []User{}
	for rows.Next() {
		var u User
		if rows.Scan(&u.ID, &u.Username, &u.IsAdmin) != nil {
			fail(w, 500, "Search unavailable")
			return
		}
		list = append(list, u)
	}
	reply(w, 200, list)
}
