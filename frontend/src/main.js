import * as THREE from 'three';
import './style.css';
import { createMultiplayer } from './multiplayer.js';

const $ = id => document.getElementById(id);
const canvas = $('game');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); }
catch { $('error').hidden = false; $('error').textContent = 'This game needs WebGL. Please open it in a browser with hardware acceleration enabled.'; throw new Error('WebGL unavailable'); }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#91bdb9');
scene.fog = new THREE.Fog('#91bdb9', 42, 130);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, .1, 200);
scene.add(new THREE.HemisphereLight('#d5eee8', '#9c9268', 2.4));
const sun = new THREE.DirectionalLight('#fff0c5', 3.4);
sun.position.set(-25, 40, 20); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left:-40, right:40, top:40, bottom:-40, far:120 });
sun.shadow.bias = -.0005; scene.add(sun);
const mat = (color, extra={}) => new THREE.MeshStandardMaterial({color, roughness:.85, ...extra});
const sand = mat('#cabd8f'), green = mat('#748b55'), dark = mat('#273d35'), wood = mat('#74644a'), metal = mat('#344642');
function mesh(geo, material, x=0,y=0,z=0, parent=scene) { const m = new THREE.Mesh(geo,material); m.position.set(x,y,z); m.castShadow=true; m.receiveShadow=true; parent.add(m); return m; }
function box(w,h,d,material,x,y,z,parent=scene){return mesh(new THREE.BoxGeometry(w,h,d),material,x,y,z,parent);}
function cylinder(rt,rb,h,material,x,y,z,parent=scene,n=10){return mesh(new THREE.CylinderGeometry(rt,rb,h,n),material,x,y,z,parent);}
// Deterministic environment generation keeps the course consistent between rounds.
let seed=72; function random(){seed=(seed*16807)%2147483647;return(seed-1)/2147483646;}
const water=mesh(new THREE.PlaneGeometry(500,500),mat('#548f89',{metalness:.3,roughness:.28}),0,-.48,0);water.rotation.x=-Math.PI/2;water.castShadow=false;
cylinder(29,32,1,sand,0,-.5,-8,scene,64);
const ground=mesh(new THREE.CircleGeometry(25,64),sand,0,.012,-8);ground.rotation.x=-Math.PI/2;ground.castShadow=false;
// Shallow water contours.
for(let i=0;i<4;i++){const ring=mesh(new THREE.RingGeometry(31+i*3,31.06+i*3,100),new THREE.MeshBasicMaterial({color:'#c9e1ce',transparent:true,opacity:.12,side:THREE.DoubleSide}),0,-.4,-8);ring.rotation.x=-Math.PI/2;}
const blockers=[];
function rock(x,z,size){const m=mesh(new THREE.DodecahedronGeometry(size,0),mat('#a2a48b'),x,size*.35,z);m.scale.set(1,.65,.85);m.rotation.set(random(),random()*5,random());}
for(let i=0;i<42;i++){const a=random()*Math.PI*2,r=26+random()*3;rock(Math.cos(a)*r,Math.sin(a)*r-8,.5+random()*1.7);}
function palm(x,z,height){const group=new THREE.Group();group.position.set(x,0,z);scene.add(group);const trunk=cylinder(.17,.32,height,wood,.5,height/2,0,group);trunk.rotation.z=-.10;for(let j=0;j<7;j++){const a=j*Math.PI*2/7;const shape=new THREE.Shape();shape.moveTo(0,0);shape.quadraticCurveTo(.7,1.5,.05,4.4);shape.quadraticCurveTo(-.6,1.5,0,0);const leaf=mesh(new THREE.ShapeGeometry(shape),mat(j%2?'#536f40':'#66854a',{side:THREE.DoubleSide}),.9,height,0,group);leaf.rotation.set(-.55,a,0);leaf.rotateZ(a);leaf.rotation.x=-1.1; } }
[[-16,4,8],[-20,-10,9],[-13,-23,8],[16,-19,9],[21,-7,7],[19,6,9],[-23,-4,7],[8,-30,8]].forEach(p=>palm(...p));
for(let i=0;i<100;i++){let x=(random()-.5)*48,z=(random()-.5)*47-8;if(Math.abs(x)<10&&z>-24)continue;const tuft=new THREE.Group();scene.add(tuft);tuft.position.set(x,.02,z);for(let k=0;k<3;k++){const blade=mesh(new THREE.ConeGeometry(.12,.5+random()*.5,3),green,(random()-.5)*.4,.25,(random()-.5)*.4,tuft);blade.rotation.z=(random()-.5)*.5;}}
function crate(x,z,s=1.6){box(s,s,s,wood,x,s/2,z);for(const dy of [.14,s-.14])box(s+.04,.12,s+.04,dark,x,dy,z);box(.12,s+.02,s+.05,dark,x,s/2,z);blockers.push({x,z,r:s*.72});}
[[-9,-6],[-10.5,-8],[10,-9],[12,-18],[-7,-20]].forEach(p=>crate(...p));
// Range boundary and marker lines.
for(let z=2;z>=-23;z-=5){for(const x of [-12,12]){cylinder(.065,.065,.8,wood,x,.4,z);}}
for(const x of [-12,12]){box(.035,.035,25,wood,x,.65,-10.5);}
for(let i=0;i<3;i++){box(15,.018,.08,mat('#e8d9ad'),0,.03,-3-i*7);}
// Distant low-poly islands.
for(let i=0;i<9;i++){const x=-100+i*25;const mountain=mesh(new THREE.ConeGeometry(13+random()*12,9+random()*12,5),mat('#739c8e'),x,2,-90-random()*20);mountain.rotation.y=random()*4;}
// Third-person operator, facing local -Z.
const player=new THREE.Group();scene.add(player);player.position.set(0,0,8);
const uniform=mat('#586553'), vest=mat('#35473d'), skin=mat('#bd9876'), boots=mat('#29352f');
box(.72,.85,.42,uniform,0,1.3,0,player);box(.77,.58,.49,vest,0,1.34,0,player);
for(const x of [-.22,0,.22])box(.16,.21,.12,wood,x,1.2,-.3,player);
const head=mesh(new THREE.SphereGeometry(.255,10,8),skin,0,1.98,0,player);head.scale.y=1.1;
mesh(new THREE.SphereGeometry(.285,10,8,0,Math.PI*2,0,Math.PI*.64),vest,0,2.09,0,player);
box(.43,.11,.11,dark,0,2,-.235,player);
const legs=[];for(const x of [-.21,.21]){const leg=new THREE.Group();leg.position.set(x,.95,0);player.add(leg);box(.28,.73,.3,uniform,0,-.34,0,leg);box(.3,.22,.46,boots,0,-.81,-.08,leg);legs.push(leg);}
const arms=[];for(const x of [-.49,.49]){const arm=box(.24,.65,.25,uniform,x,1.38,-.14,player);arm.rotation.x=-.8;arms.push(arm);mesh(new THREE.SphereGeometry(.13,8,6),skin,x,1.18,-.42,player);}
const gun=new THREE.Group();gun.position.set(.44,1.34,-.5);player.add(gun);
box(.14,.2,.65,metal,0,0,-.15,gun);box(.09,.08,.47,dark,0,.025,-.65,gun);box(.12,.24,.17,dark,0,-.16,-.15,gun);box(.13,.12,.22,wood,0,0,.2,gun);box(.06,.06,.14,dark,0,.14,-.22,gun);
const flash=mesh(new THREE.SphereGeometry(.15,6,4),new THREE.MeshBasicMaterial({color:'#fff0a2'}),0,.025,-.91,gun);flash.visible=false;
const targets=[];const targetMeshes=[];
const positions=[[-5,-5],[3,-8],[8,-13],[-7,-14],[0,-17],[-4,-23],[6,-24],[1,-29]];
positions.forEach(([x,z],i)=>{const g=new THREE.Group();g.position.set(x,0,z);scene.add(g);cylinder(.055,.07,1.8,metal,0,.9,0,g);box(.9,.13,.65,wood,0,.07,0,g);const plate=mesh(new THREE.CylinderGeometry(.64,.64,.12,32),mat('#eee8cc'),0,2,0,g);plate.rotation.x=Math.PI/2;targetMeshes.push(plate);for(const [r,c,depth] of [[.46,'#c8643e',.071],[.29,'#e9dfbb',.078],[.13,'#c8643e',.085]]){const circle=mesh(new THREE.CircleGeometry(r,32),mat(c),0,2,depth,g);targetMeshes.push(circle);}const t={group:g,alive:true,index:i};g.traverse(o=>o.userData.target=t);targets.push(t);});
let yaw=0,pitch=-.06,active=false,complete=false,ammo=12,reloading=0,hits=0,shots=0,elapsed=0,shotCooldown=0,flashTime=0,hitTime=0,muted=false;
const keys=new Set(), ray=new THREE.Raycaster(),clock=new THREE.Clock();const tracers=[];let audio;
function sound(hit=false){if(muted)return;try{audio??=new (window.AudioContext||window.webkitAudioContext)();audio.resume();const osc=audio.createOscillator(),gain=audio.createGain();osc.type=hit?'sine':'triangle';osc.frequency.setValueAtTime(hit?880:135,audio.currentTime);osc.frequency.exponentialRampToValueAtTime(hit?440:40,audio.currentTime+.12);gain.gain.setValueAtTime(.10,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.15);osc.connect(gain);gain.connect(audio.destination);osc.start();osc.stop(audio.currentTime+.16);}catch{}}
function updateHUD(){if(multiplayer.state.connected){updateNetworkHUD();return;}$('ammo').textContent=reloading?'··':String(ammo).padStart(2,'0');$('hits').textContent=String(hits).padStart(2,'0');$('accuracy').textContent=shots?Math.round(hits/shots*100)+'%':'—';$('timer').textContent=String(Math.floor(elapsed/60)).padStart(2,'0')+':'+String(Math.floor(elapsed%60)).padStart(2,'0');}
function reset(){targets.forEach(t=>{t.alive=true;t.group.visible=true;});player.position.set(0,0,8);yaw=0;pitch=-.06;ammo=12;hits=shots=elapsed=reloading=0;complete=false;$('result').hidden=true;updateHUD();}
function play(){if(multiplayer.state.connected && multiplayer.state.snapshot?.state!=='running'){multiplayer.show();return;}if(complete)reset();Promise.resolve(canvas.requestPointerLock?.()).catch(()=>{$('start-hint').textContent='Mouse capture unavailable. Try opening the game in a browser tab.';});}
$('play').onclick=play;$('again').onclick=()=>{reset();play();};
$('sound').onclick=()=>{muted=!muted;$('sound').textContent=muted?'SOUND OFF ↗':'SOUND ON ↗';};
document.addEventListener('pointerlockchange',()=>{active=document.pointerLockElement===canvas;document.body.classList.toggle('playing',active);$('start').style.display=active||complete?'none':'flex';if(!active){keys.clear();$('play').innerHTML='RESUME THE RANGE <span>↗</span>';}});
document.addEventListener('pointerlockerror',()=>{$('start-hint').textContent='Allow mouse capture, then click to try again.';});
addEventListener('keydown',e=>{if(active&&['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.code==='KeyR'&&active&&multiplayer.state.connected){multiplayer.send({type:'reload'});return;}if(e.code==='KeyR'&&active&&ammo<12&&!reloading){reloading=1.3;updateHUD();}});
addEventListener('keyup',e=>keys.delete(e.code));addEventListener('blur',()=>{keys.clear();if(active)document.exitPointerLock();});
document.addEventListener('mousemove',e=>{if(!active)return;yaw-=e.movementX*.0022;pitch=THREE.MathUtils.clamp(pitch-e.movementY*.0018,-.55,.42);});
function shoot(){if(multiplayer.state.connected){if(active&&multiplayer.state.snapshot?.state==='running'){sendNetworkInput();multiplayer.send({type:'shoot'});}return;}if(!active||complete||reloading||shotCooldown>0)return;if(ammo===0){reloading=1.3;updateHUD();return;}ammo--;shots++;shotCooldown=.18;flashTime=.055;flash.visible=true;sound();ray.setFromCamera(new THREE.Vector2(0,0),camera);const surfaces=targetMeshes.filter(o=>o.userData.target.alive);const obstacles=scene.children.filter(o=>o.isMesh&&o!==water);const intersects=ray.intersectObjects([...surfaces,...obstacles],false);const end=intersects[0]?.point||ray.ray.at(70,new THREE.Vector3());const start=flash.getWorldPosition(new THREE.Vector3());const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([start,end]),new THREE.LineBasicMaterial({color:'#ffe6a4',transparent:true,opacity:.85}));scene.add(line);tracers.push({line,life:.065});const target=intersects[0]?.object.userData.target;if(target?.alive){target.alive=false;target.group.visible=false;hits++;hitTime=.65;sound(true);if(hits===8){complete=true;setTimeout(()=>{document.exitPointerLock();$('result').hidden=false;$('result-text').textContent=`8 targets cleared in ${Math.floor(elapsed)} seconds. ${Math.round(hits/shots*100)}% accuracy · ${shots} shots fired.`;},250);}}updateHUD();}
addEventListener('mousedown',e=>{if(e.button===0)shoot();});
function updateCamera(){const forward=new THREE.Vector3(-Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));const right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));const pivot=player.position.clone().add(new THREE.Vector3(0,1.75,0));camera.position.copy(pivot).addScaledVector(forward,-5.4).addScaledVector(right,.85).add(new THREE.Vector3(0,.65,0));camera.lookAt(camera.position.clone().addScaledVector(forward,30));}
function frame(){requestAnimationFrame(frame);const dt=Math.min(clock.getDelta(),.05);if(multiplayer.state.connected){networkFrame(dt);}if(active&&!complete&&!multiplayer.state.connected){elapsed+=dt;const move=new THREE.Vector3((keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0),0,(keys.has('KeyS')?1:0)-(keys.has('KeyW')?1:0));if(move.lengthSq()){move.normalize().applyAxisAngle(new THREE.Vector3(0,1,0),yaw).multiplyScalar(dt*(keys.has('ShiftLeft')||keys.has('ShiftRight')?7:4));const next=player.position.clone().add(move);if(Math.hypot(next.x,next.z+8)<24&&!blockers.some(b=>Math.hypot(next.x-b.x,next.z-b.z)<b.r+.35))player.position.copy(next);legs.forEach((leg,i)=>leg.rotation.x=Math.sin(elapsed*12+i*Math.PI)*.45);}else legs.forEach(l=>l.rotation.x*=.8);player.rotation.y=yaw;shotCooldown=Math.max(0,shotCooldown-dt);if(reloading){reloading=Math.max(0,reloading-dt);gun.rotation.x=-.5;if(!reloading){ammo=12;gun.rotation.x=0;}}updateHUD();}flashTime-=dt;flash.visible=flashTime>0;hitTime-=dt;$('hitmarker').style.opacity=hitTime>0?'1':'0';$('toast').style.opacity=hitTime>0?'1':'0';for(let i=tracers.length-1;i>=0;i--){const t=tracers[i];t.life-=dt;if(t.life<=0){scene.remove(t.line);t.line.geometry.dispose();t.line.material.dispose();tracers.splice(i,1);}}updateCamera();renderer.render(scene,camera);}
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});

const remotePlayers = new Map();
let networkSelf = null;
const originalStats = document.querySelector('.topstats').innerHTML;
const originalToast = $('toast').innerHTML;
const multiplayer = createMultiplayer({
  onSnapshot(snapshot, previous, selfID) {
    document.body.classList.add('multiplayer');
    targets.forEach(t=>t.group.visible=false);
    $('start').style.display=active||snapshot.state!=='running'?'none':'flex';
    $('start-label').textContent='FREE-FOR-ALL · MATCH IS LIVE';
    $('play').innerHTML='DEPLOY TO ISLAND <span>↗</span>';
    if(!document.getElementById('net-kills')) document.querySelector('.topstats').innerHTML='<div><small>SCORE</small><strong id="net-kills">0</strong></div><div><small>HEALTH</small><strong id="net-health">100</strong></div><div><small>TIME LEFT</small><strong id="net-timer">03:00</strong></div>';
    const me=snapshot.players.find(p=>p.id===selfID);
    if(me){
      const wasDead=networkSelf?.health===0;
      networkSelf=me;
      if(!previous||previous.matchId!==snapshot.matchId||(wasDead&&me.health>0)){
        player.position.set(me.x,0,me.z);yaw=me.yaw;pitch=-.06;
      }
      player.visible=me.health>0;
      document.body.classList.toggle('dead',me.health===0);
    }
    const existing=new Set();
    for(const opponent of snapshot.players){
      if(opponent.id===selfID)continue;existing.add(opponent.id);
      let remote=remotePlayers.get(opponent.id);
      if(!remote){
        const model=player.clone(true);model.traverse(o=>{if(o.isMesh&&o.material===uniform){o.material=mat('#a76d4d');}});
        // Muzzle flash is the only basic-material sphere in the operator model.
        model.traverse(o=>{if(o.isMesh&&o.material.isMeshBasicMaterial)o.visible=false;});
        const labelCanvas=document.createElement('canvas');labelCanvas.width=512;labelCanvas.height=80;
        const ctx=labelCanvas.getContext('2d');ctx.fillStyle='rgba(17,44,37,.8)';ctx.fillRect(0,0,512,80);ctx.font='bold 30px sans-serif';ctx.textAlign='center';ctx.fillStyle='#eaf2dd';ctx.fillText(opponent.username,256,52);
        const label=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(labelCanvas),depthTest:false}));label.position.set(0,2.8,0);label.scale.set(2.7,.42,1);model.add(label);scene.add(model);
        remote={model,data:opponent,label};remotePlayers.set(opponent.id,remote);model.position.set(opponent.x,0,opponent.z);
      }
      remote.data=opponent;remote.model.visible=opponent.connected&&opponent.health>0;
      remote.label.material.color.set(opponent.protectedUntil>snapshot.now?'#dbea92':'#ffffff');
    }
    for(const [id,remote] of remotePlayers){if(!existing.has(id)){scene.remove(remote.model);remote.label.material.map.dispose();remote.label.material.dispose();remotePlayers.delete(id);}}
    for(const event of snapshot.events||[]){
      if(event.type!=='shot')continue;
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(event.start.x,event.start.y,event.start.z),new THREE.Vector3(event.end.x,event.end.y,event.end.z)]),new THREE.LineBasicMaterial({color:event.shooter===selfID?'#ffe6a4':'#ffa17c',transparent:true,opacity:.9}));scene.add(line);tracers.push({line,life:.10});
      if(event.shooter===selfID){flashTime=.07;sound();if(event.victim){hitTime=.65;$('toast').textContent=event.kill?'ELIMINATION +1':'HIT · 25 DAMAGE';sound(true);}}
      if(event.victim===selfID){$('net-message').textContent=event.kill?'Eliminated. Respawning…':'Taking fire!';}
    }
    if(snapshot.state!=='running'){document.exitPointerLock?.();keys.clear();}
    updateNetworkHUD();
  },
  onEnter(){complete=false;$('result').hidden=true;play();},
  onDisconnect(){document.exitPointerLock?.();keys.clear();},
  onExit(){
    document.body.classList.remove('multiplayer','dead');
    for(const remote of remotePlayers.values()){scene.remove(remote.model);remote.label.material.map.dispose();remote.label.material.dispose();}remotePlayers.clear();networkSelf=null;player.visible=true;
    document.querySelector('.topstats').innerHTML=originalStats;$('toast').innerHTML=originalToast;
    $('start-label').textContent='YOUR RANGE. YOUR PACE.';$('play').innerHTML='ENTER THE RANGE <span>↗</span>';$('start').style.display='flex';
    document.querySelector('.health span').textContent='100';document.querySelectorAll('.health i').forEach(bar=>bar.style.opacity='1');gun.rotation.x=0;reset();
  }
});
function updateNetworkHUD(){
  const snap=multiplayer.state.snapshot;if(!snap||!networkSelf)return;
  const seconds=Math.max(0,Math.ceil((snap.endAt-snap.now)/1000));
  if($('net-kills')){$('net-kills').textContent=networkSelf.kills;$('net-health').textContent=networkSelf.health;$('net-timer').textContent=snap.state==='lobby'?'03:00':String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');}
  $('ammo').textContent=networkSelf.reloading?'··':String(networkSelf.ammo).padStart(2,'0');
  document.querySelector('.health span').textContent=networkSelf.health;
  document.querySelectorAll('.health i').forEach((bar,i)=>bar.style.opacity=networkSelf.health>i*20?'1':'.15');
}
function sendNetworkInput(){
  if(!multiplayer.state.connected)return;
  multiplayer.send({type:'input',x:active?(Number(keys.has('KeyD'))-Number(keys.has('KeyA'))):0,z:active?(Number(keys.has('KeyS'))-Number(keys.has('KeyW'))):0,yaw,pitch,sprint:active&&(keys.has('ShiftLeft')||keys.has('ShiftRight'))});
}
setInterval(sendNetworkInput,50);
function networkFrame(dt){
  if(networkSelf){player.position.lerp(new THREE.Vector3(networkSelf.x,0,networkSelf.z),1-Math.exp(-25*dt));player.rotation.y=yaw;gun.rotation.x=networkSelf.reloading?-.5:0;const moving=active&&['KeyW','KeyA','KeyS','KeyD'].some(k=>keys.has(k));legs.forEach((leg,i)=>leg.rotation.x=moving?Math.sin(performance.now()*.012+i*Math.PI)*.45:0);}
  for(const remote of remotePlayers.values()){remote.model.position.lerp(new THREE.Vector3(remote.data.x,0,remote.data.z),1-Math.exp(-18*dt));remote.model.rotation.y=remote.data.yaw;}
}
updateCamera();frame();
