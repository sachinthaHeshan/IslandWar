import arena from '../../server/arena.json' with { type: 'json' };
export { arena };

export function groundHeight(x, z) {
  const radial = Math.hypot(x, z - arena.centerZ);
  const blend = Math.max(0, Math.min(1, (radial - 28) / 15));
  let height = 0;
  for (const h of arena.hills) height += h.height * Math.exp(-((x-h.x)**2 + (z-h.z)**2)/(h.width**2));
  return height * blend * Math.max(0, Math.min(1, (arena.radius-radial)/14));
}

export function isJumpableCover(c) {
  return c.type === 'crate' || c.type === 'container' || c.type === 'rock';
}

export function coverTop(c) {
  return groundHeight(c.x, c.z) + c.h;
}

export function surfaceHeight(x, z) {
  let h = groundHeight(x, z);
  for (const c of arena.cover) {
    if (!isJumpableCover(c)) continue;
    if (Math.abs(x - c.x) < c.w / 2 + .15 && Math.abs(z - c.z) < c.d / 2 + .15) {
      const top = coverTop(c);
      if (top > h) h = top;
    }
  }
  return h;
}

export function canMove(x, z, y) {
  if (Math.hypot(x, z - arena.centerZ) >= arena.playRadius) return false;
  for (const c of arena.cover) {
    if (Math.abs(x - c.x) >= c.w / 2 + .38 || Math.abs(z - c.z) >= c.d / 2 + .38) continue;
    const top = coverTop(c);
    if (y >= top - .35) continue;
    return false;
  }
  return true;
}

export function createBody() { return { x: 0, y: 0, z: 8, vx: 0, vy: 0, vz: 0, grounded: true }; }

export function moveBody(body, input, dt) {
  const approach = (v, t) => v < t ? Math.min(v + arena.acceleration * dt, t) : Math.max(v - arena.acceleration * dt, t);
  let { x, z } = input;
  const length = Math.hypot(x, z);
  if (length > 1) { x /= length; z /= length; }
  const crawling = input.crawl && body.grounded;
  const speed = crawling ? arena.crawlSpeed : input.aim ? arena.aimSpeed : input.sprint ? arena.sprintSpeed : arena.walkSpeed;
  body.vx = approach(body.vx, (x * Math.cos(input.yaw) + z * Math.sin(input.yaw)) * speed);
  body.vz = approach(body.vz, (-x * Math.sin(input.yaw) + z * Math.cos(input.yaw)) * speed);
  if (canMove(body.x + body.vx * dt, body.z, body.y)) body.x += body.vx * dt; else body.vx = 0;
  if (canMove(body.x, body.z + body.vz * dt, body.y)) body.z += body.vz * dt; else body.vz = 0;
  if (input.jump && body.grounded && !crawling) { body.vy = arena.jumpSpeed; body.grounded = false; }
  body.vy -= arena.gravity * dt;
  body.y += body.vy * dt;
  const surface = surfaceHeight(body.x, body.z);
  if (body.y <= surface) { body.y = surface; body.vy = 0; body.grounded = true; }
  else body.grounded = false;
}

export function nearestLoot(body, readyAt, now) {
  return arena.loot.filter(l => Math.hypot(body.x - l.x, body.z - l.z) < 3 && Math.abs(body.y - surfaceHeight(l.x, l.z)) < 2.5 && (readyAt.get(l.id) || 0) <= now)
    .sort((a, b) => Math.hypot(body.x - a.x, body.z - a.z) - Math.hypot(body.x - b.x, body.z - b.z))[0];
}
