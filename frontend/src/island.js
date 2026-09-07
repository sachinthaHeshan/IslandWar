import * as THREE from 'three';
import { arena, groundHeight } from './gameplay.js';
import { createGun } from './character.js';
import {
  createGrassTexture, createSandTexture, createRockTexture,
  createWoodTexture, createMetalTexture, createTerrainMaterial, texturedMaterial,
} from './textures.js';

export function buildIsland(scene) {
  const { radius, playRadius, centerZ } = arena;
  const grassTex = createGrassTexture();
  const sandTex = createSandTexture();
  const rockTex = createRockTexture();
  const woodTex = createWoodTexture();
  const metalTex = createMetalTexture();

  const materials = new Map();
  function mat(color, extra = {}) {
    const key = color + JSON.stringify(extra);
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: .88, ...extra }));
    return materials.get(key);
  }
  function mesh(geometry, material, parent = scene) {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function box(w, h, d, material, x, y, z, parent = scene) {
    const m = mesh(new THREE.BoxGeometry(w, h, d), material, parent);
    m.position.set(x, y, z);
    return m;
  }
  function cylinder(rt, rb, h, material, x, y, z, parent = scene, n = 12) {
    const m = mesh(new THREE.CylinderGeometry(rt, rb, h, n), material, parent);
    m.position.set(x, y, z);
    return m;
  }

  let seed = 734;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

  const clockUniform = { value: 0 };
  const oceanMaterial = new THREE.ShaderMaterial({
    uniforms: { time: clockUniform, islandRadius: { value: radius + 1 }, centerZ: { value: centerZ } },
    vertexShader: `varying vec3 world; void main(){world=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.0);}`,
    fragmentShader: `
      varying vec3 world; uniform float time; uniform float islandRadius; uniform float centerZ;
      void main(){
        float depth=clamp((length(world.xz-vec2(0.,centerZ))-islandRadius)/88.,0.,1.);
        float wave=sin(world.x*.3+world.z*.18+time*.6)*sin(world.z*.5-time*.4);
        float glint=pow(max(0.,wave),14.)*.17;
        vec3 col=mix(vec3(.18,.66,.63),vec3(.055,.30,.40),depth)+glint;
        gl_FragColor=vec4(col,1.);
      }`,
  });
  const oceanSize = radius * 12;
  const ocean = mesh(new THREE.PlaneGeometry(oceanSize, oceanSize), oceanMaterial);
  ocean.rotation.x = -Math.PI / 2; ocean.position.y = -.65; ocean.castShadow = false;

  const shore = mesh(new THREE.CylinderGeometry(radius, radius + 6, 2, 128), texturedMaterial(sandTex, { roughness: 1 }));
  shore.position.set(0, -1.03, centerZ); shore.castShadow = false;

  const groundSize = radius * 2;
  const segments = 160;
  const geometry = new THREE.PlaneGeometry(groundSize, groundSize, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, centerZ);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    position.setY(i, groundHeight(position.getX(i), position.getZ(i)));
  }
  const indices = [];
  const index = geometry.index;
  for (let i = 0; i < index.count; i += 3) {
    const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    if (ids.every(j => Math.hypot(position.getX(j), position.getZ(j) - centerZ) < radius)) indices.push(...ids);
  }
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const terrainMat = createTerrainMaterial(grassTex, sandTex, radius, centerZ);
  const ground = mesh(geometry, terrainMat);
  ground.castShadow = false;

  const foam = [];
  for (let i = 0; i < 4; i++) {
    const ring = mesh(
      new THREE.RingGeometry(radius + 1 + i * 3, radius + 1.18 + i * 3, 160),
      new THREE.MeshBasicMaterial({ color: '#def7e3', transparent: true, opacity: .2, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, -.58, centerZ);
    ring.castShadow = false;
    foam.push(ring);
  }

  const coverMeshes = [];
  const woodMat = texturedMaterial(woodTex);
  const rockMat = texturedMaterial(rockTex);
  const metalMat = texturedMaterial(metalTex, { metalness: .4, roughness: .6 });

  for (const c of arena.cover) {
    const group = new THREE.Group();
    group.position.set(c.x, groundHeight(c.x, c.z), c.z);
    scene.add(group);
    const baseColor = c.type === 'container' ? metalMat
      : c.type === 'wall' ? mat('#b2b29a')
      : c.type === 'rock' ? rockMat
      : woodMat;
    const base = box(c.w, c.h, c.d, baseColor, 0, c.h / 2, 0, group);
    coverMeshes.push(base);

    if (c.type === 'crate') {
      for (const y of [.12, c.h - .12]) box(c.w + .025, .12, c.d + .025, mat('#4b5a42'), 0, y, 0, group);
      for (const x of [-c.w * .32, c.w * .32]) box(.10, c.h, .06, mat('#c4ad74'), x, c.h / 2, c.d / 2 + .03, group);
    }
    if (c.type === 'container') {
      for (let x = -c.w / 2 + .25; x < c.w / 2; x += .45) {
        box(.065, c.h - .2, .055, mat('#456960'), x, c.h / 2, c.d / 2 + .03, group);
        box(.065, c.h - .2, .055, mat('#456960'), x, c.h / 2, -c.d / 2 - .03, group);
      }
      box(c.w * .7, .12, .07, mat('#dfc57e'), 0, c.h * .7, c.d / 2 + .065, group);
    }
    if (c.type === 'wall') {
      for (let y = .7; y < c.h; y += .75) box(c.w + .015, .035, c.d + .015, mat('#87917a'), 0, y, 0, group);
      box(c.w + .14, .18, c.d + .14, mat('#c4c2a8'), 0, c.h, 0, group);
    }
    if (c.type === 'rock') {
      for (let j = 0; j < 3; j++) {
        const rock = mesh(new THREE.DodecahedronGeometry(1, 0), rockMat, group);
        rock.position.set((random() - .5) * c.w * .5, c.h * .55, (random() - .5) * c.d * .5);
        rock.scale.set(c.w * .5, c.h * .5, c.d * .5);
        rock.rotation.y = random() * 5;
      }
      box(c.w * .8, .12, c.d * .8, mat('#748b58'), 0, c.h + .02, 0, group);
    }
    if (c.type === 'lighthouse') {
      base.visible = false;
      cylinder(2.3, 2.5, 17, mat('#ece5cb'), 0, 8.5, 0, group, 20);
      cylinder(2.35, 2.4, 2, mat('#b7724c'), 0, 11, 0, group, 20);
      cylinder(3.1, 3.1, .25, mat('#596c5f'), 0, 17, 0, group, 20);
      cylinder(1.8, 1.8, 2, mat('#619f9a'), 0, 18, 0, group, 12);
      cylinder(0, 3, 1.5, mat('#b8744e'), 0, 19.6, 0, group, 12);
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) cylinder(.08, .08, 2, mat('#eae1be'), Math.sin(a) * 1.8, 18, Math.cos(a) * 1.8, group, 6);
      box(1.1, 2.3, .12, mat('#45605a'), 0, 1.15, 2.51, group);
    }
  }

  const trees = [];
  const treeMin = radius * 0.17;
  const treeMax = playRadius * 0.72;
  for (let i = 0; i < 200; i++) {
    const a = random() * Math.PI * 2;
    const r = treeMin + Math.sqrt(random()) * (treeMax - treeMin);
    const x = Math.cos(a) * r, z = Math.sin(a) * r + centerZ;
    if (arena.cover.some(c => Math.abs(x - c.x) < c.w / 2 + 4 && Math.abs(z - c.z) < c.d / 2 + 4)
      || arena.loot.some(l => Math.hypot(x - l.x, z - l.z) < 5)
      || Math.abs(x) < 18 && z > centerZ - 38 && z < centerZ + 25) continue;
    trees.push({ x, z, h: 6 + random() * 5, a: random() * 6 });
  }
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.16, .3, 1, 7), texturedMaterial(woodTex), trees.length);
  trunks.castShadow = true; scene.add(trunks);
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0); leafShape.quadraticCurveTo(.7, 1.5, 0, 4.6); leafShape.quadraticCurveTo(-.7, 1.5, 0, 0);
  const leafMat = new THREE.MeshStandardMaterial({ color: '#577d48', roughness: 1, side: THREE.DoubleSide });
  const leaves = new THREE.InstancedMesh(new THREE.ShapeGeometry(leafShape), leafMat, trees.length * 7);
  leaves.castShadow = true; scene.add(leaves);
  const dummy = new THREE.Object3D(); let li = 0;
  trees.forEach((t, i) => {
    const y = groundHeight(t.x, t.z);
    dummy.position.set(t.x, y + t.h / 2, t.z); dummy.rotation.set(.07, 0, .08); dummy.scale.set(1, t.h, 1); dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    for (let j = 0; j < 7; j++) {
      const a = j * Math.PI * 2 / 7 + t.a;
      dummy.position.set(t.x + .2, y + t.h - .2, t.z);
      dummy.rotation.set(-Math.PI / 2, 0, a); dummy.rotateX(.18 + random() * .18);
      dummy.scale.set(1, 1 + random() * .2, 1); dummy.updateMatrix();
      leaves.setMatrixAt(li, dummy.matrix);
      leaves.setColorAt(li, new THREE.Color(j % 2 ? '#648b4a' : '#456f43'));
      li++;
    }
  });

  const grassCount = 2000;
  const tufts = new THREE.InstancedMesh(new THREE.ConeGeometry(.22, .75, 3), mat('#678652'), grassCount);
  scene.add(tufts);
  for (let i = 0; i < grassCount; i++) {
    const a = random() * Math.PI * 2;
    const r = treeMin + random() * (playRadius * 0.6);
    const x = Math.cos(a) * r, z = Math.sin(a) * r + centerZ;
    dummy.position.set(x, groundHeight(x, z) + .2, z);
    dummy.rotation.set(0, random() * 6, (random() - .5) * .25);
    dummy.scale.set(1, .5 + random(), 1); dummy.updateMatrix();
    tufts.setMatrixAt(i, dummy.matrix);
  }

  const pebbleGeo = new THREE.DodecahedronGeometry(1, 0);
  const pebbles = new THREE.InstancedMesh(pebbleGeo, rockMat, 100);
  scene.add(pebbles);
  for (let i = 0; i < 100; i++) {
    const a = random() * Math.PI * 2;
    const r = playRadius + random() * 8;
    dummy.position.set(Math.cos(a) * r, .2, Math.sin(a) * r + centerZ);
    dummy.rotation.set(random(), random() * 6, random());
    dummy.scale.set(1 + random() * 2, .6 + random(), 1 + random() * 2);
    dummy.updateMatrix();
    pebbles.setMatrixAt(i, dummy.matrix);
  }

  const dockZ = centerZ + playRadius * 0.68;
  for (let i = 0; i < 28; i++) box(5, .2, .8, texturedMaterial(woodTex), -16, .15, dockZ + i * .9);
  for (let i = 0; i < 6; i++) for (const x of [-18.2, -13.8]) cylinder(.12, .12, 2, mat('#7f7352'), x, -.25, dockZ + 2 + i * 4);

  for (const [x, z] of [[-71, 25], [8, 61], [-56, -74]]) {
    const y = groundHeight(x, z);
    for (const dx of [-3, 3]) for (const dz of [-2, 2]) cylinder(.07, .07, 3, mat('#807453'), x + dx, y + 1.5, z + dz);
    const roof = mesh(new THREE.CylinderGeometry(0, 4.4, 1.5, 4), mat('#c5ac72'));
    roof.position.set(x, y + 3.2, z); roof.rotation.y = Math.PI / 4;
  }

  const skylineDist = radius * 2.5;
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI * 2 / 12;
    const m = mesh(new THREE.ConeGeometry(25 + random() * 20, 18 + random() * 23, 7), mat('#8baea0'));
    m.position.set(Math.cos(a) * skylineDist, 0, Math.sin(a) * skylineDist);
    m.rotation.y = random() * 6;
  }

  const birds = [];
  for (let i = 0; i < 9; i++) {
    const b = new THREE.Group();
    for (const side of [-1, 1]) { const wing = box(1.2, .04, .22, mat('#e9e9ca'), side * .5, 0, 0, b); wing.rotation.z = side * .2; }
    scene.add(b); birds.push(b);
  }

  const chests = new Map();
  for (const l of arena.loot) {
    const root = new THREE.Group();
    root.position.set(l.x, groundHeight(l.x, l.z), l.z);
    scene.add(root);
    box(1.9, .16, 1.15, mat('#334d45'), 0, .15, 0, root);
    for (const x of [-.89, .89]) box(.13, .65, 1.15, mat('#4c6451'), x, .43, 0, root);
    for (const z of [-.51, .51]) box(1.9, .65, .13, mat('#4c6451'), 0, .43, z, root);
    const lid = new THREE.Group(); lid.position.set(0, .79, -.56); root.add(lid);
    box(1.96, .16, 1.2, mat('#8b9560'), 0, 0, .56, lid);
    box(.18, .10, 1.22, mat('#d6c285'), 0, .11, .56, lid);
    const gun = createGun(l.weapon); gun.position.set(.1, .43, 0); gun.rotation.y = Math.PI / 2; root.add(gun);
    const beacon = mesh(new THREE.CylinderGeometry(.018, .018, 3.4, 6), new THREE.MeshBasicMaterial({ color: l.weapon === 'sniper' ? '#f8c97a' : '#d6ef93', transparent: true, opacity: .5 }), root);
    beacon.position.y = 2.5; beacon.castShadow = false;
    const marker = mesh(new THREE.OctahedronGeometry(.18), new THREE.MeshBasicMaterial({ color: l.weapon === 'sniper' ? '#f8c97a' : '#d6ef93' }), root);
    marker.position.y = 4.2; marker.castShadow = false;
    chests.set(l.id, { root, lid, gun, beacon, marker, opened: 0, readyAt: 0 });
  }

  function update(time, dt, body, loot, now) {
    clockUniform.value = time;
    for (const [id, c] of chests) {
      c.readyAt = loot?.get(id) || 0;
      const empty = c.readyAt > now;
      const near = body && Math.hypot(body.x - c.root.position.x, body.z - c.root.position.z) < 4;
      c.opened = THREE.MathUtils.damp(c.opened, empty || near ? 1 : 0, 8, dt);
      c.lid.rotation.x = -c.opened * 1.9;
      c.gun.visible = !empty; c.beacon.visible = !empty; c.marker.visible = !empty;
      c.marker.rotation.y = time;
      c.marker.position.y = 3.8 + Math.sin(time * 2 + id) * .12;
    }
    foam.forEach((f, i) => f.scale.setScalar(1 + Math.sin(time * .4 + i) * .003));
    birds.forEach((b, i) => {
      const a = time * .065 + i;
      b.position.set(Math.cos(a) * 90, 28 + Math.sin(time * .4 + i) * 2, Math.sin(a) * 90 + centerZ);
      b.rotation.y = -a;
      b.children.forEach((w, j) => w.rotation.z = (j ? 1 : -1) * (.2 + Math.sin(time * 4 + i) * .18));
    });
  }

  return { ground, coverMeshes, chests, update, ocean };
}
