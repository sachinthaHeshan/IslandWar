package main

import (
	"math"
	"testing"
	"time"
)

func testRoom() *Room {
	return &Room{ID: 1, State: "running", EndAt: time.Now().Add(time.Hour).UnixMilli(), players: map[int64]*Player{}, peers: map[int64]*Peer{}}
}
func TestAuthoritativeCombat(t *testing.T) {
	now := time.Now()
	r := testRoom()
	a := &Player{User: User{ID: 1}, Health: 100, Ammo: 12, Connected: true}
	b := &Player{User: User{ID: 2}, X: .85, Z: -10, Health: 100, Connected: true}
	r.players[1] = a
	r.players[2] = b
	a.input = Input{Pitch: -.08}
	r.fire(a, now)
	if b.Health != 75 || a.Ammo != 11 {
		t.Fatalf("shot: target health=%d ammo=%d", b.Health, a.Ammo)
	}
	r.fire(a, now.Add(10*time.Millisecond))
	if b.Health != 75 {
		t.Fatal("fire cooldown bypassed")
	}
	for i := 1; i < 4; i++ {
		r.fire(a, now.Add(time.Duration(i)*200*time.Millisecond))
	}
	if a.Kills != 1 || b.Deaths != 1 || b.Health != 0 {
		t.Fatalf("expected one elimination: %+v %+v", a, b)
	}
	r.fire(a, now.Add(time.Second))
	if a.Kills != 1 {
		t.Fatal("dead player scored twice")
	}
	r.step(now.Add(4*time.Second), .05)
	if b.Health != 100 || b.ProtectedUntil <= now.Add(4*time.Second).UnixMilli() {
		t.Fatal("respawn or protection missing")
	}
}
func TestCoverAndProtection(t *testing.T) {
	r := testRoom()
	now := time.Now()
	p := &Player{User: User{ID: 2}, X: -12.3, Z: -10, Health: 100, Connected: true}
	r.players[2] = p
	_, victim := r.trace(Vec{-12.3, 1, 0}, Vec{0, 0, -1}, 1, now)
	if victim != nil {
		t.Fatal("ray shot through crate")
	}
	p.X = 0
	p.ProtectedUntil = now.Add(time.Second).UnixMilli()
	_, victim = r.trace(Vec{0, 1, 0}, Vec{0, 0, -1}, 1, now)
	if victim != nil {
		t.Fatal("spawn protection ignored")
	}
	p.ProtectedUntil = 0
	_, victim = r.trace(Vec{0, 1, 0}, Vec{0, 0, -1}, 1, now)
	if victim != p {
		t.Fatal("unobstructed body not hit")
	}
}
func TestMovementReloadAndTimeout(t *testing.T) {
	r := testRoom()
	now := time.Now()
	p := &Player{User: User{ID: 1}, Health: 100, Ammo: 0, Connected: true, input: Input{X: 100, Z: 100, Sprint: true}, inputAt: now}
	r.players[1] = p
	r.step(now, .05)
	if math.Hypot(p.X, p.Z) > .351 {
		t.Fatal("client exceeded movement speed")
	}
	x, z := p.X, p.Z
	r.step(now.Add(time.Second), .05)
	if p.X != x || p.Z != z {
		t.Fatal("stale input keeps moving")
	}
	p.reload = true
	r.step(now.Add(time.Second), .05)
	if !p.Reloading {
		t.Fatal("reload did not start")
	}
	r.step(now.Add(3*time.Second), .05)
	if p.Ammo != 12 || p.Reloading {
		t.Fatal("reload did not finish")
	}
	r.EndAt = now.UnixMilli()
	if !r.step(now, .05) || r.State != "saving" {
		t.Fatal("timeout did not finish round")
	}
	if r.step(now, .05) {
		t.Fatal("round completed twice")
	}
	if canMove(145, 0, 0) || canMove(-12.3, -8.2, 0) {
		t.Fatal("island or crate collision missing")
	}
}
