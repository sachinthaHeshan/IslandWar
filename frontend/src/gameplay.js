import arena from '../../server/arena.json' with { type: 'json' };
export { arena };
export function groundHeight(x, z) {
  const radial = Math.hypot(x, z - arena.centerZ);
  const blend = Math.max(0, Math.min(1, (radial - 28) / 15));
  let height = 0;
  for (const h of arena.hills) height += h.height * Math.exp(-((x-h.x)**2 + (z-h.z)**2)/(h.width**2));
  return height * blend * Math.max(0, Math.min(1, (arena.radius-radial)/14));
}
export function canMove(x,z) {
  return Math.hypot(x,z-arena.centerZ)<arena.playRadius && !arena.cover.some(c=>Math.abs(x-c.x)<c.w/2+.38 && Math.abs(z-c.z)<c.d/2+.38);
}
export function createBody() { return {x:0,y:0,z:8,vx:0,vy:0,vz:0,grounded:true}; }
export function moveBody(body,input,dt) {
  const approach=(v,t)=>v<t?Math.min(v+arena.acceleration*dt,t):Math.max(v-arena.acceleration*dt,t);
  let {x,z}=input; const length=Math.hypot(x,z);if(length>1){x/=length;z/=length;}
  const speed=input.aim?arena.aimSpeed:input.sprint?arena.sprintSpeed:arena.walkSpeed;
  body.vx=approach(body.vx,(x*Math.cos(input.yaw)+z*Math.sin(input.yaw))*speed);
  body.vz=approach(body.vz,(-x*Math.sin(input.yaw)+z*Math.cos(input.yaw))*speed);
  if(canMove(body.x+body.vx*dt,body.z))body.x+=body.vx*dt;else body.vx=0;
  if(canMove(body.x,body.z+body.vz*dt))body.z+=body.vz*dt;else body.vz=0;
  if(input.jump&&body.grounded){body.vy=arena.jumpSpeed;body.grounded=false;}
  body.vy-=arena.gravity*dt;body.y+=body.vy*dt;
  const ground=groundHeight(body.x,body.z);
  if(body.y<=ground){body.y=ground;body.vy=0;body.grounded=true;}else body.grounded=false;
}
export function nearestLoot(body,readyAt,now) {
  return arena.loot.filter(l=>Math.hypot(body.x-l.x,body.z-l.z)<3 && Math.abs(body.y-groundHeight(l.x,l.z))<2.5 && (readyAt.get(l.id)||0)<=now)
    .sort((a,b)=>Math.hypot(body.x-a.x,body.z-a.z)-Math.hypot(body.x-b.x,body.z-b.z))[0];
}
