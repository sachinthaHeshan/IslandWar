const LAYOUT_KEY = 'island-war-touch-layout';

export const DEFAULT_LAYOUT = {
  move: { x: 16, y: 82 },
  fire: { x: 88, y: 80 },
  pause: { x: 10, y: 10 },
  reload: { x: 22, y: 80 },
  jump: { x: 88, y: 68 },
  sprint: { x: 76, y: 88 },
  'zoom-out': { x: 68, y: 10 },
  'zoom-in': { x: 82, y: 10 },
  aim: { x: 88, y: 56 },
};

export function isMobileDevice() {
  return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

function loadLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return structuredClone(DEFAULT_LAYOUT);
    const saved = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_LAYOUT), ...saved };
  } catch {
    return structuredClone(DEFAULT_LAYOUT);
  }
}

function saveLayout(layout) {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function createTouchControls(root, settingsRoot, hooks) {
  const state = {
    enabled: isMobileDevice(),
    moveX: 0,
    moveZ: 0,
    aim: false,
    sprint: false,
    jump: false,
    fire: false,
    lookDx: 0,
    lookDy: 0,
    zoomIn: false,
    zoomOut: false,
  };

  if (!state.enabled) {
    root.hidden = true;
    settingsRoot.hidden = true;
    return {
      enabled: false,
      state,
      setVisible() {},
      reset() {},
      consumeLook() { return { dx: 0, dy: 0 }; },
      consumeZoom() { return 0; },
      clearJumpEdge() {},
      jumpEdge: false,
      openSettings() {},
      closeSettings() {},
      isEditing() { return false; },
    };
  }

  document.documentElement.classList.add('touch-device');
  root.hidden = true;

  let layout = loadLayout();
  let editing = false;
  let playVisible = false;

  const lookZone = root.querySelector('.touch-look');
  const moveBase = root.querySelector('.touch-move-base');
  const moveKnob = root.querySelector('.touch-move-knob');
  const widgets = new Map([...root.querySelectorAll('.touch-widget[data-control]')].map(w => [w.dataset.control, w]));
  const buttons = new Map([...root.querySelectorAll('[data-action]')].map(b => [b.dataset.action, b]));

  function applyLayout() {
    for (const [id, pos] of Object.entries(layout)) {
      const el = widgets.get(id);
      if (!el || !pos) continue;
      el.style.left = `${pos.x}%`;
      el.style.top = `${pos.y}%`;
    }
  }

  function applyWidgetPosition(id, x, y) {
    layout[id] = { x: clamp(x, 4, 96), y: clamp(y, 6, 94) };
    applyLayout();
  }

  function syncVisibility() {
    const show = playVisible || editing;
    root.hidden = !show;
    root.classList.toggle('visible', playVisible);
    root.classList.toggle('editing', editing);
    document.body.classList.toggle('touch-editing', editing);
  }

  applyLayout();
  syncVisibility();

  const MOVE_RADIUS = 46;
  let moveId = null;
  let lookId = null;
  let lookLast = { x: 0, y: 0 };
  let jumpEdge = false;
  let dragId = null;
  let dragControl = null;
  let dragOffset = { x: 0, y: 0 };

  function setBtn(name, on) {
    buttons.get(name)?.classList.toggle('active', !!on);
  }

  function resetMove() {
    moveId = null;
    moveKnob.style.transform = '';
    state.moveX = 0;
    state.moveZ = 0;
  }

  function updateMove(clientX, clientY) {
    const r = moveBase.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > MOVE_RADIUS) {
      dx *= MOVE_RADIUS / d;
      dy *= MOVE_RADIUS / d;
    }
    moveKnob.style.transform = `translate(${dx}px,${dy}px)`;
    state.moveX = dx / MOVE_RADIUS;
    state.moveZ = dy / MOVE_RADIUS;
  }

  moveBase.addEventListener('pointerdown', (e) => {
    if (editing) return;
    e.preventDefault();
    e.stopPropagation();
    moveId = e.pointerId;
    moveBase.setPointerCapture(e.pointerId);
    updateMove(e.clientX, e.clientY);
  });
  moveBase.addEventListener('pointermove', (e) => {
    if (e.pointerId !== moveId) return;
    updateMove(e.clientX, e.clientY);
  });
  const endMove = (e) => {
    if (e.pointerId !== moveId) return;
    resetMove();
  };
  moveBase.addEventListener('pointerup', endMove);
  moveBase.addEventListener('pointercancel', endMove);

  lookZone.addEventListener('pointerdown', (e) => {
    if (editing || !playVisible) return;
    if (e.target.closest('.touch-btn, .touch-widget')) return;
    e.preventDefault();
    lookId = e.pointerId;
    lookLast = { x: e.clientX, y: e.clientY };
    lookZone.setPointerCapture(e.pointerId);
  });
  lookZone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId) return;
    state.lookDx += e.clientX - lookLast.x;
    state.lookDy += e.clientY - lookLast.y;
    lookLast = { x: e.clientX, y: e.clientY };
  });
  const endLook = (e) => {
    if (e.pointerId !== lookId) return;
    lookId = null;
  };
  lookZone.addEventListener('pointerup', endLook);
  lookZone.addEventListener('pointercancel', endLook);

  function bindHold(name, key) {
    const btn = buttons.get(name);
    if (!btn) return;
    const down = (e) => {
      if (editing || btn.classList.contains('reloading')) return;
      e.preventDefault();
      e.stopPropagation();
      state[key] = true;
      setBtn(name, true);
      btn.setPointerCapture?.(e.pointerId);
    };
    const up = () => {
      state[key] = false;
      setBtn(name, false);
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', (e) => {
      if (btn.hasPointerCapture?.(e.pointerId)) up();
    });
  }

  bindHold('aim', 'aim');
  bindHold('fire', 'fire');
  bindHold('sprint', 'sprint');

  buttons.get('jump')?.addEventListener('pointerdown', (e) => {
    if (editing) return;
    e.preventDefault();
    e.stopPropagation();
    jumpEdge = true;
    state.jump = true;
    setBtn('jump', true);
  });
  buttons.get('jump')?.addEventListener('pointerup', () => {
    state.jump = false;
    setBtn('jump', false);
  });

  buttons.get('reload')?.addEventListener('click', (e) => {
    if (editing || buttons.get('reload')?.classList.contains('reloading-active')) return;
    e.preventDefault();
    hooks.onReload?.();
  });
  buttons.get('pause')?.addEventListener('click', (e) => {
    if (editing) return;
    e.preventDefault();
    hooks.onPause?.();
  });
  buttons.get('zoom-in')?.addEventListener('click', (e) => {
    if (editing) return;
    e.preventDefault();
    state.zoomIn = true;
  });
  buttons.get('zoom-out')?.addEventListener('click', (e) => {
    if (editing) return;
    e.preventDefault();
    state.zoomOut = true;
  });

  function startWidgetDrag(e, widget) {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();
    dragId = e.pointerId;
    dragControl = widget.dataset.control;
    const rect = widget.getBoundingClientRect();
    dragOffset = { x: e.clientX - (rect.left + rect.width / 2), y: e.clientY - (rect.top + rect.height / 2) };
    widget.setPointerCapture(e.pointerId);
    widget.classList.add('dragging');
  }

  function moveWidgetDrag(e) {
    if (e.pointerId !== dragId || !dragControl) return;
    const x = ((e.clientX - dragOffset.x) / innerWidth) * 100;
    const y = ((e.clientY - dragOffset.y) / innerHeight) * 100;
    applyWidgetPosition(dragControl, x, y);
  }

  function endWidgetDrag(e) {
    if (e.pointerId !== dragId) return;
    widgets.get(dragControl)?.classList.remove('dragging');
    dragId = null;
    dragControl = null;
    saveLayout(layout);
  }

  widgets.forEach((widget) => {
    widget.addEventListener('pointerdown', (e) => startWidgetDrag(e, widget));
    widget.addEventListener('pointermove', moveWidgetDrag);
    widget.addEventListener('pointerup', endWidgetDrag);
    widget.addEventListener('pointercancel', endWidgetDrag);
  });

  const editBtn = settingsRoot.querySelector('#touch-edit-start');
  const doneBtn = settingsRoot.querySelector('#touch-edit-done');
  const floatingDoneBtn = root.querySelector('#touch-edit-floating-done');
  const resetBtn = settingsRoot.querySelector('#touch-reset-layout');
  const closeBtn = settingsRoot.querySelector('#touch-settings-close');
  const backdrop = settingsRoot.querySelector('.touch-settings-backdrop');

  function setEditing(on) {
    editing = on;
    settingsRoot.classList.toggle('editing', on);
    if (editBtn) editBtn.hidden = on;
    if (doneBtn) doneBtn.hidden = !on;
    if (floatingDoneBtn) floatingDoneBtn.hidden = !on;
    settingsRoot.hidden = on;
    syncVisibility();
    if (on) hooks.onEditStart?.();
    else {
      saveLayout(layout);
      hooks.onEditEnd?.();
    }
  }

  function openSettings() {
    settingsRoot.hidden = false;
    document.body.classList.add('touch-settings-open');
  }

  function closeSettings() {
    if (editing) setEditing(false);
    settingsRoot.hidden = true;
    document.body.classList.remove('touch-settings-open');
  }

  editBtn?.addEventListener('click', () => setEditing(true));
  doneBtn?.addEventListener('click', closeSettings);
  floatingDoneBtn?.addEventListener('click', closeSettings);
  resetBtn?.addEventListener('click', () => {
    layout = structuredClone(DEFAULT_LAYOUT);
    applyLayout();
    saveLayout(layout);
  });
  closeBtn?.addEventListener('click', closeSettings);
  backdrop?.addEventListener('click', closeSettings);

  return {
    enabled: true,
    state,
    setVisible(show) {
      playVisible = show;
      if (!show) {
        resetMove();
        lookId = null;
        if (editing) setEditing(false);
      }
      syncVisibility();
    },
    reset() {
      resetMove();
      lookId = null;
      state.aim = false;
      state.sprint = false;
      state.jump = false;
      state.fire = false;
      state.lookDx = 0;
      state.lookDy = 0;
      jumpEdge = false;
      ['aim', 'fire', 'sprint', 'jump'].forEach(n => setBtn(n, false));
    },
    consumeLook() {
      const dx = state.lookDx;
      const dy = state.lookDy;
      state.lookDx = 0;
      state.lookDy = 0;
      return { dx, dy };
    },
    consumeZoom() {
      let d = 0;
      if (state.zoomIn) d -= 1;
      if (state.zoomOut) d += 1;
      state.zoomIn = false;
      state.zoomOut = false;
      return d;
    },
    get jumpEdge() { return jumpEdge; },
    clearJumpEdge() { jumpEdge = false; },
    openSettings,
    closeSettings,
    isEditing() { return editing; },
  };
}
