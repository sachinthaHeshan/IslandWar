import * as THREE from 'three';
import { arena, groundHeight } from './gameplay.js';
import { createGun } from './character.js';

export function buildIsland(scene) {
  const materials=new Map();
  function mat(color){if(!materials.has(color))materials.set(color,new THREE.MeshStandardMaterial({color,roughness:.88}));return materials.get(color);}
  function mesh(geometry,material,parent=scene){const m=new THREE.Mesh(geometry,material);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  function box(w,h,d,color,x,y,z,parent=scene){const m=mesh(new THREE.BoxGeometry(w,h,d),mat(color),parent);m.position.set(x,y,z);return m;}
  function cylinder(rt,rb,h,color,x,y,z,parent=scene,n=12){const m=mesh(new THREE.CylinderGeometry(rt,rb,h,n),mat(color),parent);m.position.set(x,y,z);return m;}
  let seed=734;const random=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};
  const clockUniform={value:0};
  const oceanMaterial=new THREE.ShaderMaterial({uniforms:{time:clockUniform},vertexShader:`varying vec3 world; void main(){world=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.0);}`,fragmentShader:`varying vec3 world; uniform float time; void main(){float depth=clamp((length(world.xz-vec2(0.,-8.))-111.)/65.,0.,1.);float wave=sin(world.x*.3+world.z*.18+time*.6)*sin(world.z*.5-time*.4);float glint=pow(max(0.,wave),14.)*.17;vec3 col=mix(vec3(.18,.66,.63),vec3(.055,.30,.40),depth)+glint;gl_FragColor=vec4(col,1.);}`});
  const ocean=mesh(new THREE.PlaneGeometry(1400,1400),oceanMaterial);ocean.rotation.x=-Math.PI/2;ocean.position.y=-.65;ocean.castShadow=false;
  const shore=mesh(new THREE.CylinderGeometry(110,116,2,128),mat('#dfcea0'));shore.position.set(0,-1.03,-8);shore.castShadow=false;
  // Smooth terrain with vertex-colored sand, winding footpaths, and green slopes.
  const geometry=new THREE.PlaneGeometry(220,220,160,160);geometry.rotateX(-Math.PI/2);geometry.translate(0,0,-8);
  const position=geometry.attributes.position,colors=[];const sand=new THREE.Color('#e2cda0'),grass=new THREE.Color('#71915c'),pathColor=new THREE.Color('#c8b887');
  for(let i=0;i<position.count;i++){const x=position.getX(i),z=position.getZ(i),r=Math.hypot(x,z+8);position.setY(i,groundHeight(x,z));
    const c=grass.clone();const beach=THREE.MathUtils.smoothstep(r,86,103);c.lerp(sand,beach);
    const trail=Math.min(Math.abs(z-.32*x-8),Math.abs(x+Math.sin(z*.045)*8),Math.abs(z+.9*x+13));
    if(trail<2.4 || (Math.abs(x)<13&&z>-29&&z<14))c.lerp(pathColor,.84);
    c.multiplyScalar(.92+random()*.14);colors.push(c.r,c.g,c.b);
  }
  const indices=[];const index=geometry.index;for(let i=0;i<index.count;i+=3){const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)];if(ids.every(j=>Math.hypot(position.getX(j),position.getZ(j)+8)<110))indices.push(...ids);}
  geometry.setIndex(indices);geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();
  const ground=mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));ground.castShadow=false;
  const foam=[];
  for(let i=0;i<4;i++){const ring=mesh(new THREE.RingGeometry(111+i*3,111.18+i*3,160),new THREE.MeshBasicMaterial({color:'#def7e3',transparent:true,opacity:.2,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.set(0,-.58,-8);ring.castShadow=false;foam.push(ring);}
  // Cover is rendered from exactly the same definitions used by Go hit detection.
  const coverMeshes=[];
  for(const c of arena.cover){const group=new THREE.Group();group.position.set(c.x,groundHeight(c.x,c.z),c.z);scene.add(group);const base=box(c.w,c.h,c.d,c.type==='container'?'#62837a':c.type==='wall'?'#b2b29a':c.type==='rock'?'#909d85':'#8e7954',0,c.h/2,0,group);coverMeshes.push(base);
    if(c.type==='crate'){for(const y of [.12,c.h-.12])box(c.w+.025,.12,c.d+.025,'#4b5a42',0,y,0,group);for(const x of [-c.w*.32,c.w*.32])box(.10,c.h,.06,'#c4ad74',x,c.h/2,c.d/2+.03,group);}
    if(c.type==='container'){for(let x=-c.w/2+.25;x<c.w/2;x+=.45){box(.065,c.h-.2,.055,'#456960',x,c.h/2,c.d/2+.03,group);box(.065,c.h-.2,.055,'#456960',x,c.h/2,-c.d/2-.03,group);}box(c.w*.7,.12,.07,'#dfc57e',0,c.h*.7,c.d/2+.065,group);}
    if(c.type==='wall'){for(let y=.7;y<c.h;y+=.75)box(c.w+.015,.035,c.d+.015,'#87917a',0,y,0,group);box(c.w+.14,.18,c.d+.14,'#c4c2a8',0,c.h,0,group);}
    if(c.type==='rock'){base.material=mat('#9da88d');for(let j=0;j<3;j++){const rock=mesh(new THREE.DodecahedronGeometry(1,0),mat(j%2?'#859479':'#a1ad91'),group);rock.position.set((random()-.5)*c.w*.5,c.h*.55,(random()-.5)*c.d*.5);rock.scale.set(c.w*.5,c.h*.5,c.d*.5);rock.rotation.y=random()*5;}box(c.w*.8,.12,c.d*.8,'#748b58',0,c.h+.02,0,group);}
    if(c.type==='lighthouse'){base.visible=false;cylinder(2.3,2.5,17,'#ece5cb',0,8.5,0,group,20);cylinder(2.35,2.4,2,'#b7724c',0,11,0,group,20);cylinder(3.1,3.1,.25,'#596c5f',0,17,0,group,20);cylinder(1.8,1.8,2,'#619f9a',0,18,0,group,12);cylinder(0,3,1.5,'#b8744e',0,19.6,0,group,12);for(let a=0;a<Math.PI*2;a+=Math.PI/4)cylinder(.08,.08,2,'#eae1be',Math.sin(a)*1.8,18,Math.cos(a)*1.8,group,6);box(1.1,2.3,.12,'#45605a',0,1.15,2.51,group);}
  }
  // Instanced palms keep the expanded island affordable to render.
  const trees=[];
  for(let i=0;i<155;i++){const a=random()*Math.PI*2,r=25+Math.sqrt(random())*76,x=Math.cos(a)*r,z=Math.sin(a)*r-8;
    if(arena.cover.some(c=>Math.abs(x-c.x)<c.w/2+4&&Math.abs(z-c.z)<c.d/2+4)||arena.loot.some(l=>Math.hypot(x-l.x,z-l.z)<5)||Math.abs(x)<13&&z>-35&&z<18)continue;
    trees.push({x,z,h:6+random()*5,a:random()*6});
  }
  const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.16,.3,1,7),mat('#8e7953'),trees.length);trunks.castShadow=true;scene.add(trunks);
  const leafShape=new THREE.Shape();leafShape.moveTo(0,0);leafShape.quadraticCurveTo(.7,1.5,0,4.6);leafShape.quadraticCurveTo(-.7,1.5,0,0);
  const leafMat=new THREE.MeshStandardMaterial({color:'#577d48',roughness:1,side:THREE.DoubleSide});
  const leaves=new THREE.InstancedMesh(new THREE.ShapeGeometry(leafShape),leafMat,trees.length*7);leaves.castShadow=true;scene.add(leaves);
  const dummy=new THREE.Object3D();let li=0;
  trees.forEach((t,i)=>{const y=groundHeight(t.x,t.z);dummy.position.set(t.x,y+t.h/2,t.z);dummy.rotation.set(.07,0,.08);dummy.scale.set(1,t.h,1);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
    for(let j=0;j<7;j++){const a=j*Math.PI*2/7+t.a;dummy.position.set(t.x+.2,y+t.h-.2,t.z);dummy.rotation.set(-Math.PI/2,0,a);dummy.rotateX(.18+random()*.18);dummy.scale.set(1,1+random()*.2,1);dummy.updateMatrix();leaves.setMatrixAt(li,dummy.matrix);leaves.setColorAt(li,new THREE.Color(j%2?'#648b4a':'#456f43'));li++;}
  });
  const grassCount=1500;const tufts=new THREE.InstancedMesh(new THREE.ConeGeometry(.22,.75,3),mat('#678652'),grassCount);scene.add(tufts);
  for(let i=0;i<grassCount;i++){const a=random()*Math.PI*2,r=25+random()*66,x=Math.cos(a)*r,z=Math.sin(a)*r-8;dummy.position.set(x,groundHeight(x,z)+.2,z);dummy.rotation.set(0,random()*6,(random()-.5)*.25);dummy.scale.set(1,.5+random(),1);dummy.updateMatrix();tufts.setMatrixAt(i,dummy.matrix);}
  // Coastal rocks, a small dock, canvas shelters, and distant islands.
  const pebbleGeo=new THREE.DodecahedronGeometry(1,0);const pebbles=new THREE.InstancedMesh(pebbleGeo,mat('#a8b09a'),85);scene.add(pebbles);
  for(let i=0;i<85;i++){const a=random()*Math.PI*2,r=104+random()*7;dummy.position.set(Math.cos(a)*r,.2,Math.sin(a)*r-8);dummy.rotation.set(random(),random()*6,random());dummy.scale.set(1+random()*2,.6+random(),1+random()*2);dummy.updateMatrix();pebbles.setMatrixAt(i,dummy.matrix);}
  for(let i=0;i<22;i++)box(5,.2,.8,'#a58b60',-12,.15,87+i*.9);
  for(let i=0;i<5;i++)for(const x of [-14.2,-9.8])cylinder(.12,.12,2,'#7f7352',x,-.25,88+i*4);
  for(const [x,z] of [[-52,18],[6,45],[-41,-54]]){const y=groundHeight(x,z);for(const dx of [-3,3])for(const dz of [-2,2])cylinder(.07,.07,3,'#807453',x+dx,y+1.5,z+dz);const roof=mesh(new THREE.CylinderGeometry(0,4.4,1.5,4),mat('#c5ac72'));roof.position.set(x,y+3.2,z);roof.rotation.y=Math.PI/4;}
  for(let i=0;i<10;i++){const a=i*Math.PI*2/10;const m=mesh(new THREE.ConeGeometry(25+random()*20,18+random()*23,7),mat('#8baea0'));m.position.set(Math.cos(a)*270,0,Math.sin(a)*270);m.rotation.y=random()*6;}
  const birds=[];for(let i=0;i<7;i++){const b=new THREE.Group();for(const side of [-1,1]){const wing=box(1.2,.04,.22,'#e9e9ca',side*.5,0,0,b);wing.rotation.z=side*.2;}scene.add(b);birds.push(b);}
  // Openable supply chests show an actual weapon inside and replenish after 20 seconds.
  const chests=new Map();
  for(const l of arena.loot){const root=new THREE.Group();root.position.set(l.x,groundHeight(l.x,l.z),l.z);scene.add(root);
    box(1.9,.16,1.15,'#334d45',0,.15,0,root);for(const x of [-.89,.89])box(.13,.65,1.15,'#4c6451',x,.43,0,root);for(const z of [-.51,.51])box(1.9,.65,.13,'#4c6451',0,.43,z,root);
    const lid=new THREE.Group();lid.position.set(0,.79,-.56);root.add(lid);box(1.96,.16,1.2,'#8b9560',0,0,.56,lid);box(.18,.10,1.22,'#d6c285',0,.11,.56,lid);
    const gun=createGun(l.weapon);gun.position.set(.1,.43,0);gun.rotation.y=Math.PI/2;root.add(gun);
    const beacon=mesh(new THREE.CylinderGeometry(.018,.018,3.4,6),new THREE.MeshBasicMaterial({color:l.weapon==='sniper'?'#f8c97a':'#d6ef93',transparent:true,opacity:.5}),root);beacon.position.y=2.5;beacon.castShadow=false;
    const marker=mesh(new THREE.OctahedronGeometry(.18),new THREE.MeshBasicMaterial({color:l.weapon==='sniper'?'#f8c97a':'#d6ef93'}),root);marker.position.y=4.2;marker.castShadow=false;
    chests.set(l.id,{root,lid,gun,beacon,marker,opened:0,readyAt:0});
  }
  function update(time,dt,body,loot,now){clockUniform.value=time;for(const [id,c]of chests){c.readyAt=loot.get(id)||0;const empty=c.readyAt>now,near=Math.hypot(body.x-c.root.position.x,body.z-c.root.position.z)<4;c.opened=THREE.MathUtils.damp(c.opened,empty||near?1:0,8,dt);c.lid.rotation.x=-c.opened*1.9;c.gun.visible=!empty;c.beacon.visible=!empty;c.marker.visible=!empty;c.marker.rotation.y=time;c.marker.position.y=3.8+Math.sin(time*2+id)*.12;}
    foam.forEach((f,i)=>{const scale=1+Math.sin(time*.4+i)*.003;f.scale.setScalar(scale);});birds.forEach((b,i)=>{const a=time*.065+i;b.position.set(Math.cos(a)*70,24+Math.sin(time*.4+i)*2,Math.sin(a)*70-8);b.rotation.y=-a;b.children.forEach((w,j)=>w.rotation.z=(j?1:-1)*(.2+Math.sin(time*4+i)*.18));});
  }
  return {ground,coverMeshes,chests,update};
}
