const STORAGE_KEY = "island-war-desktop-controls";

export const DEFAULT_BINDS = {
  forward: "KeyW",
  left: "KeyA",
  back: "KeyS",
  right: "KeyD",
  sprint: "ShiftLeft",
  crawl: "ControlLeft",
  jump: "Space",
  pickup: "KeyE",
  weapon1: "Digit1",
  weapon2: "Digit2",
  weapon3: "Digit3",
  weapon4: "Digit4",
  reload: "KeyR",
  shoot: "Mouse0",
  aim: "Mouse2",
};

export const BIND_ACTIONS = [
  { id: "forward", label: "Move forward" },
  { id: "left", label: "Move left" },
  { id: "back", label: "Move back" },
  { id: "right", label: "Move right" },
  { id: "sprint", label: "Sprint" },
  { id: "crawl", label: "Crawl" },
  { id: "jump", label: "Jump" },
  { id: "pickup", label: "Pick up" },
  { id: "weapon1", label: "Weapon 1" },
  { id: "weapon2", label: "Weapon 2" },
  { id: "weapon3", label: "Weapon 3" },
  { id: "weapon4", label: "Weapon 4" },
  { id: "reload", label: "Reload" },
  { id: "shoot", label: "Shoot" },
  { id: "aim", label: "Aim / scope" },
];

export const DEFAULT_MOUSE_SPEED = 1;
export const MOUSE_SPEED_MIN = 0.4;
export const MOUSE_SPEED_MAX = 2.5;
export const MOUSE_SPEED_STEP = 0.1;

const BLOCKED = new Set([
  "Escape",
  "Tab",
  "MetaLeft",
  "MetaRight",
  "F5",
  "F11",
  "F12",
]);

const LABELS = {
  Space: "Space",
  ShiftLeft: "Shift",
  ShiftRight: "Shift",
  ControlLeft: "Ctrl",
  ControlRight: "Ctrl",
  AltLeft: "Alt",
  AltRight: "Alt",
  Mouse0: "Left click",
  Mouse1: "Middle click",
  Mouse2: "Right click",
  Mouse3: "Mouse 4",
  Mouse4: "Mouse 5",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Backslash: "\\",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
};

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function normalizeCode(code) {
  if (code === "ShiftRight") return "ShiftLeft";
  if (code === "ControlRight") return "ControlLeft";
  if (code === "AltRight") return "AltLeft";
  return code;
}

export function bindLabel(code) {
  if (!code) return "—";
  if (LABELS[code]) return LABELS[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "Num " + code.slice(6);
  return code;
}

export function aliases(code) {
  if (code === "ShiftLeft" || code === "ShiftRight")
    return ["ShiftLeft", "ShiftRight"];
  if (code === "ControlLeft" || code === "ControlRight")
    return ["ControlLeft", "ControlRight"];
  if (code === "AltLeft" || code === "AltRight") return ["AltLeft", "AltRight"];
  return [code];
}

export function mouseButtonIndex(code) {
  if (!code?.startsWith("Mouse")) return null;
  return Number(code.slice(5));
}

export function mouseButtonMask(code) {
  const button = mouseButtonIndex(code);
  if (button === 0) return 1;
  if (button === 1) return 4;
  if (button === 2) return 2;
  if (button === 3) return 8;
  if (button === 4) return 16;
  return 0;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { binds: { ...DEFAULT_BINDS }, mouseSpeed: DEFAULT_MOUSE_SPEED };
    const saved = JSON.parse(raw);
    return {
      binds: { ...DEFAULT_BINDS, ...(saved.binds || {}) },
      mouseSpeed: clamp(
        Number(saved.mouseSpeed) || DEFAULT_MOUSE_SPEED,
        MOUSE_SPEED_MIN,
        MOUSE_SPEED_MAX,
      ),
    };
  } catch {
    return { binds: { ...DEFAULT_BINDS }, mouseSpeed: DEFAULT_MOUSE_SPEED };
  }
}

function saveState(binds, mouseSpeed) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ binds, mouseSpeed }));
}

export function createDesktopControls(root, hooks = {}) {
  const state = loadState();
  let listening = null;
  const list = root.querySelector("#desktop-bind-list");
  const speedValue = root.querySelector("#mouse-speed-value");

  function persist() {
    saveState(state.binds, state.mouseSpeed);
    hooks.onChange?.();
  }

  function codeOf(action) {
    return state.binds[action];
  }

  function isMouse(action) {
    return codeOf(action)?.startsWith("Mouse");
  }

  function held(action, keys, buttons = 0) {
    const code = codeOf(action);
    if (!code) return false;
    if (code.startsWith("Mouse")) return (buttons & mouseButtonMask(code)) !== 0;
    return aliases(code).some((c) => keys.has(c));
  }

  function matches(action, code) {
    return aliases(codeOf(action)).includes(normalizeCode(code));
  }

  function assign(action, code) {
    const next = normalizeCode(code);
    for (const [other, bound] of Object.entries(state.binds)) {
      if (other !== action && bound === next) state.binds[other] = state.binds[action];
    }
    state.binds[action] = next;
    listening = null;
    persist();
    render();
  }

  function cancelListen() {
    if (!listening) return;
    listening = null;
    render();
  }

  function startListen(action) {
    listening = action;
    render();
  }

  function capture(e) {
    if (!listening) return;
    if (e.type === "keydown") {
      if (e.code === "Escape") {
        e.preventDefault();
        cancelListen();
        return;
      }
      if (e.repeat || BLOCKED.has(e.code)) return;
      e.preventDefault();
      e.stopPropagation();
      assign(listening, e.code);
      return;
    }
    if (e.type === "mousedown") {
      if (e.target.closest("button, input, a, .bind-key")) return;
      e.preventDefault();
      e.stopPropagation();
      assign(listening, `Mouse${e.button}`);
    }
  }

  function nudgeSpeed(dir) {
    state.mouseSpeed = clamp(
      Math.round((state.mouseSpeed + dir * MOUSE_SPEED_STEP) * 10) / 10,
      MOUSE_SPEED_MIN,
      MOUSE_SPEED_MAX,
    );
    persist();
    render();
  }

  function reset() {
    state.binds = { ...DEFAULT_BINDS };
    state.mouseSpeed = DEFAULT_MOUSE_SPEED;
    listening = null;
    persist();
    render();
  }

  function render() {
    if (list) {
      list.innerHTML = BIND_ACTIONS.map(({ id, label }) => {
        const waiting = listening === id;
        const text = waiting ? "Press key…" : bindLabel(codeOf(id));
        return `<li><span class="bind-label">${label}</span><button type="button" class="bind-key${waiting ? " listening" : ""}" data-bind="${id}">${text}</button></li>`;
      }).join("");
    }
    if (speedValue)
      speedValue.textContent = `${Math.round(state.mouseSpeed * 100)}%`;
  }

  list?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-bind]");
    if (!btn) return;
    const action = btn.dataset.bind;
    if (listening === action) cancelListen();
    else startListen(action);
  });
  root.querySelector("#mouse-speed-down")?.addEventListener("click", () => nudgeSpeed(-1));
  root.querySelector("#mouse-speed-up")?.addEventListener("click", () => nudgeSpeed(1));
  root.querySelector("#desktop-binds-reset")?.addEventListener("click", reset);

  addEventListener("keydown", capture, true);
  addEventListener("mousedown", capture, true);

  render();

  return {
    get mouseSpeed() {
      return state.mouseSpeed;
    },
    codeOf,
    isMouse,
    held,
    matches,
    bindLabel: (action) => bindLabel(codeOf(action)),
    cancelListen,
    shouldPrevent(code) {
      return BIND_ACTIONS.some(({ id }) => matches(id, code));
    },
  };
}
