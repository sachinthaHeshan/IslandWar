import * as THREE from "three";
import "./style.css";
import { createMultiplayer } from "./multiplayer.js";
import { buildIsland } from "./island.js";
import {
  groundHeight,
  arena,
  createBody,
  moveBody,
  surfaceHeight,
  nearestLoot,
} from "./gameplay.js";
import { createGun, GUN_FLASH_Z } from "./character.js";
import {
  createEffectSystem,
  createRpgLauncher,
  RPG_SHOULDER,
  RPG_HANDS,
} from "./effects.js";
import {
  createInventory,
  switchSlot,
  switchWeapon,
  addWeapon,
  canAddWeapon,
  activeWeapon,
  activeAmmo,
  setActiveAmmo,
  updateWeaponBar,
  applyNetworkWeapons,
  WEAPON_SLOTS,
  weaponDef,
  weaponShortName,
} from "./weapons.js";
import { createTouchControls } from "./touchControls.js";

const $ = (id) => document.getElementById(id);
const canvas = $("game");
let renderer;
function dismissBoot() {
  const html = document.documentElement;
  if (!html.classList.contains("booting") && html.classList.contains("ready"))
    return;
  html.classList.add("ready");
  html.classList.remove("booting");
  const boot = $("boot");
  if (!boot) return;
  const done = () => boot.remove();
  boot.addEventListener("transitionend", done, { once: true });
  setTimeout(done, 500);
}
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch {
  dismissBoot();
  $("error").hidden = false;
  $("error").textContent =
    "This game needs WebGL. Please open it in a browser with hardware acceleration enabled.";
  throw new Error("WebGL unavailable");
}
renderer.setPixelRatio(
  Math.min(devicePixelRatio, matchMedia("(pointer: coarse)").matches ? 1.5 : 2),
);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene();
scene.background = new THREE.Color("#91bdb9");
scene.fog = new THREE.Fog("#91bdb9", 80, 280);
const camera = new THREE.PerspectiveCamera(
  55,
  innerWidth / innerHeight,
  0.1,
  450,
);
const scopeCam = new THREE.PerspectiveCamera(34, 1, 0.1, 450);
const scopeRT = new THREE.WebGLRenderTarget(1024, 1024, { depthBuffer: true });
scopeRT.texture.colorSpace = THREE.SRGBColorSpace;
scopeRT.texture.generateMipmaps = false;
scopeRT.texture.minFilter = THREE.LinearFilter;
scopeRT.texture.magFilter = THREE.LinearFilter;
function resizeScopeRT() {
  const pr = Math.min(devicePixelRatio, 2);
  scopeRT.setSize(
    Math.max(1, Math.round(innerWidth * pr)),
    Math.max(1, Math.round(innerHeight * pr)),
  );
}
resizeScopeRT();
const scopeComposite = new THREE.Scene();
const scopeOrtho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const scopeLens = new THREE.Mesh(
  new THREE.CircleGeometry(1, 72),
  new THREE.MeshBasicMaterial({
    map: scopeRT.texture,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  }),
);
scopeComposite.add(scopeLens);
scene.add(new THREE.HemisphereLight("#d5eee8", "#9c9268", 2.4));
const sun = new THREE.DirectionalLight("#fff0c5", 3.4);
sun.position.set(-40, 60, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {
  left: -160,
  right: 160,
  top: 160,
  bottom: -160,
  far: 300,
});
sun.shadow.bias = -0.0005;
scene.add(sun);
const mat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
const dark = mat("#273d35"),
  wood = mat("#74644a"),
  metal = mat("#344642");
function mesh(geo, material, x = 0, y = 0, z = 0, parent = scene) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function box(w, h, d, material, x, y, z, parent = scene) {
  return mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z, parent);
}
function cylinder(rt, rb, h, material, x, y, z, parent = scene, n = 10) {
  return mesh(
    new THREE.CylinderGeometry(rt, rb, h, n),
    material,
    x,
    y,
    z,
    parent,
  );
}
const island = buildIsland(scene);
const fx = createEffectSystem(scene);
const soloBody = createBody();
soloBody.x = 0;
soloBody.z = 8;
soloBody.y = surfaceHeight(0, 8);
const player = new THREE.Group();
scene.add(player);
player.position.set(soloBody.x, soloBody.y, soloBody.z);
const uniform = mat("#586553"),
  vest = mat("#35473d"),
  skin = mat("#bd9876"),
  boots = mat("#29352f");
box(0.72, 0.85, 0.42, uniform, 0, 1.3, 0, player);
box(0.77, 0.58, 0.49, vest, 0, 1.34, 0, player);
for (const x of [-0.22, 0, 0.22])
  box(0.16, 0.21, 0.12, wood, x, 1.2, -0.3, player);
const head = mesh(
  new THREE.SphereGeometry(0.255, 10, 8),
  skin,
  0,
  1.98,
  0,
  player,
);
head.scale.y = 1.1;
mesh(
  new THREE.SphereGeometry(0.285, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.64),
  vest,
  0,
  2.09,
  0,
  player,
);
box(0.43, 0.11, 0.11, dark, 0, 2, -0.235, player);
const legs = [];
for (const x of [-0.21, 0.21]) {
  const leg = new THREE.Group();
  leg.position.set(x, 0.95, 0);
  player.add(leg);
  box(0.28, 0.73, 0.3, uniform, 0, -0.34, 0, leg);
  box(0.3, 0.22, 0.46, boots, 0, -0.81, -0.08, leg);
  legs.push(leg);
}
const arms = [];
for (const x of [-0.49, 0.49]) {
  const arm = box(0.24, 0.65, 0.25, uniform, x, 1.38, -0.14, player);
  arm.rotation.x = -0.8;
  arms.push(arm);
  mesh(new THREE.SphereGeometry(0.13, 8, 6), skin, x, 1.18, -0.42, player);
}
let gun = createGun("pistol");
gun.position.set(0.44, 1.34, -0.5);
player.add(gun);
const flash = mesh(
  new THREE.SphereGeometry(0.15, 6, 4),
  new THREE.MeshBasicMaterial({ color: "#fff0a2" }),
  0,
  0.025,
  GUN_FLASH_Z.pistol,
  gun,
);
flash.visible = false;
function equipGun(type) {
  player.remove(gun);
  gun.traverse((o) => o.geometry?.dispose());
  gun = type === "rpg" ? createRpgLauncher() : createGun(type);
  if (type === "rpg") {
    gun.position.set(...RPG_SHOULDER.position);
    gun.rotation.set(...RPG_SHOULDER.rotation);
  } else {
    gun.position.set(0.44, 1.34, -0.5);
    gun.rotation.set(0, 0, 0);
  }
  player.add(gun);
  gun.userData = { type, isRpg: type === "rpg" };
  flash.parent?.remove(flash);
  gun.add(flash);
  flash.position.set(
    0,
    0.025,
    type === "rpg" ? 0.35 : (GUN_FLASH_Z[type] ?? GUN_FLASH_Z.pistol),
  );
}
function applyRpgPose() {
  const isRpg = activeWeaponId() === "rpg";
  if (isRpg) {
    gun.position.set(...RPG_SHOULDER.position);
    gun.rotation.set(...RPG_SHOULDER.rotation);
    arms[0].rotation.x = RPG_HANDS.right.x;
    arms[0].rotation.z = RPG_HANDS.right.z;
    arms[1].rotation.x = RPG_HANDS.left.x;
    arms[1].rotation.z = RPG_HANDS.left.z;
  } else if (crawlBlend < 0.2) {
    arms.forEach((a) => {
      a.rotation.x = THREE.MathUtils.lerp(a.rotation.x, -0.8, 0.14);
      a.rotation.z = THREE.MathUtils.lerp(a.rotation.z, 0, 0.14);
    });
  }
}
function rpgLaunchPoint() {
  const pt = gun.userData.launch || gun;
  return pt.getWorldPosition(new THREE.Vector3());
}
function rpgImpactTargets(end, splash) {
  const hitTarget = (t) => {
    if (!t?.alive) return;
    t.alive = false;
    t.group.visible = false;
    hits++;
    hitTime = 0.65;
    sound(true);
  };
  for (const t of targets) {
    if (!t.alive) continue;
    const dx = t.group.position.x - end.x,
      dz = t.group.position.z - end.z;
    if (Math.hypot(dx, dz) <= splash) hitTarget(t);
  }
  if (hits === targets.length) {
    complete = true;
    setTimeout(finishRound, 250);
  }
}
player.layers.set(1);
player.traverse((o) => o.layers.set(1));
camera.layers.enable(1);
scopeCam.layers.disable(1);
const targets = [];
const targetMeshes = [];
const positions = [
  [-7, -5],
  [5, -11],
  [14, -18],
  [-10, -20],
  [0, -24],
  [-6, -32],
  [10, -35],
  [2, -42],
  [-18, -15],
  [22, -8],
  [-12, -38],
  [16, -28],
];
positions.forEach(([x, z], i) => {
  const y = groundHeight(x, z);
  const g = new THREE.Group();
  g.position.set(x, y, z);
  scene.add(g);
  cylinder(0.055, 0.07, 1.8, metal, 0, 0.9, 0, g);
  box(0.9, 0.13, 0.65, wood, 0, 0.07, 0, g);
  const plate = mesh(
    new THREE.CylinderGeometry(0.64, 0.64, 0.12, 32),
    mat("#eee8cc"),
    0,
    2,
    0,
    g,
  );
  plate.rotation.x = Math.PI / 2;
  targetMeshes.push(plate);
  for (const [r, c, depth] of [
    [0.46, "#c8643e", 0.071],
    [0.29, "#e9dfbb", 0.078],
    [0.13, "#c8643e", 0.085],
  ]) {
    const circle = mesh(
      new THREE.CircleGeometry(r, 32),
      mat(c),
      0,
      2,
      depth,
      g,
    );
    targetMeshes.push(circle);
  }
  const t = { group: g, alive: true, index: i };
  g.traverse((o) => (o.userData.target = t));
  targets.push(t);
});
let yaw = 0,
  pitch = -0.06,
  crawlBlend = 0,
  aimBlend = 0,
  pointerButtons = 0,
  active = false,
  complete = false,
  reloading = 0,
  reloadingLeft = 0,
  hits = 0,
  shots = 0,
  elapsed = 0,
  shotCooldown = 0,
  flashTime = 0,
  hitTime = 0,
  muted = false;
const DEFAULT_FOV = 55;
const scopeZoom = { sniper: weaponDef("sniper").fov };
const focusZoom = { ak47: weaponDef("ak47").fov };
const SCOPE_LIMITS = { sniper: { min: 4, max: 22, step: 1 } };
const FOCUS_LIMITS = { ak47: { min: 22, max: 38, step: 2 } };
function canAim(id) {
  return id === "ak47" || id === "sniper";
}
function usesScopeLens(id) {
  return id === "sniper";
}
function canScope(id) {
  return usesScopeLens(id);
}
function aimFov(id) {
  if (id === "ak47") return focusZoom.ak47;
  if (id === "sniper") return scopeZoom.sniper;
  return DEFAULT_FOV;
}
function scopeMagnification(fov = aimFov(activeWeaponId())) {
  return (
    Math.tan(THREE.MathUtils.degToRad(DEFAULT_FOV * 0.5)) /
    Math.tan(THREE.MathUtils.degToRad(fov * 0.5))
  );
}
function scopeLensRadiusPx() {
  return Math.min(innerHeight, innerWidth) * 0.29;
}
function updateScopeLensMesh() {
  const r = scopeLensRadiusPx();
  scopeLens.scale.set(r / (innerWidth * 0.5), r / (innerHeight * 0.5), 1);
  scopeLens.material.opacity = Math.min(1, aimBlend / 0.35);
  scopeLens.material.transparent = scopeLens.material.opacity < 1;
}
function adjustScopeZoom(delta) {
  const id = activeWeaponId();
  const lim = id === "ak47" ? FOCUS_LIMITS.ak47 : SCOPE_LIMITS[id];
  if (!lim) return;
  const store = id === "ak47" ? focusZoom : scopeZoom;
  store[id] = THREE.MathUtils.clamp(
    store[id] + delta * lim.step,
    lim.min,
    lim.max,
  );
  const el = $("scope-zoom");
  if (el && aimBlend > 0.15)
    el.textContent = scopeMagnification().toFixed(1) + "×";
}
const inventory = createInventory();
const keys = new Set(),
  ray = new THREE.Raycaster(),
  clock = new THREE.Clock();
const tracers = [];
let audio;
const hipPos = new THREE.Vector3(),
  adsPos = new THREE.Vector3(),
  lookTarget = new THREE.Vector3();
function activeWeaponId() {
  return multiplayer.state.connected
    ? networkSelf?.weapon || "pistol"
    : inventory.active;
}
function moveAxis() {
  if (touch?.enabled && active)
    return { x: touch.state.moveX, z: touch.state.moveZ };
  return {
    x: (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0),
    z: (keys.has("KeyS") ? 1 : 0) - (keys.has("KeyW") ? 1 : 0),
  };
}
function wantsSprint() {
  return touch?.enabled
    ? !!touch.state.sprint
    : keys.has("ShiftLeft") || keys.has("ShiftRight");
}
function wantsJumpInput() {
  return touch?.enabled ? !!touch.state.jump : keys.has("Space");
}
function wantsCrawl() {
  return keys.has("ControlLeft") || keys.has("ControlRight");
}
function isAimHeld() {
  return (
    active &&
    ((pointerButtons & 2) === 2 || (touch?.enabled && touch.state.aim))
  );
}
function wantsAim() {
  if (!isAimHeld() || wantsCrawl() || !canAim(activeWeaponId())) return false;
  const reloadingNow = multiplayer.state.connected
    ? !!networkSelf?.reloading
    : !!reloading;
  if (reloadingNow || complete) return false;
  return multiplayer.state.connected || soloBody.grounded;
}
function applyAim(dt) {
  const id = activeWeaponId();
  const target = wantsAim() ? 1 : 0;
  aimBlend = THREE.MathUtils.damp(aimBlend, target, 16, dt);
  document.body.classList.toggle(
    "focused-ak47",
    aimBlend > 0.15 && id === "ak47",
  );
  document.body.classList.toggle(
    "scoped-sniper",
    aimBlend > 0.15 && id === "sniper",
  );
  document.body.classList.toggle("scoped", aimBlend > 0.15 && id === "sniper");
  const ch = $("crosshair");
  if (ch) {
    ch.dataset.weapon = id;
    ch.classList.toggle("aiming", aimBlend > 0.12);
    ch.classList.toggle("focused", aimBlend > 0.35);
  }
  const crawlGunY = THREE.MathUtils.lerp(1.34, 0.78, crawlBlend);
  gun.position.y = crawlGunY;
  const reloadingNow = multiplayer.state.connected
    ? !!networkSelf?.reloading
    : !!reloading;
  if (!reloadingNow) gun.rotation.x = THREE.MathUtils.lerp(0, -0.08, aimBlend);
  player.rotation.y = yaw;
  const zoomEl = $("scope-zoom");
  if (zoomEl)
    zoomEl.textContent =
      aimBlend > 0.15 && (id === "ak47" || id === "sniper")
        ? scopeMagnification().toFixed(1) + "×"
        : "";
}
function applyStance(dt) {
  const target = multiplayer.state.connected
    ? networkSelf?.crawling
      ? 1
      : 0
    : wantsCrawl() && soloBody.grounded
      ? 1
      : 0;
  crawlBlend = THREE.MathUtils.damp(crawlBlend, target, 12, dt);
  player.scale.y = THREE.MathUtils.lerp(1, 0.58, crawlBlend);
  arms.forEach((a) => {
    a.rotation.x = THREE.MathUtils.lerp(-0.8, -1.35, crawlBlend);
  });
  document.body.classList.toggle("crawling", crawlBlend > 0.35);
}
function trySwitch(slot) {
  if (!active) return;
  if (multiplayer.state.connected) {
    const id = WEAPON_SLOTS[slot - 1];
    if (!id || !(networkSelf?.weapons && id in networkSelf.weapons)) return;
    multiplayer.send({ type: "switch", weapon: id });
    return;
  }
  if (switchSlot(inventory, slot)) {
    reloading = 0;
    reloadingLeft = 0;
    equipGun(inventory.active);
    gun.userData.type = inventory.active;
    updateHUD();
  }
}
function tryPickup() {
  if (!active) return;
  const now = Date.now();
  if (multiplayer.state.connected) {
    multiplayer.send({ type: "interact" });
    return;
  }
  const loot = nearestLoot(soloBody, inventory.lootReady, now);
  if (!loot) return;
  if (!canAddWeapon(inventory, loot.weapon)) {
    $("toast").textContent = inventory.weapons[loot.weapon]
      ? `ALREADY CARRY ${weaponDef(loot.weapon).name}`
      : "WEAPON SLOTS FULL (4 MAX)";
    hitTime = 0.85;
    return;
  }
  addWeapon(inventory, loot.weapon);
  inventory.lootReady.set(loot.id, now + 20000);
  equipGun(inventory.active);
  gun.userData.type = inventory.active;
  reloading = 0;
  reloadingLeft = 0;
  $("toast").textContent = `PICKED UP ${weaponDef(loot.weapon).name}`;
  hitTime = 0.85;
  updateHUD();
}
function canPickupWeapon(weaponId) {
  if (multiplayer.state.connected) {
    const weapons = networkSelf?.weapons || {};
    if (weaponId in weapons) return false;
    return Object.keys(weapons).length < 4;
  }
  return canAddWeapon(inventory, weaponId);
}
function nearbyLoot() {
  if (!active) return null;
  const now = multiplayer.state.connected
    ? multiplayer.state.snapshot?.now || Date.now()
    : Date.now();
  const body =
    multiplayer.state.connected && networkSelf
      ? { x: networkSelf.x, y: networkSelf.y, z: networkSelf.z }
      : soloBody;
  const readyAt = multiplayer.state.connected
    ? new Map(
        (multiplayer.state.snapshot?.loot || []).map((l) => [l.id, l.readyAt]),
      )
    : inventory.lootReady;
  return nearestLoot(body, readyAt, now);
}
function updateInteractPrompt() {
  const el = $("interact-prompt");
  if (!el) return;
  const loot = nearbyLoot();
  const alive = !multiplayer.state.connected || (networkSelf?.health ?? 0) > 0;
  const show = !!(active && alive && loot && canPickupWeapon(loot.weapon));
  el.hidden = !show;
  if (!show) return;
  const icon = el.querySelector(".interact-icon");
  const label = el.querySelector(".interact-label");
  if (touch?.enabled) {
    icon.textContent = "↗";
    label.textContent = `Pick up ${weaponShortName(loot.weapon)}`;
  } else {
    icon.textContent = "E";
    label.textContent = `Pick up ${weaponShortName(loot.weapon)}`;
  }
}
function tryReload() {
  if (!active) return;
  if (multiplayer.state.connected) {
    multiplayer.send({ type: "reload" });
    return;
  }
  const w = activeWeapon(inventory);
  if (activeAmmo(inventory) < w.magazine && !reloading) {
    reloadingLeft = w.reload;
    reloading = 1;
    updateHUD();
  }
}
function enterGame() {
  active = true;
  document.body.classList.add("playing");
  $("start").style.display = "none";
  if (touch?.enabled) touch.setVisible(true);
}
function pauseGame() {
  active = false;
  document.body.classList.remove("playing");
  keys.clear();
  pointerButtons = 0;
  aimBlend = 0;
  touch?.reset();
  if (touch?.enabled) {
    touch.setVisible(false);
    $("start-hint").textContent = "Tap to resume · Adjust controls in settings";
  } else document.exitPointerLock();
  $("start").style.display = "flex";
  $("play").innerHTML = "RESUME THE RANGE <span>↗</span>";
}
function finishRound() {
  if (touch?.enabled) pauseGame();
  else document.exitPointerLock();
  $("result").hidden = false;
  $("result-text").textContent =
    `${targets.length} targets cleared in ${Math.floor(elapsed)} seconds. ${Math.round((hits / shots) * 100)}% accuracy · ${shots} shots fired.`;
}
function sound(hit = false, rpg = false) {
  if (muted) return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
    const osc = audio.createOscillator(),
      gain = audio.createGain();
    osc.type = hit ? "sine" : rpg ? "sawtooth" : "triangle";
    osc.frequency.setValueAtTime(rpg ? 55 : hit ? 880 : 135, audio.currentTime);
    osc.frequency.exponentialRampToValueAtTime(
      rpg ? 28 : hit ? 440 : 40,
      audio.currentTime + (rpg ? 0.35 : 0.12),
    );
    gain.gain.setValueAtTime(rpg ? 0.18 : 0.1, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      audio.currentTime + (rpg ? 0.4 : 0.15),
    );
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + (rpg ? 0.42 : 0.16));
  } catch {}
}
function isReloadingNow() {
  return multiplayer.state.connected ? !!networkSelf?.reloading : !!reloading;
}
function updateFireButton() {
  const btn = document.querySelector(".touch-btn.touch-fire");
  const reloadBtn = document.querySelector(".touch-btn[data-action=reload]");
  if (!touch?.enabled) return;
  const loading = isReloadingNow();
  if (btn) {
    btn.classList.toggle("reloading", loading);
    btn.setAttribute("aria-label", loading ? "Reloading" : "Fire");
  }
  if (reloadBtn) {
    reloadBtn.classList.toggle("reloading-active", loading);
    reloadBtn.setAttribute("aria-label", loading ? "Reloading" : "Reload");
  }
}
function updateHUD() {
  if (multiplayer.state.connected) {
    updateNetworkHUD();
    return;
  }
  $("ammo").textContent = reloading
    ? "··"
    : String(activeAmmo(inventory)).padStart(2, "0");
  $("hits").textContent = String(hits).padStart(2, "0");
  $("accuracy").textContent = shots
    ? Math.round((hits / shots) * 100) + "%"
    : "—";
  $("timer").textContent =
    String(Math.floor(elapsed / 60)).padStart(2, "0") +
    ":" +
    String(Math.floor(elapsed % 60)).padStart(2, "0");
  updateWeaponBar(inventory, reloading);
  updateFireButton();
}
function reset() {
  targets.forEach((t) => {
    t.alive = true;
    t.group.visible = true;
  });
  Object.assign(inventory, createInventory());
  inventory.lootReady = new Map();
  soloBody.x = 0;
  soloBody.z = 8;
  soloBody.y = surfaceHeight(0, 8);
  soloBody.vx = soloBody.vy = soloBody.vz = 0;
  soloBody.grounded = true;
  player.position.set(soloBody.x, soloBody.y, soloBody.z);
  yaw = 0;
  pitch = -0.06;
  crawlBlend = aimBlend = 0;
  pointerButtons = 0;
  player.scale.y = 1;
  player.visible = true;
  gun.position.y = 1.34;
  gun.rotation.x = 0;
  scopeZoom.sniper = weaponDef("sniper").fov;
  focusZoom.ak47 = weaponDef("ak47").fov;
  camera.fov = DEFAULT_FOV;
  camera.updateProjectionMatrix();
  document.body.classList.remove("scoped", "scoped-sniper", "focused-ak47");
  const ch = $("crosshair");
  if (ch) {
    ch.dataset.weapon = "pistol";
    ch.classList.remove("aiming", "focused");
  }
  $("hitmarker")?.classList.remove("show");
  reloading = reloadingLeft = shotCooldown = 0;
  hits = shots = elapsed = 0;
  complete = false;
  equipGun("pistol");
  gun.userData.type = "pistol";
  $("result").hidden = true;
  updateHUD();
}
function play() {
  if (
    multiplayer.state.connected &&
    multiplayer.state.snapshot?.state !== "running"
  ) {
    multiplayer.show();
    return;
  }
  if (complete) reset();
  if (touch?.enabled) {
    enterGame();
    return;
  }
  Promise.resolve(canvas.requestPointerLock?.()).catch(() => {
    $("start-hint").textContent =
      "Mouse capture unavailable. Try opening the game in a browser tab.";
  });
}
$("play").onclick = play;
$("again").onclick = () => {
  reset();
  play();
};
$("sound").onclick = () => {
  muted = !muted;
  $("sound").textContent = muted ? "SOUND OFF ↗" : "SOUND ON ↗";
};
document.addEventListener("pointerlockchange", () => {
  if (touch?.enabled) return;
  active = document.pointerLockElement === canvas;
  document.body.classList.toggle("playing", active);
  $("start").style.display = active || complete ? "none" : "flex";
  if (!active) {
    keys.clear();
    pointerButtons = 0;
    aimBlend = 0;
    $("play").innerHTML = "RESUME THE RANGE <span>↗</span>";
  }
});
document.addEventListener("pointerlockerror", () => {
  $("start-hint").textContent = "Allow mouse capture, then click to try again.";
});
document.addEventListener("pointerdown", (e) => {
  pointerButtons = e.buttons;
  if (e.button === 2 && active) e.preventDefault();
});
document.addEventListener("pointerup", (e) => {
  pointerButtons = e.buttons;
});
document.addEventListener("pointermove", (e) => {
  if (active) pointerButtons = e.buttons;
});
addEventListener("keydown", (e) => {
  if (
    active &&
    [
      "Space",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "ControlLeft",
      "ControlRight",
    ].includes(e.code)
  )
    e.preventDefault();
  keys.add(e.code);
  if (!active || e.repeat) return;
  if (e.code === "Space" && multiplayer.state.connected)
    multiplayer.send({ type: "jump" });
  if (e.code === "KeyE") tryPickup();
  if (e.code === "Digit1") trySwitch(1);
  if (e.code === "Digit2") trySwitch(2);
  if (e.code === "Digit3") trySwitch(3);
  if (e.code === "Digit4") trySwitch(4);
  if (e.code === "KeyR") tryReload();
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => {
  keys.clear();
  pointerButtons = 0;
  if (touch?.enabled) {
    touch.reset();
    return;
  }
  if (active) document.exitPointerLock();
});
document.addEventListener(
  "wheel",
  (e) => {
    if (!active || !wantsAim()) return;
    e.preventDefault();
    adjustScopeZoom(e.deltaY > 0 ? 1 : -1);
  },
  { passive: false },
);
document.addEventListener("mousemove", (e) => {
  if (!active || touch?.enabled) return;
  const id = activeWeaponId();
  const aimSlow = id === "sniper" ? 0.62 : id === "ak47" ? 0.22 : 0;
  const sens = 0.0022 * (1 - aimBlend * aimSlow);
  yaw -= e.movementX * sens;
  pitch = THREE.MathUtils.clamp(pitch - e.movementY * sens, -0.55, 0.42);
});
function shoot() {
  if (multiplayer.state.connected) {
    if (
      active &&
      multiplayer.state.snapshot?.state === "running" &&
      !networkSelf?.reloading
    ) {
      sendNetworkInput();
      multiplayer.send({ type: "shoot" });
    }
    return;
  }
  if (!active || complete || reloading || shotCooldown > 0) return;
  const w = activeWeapon(inventory);
  let ammo = activeAmmo(inventory);
  if (ammo === 0) {
    if (!reloading) {
      reloadingLeft = w.reload;
      reloading = 1;
      updateHUD();
    }
    return;
  }
  ammo--;
  setActiveAmmo(inventory, ammo);
  shots++;
  shotCooldown = w.cooldown;
  sound();
  const aimCam =
    aimBlend > 0.15 && usesScopeLens(activeWeaponId()) ? scopeCam : camera;
  ray.setFromCamera(new THREE.Vector2(0, 0), aimCam);
  const surfaces = targetMeshes.filter((o) => o.userData.target.alive);
  const obstacles = [island.ground, ...island.coverMeshes];
  const intersects = ray.intersectObjects([...surfaces, ...obstacles], false);
  const end = intersects[0]?.point || ray.ray.at(w.range, new THREE.Vector3());
  if (inventory.active === "rpg") {
    const start = rpgLaunchPoint();
    fx.fireRocket({
      start,
      end,
      splash: w.splash || 8,
      onImpact: (impact, r) => rpgImpactTargets(impact, r),
    });
    sound(false, true);
  } else {
    flashTime = 0.055;
    flash.visible = true;
    const start = flash.getWorldPosition(new THREE.Vector3());
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([start, end]),
      new THREE.LineBasicMaterial({
        color: "#ffe6a4",
        transparent: true,
        opacity: 0.85,
      }),
    );
    scene.add(line);
    tracers.push({ line, life: 0.065 });
    const target = intersects[0]?.object.userData.target;
    if (target?.alive) {
      target.alive = false;
      target.group.visible = false;
      hits++;
      hitTime = 0.65;
      sound(true);
      if (hits === targets.length) {
        complete = true;
        setTimeout(finishRound, 250);
      }
    }
  }
  updateHUD();
}
function shouldShootFromPointer(e) {
  if (e.button !== 0 || !active) return false;
  if (touch?.enabled) return false;
  const t = e.target;
  if (t === canvas || canvas.contains(t)) return true;
  return false;
}
addEventListener("mousedown", (e) => {
  if (shouldShootFromPointer(e)) shoot();
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
function syncScopeCamera() {
  scopeCam.position.copy(camera.position);
  scopeCam.quaternion.copy(camera.quaternion);
  const id = activeWeaponId();
  scopeCam.fov = usesScopeLens(id) ? scopeZoom.sniper : DEFAULT_FOV;
  scopeCam.aspect = camera.aspect;
  scopeCam.near = camera.near;
  scopeCam.far = camera.far;
  scopeCam.updateProjectionMatrix();
}
function updateCamera() {
  const id = activeWeaponId();
  const forward = new THREE.Vector3(
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  );
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const eye = THREE.MathUtils.lerp(1.75, 0.92, crawlBlend);
  const pivot = player.position.clone().add(new THREE.Vector3(0, eye, 0));
  hipPos
    .copy(pivot)
    .addScaledVector(forward, -THREE.MathUtils.lerp(5.4, 4.1, crawlBlend))
    .addScaledVector(right, 0.85)
    .add(new THREE.Vector3(0, THREE.MathUtils.lerp(0.65, 0.28, crawlBlend), 0));
  adsPos
    .copy(pivot)
    .addScaledVector(forward, 0.1)
    .addScaledVector(right, 0.07)
    .add(new THREE.Vector3(0, 0.05, 0));
  lookTarget.copy(pivot).addScaledVector(forward, 300);
  const focusBlend = id === "ak47" ? aimBlend : 0;
  camera.position.copy(hipPos).lerp(adsPos, focusBlend * 0.4);
  const hipFov = DEFAULT_FOV;
  const adsFov = focusZoom.ak47;
  camera.fov = THREE.MathUtils.lerp(hipFov, adsFov, focusBlend);
  camera.updateProjectionMatrix();
  camera.lookAt(lookTarget);
  syncScopeCamera();
}
function renderFrame() {
  updateScopeLensMesh();
  renderer.render(scene, camera);
  if (aimBlend <= 0.05 || !usesScopeLens(activeWeaponId())) return;
  syncScopeCamera();
  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  renderer.setRenderTarget(scopeRT);
  renderer.autoClear = true;
  renderer.clear();
  renderer.render(scene, scopeCam);
  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAutoClear;
  scopeLens.material.toneMapped = false;
  scopeLens.visible = true;
  renderer.autoClear = false;
  renderer.render(scopeComposite, scopeOrtho);
  renderer.autoClear = true;
  scopeLens.visible = false;
}
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.getElapsedTime();
  if (active && touch?.enabled) {
    updateFireButton();
    const look = touch.consumeLook();
    if (look.dx || look.dy) {
      const id = activeWeaponId();
      const aimSlow = id === "sniper" ? 0.62 : id === "ak47" ? 0.22 : 0;
      const sens = 0.0034 * (1 - aimBlend * aimSlow);
      yaw -= look.dx * sens;
      pitch = THREE.MathUtils.clamp(pitch - look.dy * sens, -0.55, 0.42);
    }
    const zoom = touch.consumeZoom();
    if (zoom && wantsAim()) adjustScopeZoom(zoom);
    if (touch.state.fire) shoot();
    if (touch.jumpEdge) {
      if (multiplayer.state.connected) multiplayer.send({ type: "jump" });
      touch.clearJumpEdge();
    }
  }
  if (multiplayer.state.connected) {
    networkFrame(dt);
  }
  if (active && !complete && !multiplayer.state.connected) {
    elapsed += dt;
    const crawling = wantsCrawl() && soloBody.grounded;
    const scoped = wantsAim();
    const mv = moveAxis();
    moveBody(
      soloBody,
      {
        x: mv.x,
        z: mv.z,
        yaw,
        sprint: !crawling && !scoped && wantsSprint(),
        crawl: crawling,
        aim: scoped,
        jump: wantsJumpInput() && !crawling && !scoped,
      },
      dt,
    );
    player.position.set(soloBody.x, soloBody.y, soloBody.z);
    const moving = Math.hypot(soloBody.vx, soloBody.vz) > 0.1;
    const stride = crawling ? 7 : 12;
    if (moving)
      legs.forEach(
        (leg, i) =>
          (leg.rotation.x =
            Math.sin(elapsed * stride + i * Math.PI) *
            (crawling ? 0.28 : 0.45)),
      );
    else legs.forEach((l) => (l.rotation.x *= 0.8));
    player.rotation.y = yaw;
    shotCooldown = Math.max(0, shotCooldown - dt);
    if (reloading) {
      reloadingLeft = Math.max(0, reloadingLeft - dt);
      gun.rotation.x = -0.5;
      if (reloadingLeft <= 0) {
        setActiveAmmo(inventory, activeWeapon(inventory).magazine);
        reloading = 0;
        gun.rotation.x = 0;
      }
    }
    updateHUD();
  }
  const body =
    multiplayer.state.connected && networkSelf
      ? { x: networkSelf.x, y: networkSelf.y, z: networkSelf.z }
      : { x: soloBody.x, y: soloBody.y, z: soloBody.z };
  const lootMap = new Map(
    (multiplayer.state.snapshot?.loot || []).map((l) => [l.id, l.readyAt]),
  );
  if (!multiplayer.state.connected)
    arena.loot.forEach((l) => {
      const ready = inventory.lootReady.get(l.id) || 0;
      if (ready > Date.now()) lootMap.set(l.id, ready);
    });
  const alive = !multiplayer.state.connected || (networkSelf?.health ?? 0) > 0;
  const canPickup = (id) => active && alive && canPickupWeapon(id);
  island.update(
    time,
    dt,
    body,
    lootMap,
    multiplayer.state.snapshot?.now || Date.now(),
    { canPickup, useCenterPrompt: active },
  );
  updateInteractPrompt();
  applyStance(dt);
  applyRpgPose();
  applyAim(dt);
  fx.update(dt);
  flashTime -= dt;
  flash.visible = flashTime > 0 && !wantsAim() && activeWeaponId() !== "rpg";
  hitTime -= dt;
  $("hitmarker").classList.toggle("show", hitTime > 0);
  $("toast").style.opacity = hitTime > 0 ? "1" : "0";
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.life -= dt;
    if (t.life <= 0) {
      scene.remove(t.line);
      t.line.geometry.dispose();
      t.line.material.dispose();
      tracers.splice(i, 1);
    }
  }
  updateCamera();
  renderFrame();
}
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  resizeScopeRT();
  syncScopeCamera();
});

const remotePlayers = new Map();
let networkSelf = null;
const originalStats = document.querySelector(".topstats").innerHTML;
const originalToast = $("toast").innerHTML;
const multiplayer = createMultiplayer({
  onSnapshot(snapshot, previous, selfID) {
    document.body.classList.add("multiplayer");
    targets.forEach((t) => (t.group.visible = false));
    $("start").style.display =
      active || snapshot.state !== "running" ? "none" : "flex";
    $("start-label").textContent = "FREE-FOR-ALL · MATCH IS LIVE";
    $("play").innerHTML = "DEPLOY TO ISLAND <span>↗</span>";
    if (!document.getElementById("net-kills"))
      document.querySelector(".topstats").innerHTML =
        '<div><small>SCORE</small><strong id="net-kills">0</strong></div><div><small>HEALTH</small><strong id="net-health">100</strong></div><div><small>TIME LEFT</small><strong id="net-timer">03:00</strong></div>';
    const me = snapshot.players.find((p) => p.id === selfID);
    if (me) {
      const wasDead = networkSelf?.health === 0;
      networkSelf = me;
      if (
        !previous ||
        previous.matchId !== snapshot.matchId ||
        (wasDead && me.health > 0)
      ) {
        player.position.set(me.x, me.y, me.z);
        yaw = me.yaw;
        pitch = -0.06;
      }
      if (me.weapon && me.weapon !== gun.userData?.type) {
        equipGun(me.weapon);
        gun.userData.type = me.weapon;
      }
      player.visible = me.health > 0;
      document.body.classList.toggle("dead", me.health === 0);
    }
    const existing = new Set();
    for (const opponent of snapshot.players) {
      if (opponent.id === selfID) continue;
      existing.add(opponent.id);
      let remote = remotePlayers.get(opponent.id);
      if (!remote) {
        const model = player.clone(true);
        model.traverse((o) => {
          if (o.isMesh && o.material === uniform) {
            o.material = mat("#a76d4d");
          }
        });
        // Muzzle flash is the only basic-material sphere in the operator model.
        model.traverse((o) => {
          if (o.isMesh && o.material.isMeshBasicMaterial) o.visible = false;
        });
        const labelCanvas = document.createElement("canvas");
        labelCanvas.width = 512;
        labelCanvas.height = 80;
        const ctx = labelCanvas.getContext("2d");
        ctx.fillStyle = "rgba(17,44,37,.8)";
        ctx.fillRect(0, 0, 512, 80);
        ctx.font = "bold 30px sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#eaf2dd";
        ctx.fillText(opponent.username, 256, 52);
        const label = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: new THREE.CanvasTexture(labelCanvas),
            depthTest: false,
          }),
        );
        label.position.set(0, 2.8, 0);
        label.scale.set(2.7, 0.42, 1);
        model.add(label);
        scene.add(model);
        remote = { model, data: opponent, label };
        remotePlayers.set(opponent.id, remote);
        model.position.set(opponent.x, opponent.y, opponent.z);
      }
      remote.data = opponent;
      remote.model.visible = opponent.connected && opponent.health > 0;
      remote.label.material.color.set(
        opponent.protectedUntil > snapshot.now ? "#dbea92" : "#ffffff",
      );
    }
    for (const [id, remote] of remotePlayers) {
      if (!existing.has(id)) {
        scene.remove(remote.model);
        remote.label.material.map.dispose();
        remote.label.material.dispose();
        remotePlayers.delete(id);
      }
    }
    for (const event of snapshot.events || []) {
      if (event.type === "pickup" && event.shooter === selfID) {
        $("toast").textContent = `PICKED UP ${weaponDef(event.weapon).name}`;
        hitTime = 0.85;
      }
      if (event.type !== "shot") continue;
      const start = new THREE.Vector3(
        event.start.x,
        event.start.y,
        event.start.z,
      );
      const end = new THREE.Vector3(event.end.x, event.end.y, event.end.z);
      if (event.weapon === "rpg") {
        fx.fireRocket({ start, end, splash: 8 });
      } else {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([start, end]),
          new THREE.LineBasicMaterial({
            color: event.shooter === selfID ? "#ffe6a4" : "#ffa17c",
            transparent: true,
            opacity: 0.9,
          }),
        );
        scene.add(line);
        tracers.push({ line, life: 0.1 });
      }
      if (event.shooter === selfID) {
        flashTime = 0.07;
        sound();
        if (event.victim) {
          hitTime = 0.65;
          $("toast").textContent = event.kill
            ? "ELIMINATION +1"
            : "HIT · 25 DAMAGE";
          sound(true);
        }
      }
      if (event.victim === selfID) {
        $("net-message").textContent = event.kill
          ? "Eliminated. Respawning…"
          : "Taking fire!";
      }
    }
    if (snapshot.state !== "running") {
      document.exitPointerLock?.();
      keys.clear();
    }
    updateNetworkHUD();
  },
  onEnter() {
    complete = false;
    $("result").hidden = true;
    play();
  },
  onDisconnect() {
    document.exitPointerLock?.();
    keys.clear();
  },
  onExit() {
    document.body.classList.remove("multiplayer", "dead");
    for (const remote of remotePlayers.values()) {
      scene.remove(remote.model);
      remote.label.material.map.dispose();
      remote.label.material.dispose();
    }
    remotePlayers.clear();
    networkSelf = null;
    player.visible = true;
    document.querySelector(".topstats").innerHTML = originalStats;
    $("toast").innerHTML = originalToast;
    $("start-label").textContent = "YOUR RANGE. YOUR PACE.";
    $("play").innerHTML = "ENTER THE RANGE <span>↗</span>";
    $("start").style.display = "flex";
    document.querySelector(".health span").textContent = "100";
    document
      .querySelectorAll(".health i")
      .forEach((bar) => (bar.style.opacity = "1"));
    gun.rotation.x = 0;
    reset();
  },
});
function updateNetworkHUD() {
  const snap = multiplayer.state.snapshot;
  if (!snap || !networkSelf) return;
  const seconds = Math.max(0, Math.ceil((snap.endAt - snap.now) / 1000));
  if ($("net-kills")) {
    $("net-kills").textContent = networkSelf.kills;
    $("net-health").textContent = networkSelf.health;
    $("net-timer").textContent =
      snap.state === "lobby"
        ? "03:00"
        : String(Math.floor(seconds / 60)).padStart(2, "0") +
          ":" +
          String(seconds % 60).padStart(2, "0");
  }
  $("ammo").textContent = networkSelf.reloading
    ? "··"
    : String(networkSelf.ammo).padStart(2, "0");
  document.querySelector(".health span").textContent = networkSelf.health;
  document
    .querySelectorAll(".health i")
    .forEach(
      (bar, i) =>
        (bar.style.opacity = networkSelf.health > i * 20 ? "1" : ".15"),
    );
  updateWeaponBar(applyNetworkWeapons(networkSelf), networkSelf.reloading);
  updateFireButton();
}
function sendNetworkInput() {
  if (!multiplayer.state.connected) return;
  const mv = moveAxis();
  multiplayer.send({
    type: "input",
    x: active ? mv.x : 0,
    z: active ? mv.z : 0,
    yaw,
    pitch,
    sprint: active && !wantsCrawl() && !wantsAim() && wantsSprint(),
    crawl: active && wantsCrawl(),
    aim: wantsAim(),
  });
}
setInterval(sendNetworkInput, 50);
function networkFrame(dt) {
  if (networkSelf) {
    player.position.lerp(
      new THREE.Vector3(networkSelf.x, networkSelf.y, networkSelf.z),
      1 - Math.exp(-25 * dt),
    );
    player.rotation.y = yaw;
    const mv = moveAxis();
    const moving =
      active &&
      (touch?.enabled
        ? Math.hypot(mv.x, mv.z) > 0.12
        : ["KeyW", "KeyA", "KeyS", "KeyD"].some((k) => keys.has(k)));
    legs.forEach(
      (leg, i) =>
        (leg.rotation.x = moving
          ? Math.sin(performance.now() * 0.012 + i * Math.PI) * 0.45
          : 0),
    );
  }
  for (const remote of remotePlayers.values()) {
    remote.model.position.lerp(
      new THREE.Vector3(remote.data.x, remote.data.y, remote.data.z),
      1 - Math.exp(-18 * dt),
    );
    remote.model.rotation.y = remote.data.yaw;
  }
}
gun.userData = { type: "pistol" };
document.querySelectorAll(".weapon-slot").forEach((s) => {
  s.addEventListener("click", (e) => {
    e.stopPropagation();
    if (active) trySwitch(Number(s.dataset.slot));
  });
  s.addEventListener("pointerdown", (e) => e.stopPropagation());
  s.addEventListener("mousedown", (e) => e.stopPropagation());
  s.addEventListener("touchstart", (e) => e.stopPropagation(), {
    passive: true,
  });
});
const touch = createTouchControls($("touch-controls"), $("touch-settings"), {
  onReload: tryReload,
  onPause: pauseGame,
  onEditStart() {},
  onEditEnd() {},
});
if (touch.enabled) {
  $("start-hint").textContent =
    "Tap play to start · Configure controls in settings first";
  $("start-settings").hidden = false;
  $("start-settings").onclick = () => touch.openSettings();
  $("interact-prompt")?.addEventListener("click", (e) => {
    e.stopPropagation();
    tryPickup();
  });
  document.addEventListener(
    "touchmove",
    (e) => {
      if (active && !touch.isEditing()) e.preventDefault();
    },
    { passive: false },
  );
}
updateWeaponBar(inventory, reloading);
updateCamera();
renderFrame();
requestAnimationFrame(dismissBoot);
frame();
