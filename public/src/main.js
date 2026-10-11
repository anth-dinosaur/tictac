import {
  loadSettings,
  saveSettings,
  byId,
  MARK_COLORS,
  MARK_STYLES,
  MARK_ICONS,
  BOARD_STYLES,
  BOARD_COLORS,
  GRIDS,
  MODES,
  DIFFICULTIES,
  SIDES,
  CPU_SPEEDS,
  DEFAULTS,
  loadPresets,
  savePresets,
  sameSettings,
} from './settings.js';
import { Game, cpuMove, X, O } from './game.js';
import { Renderer, paintStyleChip, paintMarkChip, markColor } from './render.js';
import { unlockAudio, fart, womp, fanfare, stalemate, setVolume } from './audio.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const renderer = new Renderer(canvas);
const previewCanvas = $('preview');
const preview = new Renderer(previewCanvas, { preview: true });

let settings = loadSettings();
let presets = loadPresets();
let state = 'title'; // title | playing | paused | ending | over
let game = null;
let demo = null;
let previewGame = null;
let human = X; // the mark the local player holds this round (vs CPU)
let round = 0;
let cpuAt = 0; // timestamp the CPU will move at (0 = not scheduled)
let hover = -1;
let settingsFrom = null;
let gridDirty = false;
let tally = { x: 0, o: 0, d: 0 }; // this session only — never saved
let dpr = Math.min(window.devicePixelRatio || 1, 3);
let last = performance.now();

const grid = () => byId(GRIDS, settings.grid);
const vsCpu = () => settings.mode === 'cpu';
const cpuDelay = () => byId(CPU_SPEEDS, settings.cpuSpeed).ms;
const markName = (p) => (p === X ? 'X' : 'O');

// ---------- layout ----------

function insets() {
  const cs = getComputedStyle($('safe-probe'));
  return {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
}

// Largest square board that fits between the HUD and the footer readout.
function layout(n) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const ins = insets();
  const top = ins.top + 66;
  const bottom = ins.bottom + 36;
  const side = Math.max(ins.left, ins.right) + 22;
  const aw = w - side * 2;
  const ah = h - top - bottom;
  const size = Math.floor(Math.min(aw, ah, 560) / n) * n;
  return { x: Math.round((w - size) / 2), y: Math.round(top + (ah - size) / 2), size, n };
}

// The start hint lives in the gap between the HUD and the board so it never covers cells.
function placeHint(L) {
  const hud = insets().top + 56;
  const gap = Math.max(0, L.y - 8 - hud);
  const el = $('hint');
  el.style.top = `${hud}px`;
  el.style.height = `${gap}px`;
  el.classList.toggle('compact', gap < 120);
}

function newGame() {
  const g = grid();
  return new Game(g.n, g.k, settings.wrap);
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, dpr);
  if (game && state !== 'title') {
    const L = layout(game.n);
    renderer.setBoard(L);
    placeHint(L);
  }
  else newDemo();
  sizePreview();
}

// ---------- attract mode (title + settings preview): CPU vs CPU ----------

function newDemo() {
  demo = newGame();
  demo._next = performance.now() + 700;
  renderer.reset();
  renderer.setBoard(layout(demo.n));
}

function runAutoplay(g, r, now, gap) {
  if (g.over) {
    if (r.endDone() && now - r.end.t0 > 2200) {
      g.reset();
      r.reset();
      g._next = now + 500;
    }
    return;
  }
  if (now < (g._next || 0)) return;
  const ev = g.play(cpuMove(g, Math.random() < 0.5 ? 'normal' : 'hard'));
  g._next = now + gap * (0.7 + Math.random() * 0.6);
  r.fxPlace(ev.at, ev.by);
  if (ev.win) r.fxEnd(g, 'win');
  else if (ev.draw) r.fxEnd(g, 'draw');
}

// ---------- game flow ----------

function show(id, on) {
  $(id).classList.toggle('hidden', !on);
}

function startRound() {
  game = newGame();
  renderer.reset();
  const L = layout(game.n);
  renderer.setBoard(L);
  placeHint(L);
  gridDirty = false;
  human = settings.side === 'o' ? O : settings.side === 'swap' && round % 2 ? O : X;
  round++;
  state = 'playing';
  hover = -1;
  ['screen-title', 'screen-over', 'screen-pause', 'screen-settings'].forEach((s) => show(s, false));
  show('hud', true);
  $('hint-sub').textContent = vsCpu()
    ? `YOU ARE ${markName(human)} // ${game.k} IN A ROW${game.wrap ? ' // EDGES WRAP' : ''}`
    : `PASS & PLAY // ${game.k} IN A ROW${game.wrap ? ' // EDGES WRAP' : ''}`;
  scheduleCpu();
  updateHud();
}

const cpuTurn = () => vsCpu() && game && !game.over && game.turn !== human;

function scheduleCpu() {
  cpuAt = cpuTurn() ? performance.now() + cpuDelay() + (game.moves.length ? 0 : 300) : 0;
  show('hint', state === 'playing' && !cpuTurn() && game.moves.length === 0);
}

function place(i) {
  if (state !== 'playing' || !game.free(i)) return false;
  const ev = game.play(i);
  renderer.fxPlace(ev.at, ev.by);
  if (settings.sound) fart();
  show('hint', false);
  hover = -1;
  if (ev.win || ev.draw) endRound(ev);
  else scheduleCpu();
  updateHud(ev.by);
  return true;
}

function endRound(ev) {
  state = 'ending';
  cpuAt = 0;
  let kind = 'win';
  if (ev.draw) {
    kind = 'draw';
    tally.d++;
  } else if (vsCpu()) {
    kind = game.winner === human ? 'win' : 'lose';
    tally[kind === 'win' ? 'x' : 'o']++;
  } else tally[game.winner === X ? 'x' : 'o']++;
  renderer.fxEnd(game, kind);
  if (kind === 'lose') {
    canvas.classList.add('rgb-split');
    setTimeout(() => canvas.classList.remove('rgb-split'), 450);
  }
  if (settings.sound) setTimeout(() => (kind === 'lose' ? womp() : kind === 'draw' ? stalemate() : fanfare()), 160);

  const panel = $('over-panel');
  panel.className = `panel ${kind === 'lose' ? 'danger' : kind === 'draw' ? 'draw' : 'win'}`;
  const [tag, title, reason] =
    kind === 'draw'
      ? ['DEADLOCK 0x0000', 'STALEMATE', 'GRID LOCKED // NO LINES LEFT']
      : kind === 'lose'
        ? ['FATAL_EXCEPTION 0xDEAD', 'CORE DUMPED', `CPU COMPLETED ${game.k} IN A ROW`]
        : vsCpu()
          ? ['ACCESS GRANTED', 'CPU PWNED', `${game.k} IN A ROW // YOU WIN`]
          : ['ACCESS GRANTED', `${markName(game.winner)} WINS`, `${game.k} IN A ROW${game.winLine && isWrapped(game) ? ' // VIA EDGE WRAP' : ''}`];
  $('over-tag').textContent = tag;
  $('over-title').textContent = title;
  $('over-title').dataset.text = title;
  $('over-reason').textContent = reason;
}

// Did the winning line go through a wrapped edge?
function isWrapped(g) {
  const c = g.winLine.cells;
  for (let k = 1; k < c.length; k++) {
    const ax = c[k - 1] % g.n;
    const bx = c[k] % g.n;
    const ay = Math.floor(c[k - 1] / g.n);
    const by = Math.floor(c[k] / g.n);
    if (Math.abs(ax - bx) > 1 || Math.abs(ay - by) > 1) return true;
  }
  return false;
}

function showOver() {
  state = 'over';
  updateHud();
  $('over-x').textContent = String(tally.x);
  $('over-d').textContent = String(tally.d);
  $('over-o').textContent = String(tally.o);
  $('over-x-lbl').textContent = vsCpu() ? 'YOU' : 'X';
  $('over-o-lbl').textContent = vsCpu() ? 'CPU' : 'O';
  const scr = $('screen-over');
  scr.style.pointerEvents = 'none';
  show('screen-over', true);
  setTimeout(() => (scr.style.pointerEvents = ''), 650);
}

function toTitle() {
  state = 'title';
  game = null;
  cpuAt = 0;
  tally = { x: 0, o: 0, d: 0 };
  round = 0;
  ['screen-over', 'screen-pause', 'screen-settings', 'hud', 'hint'].forEach((s) => show(s, false));
  show('screen-title', true);
  newDemo();
}

let pausedCpu = 0;
function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  pausedCpu = cpuAt ? Math.max(0, cpuAt - performance.now()) : 0;
  cpuAt = 0;
  show('hint', false);
  show('screen-pause', true);
}

function resume() {
  show('screen-pause', false);
  if (gridDirty) {
    startRound();
    toast('GRID REBUILT // NEW ROUND');
    return;
  }
  state = 'playing';
  if (cpuTurn()) cpuAt = performance.now() + Math.max(250, pausedCpu);
  show('hint', !cpuTurn() && game.moves.length === 0);
}

function updateHud(bumpMark) {
  if (!game) return;
  const cpu = vsCpu();
  const xMark = cpu ? human : X;
  const oMark = cpu ? (human === X ? O : X) : O;
  $('hud-x-lbl').textContent = cpu ? `YOU·${markName(xMark)}` : 'X';
  $('hud-o-lbl').textContent = cpu ? `CPU·${markName(oMark)}` : 'O';
  $('hud-x').textContent = String(tally.x).padStart(2, '0');
  $('hud-o').textContent = String(tally.o).padStart(2, '0');
  $('hud-d').textContent = String(tally.d).padStart(2, '0');
  const turn = $('hud-turn');
  const thinking = cpuTurn();
  turn.textContent = game.over ? '--' : cpu ? (thinking ? 'CPU' : 'YOU') : markName(game.turn);
  turn.classList.toggle('cpu', thinking);
  const tc = markColor(settings[game.turn === X ? 'xColor' : 'oColor'], 0, performance.now() / 1000);
  turn.style.textShadow = game.over ? '' : `0 0 10px ${tc}, -1px 0 0 rgba(255,43,214,0.6), 1px 0 0 rgba(0,240,255,0.6)`;
  if (bumpMark) {
    const el = turn;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
}

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 1600);
}

// ---------- input: tap a cell ----------

const canPlace = () => state === 'playing' && !game.over && !cpuTurn();
let down = null;

canvas.addEventListener('pointerdown', (e) => {
  unlockAudio();
  if (!canPlace()) return;
  e.preventDefault();
  down = { id: e.pointerId, cell: renderer.cellAt(e.clientX, e.clientY) };
  hover = down.cell;
});
canvas.addEventListener('pointermove', (e) => {
  if (!game || !canPlace()) return;
  if (down && e.pointerId !== down.id) return;
  if (!down && e.pointerType !== 'mouse') return;
  hover = renderer.cellAt(e.clientX, e.clientY);
});
canvas.addEventListener('pointerup', (e) => {
  if (!down || e.pointerId !== down.id) return;
  const cell = renderer.cellAt(e.clientX, e.clientY);
  // Commit on release over the same cell — slide off to cancel.
  if (cell >= 0 && cell === down.cell && canPlace()) place(cell);
  down = null;
  if (e.pointerType !== 'mouse') hover = -1;
});
canvas.addEventListener('pointercancel', () => {
  down = null;
  hover = -1;
});
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse' && !down) hover = -1;
});

// Keyboard (desktop testing): arrows move a cursor, Enter places, 1-9 = numpad cells on 3×3.
const MOVES = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
window.addEventListener('keydown', (e) => {
  unlockAudio();
  if (!$('screen-settings').classList.contains('hidden')) {
    if (e.key === 'Escape') closeSettings();
    return;
  }
  if (MOVES[e.key] && canPlace()) {
    e.preventDefault();
    const n = game.n;
    const c = hover >= 0 ? hover : Math.floor((n * n) / 2);
    const [dx, dy] = MOVES[e.key];
    hover = ((Math.floor(c / n) + dy + n) % n) * n + ((c % n) + dx + n) % n;
  } else if (e.key === 'Enter' && canPlace() && hover >= 0) {
    place(hover);
  } else if (/^[1-9]$/.test(e.key) && canPlace() && game.n === 3) {
    const k = Number(e.key) - 1;
    place((2 - Math.floor(k / 3)) * 3 + (k % 3));
  } else if (e.key === ' ' || e.key === 'Escape' || e.key === 'p') {
    e.preventDefault();
    if (state === 'playing') pause();
    else if (state === 'paused') resume();
  } else if (e.key === 'Enter') {
    if (state === 'title' || state === 'over') startRound();
  }
});

// Block iOS rubber-banding everywhere except the scrollable settings body.
document.addEventListener(
  'touchmove',
  (e) => {
    if (!e.target.closest?.('.settings-body')) e.preventDefault();
  },
  { passive: false },
);
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('touchend', () => unlockAudio(), { passive: true });
// No double-tap zoom when tapping cells quickly.
canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') pause();
});

// ---------- buttons ----------

const on = (id, fn) =>
  $(id).addEventListener('click', () => {
    unlockAudio();
    fn();
  });
on('btn-play', startRound);
on('btn-config', () => openSettings('title'));
on('btn-pause', pause);
on('btn-resume', resume);
on('btn-restart', startRound);
on('btn-pause-config', () => openSettings('pause'));
on('btn-quit', toTitle);
on('btn-again', startRound);
on('btn-over-config', () => openSettings('over'));
on('btn-over-quit', toTitle);
on('btn-settings-back', closeSettings);

// ---------- settings UI ----------

let tab = 'x';
let chipTimer = 0;
// Changing any of these mid-round needs a fresh board.
const STRUCTURAL = ['grid', 'wrap', 'mode', 'side'];

function applyTheme() {
  const c = byId(BOARD_COLORS, settings.boardColor).c;
  const n = parseInt(c.slice(1), 16);
  document.documentElement.style.setProperty('--accent', c);
  document.documentElement.style.setProperty('--accent-rgb', `${n >> 16}, ${(n >> 8) & 255}, ${n & 255}`);
  renderer.setSettings(settings);
  preview.setSettings(settings);
  setVolume(settings.volume);
}

// Apply a settings change: persist, retheme, and rebuild the board if its shape moved.
function commit(prev) {
  saveSettings(settings);
  applyTheme();
  const changed = STRUCTURAL.filter((k) => prev[k] !== settings[k]);
  if (changed.length) {
    if (prev.mode !== settings.mode) {
      tally = { x: 0, o: 0, d: 0 };
      round = 0;
    }
    if (state === 'title') newDemo();
    else if (game) gridDirty = true;
    if (prev.grid !== settings.grid || prev.wrap !== settings.wrap) sizePreview();
  }
  if (game) updateHud();
  renderSlots();
}

function set(key, value) {
  const prev = { ...settings };
  settings[key] = value;
  commit(prev);
  buildTab();
}

// ---------- preset slots ----------

const esc = (str) => String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function dot(list, id) {
  const c = byId(list, id).c;
  return c.startsWith('#') ? `<i style="--c:${c}"></i>` : `<i class="${c}"></i>`;
}

function dots(p) {
  if (!p) return '<span class="dots empty"><i></i><i></i><i></i></span>';
  const s = p.settings;
  return `<span class="dots">${dot(MARK_COLORS, s.xColor)}${dot(MARK_COLORS, s.oColor)}${dot(BOARD_COLORS, s.boardColor)}</span>`;
}

const isActive = (p) => p && sameSettings(p.settings, settings);

// The one-tap strip on the title and pause screens.
function renderSlots() {
  const html = `<div class="slots-label"><span>PRESETS</span><span>TAP TO LOAD</span></div><div class="slots-row">${presets
    .map(
      (p, i) =>
        `<button class="slot ${p ? '' : 'empty'} ${isActive(p) ? 'on' : ''}" data-slot="${i}" aria-label="${p ? `Load ${esc(p.name)}` : `Save to slot ${i + 1}`}">${dots(p)}<span class="nm">${p ? esc(p.name) : '+ SAVE'}</span></button>`,
    )
    .join('')}</div>`;
  $('slots-title').innerHTML = html;
  $('slots-pause').innerHTML = html;
}

function loadPreset(i) {
  const p = presets[i];
  if (!p) return;
  const prev = { ...settings };
  Object.assign(settings, DEFAULTS, p.settings);
  commit(prev);
  toast(`LOADED // ${p.name}`);
}

function storePreset(i) {
  presets[i] = { name: presets[i]?.name || `SLOT ${i + 1}`, settings: { ...settings } };
  savePresets(presets);
  renderSlots();
}

function clearPreset(i) {
  presets[i] = null;
  savePresets(presets);
  renderSlots();
}

for (const id of ['slots-title', 'slots-pause']) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('[data-slot]');
    if (!b) return;
    unlockAudio();
    const i = Number(b.dataset.slot);
    if (presets[i]) loadPreset(i);
    else {
      storePreset(i);
      toast(`SAVED // SLOT ${i + 1}`);
    }
  });
}

function openSettings(from) {
  settingsFrom = from;
  show('screen-settings', true);
  if (from !== 'title') show(from === 'pause' ? 'screen-pause' : 'screen-over', false);
  else show('screen-title', false);
  sizePreview();
  buildTab();
}

function closeSettings() {
  show('screen-settings', false);
  if (settingsFrom === 'title') show('screen-title', true);
  else if (settingsFrom === 'pause') {
    if (gridDirty) {
      startRound();
      toast('GRID REBUILT // NEW ROUND');
    } else show('screen-pause', true);
  } else show('screen-over', true);
}

function sizePreview() {
  const w = previewCanvas.clientWidth;
  const h = previewCanvas.clientHeight;
  if (!w || !h) return;
  preview.setSize(w, h, dpr);
  const g = grid();
  const size = Math.floor((h - 26) / g.n) * g.n;
  previewGame = new Game(g.n, g.k, settings.wrap);
  previewGame._next = performance.now() + 300;
  preview.reset();
  preview.setBoard({ x: Math.round((w - size) / 2), y: 13, size, n: g.n });
}

$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  tab = b.dataset.tab;
  [...$('tabs').children].forEach((x) => x.classList.toggle('on', x === b));
  buildTab();
});

function group(label, value, inner) {
  return `<div class="group"><div class="group-label"><span>${label}</span><b>${value}</b></div>${inner}</div>`;
}

function swatches(key, list) {
  return `<div class="swatches">${list
    .map((o) => {
      const special = o.c.startsWith('#') ? '' : o.c;
      return `<button class="swatch ${special} ${settings[key] === o.id ? 'on' : ''}" data-key="${key}" data-val="${o.id}" aria-label="${o.name}" style="--c:${o.c.startsWith('#') ? o.c : '#fff'}"><i></i></button>`;
    })
    .join('')}</div>`;
}

function chips(key, list, { cls = '', canvasKind = '', cols = 3, sub, muted = false } = {}) {
  return `<div class="chips cols-${cols} ${muted ? 'muted' : ''}">${list
    .map(
      (o) =>
        `<button class="chip ${cls} ${String(settings[key]) === o.id ? 'on' : ''}" data-key="${key}" data-val="${o.id}">${
          canvasKind ? `<canvas data-kind="${canvasKind}" data-id="${o.id}"></canvas>` : ''
        }<span>${o.name}</span>${sub ? `<span class="sub">${sub(o)}</span>` : ''}</button>`,
    )
    .join('')}</div>`;
}

function toggleRow(id, name, desc, value) {
  return `<div class="group"><div class="row"><div><div class="name">${name}</div><div class="desc">${desc}</div></div><button class="toggle ${value ? 'on' : ''}" id="${id}" aria-label="${name}"></button></div></div>`;
}

function markTab(k) {
  const letter = settings[`${k}Icon`] === 'letter';
  let html = '';
  html += group('COLOR', byId(MARK_COLORS, settings[`${k}Color`]).name, swatches(`${k}Color`, MARK_COLORS));
  html += group('ICON', byId(MARK_ICONS, settings[`${k}Icon`]).name, chips(`${k}Icon`, MARK_ICONS, { canvasKind: `icon-${k}`, cls: 'mark' }));
  html += group(
    'LETTER STYLE',
    letter ? byId(MARK_STYLES, settings[`${k}Style`]).name : 'ICON IN USE',
    chips(`${k}Style`, MARK_STYLES, { canvasKind: `style-${k}`, cls: 'mark', muted: !letter }),
  );
  html += `<div class="note">LETTER STYLE APPLIES WHEN ICON IS SET TO LETTER. PICK DIFFERENT COLORS FOR X AND O SO YOU CAN TELL THEM APART.</div>`;
  return html;
}

function buildTab() {
  const body = $('settings-body');
  let html = '';
  if (tab === 'x' || tab === 'o') html = markTab(tab);
  else if (tab === 'board') {
    html += group('STYLE', byId(BOARD_STYLES, settings.boardStyle).name, chips('boardStyle', BOARD_STYLES, { canvasKind: 'style' }));
    html += group('COLOR', byId(BOARD_COLORS, settings.boardColor).name, swatches('boardColor', BOARD_COLORS));
    html += group('GRID SIZE', grid().name, chips('grid', GRIDS, { cols: 2, cls: 'big', sub: (o) => o.sub }));
    html += toggleRow('tgl-wrap', 'EDGE WRAP', 'LINES WRAP AROUND THE EDGES OF THE GRID.<br/>THE BOARD BECOMES A TORUS.', settings.wrap);
    html += `<div class="note">CHANGING GRID SIZE OR EDGE WRAP MID-ROUND STARTS A NEW ROUND.</div>`;
  } else if (tab === 'cpu') {
    html += group('MODE', byId(MODES, settings.mode).name, chips('mode', MODES, { cols: 2, cls: 'big', sub: (o) => o.sub }));
    html += group('DIFFICULTY', byId(DIFFICULTIES, settings.difficulty).name, chips('difficulty', DIFFICULTIES, { cols: 2, cls: 'big', sub: (o) => o.sub, muted: !vsCpu() }));
    html += group('YOU PLAY', byId(SIDES, settings.side).name, chips('side', SIDES, { cls: 'big', sub: (o) => o.sub, muted: !vsCpu() }));
    html += group('CPU SPEED', byId(CPU_SPEEDS, settings.cpuSpeed).name, chips('cpuSpeed', CPU_SPEEDS, { cls: 'big', sub: (o) => o.sub, muted: !vsCpu() }));
    html += `<div class="note">X ALWAYS MOVES FIRST. INSANE NEVER LOSES ON 3×3. SCORES LAST FOR THIS SESSION ONLY.</div>`;
  } else if (tab === 'slots') {
    html += `<div class="note">SAVE YOUR CURRENT CONFIG TO A SLOT, NAME IT, THEN LOAD IT IN ONE TAP FROM THE TITLE OR PAUSE SCREEN.</div>`;
    presets.forEach((p, i) => {
      html += `<div class="slot-card ${isActive(p) ? 'on' : ''}"><div class="slot-card-head"><span class="num">0${i + 1}</span>${dots(p)}<input class="slot-name" data-slot-name="${i}" maxlength="10" placeholder="${p ? `SLOT ${i + 1}` : 'EMPTY'}" value="${p ? esc(p.name) : ''}" ${p ? '' : 'disabled'} autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done" aria-label="Slot ${i + 1} name" /></div><div class="slot-actions"><button class="btn small primary" data-slot-act="load" data-i="${i}" ${p ? '' : 'disabled'}><span>LOAD</span></button><button class="btn small" data-slot-act="save" data-i="${i}"><span>SAVE</span></button><button class="btn small ghost" data-slot-act="clear" data-i="${i}" ${p ? '' : 'disabled'}><span>CLEAR</span></button></div></div>`;
    });
  } else {
    html += toggleRow('tgl-sound', 'SOUND FX', 'RANDOMIZED FART ON EVERY MOVE.<br/>WOMP WOMP WHEN YOU LOSE.', settings.sound);
    html += group(
      'VOLUME',
      `${Math.round(settings.volume * 100)}%`,
      `<input type="range" id="rng-volume" min="0" max="1" step="0.05" value="${settings.volume}" style="--p:${settings.volume * 100}%" />`,
    );
    html += `<div class="test-row"><button class="btn small" id="btn-test-fart"><span>💨 TEST FART</span></button><button class="btn small" id="btn-test-womp"><span>📯 TEST WOMP</span></button></div>`;
    html += `<div class="note">SOUNDS ARE SYNTHESIZED LIVE — EVERY FART IS UNIQUE.</div>`;
  }
  const scroll = body.scrollTop;
  body.innerHTML = html;
  body.scrollTop = scroll;

  body.querySelectorAll('[data-key]').forEach((b) =>
    b.addEventListener('click', () => {
      unlockAudio();
      set(b.dataset.key, b.dataset.val);
    }),
  );
  body.querySelectorAll('[data-slot-act]').forEach((b) =>
    b.addEventListener('click', () => slotAction(b, b.dataset.slotAct, Number(b.dataset.i))),
  );
  body.querySelectorAll('[data-slot-name]').forEach((inp) => {
    const i = Number(inp.dataset.slotName);
    inp.addEventListener('input', () => {
      if (!presets[i]) return;
      presets[i].name = inp.value.trim().toUpperCase() || `SLOT ${i + 1}`;
      savePresets(presets);
      renderSlots();
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') inp.blur();
    });
    inp.addEventListener('blur', () => (inp.value = presets[i]?.name || ''));
  });
  for (const [id, key] of [
    ['tgl-sound', 'sound'],
    ['tgl-wrap', 'wrap'],
  ]) {
    const tgl = $(id);
    if (tgl)
      tgl.addEventListener('click', () => {
        unlockAudio();
        set(key, !settings[key]);
      });
  }
  const rng = $('rng-volume');
  if (rng) {
    rng.addEventListener('input', () => {
      settings.volume = Number(rng.value);
      rng.style.setProperty('--p', `${settings.volume * 100}%`);
      rng.closest('.group').querySelector('b').textContent = `${Math.round(settings.volume * 100)}%`;
      setVolume(settings.volume);
    });
    rng.addEventListener('change', () => {
      saveSettings(settings);
      renderSlots();
    });
  }
  const tf = $('btn-test-fart');
  if (tf)
    tf.addEventListener('click', () => {
      unlockAudio();
      fart();
    });
  const tw = $('btn-test-womp');
  if (tw)
    tw.addEventListener('click', () => {
      unlockAudio();
      womp();
    });
  requestAnimationFrame(() => paintChips(0));
}

// Overwrite and clear need a second tap so nobody wipes someone else's slot by accident.
let armed = null;
let armTimer = 0;
function disarm() {
  clearTimeout(armTimer);
  if (!armed) return;
  armed.classList.remove('warn');
  armed.querySelector('span').textContent = armed.dataset.slotAct.toUpperCase();
  armed = null;
}

function slotAction(btn, act, i) {
  unlockAudio();
  const risky = presets[i] && act !== 'load';
  if (risky && armed !== btn) {
    disarm();
    armed = btn;
    btn.classList.add('warn');
    btn.querySelector('span').textContent = 'SURE?';
    armTimer = setTimeout(disarm, 2500);
    return;
  }
  disarm();
  const wasEmpty = !presets[i];
  if (act === 'load') loadPreset(i);
  else if (act === 'save') {
    storePreset(i);
    toast(`SAVED // ${presets[i].name}`);
  } else {
    clearPreset(i);
    toast(`CLEARED // SLOT ${i + 1}`);
  }
  buildTab();
  // Fresh slot: jump straight to naming it.
  if (act === 'save' && wasEmpty) {
    const inp = document.querySelector(`[data-slot-name="${i}"]`);
    inp.focus();
    inp.select();
  }
}

function paintChips(t) {
  const body = $('settings-body');
  body.querySelectorAll('canvas[data-kind]').forEach((c) => {
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const id = c.dataset.id;
    const [kind, k] = c.dataset.kind.split('-');
    if (kind === 'style' && !k) paintStyleChip(c, id, byId(BOARD_COLORS, settings.boardColor).c);
    else {
      const player = k === 'x' ? X : O;
      const o = { colorId: settings[`${k}Color`], t, seed: 0 };
      if (kind === 'icon') paintMarkChip(c, player, { ...o, icon: id, style: settings[`${k}Style`] });
      else paintMarkChip(c, player, { ...o, icon: 'letter', style: id });
    }
  });
}

// ---------- main loop ----------

let frameTimes = [];
function adaptQuality(dt) {
  frameTimes.push(dt);
  if (frameTimes.length < 120) return;
  const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
  frameTimes = [];
  if (avg > 22 && dpr > 1.5) {
    dpr = Math.max(1.5, dpr - 0.5);
    resize();
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(100, now - last);
  last = now;
  if (!document.hidden) adaptQuality(dt);

  const settingsOpen = !$('screen-settings').classList.contains('hidden');

  if (state === 'title') {
    runAutoplay(demo, renderer, now, 650);
    if (!settingsOpen) renderer.render(demo, now, { dim: 0.5, attract: true });
  } else if (game) {
    if (state === 'playing' && cpuAt && now >= cpuAt) {
      cpuAt = 0;
      place(cpuMove(game, settings.difficulty));
    }
    if (state === 'ending' && renderer.endDone()) showOver();
    const hv = state === 'playing' && canPlace() && hover >= 0 ? { cell: hover, player: game.turn } : null;
    if (!settingsOpen) renderer.render(game, now, { hover: hv });
  }

  if (settingsOpen && previewGame) {
    runAutoplay(previewGame, preview, now, 420);
    preview.render(previewGame, now);
    if ((tab === 'x' || tab === 'o') && now - chipTimer > 66) {
      chipTimer = now;
      paintChips(now / 1000);
    }
  }
}

// ---------- boot ----------

applyTheme();
renderSlots();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
resize();
requestAnimationFrame(frame);

// Offline PWA: service workers need a secure context (HTTPS or localhost).
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('service worker:', err));
}

// Debug/QA hook (harmless in production).
window.__tictac = {
  get state() {
    return state;
  },
  get game() {
    return game;
  },
  get tally() {
    return tally;
  },
  get settings() {
    return settings;
  },
  get human() {
    return human;
  },
  place,
  startRound,
  set,
  loadPreset,
  cellCenter: (i) => renderer.cellCenter(i),
};
