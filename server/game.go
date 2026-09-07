package main

import (
	"context"
	"encoding/json"
	"log"
	"math"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Vec struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

func (a Vec) add(b Vec) Vec     { return Vec{a.X + b.X, a.Y + b.Y, a.Z + b.Z} }
func (a Vec) sub(b Vec) Vec     { return Vec{a.X - b.X, a.Y - b.Y, a.Z - b.Z} }
func (a Vec) mul(n float64) Vec { return Vec{a.X * n, a.Y * n, a.Z * n} }
func (a Vec) length() float64   { return math.Sqrt(a.X*a.X + a.Y*a.Y + a.Z*a.Z) }
func (a Vec) unit() Vec {
	if l := a.length(); l > 0 {
		return a.mul(1 / l)
	}
	return Vec{}
}

type Input struct {
	Type   string  `json:"type"`
	X      float64 `json:"x"`
	Z      float64 `json:"z"`
	Yaw    float64 `json:"yaw"`
	Pitch  float64 `json:"pitch"`
	Sprint bool    `json:"sprint"`
	Crawl  bool    `json:"crawl"`
	Aim    bool    `json:"aim"`
	Weapon string  `json:"weapon,omitempty"`
}
type Player struct {
	User
	X              float64        `json:"x"`
	Y              float64        `json:"y"`
	Z              float64        `json:"z"`
	Yaw            float64        `json:"yaw"`
	Pitch          float64        `json:"pitch"`
	VX             float64        `json:"vx"`
	VY             float64        `json:"vy"`
	VZ             float64        `json:"vz"`
	Grounded       bool           `json:"grounded"`
	Aiming         bool           `json:"aiming"`
	Sprinting      bool           `json:"sprinting"`
	Crawling       bool           `json:"crawling"`
	Weapon         string         `json:"weapon"`
	Weapons        map[string]int `json:"weapons"`
	Health         int            `json:"health"`
	Ammo           int            `json:"ammo"`
	Kills          int            `json:"kills"`
	Deaths         int            `json:"deaths"`
	Connected      bool           `json:"connected"`
	Reloading      bool           `json:"reloading"`
	RespawnAt      int64          `json:"respawnAt"`
	ProtectedUntil int64          `json:"protectedUntil"`
	input          Input
	inputAt        time.Time
	lastShot       time.Time
	reloadEnd      time.Time
	shoot          bool
	reload         bool
	jump           bool
}
type Event struct {
	Type     string `json:"type"`
	Shooter  int64  `json:"shooter"`
	Victim   int64  `json:"victim,omitempty"`
	Start    Vec    `json:"start"`
	End      Vec    `json:"end"`
	Kill     bool   `json:"kill"`
	Weapon   string `json:"weapon,omitempty"`
	Damage   int    `json:"damage,omitempty"`
	Headshot bool   `json:"headshot,omitempty"`
}
type Room struct {
	ID      int64  `json:"groupId"`
	OwnerID int64  `json:"ownerId"`
	State   string `json:"state"`
	MatchID int64  `json:"matchId"`
	EndAt   int64  `json:"endAt"`
	players map[int64]*Player
	peers   map[int64]*Peer
	events  []Event
	loot    map[int]int64
}
type Snapshot struct {
	Type    string      `json:"type"`
	GroupID int64       `json:"groupId"`
	OwnerID int64       `json:"ownerId"`
	State   string      `json:"state"`
	MatchID int64       `json:"matchId"`
	EndAt   int64       `json:"endAt"`
	Now     int64       `json:"now"`
	Players []*Player   `json:"players"`
	Events  []Event     `json:"events"`
	Loot    []LootState `json:"loot"`
}
type Peer struct {
	conn    *websocket.Conn
	send    chan []byte
	uid     int64
	session string
}
type Hub struct {
	mu     sync.Mutex
	rooms  map[int64]*Room
	server *Server
}

func newHub(s *Server) *Hub { return &Hub{rooms: map[int64]*Room{}, server: s} }

func (h *Hub) liveCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	n := 0
	for _, r := range h.rooms {
		n += len(r.peers)
	}
	return n
}

func (h *Hub) closeGroup(gid int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if r := h.rooms[gid]; r != nil {
		for _, p := range r.peers {
			p.conn.Close()
		}
		delete(h.rooms, gid)
	}
}

func (h *Hub) abortMatch(matchID int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for id, r := range h.rooms {
		if r.MatchID == matchID {
			for _, p := range r.peers {
				p.conn.Close()
			}
			delete(h.rooms, id)
			return
		}
	}
}

func (r *Room) spawn(p *Player, now time.Time) {
	// Pick a spawn furthest from living opponents to reduce repeated spawn kills.
	best := Vec{}
	bestDistance := -1.0
	for i := 0; i < 8; i++ {
		angle := float64(i) * math.Pi / 4
		candidate := Vec{math.Sin(angle) * 85, 0, math.Cos(angle)*85 + arena.CenterZ}
		if !canMove(candidate.X, candidate.Z, groundHeight(candidate.X, candidate.Z)) {
			continue
		}
		distance := 1000.0
		for _, other := range r.players {
			if other.ID != p.ID && other.Health > 0 {
				distance = math.Min(distance, math.Hypot(other.X-candidate.X, other.Z-candidate.Z))
			}
		}
		if distance > bestDistance {
			bestDistance = distance
			best = candidate
		}
	}
	p.X = best.X
	p.Z = best.Z
	p.Y = groundHeight(p.X, p.Z)
	p.VX = 0
	p.VY = 0
	p.VZ = 0
	p.Grounded = true
	p.Aiming = false
	p.Sprinting = false
	p.Crawling = false
	p.jump = false
	p.Yaw = math.Atan2(p.X, p.Z+8)
	p.Health = 100
	p.Weapon = "pistol"
	p.Weapons = map[string]int{"pistol": arena.Weapons["pistol"].Magazine}
	p.Ammo = p.Weapons["pistol"]
	p.RespawnAt = 0
	p.ProtectedUntil = now.Add(2 * time.Second).UnixMilli()
	p.Reloading = false
	p.reloadEnd = time.Time{}
	p.input = Input{Yaw: p.Yaw}
	p.shoot = false
	p.reload = false
}
func (r *Room) start(now time.Time, mid int64, duration time.Duration) {
	r.State = "running"
	r.MatchID = mid
	r.EndAt = now.Add(duration).UnixMilli()
	r.events = nil
	r.loot = map[int]int64{}
	for id := range r.players {
		if r.peers[id] == nil {
			delete(r.players, id)
		}
	}
	ids := []int64{}
	for id := range r.players {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for _, id := range ids {
		p := r.players[id]
		p.Kills = 0
		p.Deaths = 0
		p.Health = 0
	}
	for _, id := range ids {
		r.spawn(r.players[id], now)
	}
}
func (r *Room) step(now time.Time, dt float64) bool {
	if r.State != "running" {
		return false
	}
	if now.UnixMilli() >= r.EndAt {
		r.State = "saving"
		for _, p := range r.players {
			p.shoot = false
			p.input = Input{}
		}
		return true
	}
	for _, p := range r.players {
		if p.Health <= 0 {
			if now.UnixMilli() >= p.RespawnAt {
				r.spawn(p, now)
			}
			continue
		}
		if p.Reloading && !now.Before(p.reloadEnd) {
			p.Ammo = weaponFor(p).Magazine
			if p.Weapons == nil {
				p.Weapons = map[string]int{}
			}
			p.Weapons[p.Weapon] = p.Ammo
			p.Reloading = false
		}
		if p.reload && !p.Reloading && p.Ammo < weaponFor(p).Magazine {
			p.Reloading = true
			p.reloadEnd = now.Add(time.Duration(weaponFor(p).Reload * float64(time.Second)))
		}
		p.reload = false
		movePlayer(p, now, dt)
		if p.shoot && p.Connected {
			r.fire(p, now)
		}
		p.shoot = false
	}
	return false
}

// Slab intersection gives a server-owned hit distance for cover and oriented body parts.
func rayBox(origin, dir, min, max Vec) float64 {
	near, far := 0.0, 260.0
	for _, axis := range [][4]float64{{origin.X, dir.X, min.X, max.X}, {origin.Y, dir.Y, min.Y, max.Y}, {origin.Z, dir.Z, min.Z, max.Z}} {
		o, d, lo, hi := axis[0], axis[1], axis[2], axis[3]
		if math.Abs(d) < 1e-8 {
			if o < lo || o > hi {
				return math.Inf(1)
			}
			continue
		}
		a, b := (lo-o)/d, (hi-o)/d
		if a > b {
			a, b = b, a
		}
		near = math.Max(near, a)
		far = math.Min(far, b)
		if near > far {
			return math.Inf(1)
		}
	}
	return near
}
func playerHitHeight(p *Player) float64 {
	if p.Crawling {
		return 1.44
	}
	return 2.48
}
func playerEyeHeight(p *Player) float64 {
	if p.Crawling {
		return 0.95
	}
	return 2.4
}
func worldToPlayerLocal(origin, dir Vec, p *Player) (Vec, Vec) {
	dx, dz := origin.X-p.X, origin.Z-p.Z
	c, s := math.Cos(p.Yaw), math.Sin(p.Yaw)
	return Vec{c*dx - s*dz, origin.Y - p.Y, s*dx + c*dz}, Vec{c*dir.X - s*dir.Z, dir.Y, s*dir.X + c*dir.Z}
}
func playerHitParts(p *Player) [][2]Vec {
	y := 1.0
	armZ := -0.62
	if p.Crawling {
		y = 0.58
		armZ = -0.9
	}
	return [][2]Vec{
		{{-.32, 1.7 * y, -.32}, {.32, 2.48 * y, .32}},
		{{-.42, .88 * y, -.3}, {.42, 1.8 * y, .3}},
		{{-.7, 1.0 * y, armZ}, {-.28, 1.78 * y, .22}},
		{{.28, 1.0 * y, armZ}, {.7, 1.78 * y, .22}},
		{{-.42, 0, -.36}, {-.02, 1.05 * y, .2}},
		{{.02, 0, -.36}, {.42, 1.05 * y, .2}},
	}
}
func playerHitDistance(origin, dir Vec, p *Player) float64 {
	localOrigin, localDir := worldToPlayerLocal(origin, dir, p)
	closest := math.Inf(1)
	for _, part := range playerHitParts(p) {
		if d := rayBox(localOrigin, localDir, part[0], part[1]); d < closest {
			closest = d
		}
	}
	return closest
}
func (r *Room) trace(origin, dir Vec, shooter int64, now time.Time) (float64, *Player) {
	maxRange := 240.0
	if p := r.players[shooter]; p != nil {
		maxRange = weaponFor(p).Range
	}
	closest := terrainDistance(origin, dir, maxRange)
	var victim *Player
	for _, c := range arena.Cover {
		y := groundHeight(c.X, c.Z)
		d := rayBox(origin, dir, Vec{c.X - c.W/2, y, c.Z - c.D/2}, Vec{c.X + c.W/2, y + c.H, c.Z + c.D/2})
		if d < closest {
			closest = d
		}
	}
	for _, p := range r.players {
		if p.ID == shooter || p.Health <= 0 || !p.Connected || now.UnixMilli() < p.ProtectedUntil {
			continue
		}
		d := playerHitDistance(origin, dir, p)
		if d < closest {
			closest = d
			victim = p
		}
	}
	return closest, victim
}
func (r *Room) fire(p *Player, now time.Time) {
	w := weaponFor(p)
	if p.Health <= 0 || p.Reloading || now.Sub(p.lastShot) < time.Duration(w.Cooldown*float64(time.Second)) {
		return
	}
	if p.Ammo == 0 {
		p.reload = true
		return
	}
	p.lastShot = now
	p.Ammo--
	if p.Weapons == nil {
		p.Weapons = map[string]int{}
	}
	p.Weapons[p.Weapon] = p.Ammo
	p.ProtectedUntil = 0
	yaw, pitch := p.input.Yaw, p.input.Pitch
	direction := Vec{-math.Sin(yaw) * math.Cos(pitch), math.Sin(pitch), -math.Cos(yaw) * math.Cos(pitch)}
	right := Vec{math.Cos(yaw), 0, -math.Sin(yaw)}
	camera := Vec{p.X, p.Y + playerEyeHeight(p), p.Z}.add(direction.mul(-5.4)).add(right.mul(.85))
	if p.input.Aim {
		camera = Vec{p.X, p.Y + playerEyeHeight(p) - .45, p.Z}
	}
	aimDistance, _ := r.trace(camera, direction, p.ID, now)
	aim := camera.add(direction.mul(aimDistance))
	muzzleY := 1.365
	if p.Crawling {
		muzzleY = 0.72
	}
	muzzle := Vec{p.X, p.Y + muzzleY, p.Z}.add(right.mul(.44)).add(Vec{-math.Sin(yaw), 0, -math.Cos(yaw)}.mul(1.41))
	if p.input.Aim {
		muzzle = camera.add(direction.mul(.3))
	}
	shotDir := aim.sub(muzzle).unit()
	distance, victim := r.trace(muzzle, shotDir, p.ID, now)
	event := Event{Type: "shot", Shooter: p.ID, Start: muzzle, End: muzzle.add(shotDir.mul(distance)), Weapon: p.Weapon}
	impact := muzzle.add(shotDir.mul(distance))
	if victim != nil {
		event.Victim = victim.ID
		event.Damage = w.Damage
		if p.Weapon == "sniper" && event.End.Y >= victim.Y+playerHitHeight(victim)*.78 {
			event.Damage = 100
			event.Headshot = true
		}
		r.applyDamage(victim, event.Damage, p, now, &event)
	}
	if w.Splash > 0 {
		for _, other := range r.players {
			if other.ID == p.ID || other.Health <= 0 || !other.Connected || now.UnixMilli() < other.ProtectedUntil {
				continue
			}
			if math.Hypot(other.X-impact.X, other.Z-impact.Z) > w.Splash {
				continue
			}
			if math.Abs(other.Y-impact.Y) > w.Splash+.5 {
				continue
			}
			if victim != nil && other.ID == victim.ID {
				continue
			}
			falloff := 1 - math.Hypot(other.X-impact.X, other.Z-impact.Z)/w.Splash*.35
			r.applyDamage(other, int(float64(w.Damage)*falloff), p, now, &event)
		}
	}
	r.events = append(r.events, event)
}
func (r *Room) applyDamage(victim *Player, damage int, shooter *Player, now time.Time, event *Event) {
	if damage <= 0 || victim.Health <= 0 {
		return
	}
	victim.Health -= damage
	if victim.Health <= 0 {
		victim.Health = 0
		victim.Deaths++
		victim.RespawnAt = now.Add(3 * time.Second).UnixMilli()
		victim.shoot = false
		shooter.Kills++
		event.Kill = true
	}
	if event.Victim == 0 {
		event.Victim = victim.ID
	}
}
func (h *Hub) run(ctx context.Context) {
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			h.mu.Lock()
			for id, r := range h.rooms {
				if r.step(now, .05) {
					scores := make([]Player, 0, len(r.players))
					for _, p := range r.players {
						scores = append(scores, *p)
					}
					go h.persist(ctx, r.ID, r.MatchID, scores)
				}
				if len(r.peers) == 0 && r.State != "running" && r.State != "saving" {
					delete(h.rooms, id)
					continue
				}
				players := make([]*Player, 0, len(r.players))
				for _, p := range r.players {
					players = append(players, p)
				}
				sort.Slice(players, func(i, j int) bool {
					if players[i].Kills == players[j].Kills {
						return players[i].ID < players[j].ID
					}
					return players[i].Kills > players[j].Kills
				})
				data, _ := json.Marshal(Snapshot{Type: "snapshot", GroupID: r.ID, OwnerID: r.OwnerID, State: r.State, MatchID: r.MatchID, EndAt: r.EndAt, Now: now.UnixMilli(), Players: players, Events: r.events, Loot: r.lootSnapshot()})
				r.events = nil
				for _, p := range r.peers {
					select {
					case p.send <- data:
					default:
						p.conn.Close()
					}
				}
			}
			h.mu.Unlock()
		}
	}
}
func (h *Hub) persist(ctx context.Context, gid, mid int64, players []Player) {
	for {
		if ctx.Err() != nil {
			return
		}
		attempt, cancel := context.WithTimeout(ctx, 4*time.Second)
		tx, e := h.server.db.Begin(attempt)
		if e == nil {
			for _, p := range players {
				_, e = tx.Exec(attempt, "INSERT INTO match_scores(match_id,user_id,kills,deaths) VALUES($1,$2,$3,$4) ON CONFLICT(match_id,user_id) DO UPDATE SET kills=excluded.kills,deaths=excluded.deaths", mid, p.ID, p.Kills, p.Deaths)
				if e != nil {
					break
				}
			}
			if e == nil {
				_, e = tx.Exec(attempt, "UPDATE matches SET status='finished',ended_at=now() WHERE id=$1", mid)
			}
			if e == nil {
				e = tx.Commit(attempt)
			} else {
				_ = tx.Rollback(attempt)
			}
		}
		cancel()
		if e == nil {
			h.mu.Lock()
			if r := h.rooms[gid]; r != nil && r.MatchID == mid {
				r.State = "finished"
			}
			h.mu.Unlock()
			return
		}
		log.Printf("Retrying save for match %d: %v", mid, e)
		select {
		case <-ctx.Done():
			return
		case <-time.After(3 * time.Second):
		}
	}
}
func (h *Hub) disconnect(uid int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, r := range h.rooms {
		if p := r.peers[uid]; p != nil {
			p.conn.Close()
		}
	}
}
func (h *Hub) close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, r := range h.rooms {
		for _, p := range r.peers {
			p.conn.Close()
		}
	}
}
func (s *Server) connect(w http.ResponseWriter, r *http.Request) {
	id, ok := groupID(w, r)
	if !ok {
		return
	}
	if !s.allowed(r, "connect", 30) {
		fail(w, 429, "Too many reconnects. Wait a minute.")
		return
	}
	s.hub.mu.Lock()
	var owner int64
	e := s.db.QueryRow(r.Context(), "SELECT g.owner_id FROM groups g JOIN group_members m ON m.group_id=g.id WHERE g.id=$1 AND m.user_id=$2 AND m.status='accepted'", id, user(r).ID).Scan(&owner)
	if e != nil {
		s.hub.mu.Unlock()
		fail(w, 403, "Accept a group invitation before connecting")
		return
	}
	room := s.hub.rooms[id]
	if room == nil {
		room = &Room{ID: id, OwnerID: owner, State: "lobby", players: map[int64]*Player{}, peers: map[int64]*Peer{}}
		s.hub.rooms[id] = room
	}
	if (room.State == "running" || room.State == "saving") && room.players[user(r).ID] == nil {
		s.hub.mu.Unlock()
		fail(w, 409, "Round in progress. Join after the timer ends.")
		return
	}
	// One active browser connection per account, avoiding multiple controlled avatars.
	for gid, other := range s.hub.rooms {
		if gid != id && other.State == "running" && other.players[user(r).ID] != nil {
			s.hub.mu.Unlock()
			fail(w, 409, "Finish your current match before switching groups")
			return
		}
	}
	upgrader := websocket.Upgrader{CheckOrigin: s.validOrigin, HandshakeTimeout: 5 * time.Second}
	conn, e := upgrader.Upgrade(w, r, nil)
	if e != nil {
		s.hub.mu.Unlock()
		return
	}
	for _, other := range s.hub.rooms {
		if previous := other.peers[user(r).ID]; previous != nil {
			previous.conn.Close()
		}
	}
	cookie, _ := r.Cookie("session")
	peer := &Peer{conn: conn, send: make(chan []byte, 8), uid: user(r).ID, session: hashToken(cookie.Value)}
	room.peers[peer.uid] = peer
	p := room.players[peer.uid]
	if p == nil {
		p = &Player{User: user(r), Health: 100, Ammo: 15, Weapon: "pistol", Weapons: map[string]int{"pistol": 15}, Grounded: true}
		room.players[p.ID] = p
	}
	p.Connected = true
	p.input = Input{Yaw: p.Yaw}
	p.inputAt = time.Time{}
	s.hub.mu.Unlock()
	go peer.write()
	defer func() {
		conn.Close()
		s.hub.mu.Lock()
		defer s.hub.mu.Unlock()
		if room.peers[peer.uid] == peer {
			delete(room.peers, peer.uid)
			if p := room.players[peer.uid]; p != nil {
				p.Connected = false
				p.input = Input{}
				p.shoot = false
			}
			if room.State == "lobby" {
				delete(room.players, peer.uid)
			}
		}
	}()
	conn.SetReadLimit(1024)
	_ = conn.SetReadDeadline(time.Now().Add(45 * time.Second))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(45 * time.Second)) })
	window := time.Now()
	count := 0
	checked := time.Now()
	for {
		var in Input
		if conn.ReadJSON(&in) != nil {
			return
		}
		now := time.Now()
		if now.Sub(window) > time.Second {
			window = now
			count = 0
		}
		count++
		if count > 90 {
			return
		}
		if now.Sub(checked) > 30*time.Second {
			var valid bool
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			err := s.db.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM sessions WHERE token_hash=$1 AND expires_at>now())", peer.session).Scan(&valid)
			cancel()
			if err != nil || !valid {
				return
			}
			checked = now
		}
		if !finite(in.X) || !finite(in.Z) || !finite(in.Yaw) || !finite(in.Pitch) {
			return
		}
		in.X = math.Max(-1, math.Min(1, in.X))
		in.Z = math.Max(-1, math.Min(1, in.Z))
		in.Yaw = math.Mod(in.Yaw, 2*math.Pi)
		in.Pitch = math.Max(-1.1, math.Min(1.0, in.Pitch))
		s.hub.mu.Lock()
		if room.peers[peer.uid] != peer {
			s.hub.mu.Unlock()
			return
		}
		p := room.players[peer.uid]
		if room.State == "running" {
			switch in.Type {
			case "input":
				p.input = in
				p.inputAt = now
			case "shoot":
				p.shoot = true
			case "reload":
				p.reload = true
			case "jump":
				p.jump = true
			case "interact":
				room.pickup(p, now)
			case "switch":
				if in.Weapon != "" {
					p.switchTo(in.Weapon)
				}
			}
		}
		s.hub.mu.Unlock()
	}
}
func finite(n float64) bool { return !math.IsNaN(n) && !math.IsInf(n, 0) }
func (p *Peer) write() {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	defer p.conn.Close()
	for {
		select {
		case data := <-p.send:
			_ = p.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if p.conn.WriteMessage(websocket.TextMessage, data) != nil {
				return
			}
		case <-ticker.C:
			_ = p.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if p.conn.WriteMessage(websocket.PingMessage, nil) != nil {
				return
			}
		}
	}
}
