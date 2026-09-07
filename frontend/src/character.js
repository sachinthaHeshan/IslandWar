import * as THREE from 'three';
const material = color => new THREE.MeshStandardMaterial({color,roughness:.8});
const metal=material('#283f41'),black=material('#172d30'),skin=material('#bb926b'),tan=material('#b39a66'),olive=material('#4a5a3f');
function piece(parent,w,h,d,mat,x,y,z) {const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;parent.add(m);return m;}
function joint(parent,x,y,z){const g=new THREE.Group();g.position.set(x,y,z);parent.add(g);return g;}

export const GUN_FLASH_Z = { pistol: -.55, ak47: -.91, sniper: -1.35, rpg: -1.15 };

export function createGun(type='pistol') {
  const root=new THREE.Group();
  if(type==='pistol'){
    piece(root,.11,.16,.38,metal,0,0,-.04);piece(root,.08,.08,.18,tan,0,-.01,.22);
    piece(root,.06,.06,.28,black,0,.01,-.18);piece(root,.09,.18,.12,black,0,-.12,-.1);
  }else if(type==='ak47'){
    piece(root,.15,.2,.65,metal,0,0,-.1);piece(root,.13,.13,.32,tan,0,-.015,.3);
    piece(root,.07,.07,.45,black,0,.015,-.61);piece(root,.12,.25,.18,black,0,-.2,-.12);piece(root,.1,.16,.12,tan,0,-.17,.16);
    piece(root,.045,.07,.08,tan,0,.17,-.28);const sight=new THREE.Mesh(new THREE.BoxGeometry(.045,.045,.12),black);sight.position.set(0,.24,-.12);root.add(sight);
    const lens=new THREE.Mesh(new THREE.CircleGeometry(.018,8),new THREE.MeshStandardMaterial({color:'#ff5a5a',emissive:'#ff3030',emissiveIntensity:.35}));lens.position.set(0,.24,-.185);lens.rotation.y=Math.PI;root.add(lens);
  }else if(type==='sniper'){
    piece(root,.15,.2,.65,metal,0,0,-.1);piece(root,.13,.13,.32,tan,0,-.015,.3);
    piece(root,.07,.07,.95,black,0,.015,-.86);piece(root,.12,.25,.18,black,0,-.2,-.12);piece(root,.045,.1,.23,metal,0,.14,-.12);
    const scope=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.4,12),black);scope.rotation.x=Math.PI/2;scope.position.set(0,.22,-.14);root.add(scope);
    const lens=new THREE.Mesh(new THREE.CircleGeometry(.067,12),new THREE.MeshStandardMaterial({color:'#72d9ca',metalness:.7,roughness:.18}));lens.position.set(0,.22,-.345);lens.rotation.y=Math.PI;root.add(lens);
  }else if(type==='rpg'){
    piece(root,.16,.16,.95,olive,0,0,-.35);piece(root,.22,.22,.28,metal,0,0,.15);
    piece(root,.12,.12,1.05,black,0,.01,-.95);const warhead=new THREE.Mesh(new THREE.ConeGeometry(.14,.42,8),olive);warhead.rotation.x=-Math.PI/2;warhead.position.set(0,.01,-1.38);root.add(warhead);
    piece(root,.08,.28,.16,black,0,-.18,-.05);
  }
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
  const weaponMount=joint(torso,.39,.18,-.57);let weapon=createGun('pistol');weaponMount.add(weapon);
  const flash=new THREE.Mesh(new THREE.OctahedronGeometry(.15),new THREE.MeshBasicMaterial({color:'#ffe8a5'}));flash.position.set(0,.02,GUN_FLASH_Z.pistol);flash.visible=false;weaponMount.add(flash);
  let label;
  if(username){const canvas=document.createElement('canvas');canvas.width=512;canvas.height=80;const ctx=canvas.getContext('2d');ctx.fillStyle='#123c36dd';ctx.fillRect(0,0,512,80);ctx.fillStyle='#eff7df';ctx.font='bold 29px sans-serif';ctx.textAlign='center';ctx.fillText(username,256,51);label=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas)}));label.position.y=2.8;label.scale.set(2.6,.41,1);root.add(label);}
  let currentWeapon='pistol',phase=0,blend=0,flashTime=0;
  function equip(type){if(type===currentWeapon)return;currentWeapon=type;weaponMount.remove(weapon);weapon.traverse(o=>{o.geometry?.dispose();});weapon=createGun(type);weaponMount.add(weapon);flash.position.z=GUN_FLASH_Z[type]??GUN_FLASH_Z.pistol;}
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
