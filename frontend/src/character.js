import * as THREE from 'three';
const material = color => new THREE.MeshStandardMaterial({color,roughness:.8});
const metal=material('#283f41'),black=material('#172d30'),skin=material('#bb926b'),tan=material('#b39a66');
function piece(parent,w,h,d,mat,x,y,z) {const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;parent.add(m);return m;}
function joint(parent,x,y,z){const g=new THREE.Group();g.position.set(x,y,z);parent.add(g);return g;}
export function createGun(type='rifle') {
  const root=new THREE.Group();const sniper=type==='sniper';
  piece(root,.15,.2,.65,metal,0,0,-.1);piece(root,.13,.13,.32,tan,0,-.015,.3);
  piece(root,.07,.07,sniper?.95:.45,black,0,.015,sniper?-.86:-.61);
  piece(root,.12,.25,.18,black,0,-.2,-.12);piece(root,.1,.16,.12,tan,0,-.17,.16);
  if(sniper){const scope=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.4,12),black);scope.rotation.x=Math.PI/2;scope.position.set(0,.22,-.14);root.add(scope);piece(root,.045,.1,.23,metal,0,.14,-.12);
    const lens=new THREE.Mesh(new THREE.CircleGeometry(.067,12),new THREE.MeshStandardMaterial({color:'#72d9ca',metalness:.7,roughness:.18}));lens.position.set(0,.22,-.345);lens.rotation.y=Math.PI;root.add(lens);
  }else{piece(root,.045,.07,.08,tan,0,.17,-.28);}
  return root;
}
export function createCharacter(color='#64745b',username='') {
  const root=new THREE.Group(),rig=joint(root,0,0,0),torso=joint(rig,0,1.2,0);
  const cloth=material(color),vest=material('#354c42');
  piece(torso,.65,.75,.39,cloth,0,.16,0);piece(torso,.72,.5,.48,vest,0,.2,0);
  piece(torso,.48,.5,.2,vest,0,.2,.3);
  for(const x of [-.23,0,.23])piece(torso,.16,.19,.14,tan,x,.05,-.29);
  const head=joint(torso,0,.79,0);
  const face=new THREE.Mesh(new THREE.SphereGeometry(.245,12,10),skin);face.scale.y=1.15;head.add(face);face.castShadow=true;
  const helmet=new THREE.Mesh(new THREE.SphereGeometry(.285,12,8,0,Math.PI*2,0,Math.PI*.62),vest);helmet.position.y=.12;head.add(helmet);helmet.castShadow=true;
  piece(head,.42,.10,.09,black,0,.01,-.23);piece(head,.44,.08,.08,tan,0,-.17,-.18);
  const legs=[];
  for(const x of [-.2,.2]){const hip=joint(rig,x,1.0,0);piece(hip,.28,.46,.3,cloth,0,-.22,0);const knee=joint(hip,0,-.44,0);piece(knee,.25,.42,.27,cloth,0,-.19,0);piece(knee,.27,.15,.13,vest,0,-.025,-.15);piece(knee,.29,.18,.45,black,0,-.45,-.09);legs.push({hip,knee});}
  const arms=[];
  for(const x of [-.45,.45]){const shoulder=joint(torso,x,.45,0);piece(shoulder,.23,.39,.25,cloth,0,-.18,0);const elbow=joint(shoulder,0,-.35,0);piece(elbow,.2,.35,.22,cloth,0,-.15,0);piece(elbow,.18,.17,.19,skin,0,-.36,0);arms.push({shoulder,elbow});}
  const weaponMount=joint(torso,.39,.18,-.57);let weapon=createGun('rifle');weaponMount.add(weapon);
  const flash=new THREE.Mesh(new THREE.OctahedronGeometry(.15),new THREE.MeshBasicMaterial({color:'#ffe8a5'}));flash.position.set(0,.02,-.9);flash.visible=false;weaponMount.add(flash);
  let label;
  if(username){const canvas=document.createElement('canvas');canvas.width=512;canvas.height=80;const ctx=canvas.getContext('2d');ctx.fillStyle='#123c36dd';ctx.fillRect(0,0,512,80);ctx.fillStyle='#eff7df';ctx.font='bold 29px sans-serif';ctx.textAlign='center';ctx.fillText(username,256,51);label=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas)}));label.position.y=2.8;label.scale.set(2.6,.41,1);root.add(label);}
  let currentWeapon='rifle',phase=0,blend=0,flashTime=0;
  function equip(type){if(type===currentWeapon)return;currentWeapon=type;weaponMount.remove(weapon);weapon.traverse(o=>{o.geometry?.dispose();});weapon=createGun(type);weaponMount.add(weapon);flash.position.z=type==='sniper'?-1.35:-.9;}
  function update(dt,{speed=0,sprinting=false,aiming=false,grounded=true,pitch=0,reloading=false,strafe=0}={}){
    blend=THREE.MathUtils.damp(blend,Math.min(1,speed/6),10,dt);phase+=speed*dt*1.6;
    const stride=(sprinting?.82:.57)*blend;
    rig.position.y=grounded?Math.abs(Math.sin(phase))*blend*.055:0;
    torso.rotation.x=THREE.MathUtils.damp(torso.rotation.x,sprinting?.19:aiming?-.015:.025,10,dt);
    torso.rotation.z=THREE.MathUtils.damp(torso.rotation.z,-strafe*.075*blend,10,dt);
    head.rotation.x=-pitch*.3;
    legs.forEach(({hip,knee},i)=>{const cycle=phase+i*Math.PI;hip.rotation.x=grounded?Math.sin(cycle)*stride:-.5+i*.4;knee.rotation.x=grounded?Math.max(0,-Math.sin(cycle))*.95*blend:.9;});
    arms.forEach(({shoulder,elbow},i)=>{shoulder.rotation.x=sprinting?Math.sin(phase+i*Math.PI)*.6*blend:-.75-pitch*.25;shoulder.rotation.z=i===0?-.10:.1;elbow.rotation.x=sprinting?-.85:-1.0;});
    weaponMount.rotation.x=reloading?-.75:-pitch*.5+(sprinting?.25:0);weaponMount.rotation.z=reloading?-.55:0;
    weaponMount.position.y=.18+(reloading?-.12:0);flashTime-=dt;flash.visible=flashTime>0;
  }
  function dispose(){root.traverse(o=>{o.geometry?.dispose();});label?.material.map.dispose();label?.material.dispose();cloth.dispose();vest.dispose();}
  return {root,equip,update,dispose,flash(){flashTime=.065;},label};
}
