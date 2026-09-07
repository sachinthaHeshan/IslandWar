package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAdminDashboard(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("TEST_DATABASE_URL must point to an isolated test database")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	db, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err = db.Exec(ctx, schema); err != nil {
		t.Fatal(err)
	}
	s := &Server{db: db, limits: map[string]*rateWindow{}}
	s.hub = newHub(s)
	ts := httptest.NewServer(s.routes())
	defer ts.Close()
	defer s.hub.close()
	s.origin = ts.URL
	go s.hub.run(ctx)

	request := func(method, path string, payload any, cookie *http.Cookie, want int) []byte {
		t.Helper()
		var body io.Reader
		if payload != nil {
			encoded, _ := json.Marshal(payload)
			body = bytes.NewReader(encoded)
		}
		req, _ := http.NewRequest(method, ts.URL+path, body)
		req.Header.Set("Origin", ts.URL)
		if cookie != nil {
			req.AddCookie(cookie)
		}
		res, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer res.Body.Close()
		data, _ := io.ReadAll(res.Body)
		if res.StatusCode != want {
			t.Fatalf("%s %s: got %d want %d: %s", method, path, res.StatusCode, want, data)
		}
		return data
	}
	register := func(name string) (User, *http.Cookie) {
		t.Helper()
		data, _ := json.Marshal(credentials{Username: name, Password: "test-password-2026"})
		req, _ := http.NewRequest("POST", ts.URL+"/api/register", bytes.NewReader(data))
		req.Header.Set("Origin", ts.URL)
		res, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			body, _ := io.ReadAll(res.Body)
			t.Fatalf("register status %d: %s", res.StatusCode, body)
		}
		var u User
		_ = json.NewDecoder(res.Body).Decode(&u)
		return u, res.Cookies()[0]
	}

	suffix := fmt.Sprint(time.Now().UnixNano() % 1000000000)
	player, playerCookie := register("player_" + suffix)
	admin, adminCookie := register("admin_" + suffix)

	me := request("GET", "/api/me", nil, playerCookie, 200)
	if !bytes.Contains(me, []byte(`"isAdmin":false`)) {
		t.Fatalf("player /api/me missing isAdmin false: %s", me)
	}
	request("GET", "/api/admin/overview", nil, playerCookie, 403)

	if _, err = db.Exec(ctx, "UPDATE users SET is_admin=true WHERE id=$1", admin.ID); err != nil {
		t.Fatal(err)
	}
	adminMe := request("GET", "/api/me", nil, adminCookie, 200)
	if !bytes.Contains(adminMe, []byte(`"isAdmin":true`)) {
		t.Fatalf("admin session did not pick up isAdmin: %s", adminMe)
	}

	overview := request("GET", "/api/admin/overview", nil, adminCookie, 200)
	for _, key := range []string{"livePlayers", "sessions", "users", "groups", "runningMatches", "finishedMatches"} {
		if !bytes.Contains(overview, []byte(`"`+key+`"`)) {
			t.Fatalf("overview missing %s: %s", key, overview)
		}
	}

	users := request("GET", "/api/admin/users", nil, adminCookie, 200)
	if !bytes.Contains(users, []byte(player.Username)) || !bytes.Contains(users, []byte(admin.Username)) {
		t.Fatalf("users list missing accounts: %s", users)
	}

	login := func(name, password string, want int) *http.Cookie {
		t.Helper()
		data, _ := json.Marshal(credentials{Username: name, Password: password})
		req, _ := http.NewRequest("POST", ts.URL+"/api/login", bytes.NewReader(data))
		req.Header.Set("Origin", ts.URL)
		res, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer res.Body.Close()
		body, _ := io.ReadAll(res.Body)
		if res.StatusCode != want {
			t.Fatalf("login %s: got %d want %d: %s", name, res.StatusCode, want, body)
		}
		if len(res.Cookies()) == 0 {
			return nil
		}
		return res.Cookies()[0]
	}

	request("POST", fmt.Sprintf("/api/admin/users/%d/deactivate", player.ID), map[string]bool{}, adminCookie, 200)
	login(player.Username, "test-password-2026", 401)
	request("POST", fmt.Sprintf("/api/admin/users/%d/activate", player.ID), map[string]bool{}, adminCookie, 200)
	playerCookie = login(player.Username, "test-password-2026", 200)

	request("POST", fmt.Sprintf("/api/admin/users/%d/deactivate", admin.ID), map[string]bool{}, adminCookie, 403)
	request("DELETE", fmt.Sprintf("/api/admin/users/%d", admin.ID), nil, adminCookie, 403)

	groupBody := request("POST", "/api/groups", map[string]string{"name": "Admin squad"}, playerCookie, 201)
	var group struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(groupBody, &group)
	groups := request("GET", "/api/admin/groups", nil, adminCookie, 200)
	if !bytes.Contains(groups, []byte("Admin squad")) {
		t.Fatalf("groups list missing group: %s", groups)
	}

	var matchID int64
	if err = db.QueryRow(ctx, "INSERT INTO matches(group_id,status) VALUES($1,'running') RETURNING id", group.ID).Scan(&matchID); err != nil {
		t.Fatal(err)
	}
	matches := request("GET", "/api/admin/matches", nil, adminCookie, 200)
	if !bytes.Contains(matches, []byte(`"status":"running"`)) {
		t.Fatalf("matches list missing running match: %s", matches)
	}
	request("POST", fmt.Sprintf("/api/admin/matches/%d/abort", matchID), map[string]bool{}, adminCookie, 200)
	request("POST", fmt.Sprintf("/api/admin/matches/%d/abort", matchID), map[string]bool{}, adminCookie, 409)

	sessions := request("GET", "/api/admin/sessions", nil, adminCookie, 200)
	var sessionList []struct {
		ID       string `json:"id"`
		Username string `json:"username"`
	}
	if err = json.Unmarshal(sessions, &sessionList); err != nil || len(sessionList) == 0 {
		t.Fatalf("sessions list: %s", sessions)
	}
	var playerSession string
	for _, row := range sessionList {
		if row.Username == player.Username {
			playerSession = row.ID
		}
	}
	if playerSession == "" {
		t.Fatalf("player session missing: %s", sessions)
	}
	request("DELETE", "/api/admin/sessions/"+playerSession, nil, adminCookie, 200)
	request("GET", "/api/me", nil, playerCookie, 401)

	player, playerCookie = register("gone_" + suffix)
	request("POST", "/api/groups", map[string]string{"name": "Delete me"}, playerCookie, 201)
	request("DELETE", fmt.Sprintf("/api/admin/users/%d", player.ID), nil, adminCookie, 200)
	request("POST", "/api/login", credentials{Username: player.Username, Password: "test-password-2026"}, nil, 401)

	request("DELETE", fmt.Sprintf("/api/admin/groups/%d", group.ID), nil, adminCookie, 200)
	groups = request("GET", "/api/admin/groups", nil, adminCookie, 200)
	if bytes.Contains(groups, []byte("Admin squad")) {
		t.Fatalf("deleted group still listed: %s", groups)
	}

	if err = seedAdminUser(ctx, db, "seed_"+suffix, "seed-password-2026"); err != nil {
		t.Fatal(err)
	}
	if err = seedAdminUser(ctx, db, "seed_"+suffix, "seed-password-9999"); err != nil {
		t.Fatal(err)
	}
	request("POST", "/api/login", credentials{Username: "seed_" + suffix, Password: "seed-password-2026"}, nil, 401)
	seedLogin := request("POST", "/api/login", credentials{Username: "seed_" + suffix, Password: "seed-password-9999"}, nil, 200)
	if !bytes.Contains(seedLogin, []byte(`"isAdmin":true`)) {
		t.Fatalf("seeded admin login: %s", seedLogin)
	}
}
