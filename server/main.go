package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schema string

type User struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	IsAdmin  bool   `json:"isAdmin"`
}
type Server struct {
	db      *pgxpool.Pool
	hub     *Hub
	origin  string
	origins map[string]struct{}
	secure  bool
	limitMu sync.Mutex
	limits  map[string]*rateWindow
}
type rateWindow struct {
	Start time.Time
	Count int
}
type authKey struct{}

func user(r *http.Request) User { return r.Context().Value(authKey{}).(User) }
func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func seedAdminCommand() {
	if len(os.Args) != 4 {
		log.Fatal("usage: go run . seed-admin <username> <password>")
	}
	ctx := context.Background()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL is required; see .env.example")
	}
	db, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	if err = db.Ping(ctx); err != nil {
		log.Fatal("PostgreSQL: ", err)
	}
	if _, err = db.Exec(ctx, schema); err != nil {
		log.Fatal("migrations: ", err)
	}
	if err = seedAdminUser(ctx, db, os.Args[2], os.Args[3]); err != nil {
		log.Fatal(err)
	}
	log.Printf("Admin user %q is ready", strings.ToLower(strings.TrimSpace(os.Args[2])))
}

func main() {
	if len(os.Args) >= 2 && os.Args[1] == "seed-admin" {
		seedAdminCommand()
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL is required; see .env.example")
	}
	db, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	if err = db.Ping(ctx); err != nil {
		log.Fatal("PostgreSQL: ", err)
	}
	if _, err = db.Exec(ctx, schema); err != nil {
		log.Fatal("migrations: ", err)
	}
	// Live rooms are in memory; unfinished rounds cannot survive a process restart.
	if _, err = db.Exec(ctx, "UPDATE matches SET status='aborted', ended_at=now() WHERE status='running'"); err != nil {
		log.Fatal(err)
	}
	originValue := env("APP_ORIGINS", env("APP_ORIGIN", "http://localhost:5173"))
	origins := make(map[string]struct{})
	for _, value := range strings.Split(originValue, ",") {
		if value = strings.TrimSpace(value); value != "" {
			origins[value] = struct{}{}
		}
	}
	s := &Server{db: db, origin: originValue, origins: origins, secure: os.Getenv("COOKIE_SECURE") == "true", limits: map[string]*rateWindow{}}
	s.hub = newHub(s)
	go s.hub.run(ctx)
	httpServer := &http.Server{Addr: env("ADDR", ":8080"), Handler: s.routes(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	go func() {
		log.Printf("Island War listening on %s (origin %s)", httpServer.Addr, s.origin)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	<-ctx.Done()
	s.hub.close()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdown)
}
func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		ctx, c := context.WithTimeout(r.Context(), time.Second)
		defer c()
		if s.db.Ping(ctx) != nil {
			fail(w, 503, "Database unavailable")
			return
		}
		reply(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /api/register", s.register)
	mux.HandleFunc("POST /api/login", s.login)
	mux.Handle("POST /api/logout", s.auth(s.logout))
	mux.Handle("GET /api/me", s.auth(func(w http.ResponseWriter, r *http.Request) { reply(w, 200, user(r)) }))
	mux.Handle("GET /api/users", s.auth(s.searchUsers))
	mux.Handle("GET /api/groups", s.auth(s.listGroups))
	mux.Handle("POST /api/groups", s.auth(s.createGroup))
	mux.Handle("POST /api/groups/{id}/invite", s.auth(s.invite))
	mux.Handle("POST /api/groups/{id}/accept", s.auth(s.accept))
	mux.Handle("POST /api/groups/{id}/leave", s.auth(s.leave))
	mux.Handle("POST /api/groups/{id}/start", s.auth(s.startMatch))
	mux.Handle("GET /api/groups/{id}/ws", s.auth(s.connect))
	mux.Handle("GET /api/history", s.auth(s.history))
	mux.Handle("GET /api/admin/overview", s.requireAdmin(s.adminOverview))
	mux.Handle("GET /api/admin/users", s.requireAdmin(s.adminListUsers))
	mux.Handle("POST /api/admin/users/{id}/deactivate", s.requireAdmin(s.adminDeactivateUser))
	mux.Handle("POST /api/admin/users/{id}/activate", s.requireAdmin(s.adminActivateUser))
	mux.Handle("DELETE /api/admin/users/{id}", s.requireAdmin(s.adminDeleteUser))
	mux.Handle("GET /api/admin/groups", s.requireAdmin(s.adminListGroups))
	mux.Handle("DELETE /api/admin/groups/{id}", s.requireAdmin(s.adminDeleteGroup))
	mux.Handle("GET /api/admin/matches", s.requireAdmin(s.adminListMatches))
	mux.Handle("POST /api/admin/matches/{id}/abort", s.requireAdmin(s.adminAbortMatch))
	mux.Handle("GET /api/admin/sessions", s.requireAdmin(s.adminListSessions))
	mux.Handle("DELETE /api/admin/sessions/{id}", s.requireAdmin(s.adminRevokeSession))
	static := env("STATIC_DIR", "../dist")
	mux.Handle("/", http.FileServer(http.Dir(filepath.Clean(static))))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			if !s.originAllowed(origin) {
				fail(w, 403, "Origin not allowed")
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
				fail(w, 403, "Cross-site request rejected")
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}
func reply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, msg string) {
	reply(w, status, map[string]string{"error": msg})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if d.Decode(v) != nil {
		fail(w, 400, "Invalid request body")
		return false
	}
	return true
}
func token() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func hashToken(v string) string { h := sha256.Sum256([]byte(v)); return hex.EncodeToString(h[:]) }
func groupID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, e := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if e != nil || id < 1 {
		fail(w, 400, "Invalid group")
		return 0, false
	}
	return id, true
}
func (s *Server) allowed(r *http.Request, key string, max int) bool {
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	key += ip
	s.limitMu.Lock()
	defer s.limitMu.Unlock()
	now := time.Now()
	for k, v := range s.limits {
		if now.Sub(v.Start) > time.Minute {
			delete(s.limits, k)
		}
	}
	v := s.limits[key]
	if v == nil {
		v = &rateWindow{Start: now}
		s.limits[key] = v
	}
	v.Count++
	return v.Count <= max
}
func (s *Server) validOrigin(r *http.Request) bool {
	v := r.Header.Get("Origin")
	u, e := url.Parse(v)
	return e == nil && u.Host != "" && s.originAllowed(v)
}

func (s *Server) originAllowed(value string) bool {
	if len(s.origins) == 0 {
		return value == s.origin
	}
	_, ok := s.origins[value]
	return ok
}
