import * as THREE from 'three';

const olive = new THREE.MeshStandardMaterial({ color: '#4a5a3f', roughness: 0.85 });
const metal = new THREE.MeshStandardMaterial({ color: '#283f41', roughness: 0.75 });
const warheadMat = new THREE.MeshStandardMaterial({ color: '#6a5a3a', roughness: 0.7, metalness: 0.15 });
const finMat = new THREE.MeshStandardMaterial({ color: '#3d4a35', roughness: 0.9 });

export function createRpgLauncher() {
  const root = new THREE.Group();
  root.userData.isRpg = true;
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 1.15, 10), olive);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, 0, -0.42);
  tube.castShadow = true;
  root.add(tube);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.1), metal);
  grip.position.set(0, -0.12, 0.08);
  root.add(grip);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.22), metal);
  pad.position.set(0, 0.1, 0.05);
  root.add(pad);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.14), metal);
  sight.position.set(0, 0.12, -0.55);
  root.add(sight);
  const launch = new THREE.Object3D();
  launch.position.set(0, 0, -1.02);
  root.add(launch);
  root.userData.launch = launch;
  return root;
}

function createRocketMesh() {
  const rocket = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.62, 10), olive);
  body.rotation.x = Math.PI / 2;
  body.position.z = -0.18;
  body.castShadow = true;
  rocket.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.22, 10), warheadMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -0.58;
  rocket.add(nose);
  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.12), finMat);
    fin.position.set(side * 0.09, 0, 0.08);
    rocket.add(fin);
  }
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.05, 0.2, 8),
    new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.85 }),
  );
  flame.rotation.x = Math.PI / 2;
  flame.position.z = 0.42;
  rocket.add(flame);
  rocket.userData.flame = flame;
  return rocket;
}

function aimObject(obj, dir) {
  const d = dir.clone().normalize();
  obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), d);
}

export function createEffectSystem(scene) {
  const projectiles = [];
  const explosions = [];

  function spawnBackblast(origin, dir) {
    const puff = new THREE.Group();
    puff.position.copy(origin).addScaledVector(dir, -0.35);
    aimObject(puff, dir.clone().multiplyScalar(-1));
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.08 + Math.random() * 0.08, 6, 4),
        new THREE.MeshBasicMaterial({ color: '#c8ccd0', transparent: true, opacity: 0.55 }),
      );
      s.position.set((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.2, Math.random() * 0.15);
      puff.add(s);
    }
    scene.add(puff);
    explosions.push({ group: puff, life: 0.35, maxLife: 0.35, kind: 'smoke' });
  }

  function spawnExplosion(position, radius = 8) {
    const group = new THREE.Group();
    group.position.copy(position);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#ffd080', transparent: true, opacity: 0.95 }),
    );
    group.add(core);
    const fire = new THREE.Mesh(
      new THREE.SphereGeometry(1, 14, 10),
      new THREE.MeshBasicMaterial({ color: '#ff5a20', transparent: true, opacity: 0.75 }),
    );
    group.add(fire);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.55, 36),
      new THREE.MeshBasicMaterial({ color: '#ff9040', transparent: true, opacity: 0.65, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
    const light = new THREE.PointLight('#ffaa55', 4, radius * 3, 2);
    group.add(light);
    for (let i = 0; i < 10; i++) {
      const debris = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.12, 0.12),
        new THREE.MeshStandardMaterial({ color: i % 2 ? '#4a4035' : '#7a6348', roughness: 1 }),
      );
      debris.userData.vel = new THREE.Vector3(
        (Math.random() - 0.5) * 12,
        3 + Math.random() * 8,
        (Math.random() - 0.5) * 12,
      );
      debris.position.set((Math.random() - 0.5) * 0.5, 0.2, (Math.random() - 0.5) * 0.5);
      group.add(debris);
    }
    scene.add(group);
    explosions.push({ group, core, fire, ring, light, life: 0, maxLife: 0.85, radius, kind: 'blast' });
  }

  function fireRocket({ start, end, speed = 95, splash = 8, onImpact }) {
    const rocket = createRocketMesh();
    rocket.position.copy(start);
    const dir = end.clone().sub(start);
    const dist = dir.length();
    dir.normalize();
    aimObject(rocket, dir);
    scene.add(rocket);
    spawnBackblast(start, dir);
    projectiles.push({
      mesh: rocket,
      dir,
      speed,
      traveled: 0,
      maxDist: dist,
      splash,
      onImpact: () => {
        spawnExplosion(end, splash);
        onImpact?.(end, splash);
      },
      end: end.clone(),
    });
  }

  function update(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      const step = p.speed * dt;
      p.traveled += step;
      p.mesh.position.addScaledVector(p.dir, step);
      if (p.mesh.userData.flame) {
        p.mesh.userData.flame.scale.setScalar(0.85 + Math.random() * 0.35);
      }
      if (p.traveled >= p.maxDist) {
        p.onImpact?.();
        scene.remove(p.mesh);
        p.mesh.traverse(o => o.geometry?.dispose());
        projectiles.splice(i, 1);
      }
    }
    for (let i = explosions.length - 1; i >= 0; i--) {
      const e = explosions[i];
      e.life += dt;
      const t = e.life / e.maxLife;
      if (e.kind === 'blast') {
        const scale = THREE.MathUtils.lerp(0.4, e.radius * 1.15, Math.min(1, t * 1.4));
        e.core.scale.setScalar(scale);
        e.fire.scale.setScalar(scale * 0.82);
        e.core.material.opacity = 0.95 * (1 - t);
        e.fire.material.opacity = 0.75 * (1 - t * 0.95);
        e.ring.scale.setScalar(THREE.MathUtils.lerp(0.5, e.radius * 1.6, t));
        e.ring.material.opacity = 0.65 * (1 - t);
        e.light.intensity = 4 * (1 - t);
        e.group.children.forEach(c => {
          if (c.userData.vel) {
            c.position.addScaledVector(c.userData.vel, dt);
            c.userData.vel.y -= 18 * dt;
          }
        });
      } else {
        e.group.scale.setScalar(1 + t * 2.5);
        e.group.traverse(o => {
          if (o.material) o.material.opacity = 0.55 * (1 - t);
        });
      }
      if (e.life >= e.maxLife) {
        scene.remove(e.group);
        e.group.traverse(o => {
          o.geometry?.dispose();
          o.material?.dispose?.();
        });
        explosions.splice(i, 1);
      }
    }
  }

  return { fireRocket, spawnExplosion, spawnBackblast, update };
}

export const RPG_SHOULDER = {
  position: [0.06, 1.82, -0.18],
  rotation: [-1.42, 0.12, 0.08],
};

export const RPG_HANDS = {
  right: { x: -1.05, z: -0.05 },
  left: { x: -0.35, z: -0.08 },
};
