package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestMultiplayerEndToEnd(t *testing.T) {
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
			data, _ := json.Marshal(payload)
			body = bytes.NewReader(data)
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
			t.Fatalf("register status %d", res.StatusCode)
		}
		var u User
		_ = json.NewDecoder(res.Body).Decode(&u)
		return u, res.Cookies()[0]
	}
	suffix := fmt.Sprint(time.Now().UnixNano() % 1000000000)
	a, ac := register("alpha_" + suffix)
	b, bc := register("bravo_" + suffix)
	request("GET", "/api/me", nil, nil, 401)
	request("POST", "/api/register", credentials{Username: a.Username, Password: "test-password-2026"}, nil, 409)
	request("POST", "/api/login", credentials{Username: a.Username, Password: "wrong-password"}, nil, 401)
	data := request("GET", "/api/users?q=bravo_"+suffix, nil, ac, 200)
	if !bytes.Contains(data, []byte(b.Username)) {
		t.Fatal("username search did not find friend")
	}
	data = request("POST", "/api/groups", map[string]string{"name": "Integration squad"}, ac, 201)
	var group struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(data, &group)
	path := fmt.Sprintf("/api/groups/%d", group.ID)
	request("POST", path+"/invite", map[string]string{"username": a.Username}, bc, 403)
	request("POST", path+"/accept", map[string]string{}, bc, 404)
	request("POST", path+"/invite", map[string]string{"username": b.Username}, ac, 200)
	dial := func(cookie *http.Cookie, origin string) (*websocket.Conn, *http.Response, error) {
		headers := http.Header{"Origin": {origin}, "Cookie": {cookie.String()}}
		return websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(ts.URL, "http")+path+"/ws", headers)
	}
	if conn, res, _ := dial(bc, ts.URL); conn != nil || res.StatusCode != 403 {
		t.Fatal("pending invitation can connect")
	}
	request("POST", path+"/accept", map[string]string{}, bc, 200)
	if conn, res, _ := dial(ac, "https://untrusted.example"); conn != nil || res.StatusCode != 403 {
		t.Fatal("cross-origin WebSocket allowed")
	}
	wa, _, e := dial(ac, ts.URL)
	if e != nil {
		t.Fatal(e)
	}
	defer wa.Close()
	wb, _, e := dial(bc, ts.URL)
	if e != nil {
		t.Fatal(e)
	}
	defer wb.Close()
	request("POST", path+"/start", map[string]string{}, bc, 403)
	request("POST", path+"/start", map[string]string{}, ac, 200)
	request("POST", path+"/leave", map[string]string{}, bc, 409)
	request("POST", path+"/start", map[string]string{}, ac, 409)
	readRunning := func(ws *websocket.Conn) Snapshot {
		t.Helper()
		_ = ws.SetReadDeadline(time.Now().Add(3 * time.Second))
		for {
			var snap Snapshot
			if ws.ReadJSON(&snap) != nil {
				t.Fatal("snapshot not received")
			}
			if snap.State == "running" {
				return snap
			}
		}
	}
	sa, sb := readRunning(wa), readRunning(wb)
	if sa.MatchID != sb.MatchID || len(sa.Players) != 2 {
		t.Fatal("clients disagree about match")
	}
	s.hub.mu.Lock()
	room := s.hub.rooms[group.ID]
	room.players[a.ID].X = 0
	room.players[a.ID].Z = 0
	room.players[a.ID].ProtectedUntil = 0
	room.players[b.ID].X = .85
	room.players[b.ID].Z = -10
	room.players[b.ID].ProtectedUntil = 0
	s.hub.mu.Unlock()
	for i := 0; i < 4; i++ {
		if e = wa.WriteJSON(Input{Type: "input", Pitch: -.08}); e != nil {
			t.Fatal(e)
		}
		if e = wa.WriteJSON(Input{Type: "shoot"}); e != nil {
			t.Fatal(e)
		}
		time.Sleep(230 * time.Millisecond)
		readRunning(wa)
		readRunning(wb)
	}
	s.hub.mu.Lock()
	kills := room.players[a.ID].Kills
	deaths := room.players[b.ID].Deaths
	room.EndAt = time.Now().UnixMilli()
	s.hub.mu.Unlock()
	if kills != 1 || deaths != 1 {
		t.Fatalf("network combat failed: kills %d deaths %d", kills, deaths)
	}
	deadline := time.Now().Add(4 * time.Second)
	saved := false
	for time.Now().Before(deadline) {
		var status string
		_ = db.QueryRow(ctx, "SELECT status FROM matches WHERE id=$1", sa.MatchID).Scan(&status)
		if status == "finished" {
			saved = true
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !saved {
		t.Fatal("match scores were not persisted")
	}
	data = request("GET", "/api/history", nil, ac, 200)
	if !bytes.Contains(data, []byte(`"kills":1`)) {
		t.Fatalf("history missing kill: %s", data)
	}
	request("POST", "/api/logout", map[string]string{}, bc, 200)
	request("GET", "/api/me", nil, bc, 401)
	req, _ := http.NewRequest("POST", ts.URL+path+"/start", strings.NewReader("{}"))
	req.Header.Set("Origin", "https://untrusted.example")
	req.AddCookie(ac)
	res, e := http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatal("cross-origin write accepted")
	}
}
