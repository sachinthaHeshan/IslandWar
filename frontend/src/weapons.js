import arena from '../../server/arena.json' with { type: 'json' };

export const WEAPON_SLOTS = ['pistol', 'ak47', 'sniper', 'rpg'];
export const MAX_WEAPONS = 4;

export function weaponDef(id) {
  return arena.weapons[id] || arena.weapons.pistol;
}

export function createInventory() {
  return {
    active: 'pistol',
    weapons: { pistol: arena.weapons.pistol.magazine },
    lootReady: new Map(),
  };
}

export function syncActiveAmmo(inv) {
  inv.weapons[inv.active] = inv.weapons[inv.active] ?? 0;
}

export function switchWeapon(inv, id) {
  if (!(id in inv.weapons)) return false;
  syncActiveAmmo(inv);
  inv.active = id;
  return true;
}

export function switchSlot(inv, slot) {
  const id = WEAPON_SLOTS[slot - 1];
  return id ? switchWeapon(inv, id) : false;
}

export function canAddWeapon(inv, id) {
  if (!arena.weapons[id]) return false;
  if (id in inv.weapons) return false;
  return Object.keys(inv.weapons).length < MAX_WEAPONS;
}

export function addWeapon(inv, id) {
  if (!canAddWeapon(inv, id)) return false;
  syncActiveAmmo(inv);
  inv.weapons[id] = weaponDef(id).magazine;
  inv.active = id;
  return true;
}

export function activeWeapon(inv) {
  return weaponDef(inv.active);
}

export function activeAmmo(inv) {
  return inv.weapons[inv.active] ?? 0;
}

export function setActiveAmmo(inv, ammo) {
  inv.weapons[inv.active] = ammo;
}

export function weaponShortName(id) {
  const name = weaponDef(id).name;
  if (id === 'ak47') return 'AK-47';
  if (id === 'rpg') return 'RPG-7';
  return name.split(' ')[0];
}

export function updateWeaponBar(inv, reloading = false) {
  WEAPON_SLOTS.forEach((id, i) => {
    const slot = document.querySelector(`.weapon-slot[data-slot="${i + 1}"]`);
    if (!slot) return;
    const owned = id in inv.weapons;
    slot.hidden = !owned;
    if (!owned) return;
    slot.classList.toggle('active', inv.active === id);
    slot.classList.add('owned');
    slot.classList.remove('locked');
    const ammoEl = slot.querySelector('.weapon-ammo');
    const nameEl = slot.querySelector('.weapon-name');
    if (nameEl) nameEl.textContent = weaponShortName(id);
    if (ammoEl) {
      if (reloading && inv.active === id) ammoEl.textContent = '··';
      else ammoEl.textContent = String(inv.weapons[id]).padStart(2, '0');
    }
  });
  const label = document.querySelector('.weapon-label');
  if (label) label.textContent = weaponDef(inv.active).name;
}

export function applyNetworkWeapons(me) {
  const weapons = me.weapons || { [me.weapon || 'pistol']: me.ammo };
  return { active: me.weapon || 'pistol', weapons };
}
