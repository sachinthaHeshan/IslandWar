package main

import (
 "encoding/json"
 _ "embed"
 "math"
 "time"
)

// One map and weapon definition is consumed by both Go and Three.js.
//go:embed arena.json
var arenaJSON []byte
type Cover struct { Type string; X, Z, W, H, D float64 }
type Hill struct { X,Z,Height,Width float64 }
type LootDefinition struct { ID int `json:"id"`; X float64 `json:"x"`; Z float64 `json:"z"`; Weapon string `json:"weapon"` }
type LootState struct { ID int `json:"id"`; ReadyAt int64 `json:"readyAt"` }
type WeaponDefinition struct { Name string; Magazine,Damage int; Cooldown,Reload,Range,Fov float64 }
type Arena struct { Radius,PlayRadius,CenterZ,WalkSpeed,SprintSpeed,AimSpeed,Acceleration,Gravity,JumpSpeed float64; Hills []Hill; Cover []Cover; Loot []LootDefinition; Weapons map[string]WeaponDefinition }
var arena = func()Arena{var a Arena;if err:=json.Unmarshal(arenaJSON,&a);err!=nil{panic(err)};return a}()
func groundHeight(x,z float64)float64{
 radial:=math.Hypot(x,z-arena.CenterZ)
 blend:=math.Max(0,math.Min(1,(radial-28)/15))
 height:=0.0
 for _,h:=range arena.Hills{d:=((x-h.X)*(x-h.X)+(z-h.Z)*(z-h.Z))/(h.Width*h.Width);height+=h.Height*math.Exp(-d)}
 return height*blend*math.Max(0,math.Min(1,(arena.Radius-radial)/14))
}
func weaponFor(p *Player)WeaponDefinition{if w,ok:=arena.Weapons[p.Weapon];ok{return w};return arena.Weapons["rifle"]}
func canMove(x,z float64)bool{
 if math.Hypot(x,z-arena.CenterZ)>=arena.PlayRadius{return false}
 for _,c:=range arena.Cover{if math.Abs(x-c.X)<c.W/2+.38&&math.Abs(z-c.Z)<c.D/2+.38{return false}}
 return true
}
func approach(value,target,step float64)float64{if value<target{return math.Min(value+step,target)};return math.Max(value-step,target)}
func movePlayer(p *Player,now time.Time,dt float64){
 fresh:=p.Connected&&now.Sub(p.inputAt)<250*time.Millisecond
 x,z:=0.0,0.0;p.Aiming=false;p.Sprinting=false
 if fresh {p.Yaw=p.input.Yaw;p.Pitch=p.input.Pitch;x=p.input.X;z=p.input.Z;p.Aiming=p.input.Aim&&!p.Reloading;p.Sprinting=p.input.Sprint&&!p.Aiming&&math.Hypot(x,z)>.1}
 speed:=arena.WalkSpeed;if p.Sprinting{speed=arena.SprintSpeed};if p.Aiming{speed=arena.AimSpeed}
 if l:=math.Hypot(x,z);l>1{x/=l;z/=l}
 targetX:=(x*math.Cos(p.Yaw)+z*math.Sin(p.Yaw))*speed;targetZ:=(-x*math.Sin(p.Yaw)+z*math.Cos(p.Yaw))*speed
 p.VX=approach(p.VX,targetX,arena.Acceleration*dt);p.VZ=approach(p.VZ,targetZ,arena.Acceleration*dt)
 if !fresh{p.VX=0;p.VZ=0}
 if canMove(p.X+p.VX*dt,p.Z){p.X+=p.VX*dt}else{p.VX=0}
 if canMove(p.X,p.Z+p.VZ*dt){p.Z+=p.VZ*dt}else{p.VZ=0}
 ground:=groundHeight(p.X,p.Z)
 if p.jump&&fresh&&p.Grounded{p.VY=arena.JumpSpeed;p.Grounded=false};p.jump=false
 p.VY-=arena.Gravity*dt;p.Y+=p.VY*dt
 if p.Y<=ground{p.Y=ground;p.VY=0;p.Grounded=true}else{p.Grounded=false}
}
func(r *Room)pickup(p *Player,now time.Time){
 if p.Health<=0||!p.Connected||r.State!="running"{return}
 if r.loot==nil{r.loot=map[int]int64{}}
 var closest *LootDefinition;distance:=3.0
 for i:=range arena.Loot{l:=&arena.Loot[i];d:=math.Hypot(p.X-l.X,p.Z-l.Z);if d<distance&&r.loot[l.ID]<=now.UnixMilli()&&math.Abs(p.Y-groundHeight(l.X,l.Z))<2.5{distance=d;closest=l}}
 if closest==nil{return}
 p.Weapon=closest.Weapon;p.Ammo=weaponFor(p).Magazine;p.Reloading=false;p.reload=false;p.Aiming=false;p.reloadEnd=time.Time{}
 r.loot[closest.ID]=now.Add(20*time.Second).UnixMilli()
 r.events=append(r.events,Event{Type:"pickup",Shooter:p.ID,Weapon:p.Weapon})
}
func(r *Room)lootSnapshot()[]LootState{states:=make([]LootState,0,len(arena.Loot));for _,l:=range arena.Loot{states=append(states,LootState{ID:l.ID,ReadyAt:r.loot[l.ID]})};return states}

// Marching uses the same smooth terrain surface rendered by the client.
func terrainDistance(origin,dir Vec,max float64)float64{for d:=.25;d<max;d+=.5{p:=origin.add(dir.mul(d));if math.Hypot(p.X,p.Z-arena.CenterZ)<arena.Radius&&p.Y<groundHeight(p.X,p.Z){return d}};return max}
