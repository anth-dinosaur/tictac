// Option catalogs + persisted user settings (settings only — never scores).

export const PALETTE = [
  { id: 'cyan', name: 'NEON CYAN', c: '#00f0ff' },
  { id: 'magenta', name: 'HOT MAGENTA', c: '#ff2bd6' },
  { id: 'acid', name: 'ACID', c: '#7dff1f' },
  { id: 'amber', name: 'AMBER', c: '#ffb000' },
  { id: 'violet', name: 'ULTRAVIOLET', c: '#a45cff' },
  { id: 'crimson', name: 'CRIMSON', c: '#ff2a55' },
  { id: 'ice', name: 'ICE', c: '#dff6ff' },
];

export const MARK_COLORS = [
  ...PALETTE,
  { id: 'spectrum', name: 'SPECTRUM', c: 'spectrum' },
  { id: 'glitch', name: 'GLITCH', c: 'glitch' },
];

// Vector styles draw the player's own letter (X or O); icons are shared pixel sprites.
export const MARK_STYLES = [
  { id: 'neon', name: 'NEON' },
  { id: 'wire', name: 'WIRE' },
  { id: 'block', name: 'BLOCK' },
  { id: 'shard', name: 'SHARD' },
  { id: 'plasma', name: 'PLASMA' },
  { id: 'pixel', name: 'PIXEL' },
];

export const MARK_ICONS = [
  { id: 'letter', name: 'LETTER' },
  { id: 'skull', name: 'SKULL' },
  { id: 'invader', name: 'INVADER' },
  { id: 'bug', name: 'BUG' },
  { id: 'chip', name: 'CHIP' },
  { id: 'gem', name: 'GEM' },
  { id: 'bolt', name: 'BOLT' },
  { id: 'apple', name: 'APPLE' },
  { id: 'orb', name: 'DATA ORB' },
];

export const BOARD_STYLES = [
  { id: 'grid', name: 'GRID' },
  { id: 'dots', name: 'DOT MATRIX' },
  { id: 'circuit', name: 'CIRCUIT' },
  { id: 'hex', name: 'HEXFIELD' },
  { id: 'matrix', name: 'RAIN' },
  { id: 'void', name: 'VOID' },
];

export const BOARD_COLORS = PALETTE;

// n = cells per side, k = marks in a row to win.
export const GRIDS = [
  { id: '3', name: '3×3', n: 3, k: 3, sub: '3 IN A ROW' },
  { id: '4', name: '4×4', n: 4, k: 4, sub: '4 IN A ROW' },
  { id: '5', name: '5×5', n: 5, k: 4, sub: '4 IN A ROW' },
  { id: '6', name: '6×6', n: 6, k: 5, sub: '5 IN A ROW' },
];

export const MODES = [
  { id: 'cpu', name: 'VS CPU', sub: '1 PLAYER' },
  { id: 'local', name: 'PASS & PLAY', sub: '2 PLAYERS' },
];

export const DIFFICULTIES = [
  { id: 'easy', name: 'EASY', sub: 'SCRIPT KIDDIE' },
  { id: 'normal', name: 'NORMAL', sub: 'SYSADMIN' },
  { id: 'hard', name: 'HARD', sub: 'BLACK ICE' },
  { id: 'insane', name: 'INSANE', sub: 'UNBEATABLE AI' },
];

export const SIDES = [
  { id: 'x', name: 'X', sub: 'ALWAYS FIRST' },
  { id: 'o', name: 'O', sub: 'CPU OPENS' },
  { id: 'swap', name: 'SWAP', sub: 'ALTERNATE' },
];

// CPU "think" delay before it moves.
export const CPU_SPEEDS = [
  { id: 'instant', name: 'INSTANT', ms: 120, sub: '0.1S' },
  { id: 'stock', name: 'STOCK', ms: 480, sub: '0.5S' },
  { id: 'dramatic', name: 'DRAMATIC', ms: 1100, sub: '1.1S' },
];

export const DEFAULTS = {
  xColor: 'cyan',
  xStyle: 'neon',
  xIcon: 'letter',
  oColor: 'magenta',
  oStyle: 'neon',
  oIcon: 'letter',
  boardStyle: 'grid',
  boardColor: 'cyan',
  grid: '3',
  wrap: false,
  mode: 'cpu',
  difficulty: 'hard',
  side: 'x',
  cpuSpeed: 'stock',
  sound: true,
  volume: 0.8,
};

const KEY = 'tictac.settings.v1';

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode — fine */
  }
}

export const byId = (list, id) => list.find((o) => o.id === id) || list[0];

// Three named config save slots (not game state). Each slot is null or { name, settings }.
export const SLOT_COUNT = 3;
const PRESETS_KEY = 'tictac.presets.v1';

export function loadPresets() {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]');
  } catch {
    /* corrupt — start empty */
  }
  return Array.from({ length: SLOT_COUNT }, (_, i) => {
    const p = Array.isArray(saved) ? saved[i] : null;
    return p && p.settings ? { name: String(p.name || `SLOT ${i + 1}`), settings: { ...DEFAULTS, ...p.settings } } : null;
  });
}

export function savePresets(presets) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  } catch {
    /* private mode — fine */
  }
}

export const sameSettings = (a, b) => Object.keys(DEFAULTS).every((k) => a[k] === b[k]);
