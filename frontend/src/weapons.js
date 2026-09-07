import arena from '../../server/arena.json' with { type: 'json' };

export const WEAPON_SLOTS = ['rifle', 'sniper'];

export function weaponDef(id) {
  return arena.weapons[id] || arena.weapons.rifle;
}

export function createInventory() {
  return {
    active: 'rifle',
    weapons: { rifle: arena.weapons.rifle.magazine },
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

export function addWeapon(inv, id) {
  syncActiveAmmo(inv);
  inv.weapons[id] = weaponDef(id).magazine;
  inv.active = id;
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

export function updateWeaponBar(inv, reloading = false) {
  WEAPON_SLOTS.forEach((id, i) => {
    const slot = document.querySelector(`.weapon-slot[data-slot="${i + 1}"]`);
    if (!slot) return;
    const owned = id in inv.weapons;
    slot.classList.toggle('active', inv.active === id);
    slot.classList.toggle('owned', owned);
    slot.classList.toggle('locked', !owned);
    const ammoEl = slot.querySelector('.weapon-ammo');
    const nameEl = slot.querySelector('.weapon-name');
    if (nameEl) nameEl.textContent = weaponDef(id).name.split(' ')[0];
    if (ammoEl) {
      if (!owned) ammoEl.textContent = '—';
      else if (reloading && inv.active === id) ammoEl.textContent = '··';
      else ammoEl.textContent = String(inv.weapons[id]).padStart(2, '0');
    }
  });
  const label = document.querySelector('.weapon-label');
  if (label) label.textContent = weaponDef(inv.active).name;
}

export function applyNetworkWeapons(me) {
  const weapons = me.weapons || { [me.weapon || 'rifle']: me.ammo };
  return { active: me.weapon || 'rifle', weapons };
}
