// Canvas renderer: board layers, neon X/O marks, win lasers, particles and glitch post-FX.

import { byId, MARK_COLORS, BOARD_COLORS } from './settings.js';
import { getSprite } from './icons.js';
import { X } from './game.js';

const TAU = Math.PI * 2;
const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF<>/\\#$%';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function hash(a, b) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Solid hex color for a mark. `i` decorrelates animated palettes between cells.
export function markColor(id, i, t) {
  if (id === 'spectrum') {
    const h = ((((t * 80 - i * 40) % 360) + 360) % 360) / 360;
    return hslHex(h, 1, 0.62);
  }
  if (id === 'glitch') {
    const r = hash(i, Math.floor(t * 9));
    return r < 0.1 ? '#ff2bd6' : r < 0.14 ? '#ffffff' : r < 0.19 ? '#7dff1f' : '#00f0ff';
  }
  return byId(MARK_COLORS, id).c;
}

function hslHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const ease = (u) => 1 - Math.pow(1 - u, 3);
const backOut = (u) => 1 + 2.2 * Math.pow(u - 1, 3) + 1.2 * Math.pow(u - 1, 2);

// ---------- marks ----------

// Partial polyline: draws the first `u` (0..1) of the path through `pts`.
function partial(ctx, pts, u) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let left = total * u;
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length && left > 0; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const len = Math.hypot(bx - ax, by - ay);
    const k = Math.min(1, left / len);
    ctx.lineTo(ax + (bx - ax) * k, ay + (by - ay) * k);
    left -= len;
  }
}

// Stroke X (two diagonals, drawn one after the other) or O (a ring) with draw-in progress.
function strokeLetter(ctx, player, cx, cy, h, prog) {
  ctx.beginPath();
  if (player === X) {
    const a = Math.min(1, prog * 2);
    const b = Math.max(0, prog * 2 - 1);
    partial(ctx, [[cx - h, cy - h], [cx + h, cy + h]], a);
    if (b > 0) {
      ctx.moveTo(cx + h, cy - h);
      partial(ctx, [[cx + h, cy - h], [cx - h, cy + h]], b);
    }
  } else {
    ctx.arc(cx, cy, h, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.001, prog));
  }
  ctx.stroke();
}

function shardPath(player, cx, cy, h) {
  const p = new Path2D();
  if (player === X) {
    const w = h * 0.3;
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      p.moveTo(cx + sx * h, cy + sy * h);
      p.lineTo(cx + sx * w * 0.2 + sy * w * 0.9 * 0.5, cy + sy * w * 0.2 - sx * w * 0.9 * 0.5);
      p.lineTo(cx, cy);
      p.lineTo(cx + sx * w * 0.2 - sy * w * 0.9 * 0.5, cy + sy * w * 0.2 + sx * w * 0.9 * 0.5);
      p.closePath();
    }
  } else {
    const r = h * 1.12;
    const r2 = r * 0.62;
    p.moveTo(cx, cy - r);
    p.lineTo(cx + r, cy);
    p.lineTo(cx, cy + r);
    p.lineTo(cx - r, cy);
    p.closePath();
    p.moveTo(cx, cy - r2);
    p.lineTo(cx - r2, cy);
    p.lineTo(cx, cy + r2);
    p.lineTo(cx + r2, cy);
    p.closePath();
  }
  return p;
}

// o: { style, icon, colorId, t, prog (0..1 draw-in), seed, alpha, glow }
export function drawMark(ctx, player, cx, cy, size, o) {
  const t = o.t || 0;
  const prog = o.prog ?? 1;
  const col = markColor(o.colorId, o.seed || 0, t);
  const h = size / 2;
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;
  const glow = o.glow ?? 1;

  if (o.icon && o.icon !== 'letter') {
    spriteMark(ctx, o.icon, col, cx, cy, size, prog, glow);
  } else if (o.style === 'pixel') {
    spriteMark(ctx, player === X ? 'x' : 'o', col, cx, cy, size, prog, glow);
  } else if (o.style === 'shard') {
    const s = backOut(Math.min(1, prog * 1.1));
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.rotate((1 - Math.min(1, prog)) * 0.9);
    const p = shardPath(player, 0, 0, h);
    ctx.shadowColor = col;
    ctx.shadowBlur = size * 0.35 * glow;
    ctx.fillStyle = col;
    ctx.fill(p, 'evenodd');
    ctx.shadowBlur = 0;
    const g = ctx.createLinearGradient(0, -h, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0.6)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = g;
    ctx.fill(p, 'evenodd');
  } else if (o.style === 'block') {
    const lw = size * 0.24;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.shadowColor = col;
    ctx.shadowBlur = size * 0.3 * glow;
    if (player === X) strokeLetter(ctx, player, cx, cy, h * 0.86, prog);
    else {
      const u = ease(Math.min(1, prog));
      const r = h * 0.86 * u;
      ctx.beginPath();
      ctx.roundRect(cx - r, cy - r, r * 2, r * 2, r * 0.28);
      ctx.stroke();
    }
    // scanline bite
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = cy - h * 1.1; y < cy + h * 1.1; y += Math.max(3, size / 14)) ctx.fillRect(cx - h * 1.2, y, h * 2.4, Math.max(1, size / 40));
  } else if (o.style === 'wire') {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = size * 0.22 * glow;
    ctx.lineWidth = Math.max(1.5, size * 0.035);
    if (player === X) {
      const d = (size * 0.07) / Math.SQRT2;
      const a = Math.min(1, prog * 2);
      const b = Math.max(0, prog * 2 - 1);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        partial(ctx, [[cx - h + s * d, cy - h - s * d], [cx + h + s * d, cy + h - s * d]], a);
        if (b > 0) {
          ctx.moveTo(cx + h + s * d, cy - h + s * d);
          partial(ctx, [[cx + h + s * d, cy - h + s * d], [cx - h + s * d, cy + h + s * d]], b);
        }
        ctx.stroke();
      }
    } else {
      strokeLetter(ctx, player, cx, cy, h, prog);
      strokeLetter(ctx, player, cx, cy, h * 0.72, prog);
    }
  } else if (o.style === 'plasma') {
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    const wob = (k) => Math.sin(t * 7 + k * 2.1 + (o.seed || 0)) * size * 0.025;
    for (let k = 0; k < 3; k++) {
      ctx.save();
      ctx.translate(wob(k), wob(k + 5));
      ctx.strokeStyle = hexA(col, 0.4);
      ctx.lineWidth = size * (0.26 - k * 0.06);
      ctx.shadowColor = col;
      ctx.shadowBlur = size * 0.5 * glow;
      strokeLetter(ctx, player, cx, cy, h * 0.9, prog);
      ctx.restore();
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = size * 0.06;
    ctx.globalAlpha *= 0.85;
    strokeLetter(ctx, player, cx, cy, h * 0.9, prog);
  } else {
    // neon: blurred glow underlay + crisp tube + white-hot core
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = size * 0.45 * glow;
    ctx.lineWidth = size * 0.15;
    strokeLetter(ctx, player, cx, cy, h * 0.9, prog);
    ctx.shadowBlur = size * 0.12 * glow;
    strokeLetter(ctx, player, cx, cy, h * 0.9, prog);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = size * 0.045;
    strokeLetter(ctx, player, cx, cy, h * 0.9, prog);
  }
  ctx.restore();
}

function spriteMark(ctx, id, col, cx, cy, size, prog, glow) {
  const u = Math.min(1, prog);
  const S = size * 1.9 * Math.max(0, backOut(u));
  if (S < 1) return;
  const sprite = getSprite(id, col, size * 1.9 * 2);
  const jitter = u < 1 && Math.random() < 0.4 ? (Math.random() - 0.5) * size * 0.15 : 0;
  ctx.globalAlpha *= Math.min(1, 0.6 + glow * 0.4);
  ctx.drawImage(sprite, cx - S / 2 + jitter, cy - S / 2, S, S);
}

// ---------- board ----------

function drawBoardPattern(g, style, color, cols, rows, cell, bright) {
  const W = cols * cell;
  const H = rows * cell;
  const k = bright ? 4.5 : 1;
  const A = (a) => hexA(color, Math.min(1, a * k));
  const rnd = mulberry(1337 + cols * 31 + rows);

  if (!bright) {
    const bg = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
    bg.addColorStop(0, hexA(color, 0.07));
    bg.addColorStop(1, hexA(color, 0.015));
    g.fillStyle = '#03040b';
    g.fillRect(0, 0, W, H);
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
  }

  const lw = bright ? 1.6 : 1;
  const gridLines = (alphaMinor, alphaMajor) => {
    for (let i = 0; i <= cols; i++) {
      g.strokeStyle = A(i % 4 === 0 ? alphaMajor : alphaMinor);
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(i * cell, 0);
      g.lineTo(i * cell, H);
      g.stroke();
    }
    for (let j = 0; j <= rows; j++) {
      g.strokeStyle = A(j % 4 === 0 ? alphaMajor : alphaMinor);
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(0, j * cell);
      g.lineTo(W, j * cell);
      g.stroke();
    }
  };

  switch (style) {
    case 'grid': {
      gridLines(0.07, 0.17);
      g.fillStyle = A(0.5);
      for (let i = 0; i <= cols; i += 4)
        for (let j = 0; j <= rows; j += 4) g.fillRect(i * cell - 1.5, j * cell - 1.5, 3, 3);
      break;
    }
    case 'dots': {
      for (let i = 0; i <= cols; i++)
        for (let j = 0; j <= rows; j++) {
          const major = i % 4 === 0 && j % 4 === 0;
          g.fillStyle = A(major ? 0.6 : 0.28);
          g.beginPath();
          g.arc(i * cell, j * cell, major ? 1.7 : 1.1, 0, TAU);
          g.fill();
        }
      g.fillStyle = A(0.07);
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) g.fillRect((i + 0.5) * cell - 0.5, (j + 0.5) * cell - 0.5, 1, 1);
      break;
    }
    case 'circuit': {
      gridLines(0.025, 0.05);
      const traces = Math.floor((cols * rows) / 5);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (let n = 0; n < traces; n++) {
        let x = Math.floor(rnd() * (cols + 1));
        let y = Math.floor(rnd() * (rows + 1));
        const steps = 2 + Math.floor(rnd() * 6);
        let dx = rnd() < 0.5 ? (rnd() < 0.5 ? 1 : -1) : 0;
        let dy = dx === 0 ? (rnd() < 0.5 ? 1 : -1) : 0;
        g.strokeStyle = A(0.14 + rnd() * 0.12);
        g.lineWidth = bright ? 2 : 1.3;
        g.beginPath();
        g.moveTo(x * cell, y * cell);
        const sx = x;
        const sy = y;
        for (let s = 0; s < steps; s++) {
          if (rnd() < 0.3) {
            // 45° bend
            if (dx === 0) dx = rnd() < 0.5 ? 1 : -1;
            else if (dy === 0) dy = rnd() < 0.5 ? 1 : -1;
            else if (rnd() < 0.5) dx = 0;
            else dy = 0;
          }
          x += dx;
          y += dy;
          g.lineTo(x * cell, y * cell);
        }
        g.stroke();
        for (const [px, py, filled] of [[sx, sy, false], [x, y, rnd() < 0.5]]) {
          g.beginPath();
          g.arc(px * cell, py * cell, Math.max(1.6, cell * 0.11), 0, TAU);
          if (filled) {
            g.fillStyle = A(0.35);
            g.fill();
          } else g.stroke();
        }
      }
      break;
    }
    case 'hex': {
      const R = cell * 0.62;
      const hw = Math.sqrt(3) * R;
      g.strokeStyle = A(0.1);
      g.lineWidth = lw;
      for (let row = -1; row * R * 1.5 < H + R * 2; row++) {
        for (let col = -1; col * hw < W + hw; col++) {
          const cx = col * hw + (row % 2 ? hw / 2 : 0);
          const cy = row * R * 1.5;
          g.beginPath();
          for (let k2 = 0; k2 < 6; k2++) {
            const a = (k2 * TAU) / 6 + TAU / 12;
            const px = cx + Math.cos(a) * R;
            const py = cy + Math.sin(a) * R;
            if (k2 === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
          }
          g.closePath();
          if (rnd() < 0.06) {
            g.fillStyle = A(0.06);
            g.fill();
          }
          g.stroke();
        }
      }
      break;
    }
    case 'matrix': {
      for (let i = 0; i <= cols; i++) {
        g.strokeStyle = A(0.045);
        g.lineWidth = lw;
        g.beginPath();
        g.moveTo(i * cell, 0);
        g.lineTo(i * cell, H);
        g.stroke();
      }
      g.fillStyle = A(0.16);
      for (let i = 0; i <= cols; i++) for (let j = 0; j <= rows; j++) g.fillRect(i * cell - 0.75, j * cell - 0.75, 1.5, 1.5);
      break;
    }
    case 'void':
    default: {
      const stars = Math.floor((cols * rows) / 2.5);
      for (let n = 0; n < stars; n++) {
        g.fillStyle = A(0.08 + rnd() * 0.3);
        const s = rnd() < 0.85 ? 1 : 2;
        g.fillRect(rnd() * W, rnd() * H, s, s);
      }
      break;
    }
  }

  if (!bright) {
    // inner vignette
    const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
  }
}

// ---------- settings chip previews ----------

export function paintStyleChip(canvas, style, color) {
  const g = canvas.getContext('2d');
  const dpr = canvas.width / canvas.clientWidth || 2;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const cell = 9;
  g.clearRect(0, 0, w, h);
  drawBoardPattern(g, style, color, Math.ceil(w / cell), Math.ceil(h / cell), cell, false);
  if (style === 'matrix') {
    g.font = `bold ${cell}px ui-monospace, Menlo, monospace`;
    g.textAlign = 'center';
    for (let c = 0; c < w / cell; c += 2)
      for (let j = 0; j < 5; j++) {
        g.fillStyle = hexA(color, 0.5 - j * 0.09);
        g.fillText(GLYPHS[(c * 7 + j * 3) % GLYPHS.length], (c + 0.5) * cell, ((c * 3) % 5) * cell + j * cell + cell);
      }
  }
  g.strokeStyle = hexA(color, 0.6);
  g.strokeRect(0.5, 0.5, w - 1, h - 1);
}

// ---------- settings chip previews ----------

export function paintMarkChip(canvas, player, o) {
  const g = canvas.getContext('2d');
  const dpr = canvas.width / canvas.clientWidth || 2;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  g.clearRect(0, 0, w, h);
  drawMark(g, player, w / 2, h / 2, Math.min(w, h) * 0.62, { ...o, glow: 0.6 });
}

// ---------- the renderer ----------

export class Renderer {
  constructor(canvas, { preview = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.preview = preview;
    this.w = 1;
    this.h = 1;
    this.dpr = 1;
    this.board = null; // { x, y, size, n, big, cell, cols, rows }
    this.s = null;
    this.layer = null;
    this.bright = null;
    this.dirty = true;
    this.scratch = document.createElement('canvas');
    this.tintR = document.createElement('canvas');
    this.tintC = document.createElement('canvas');
    this.reset();
  }

  reset() {
    this.particles = [];
    this.texts = [];
    this.waves = [];
    this.born = new Map(); // cell → placement time
    this.glitch = { until: 0, dur: 1, k: 0 };
    this.shake = 0;
    this.flash = { a: 0, color: '#ffffff' };
    this.end = null;
    this.rain = null;
  }

  setSize(w, h, dpr) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    for (const c of [this.scratch, this.tintR, this.tintC]) {
      c.width = W;
      c.height = H;
    }
    this.dirty = true;
  }

  // Square board of n cells at (x, y); the background texture runs on a finer sub-grid.
  setBoard({ x, y, size, n }) {
    const big = size / n;
    const sub = Math.max(2, Math.round(big / 24));
    this.board = { x, y, size, n, big, cell: big / sub, cols: n * sub, rows: n * sub };
    this.dirty = true;
    this.rain = null;
  }

  setSettings(s) {
    this.s = { ...s };
    this.dirty = true;
  }

  get accent() {
    return byId(BOARD_COLORS, this.s.boardColor).c;
  }

  cellCenter(i) {
    const b = this.board;
    return { x: b.x + ((i % b.n) + 0.5) * b.big, y: b.y + (Math.floor(i / b.n) + 0.5) * b.big };
  }

  // Which cell is under a client-space point, or -1.
  cellAt(px, py) {
    const b = this.board;
    if (!b) return -1;
    const cx = Math.floor((px - b.x) / b.big);
    const cy = Math.floor((py - b.y) / b.big);
    if (cx < 0 || cy < 0 || cx >= b.n || cy >= b.n) return -1;
    return cy * b.n + cx;
  }

  markOpts(player, i, t) {
    const s = this.s;
    const k = player === X ? 'x' : 'o';
    return { style: s[`${k}Style`], icon: s[`${k}Icon`], colorId: s[`${k}Color`], t, seed: i };
  }

  markColorOf(player, i, t) {
    return markColor(this.s[player === X ? 'xColor' : 'oColor'], i, t);
  }

  buildBoard() {
    const b = this.board;
    const W = b.cols * b.cell;
    const H = b.rows * b.cell;
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = Math.ceil(W * this.dpr);
      c.height = Math.ceil(H * this.dpr);
      const g = c.getContext('2d');
      g.scale(this.dpr, this.dpr);
      return [c, g];
    };
    const [layer, g1] = mk();
    drawBoardPattern(g1, this.s.boardStyle, this.accent, b.cols, b.rows, b.cell, false);
    const [bright, g2] = mk();
    drawBoardPattern(g2, this.s.boardStyle === 'void' ? 'grid' : this.s.boardStyle, this.accent, b.cols, b.rows, b.cell, true);
    this.layer = layer;
    this.bright = bright;
    this.dirty = false;
  }

  // ----- FX triggers -----

  fxPlace(i, player) {
    const c = this.cellCenter(i);
    const now = performance.now();
    const col = this.markColorOf(player, i, now / 1000);
    const big = this.board.big;
    this.born.set(i, now);
    for (let k = 0; k < (this.preview ? 12 : 30); k++) {
      const a = Math.random() * TAU;
      const v = (60 + Math.random() * 260) * (big / 70);
      this.particles.push({ x: c.x, y: c.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, ttl: 0.35 + Math.random() * 0.45, size: 1.5 + Math.random() * big * 0.05, color: k % 5 === 0 ? '#ffffff' : col });
    }
    this.waves.push({ x: c.x, y: c.y, t0: now, color: col });
    if (!this.preview) {
      this.kickGlitch(120, 0.3);
      this.flash = { a: 0.05, color: col };
    }
  }

  // kind: 'win' (a human won, or either side in pass & play), 'lose' (CPU won), 'draw'
  fxEnd(game, kind) {
    const now = performance.now();
    this.end = { t0: now, kind, winner: game.winner, line: game.winLine };
    const b = this.board;
    if (kind === 'draw') {
      const c = { x: b.x + b.size / 2, y: b.y + b.size / 2 };
      this.waves.push({ x: c.x, y: c.y, t0: now, color: '#ffffff', big: true });
      if (!this.preview) {
        this.kickGlitch(420, 0.6);
        this.flash = { a: 0.12, color: '#ffffff' };
      }
      return;
    }
    const col = kind === 'lose' ? '#ff2a55' : this.markColorOf(game.winner, 0, now / 1000);
    for (const i of game.winLine.cells) {
      const c = this.cellCenter(i);
      this.waves.push({ x: c.x, y: c.y, t0: now + Math.random() * 120, color: col, big: true });
      for (let k = 0; k < (this.preview ? 6 : 22); k++) {
        const a = Math.random() * TAU;
        const v = (80 + Math.random() * 380) * (b.big / 70);
        this.particles.push({ x: c.x, y: c.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, ttl: 0.5 + Math.random() * 0.7, size: 2 + Math.random() * b.big * 0.06, color: k % 4 === 0 ? '#ffffff' : col });
      }
    }
    if (this.preview) return;
    if (kind === 'lose') {
      this.kickGlitch(650, 1);
      this.shake = 14;
      this.flash = { a: 0.35, color: '#ff2a55' };
    } else {
      this.kickGlitch(320, 0.55);
      this.flash = { a: 0.22, color: col };
      const c = this.cellCenter(game.winLine.cells[Math.floor(game.winLine.cells.length / 2)]);
      this.texts.push({ x: c.x, y: c.y - b.big * 0.5, text: `${game.winner === X ? 'X' : 'O'} WINS`, color: col, t0: now });
    }
  }

  kickGlitch(ms, k) {
    const now = performance.now();
    if (now + ms > this.glitch.until || k > this.glitch.k) this.glitch = { until: now + ms, dur: ms, k };
  }

  // True once the end-of-round animation has had time to land.
  endDone() {
    return !!this.end && performance.now() - this.end.t0 > (this.end.kind === 'draw' ? 1000 : 1300);
  }

  // ----- frame -----

  render(game, now, opts = {}) {
    try {
      this.renderFrame(game, now, opts);
    } catch (err) {
      console.error(err);
      this.canvas.width = this.canvas.width; // resets any leaked save()/clip state
    }
  }

  renderFrame(game, now, opts) {
    const { ctx, dpr } = this;
    const t = now / 1000;
    const dt = Math.min(0.05, this._last ? (now - this._last) / 1000 : 0.016);
    this._last = now;
    if (!this.board || !this.s) return;
    if (this.dirty) this.buildBoard();
    const b = this.board;
    const bw = b.size;
    const bh = b.size;
    const accent = this.accent;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // background
    ctx.fillStyle = '#020309';
    ctx.fillRect(0, 0, this.w, this.h);
    if (!this.preview) {
      const g1 = ctx.createRadialGradient(this.w * (0.2 + 0.1 * Math.sin(t * 0.3)), this.h * 0.15, 0, this.w * 0.2, this.h * 0.15, this.h * 0.7);
      g1.addColorStop(0, hexA(accent, 0.13));
      g1.addColorStop(1, hexA(accent, 0));
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, this.w, this.h);
      const g2 = ctx.createRadialGradient(this.w * 0.85, this.h * (0.85 + 0.05 * Math.cos(t * 0.23)), 0, this.w * 0.85, this.h * 0.85, this.h * 0.6);
      g2.addColorStop(0, 'rgba(255,43,214,0.09)');
      g2.addColorStop(1, 'rgba(255,43,214,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    ctx.save();
    if (this.shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake *= Math.pow(0.004, dt);
    }

    ctx.drawImage(this.layer, b.x, b.y, bw, bh);

    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, bw, bh);
    ctx.clip();
    if (this.s.boardStyle === 'matrix') this.drawRain(ctx, t, dt, accent);
    this.drawSweep(ctx, t, accent, bw, bh);
    this.drawWaves(ctx, now, bw, bh);
    this.drawCellTags(ctx, game, t, accent);
    ctx.restore();

    this.drawDividers(ctx, t, accent);
    this.drawBorder(ctx, t, accent, bw, bh, game);
    this.drawHover(ctx, game, opts.hover, t);
    this.drawMarks(ctx, game, now, t);
    this.drawWinLine(ctx, now);
    this.drawParticles(ctx, dt);
    this.drawTexts(ctx, now);
    ctx.restore();

    if (opts.dim) {
      ctx.fillStyle = `rgba(2,3,9,${opts.dim})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    if (this.flash.a > 0.004) {
      ctx.globalAlpha = this.flash.a;
      ctx.fillStyle = this.flash.color;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
      this.flash.a *= Math.pow(0.002, dt);
    }

    if (now < this.glitch.until) this.postGlitch(now);
  }

  // Faint hex address in each empty cell's corner.
  drawCellTags(ctx, game, t, accent) {
    const b = this.board;
    if (this.preview || b.big < 46) return;
    ctx.font = `600 ${Math.round(Math.max(8, b.big * 0.075))}px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let i = 0; i < b.n * b.n; i++) {
      if (game.cells[i]) continue;
      const x = b.x + (i % b.n) * b.big;
      const y = b.y + Math.floor(i / b.n) * b.big;
      const flick = hash(i, Math.floor(t * 3)) < 0.04;
      ctx.fillStyle = hexA(accent, flick ? 0.6 : 0.28);
      ctx.fillText(`0x${i.toString(16).padStart(2, '0').toUpperCase()}`, x + b.big * 0.07, y + b.big * 0.06);
    }
  }

  // The tic-tac-toe lattice: glowing neon tubes with flicker and junction nodes.
  drawDividers(ctx, t, accent) {
    const b = this.board;
    ctx.save();
    ctx.lineCap = 'round';
    const lw = Math.max(2, b.big * (this.preview ? 0.03 : 0.035));
    const segs = [];
    for (let i = 1; i < b.n; i++) {
      const p = b.x + i * b.big;
      const q = b.y + i * b.big;
      segs.push([p, b.y + b.big * 0.08, p, b.y + b.size - b.big * 0.08, i]);
      segs.push([b.x + b.big * 0.08, q, b.x + b.size - b.big * 0.08, q, i + 10]);
    }
    for (const [x0, y0, x1, y1, k] of segs) {
      const flick = hash(k, Math.floor(t * 12)) < 0.03 ? 0.45 : 1;
      ctx.globalAlpha = flick;
      ctx.strokeStyle = accent;
      ctx.shadowColor = accent;
      ctx.shadowBlur = lw * 5;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = lw * 0.35;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // pulse travelling along the tubes
    const u = (t * 0.35) % 1;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = accent;
    ctx.shadowBlur = lw * 6;
    for (let i = 1; i < b.n; i++) {
      const p = b.x + i * b.big;
      const q = b.y + i * b.big;
      const s = lw * 1.1;
      ctx.fillRect(p - s / 2, b.y + b.size * ((u + i * 0.37) % 1) - s * 2, s, s * 4);
      ctx.fillRect(b.x + b.size * ((1 - u + i * 0.29) % 1) - s * 2, q - s / 2, s * 4, s);
    }
    ctx.restore();
  }

  drawBorder(ctx, t, accent, bw, bh, game) {
    const b = this.board;
    const wrap = game.wrap;
    ctx.save();
    ctx.strokeStyle = hexA(accent, 0.55 + 0.08 * Math.sin(t * 2.3));
    ctx.lineWidth = 1.5;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 14;
    if (wrap) ctx.setLineDash([b.big * 0.12, b.big * 0.08]);
    ctx.lineDashOffset = -t * 18;
    ctx.strokeRect(b.x - 0.75, b.y - 0.75, bw + 1.5, bh + 1.5);
    ctx.shadowBlur = 0;

    // marching dashes: when the edges wrap they're portals
    ctx.setLineDash([3, 7]);
    ctx.lineDashOffset = -t * (wrap ? 40 : 18);
    ctx.strokeStyle = hexA(accent, wrap ? 0.6 : 0.35);
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x - 5.5, b.y - 5.5, bw + 11, bh + 11);
    ctx.setLineDash([]);

    // corner brackets
    const L = Math.min(b.big * 0.35, 26);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    for (const [cx, cy, sx, sy] of [
      [b.x - 5, b.y - 5, 1, 1],
      [b.x + bw + 5, b.y - 5, -1, 1],
      [b.x - 5, b.y + bh + 5, 1, -1],
      [b.x + bw + 5, b.y + bh + 5, -1, -1],
    ]) {
      ctx.moveTo(cx + sx * L, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * L);
    }
    ctx.stroke();
    ctx.restore();

    if (!this.preview && this.h - (b.y + bh) > 26) {
      ctx.save();
      ctx.font = `600 9px ${MONO}`;
      ctx.fillStyle = hexA(accent, 0.55);
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText(`GRID ${b.n}×${b.n} // ${game.k} IN A ROW // MOVE ${String(game.moves.length).padStart(2, '0')}`, b.x, b.y + bh + 12);
      ctx.textAlign = 'right';
      const blink = Math.floor(t * 2) % 2 ? '▮' : '▯';
      ctx.fillText(wrap ? `EDGE WRAP: ONLINE ${blink}` : `EDGE WRAP: OFF ${blink}`, b.x + bw, b.y + bh + 12);
      ctx.restore();
    }
  }

  // Ghost of your mark + rotating target reticle on the cell under your finger.
  drawHover(ctx, game, hover, t) {
    if (!hover || hover.cell < 0 || game.cells[hover.cell] || game.over) return;
    const b = this.board;
    const c = this.cellCenter(hover.cell);
    const col = this.markColorOf(hover.player, hover.cell, t);
    ctx.save();
    drawMark(ctx, hover.player, c.x, c.y, b.big * 0.56, { ...this.markOpts(hover.player, hover.cell, t), alpha: 0.22, glow: 0.4 });
    ctx.translate(c.x, c.y);
    ctx.rotate(t * 1.4);
    ctx.strokeStyle = hexA(col, 0.8);
    ctx.lineWidth = 1.5;
    const R = b.big * 0.42;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = (k * TAU) / 4;
      ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R);
      ctx.arc(0, 0, R, a, a + 0.75);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawMarks(ctx, game, now, t) {
    const b = this.board;
    const end = this.end;
    const winSet = end && end.line ? new Set(end.line.cells) : null;
    const last = game.moves[game.moves.length - 1];
    for (let i = 0; i < game.cells.length; i++) {
      const p = game.cells[i];
      if (!p) continue;
      const c = this.cellCenter(i);
      const t0 = this.born.get(i) ?? now - 1000;
      const age = now - t0;
      const prog = Math.min(1, age / 300);
      const o = this.markOpts(p, i, t);
      let alpha = 1;
      let glow = 1 + 0.12 * Math.sin(t * 3 + i);
      let size = b.big * 0.56;
      let dx = 0;
      if (end) {
        const ea = (now - end.t0) / 1000;
        if (winSet?.has(i)) {
          glow = 1.6 + 0.5 * Math.sin(t * 10);
          size *= 1 + 0.08 * Math.sin(Math.min(1, ea * 3) * Math.PI);
        } else {
          // everything else powers down; on a loss, it glitches out
          alpha = Math.max(end.kind === 'draw' ? 0.35 : 0.25, 1 - ea * 1.6);
          if (hash(i, Math.floor(now / 50)) < (end.kind === 'lose' ? 0.25 : 0.08)) {
            dx = (hash(i + 7, Math.floor(now / 50)) - 0.5) * b.big * 0.2;
            alpha *= 0.4;
          }
        }
      }
      // spawn beam
      if (age < 520) {
        const k = 1 - age / 520;
        const col = this.markColorOf(p, i, t);
        const g = ctx.createLinearGradient(0, b.y, 0, c.y);
        g.addColorStop(0, hexA(col, 0));
        g.addColorStop(1, hexA(col, 0.5 * k));
        ctx.fillStyle = g;
        const bwid = b.big * 0.12 * k;
        ctx.fillRect(c.x - bwid / 2, b.y, bwid, c.y - b.y);
      }
      drawMark(ctx, p, c.x + dx, c.y, size, { ...o, prog, alpha, glow });
      if (i === last && !end && !this.preview) {
        // last-move bracket
        const col = this.markColorOf(p, i, t);
        const r = b.big * 0.44;
        const L = b.big * 0.1;
        ctx.save();
        ctx.strokeStyle = hexA(col, 0.5 + 0.3 * Math.sin(t * 5));
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          ctx.moveTo(c.x + sx * r, c.y + sy * (r - L));
          ctx.lineTo(c.x + sx * r, c.y + sy * r);
          ctx.lineTo(c.x + sx * (r - L), c.y + sy * r);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // Laser through the winning cells. Wrapped lines exit one edge and re-enter the opposite one.
  drawWinLine(ctx, now) {
    const end = this.end;
    if (!end || !end.line) return;
    const b = this.board;
    const cells = end.line.cells;
    const d = end.line.dir;
    const u = ease(Math.min(1, (now - end.t0) / 380));
    const col = end.kind === 'lose' ? '#ff2a55' : this.markColorOf(end.winner, 0, now / 1000);
    const segs = [];
    const xy = (i) => ({ x: i % b.n, y: Math.floor(i / b.n) });
    const px = (x, y) => ({ x: b.x + (x + 0.5) * b.big, y: b.y + (y + 0.5) * b.big });
    // overshoot the ends a little (but not past the board)
    const ext = 0.38;
    const first = xy(cells[0]);
    const lastC = xy(cells[cells.length - 1]);
    let prevPt = px(first.x - d.x * ext, first.y - d.y * ext);
    for (let k = 0; k < cells.length; k++) {
      const c = xy(cells[k]);
      if (k > 0) {
        const p = xy(cells[k - 1]);
        if (p.x + d.x !== c.x || p.y + d.y !== c.y) {
          // wrapped: run off the edge, re-enter from the opposite side
          segs.push([prevPt, px(p.x + d.x * 0.5, p.y + d.y * 0.5)]);
          prevPt = px(c.x - d.x * 0.5, c.y - d.y * 0.5);
          segs.push(null);
        }
      }
    }
    segs.push([prevPt, px(lastC.x + d.x * ext, lastC.y + d.y * ext)]);
    const runs = segs.filter(Boolean);
    let total = 0;
    for (const [a, c] of runs) total += Math.hypot(c.x - a.x, c.y - a.y);
    let left = total * u;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    const jit = () => (Math.random() - 0.5) * b.big * 0.02;
    for (const [w, color, blur, alpha] of [
      [b.big * 0.16, col, b.big * 0.4, 0.55],
      [b.big * 0.06, '#ff2bd6', 0, 0.5],
      [b.big * 0.06, '#00f0ff', 0, 0.5],
      [b.big * 0.035, '#ffffff', b.big * 0.1, 1],
    ]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.shadowColor = col;
      ctx.shadowBlur = blur;
      ctx.globalAlpha = alpha;
      const off = color === '#ff2bd6' ? -2 : color === '#00f0ff' ? 2 : 0;
      let rem = left;
      ctx.beginPath();
      for (const [a, c] of runs) {
        if (rem <= 0) break;
        const len = Math.hypot(c.x - a.x, c.y - a.y);
        const k = Math.min(1, rem / len);
        ctx.moveTo(a.x + off + jit(), a.y + jit());
        ctx.lineTo(a.x + (c.x - a.x) * k + off + jit(), a.y + (c.y - a.y) * k + jit());
        rem -= len;
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSweep(ctx, t, accent, bw, bh) {
    const b = this.board;
    const period = 5;
    const u = (t % period) / period;
    const y = b.y - bh * 0.2 + u * bh * 1.4;
    const hh = b.cell * 3;
    const g = ctx.createLinearGradient(0, y - hh, 0, y);
    g.addColorStop(0, hexA(accent, 0));
    g.addColorStop(1, hexA(accent, 0.07));
    ctx.fillStyle = g;
    ctx.fillRect(b.x, y - hh, bw, hh);
    ctx.fillStyle = hexA(accent, 0.18);
    ctx.fillRect(b.x, y, bw, 1);
  }

  drawRain(ctx, t, dt, accent) {
    const b = this.board;
    if (!this.rain) {
      this.rain = [];
      for (let i = 0; i < b.cols; i++)
        this.rain.push({ y: Math.random() * b.rows * 2 - b.rows, v: 3 + Math.random() * 7, len: 5 + Math.floor(Math.random() * 9), seed: Math.floor(Math.random() * 999) });
    }
    ctx.font = `600 ${Math.round(b.cell * 0.6)}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < this.rain.length; i++) {
      const r = this.rain[i];
      r.y += r.v * dt;
      if (r.y - r.len > b.rows) {
        r.y = -Math.random() * b.rows * 0.5;
        r.v = 3 + Math.random() * 7;
      }
      const hy = Math.floor(r.y);
      for (let j = 0; j < r.len; j++) {
        const cy = hy - j;
        if (cy < 0 || cy >= b.rows) continue;
        const a = j === 0 ? 0.32 : 0.14 * (1 - j / r.len);
        ctx.fillStyle = j === 0 ? `rgba(255,255,255,${a})` : hexA(accent, a);
        const gi = (r.seed + cy * 7 + Math.floor(t * 6 + j) * (j % 3 === 0 ? 1 : 0)) % GLYPHS.length;
        ctx.fillText(GLYPHS[gi], b.x + (i + 0.5) * b.cell, b.y + (cy + 0.5) * b.cell);
      }
    }
  }

  drawWaves(ctx, now, bw, bh) {
    const b = this.board;
    this.waves = this.waves.filter((w) => now - w.t0 < 900);
    for (const w of this.waves) {
      const age = Math.max(0, now - w.t0) / 1000;
      const r = age * (w.big ? 900 : 620) * (this.preview ? 0.5 : 1);
      const width = b.cell * (w.big ? 2.5 : 1.6);
      const fade = Math.max(0, 1 - age / 0.9);
      ctx.save();
      ctx.beginPath();
      ctx.arc(w.x, w.y, r + width, 0, TAU);
      ctx.arc(w.x, w.y, Math.max(0, r - width), 0, TAU, true);
      ctx.clip();
      ctx.globalAlpha = fade;
      ctx.drawImage(this.bright, b.x, b.y, bw, bh);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = fade * 0.5;
      ctx.strokeStyle = w.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(w.x, w.y, Math.max(0.1, r), 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawParticles(ctx, dt) {
    const ps = this.particles;
    if (ps.length > 600) ps.splice(0, ps.length - 600);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const drag = Math.pow(0.06, dt);
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life += dt;
      if (p.life >= p.ttl) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= drag;
      p.vy *= drag;
      const k = 1 - p.life / p.ttl;
      ctx.globalAlpha = (p.faint ? 0.45 : 1) * k;
      ctx.fillStyle = p.color;
      const s = p.size * (0.4 + 0.6 * k);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      ps[w++] = p;
    }
    ps.length = w;
    ctx.restore();
  }

  drawTexts(ctx, now) {
    this.texts = this.texts.filter((x) => now - x.t0 < 850);
    const cell = this.board.cell;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(Math.max(13, cell * 0.8))}px ui-monospace, "SF Mono", Menlo, monospace`;
    for (const x of this.texts) {
      const u = (now - x.t0) / 850;
      const jit = u < 0.15 ? (Math.random() - 0.5) * 6 : 0;
      const y = x.y - u * cell * 2;
      ctx.globalAlpha = 1 - u * u;
      ctx.fillStyle = '#ff2bd6';
      ctx.fillText(x.text, x.x + jit - 1.5, y);
      ctx.fillStyle = '#00f0ff';
      ctx.fillText(x.text, x.x + jit + 1.5, y);
      ctx.shadowColor = x.color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(x.text, x.x + jit, y);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  postGlitch(now) {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    const k = this.glitch.k * Math.max(0, (this.glitch.until - now) / this.glitch.dur);
    if (k < 0.02) return;
    const sc = this.scratch.getContext('2d');
    sc.globalCompositeOperation = 'copy';
    sc.drawImage(canvas, 0, 0);
    sc.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // chromatic aberration: split into red / cyan plates and re-add offset
    if (k > 0.25) {
      const off = Math.round(k * 7 * this.dpr);
      for (const [cv, color] of [[this.tintR, '#ff0000'], [this.tintC, '#00ffff']]) {
        const g = cv.getContext('2d');
        g.globalCompositeOperation = 'copy';
        g.drawImage(this.scratch, 0, 0);
        g.globalCompositeOperation = 'multiply';
        g.fillStyle = color;
        g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'source-over';
      }
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(this.tintC, -off, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.tintR, off, 0);
      ctx.globalCompositeOperation = 'source-over';
      sc.globalCompositeOperation = 'copy';
      sc.drawImage(canvas, 0, 0);
      sc.globalCompositeOperation = 'source-over';
    }

    // horizontal slice displacement
    const strips = 2 + Math.floor(k * 9);
    for (let i = 0; i < strips; i++) {
      const y = Math.floor(Math.random() * H);
      const h = Math.floor(2 + Math.random() * H * 0.05 * (0.3 + k));
      const dx = Math.round((Math.random() - 0.5) * 70 * k * this.dpr);
      ctx.drawImage(this.scratch, 0, y, W, h, dx, y, W, h);
    }
    // neon noise bars
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 1 + k * 5; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? `rgba(0,240,255,${0.18 * k})` : `rgba(255,43,214,${0.18 * k})`;
      ctx.fillRect(Math.random() * W * 0.5, Math.random() * H, W * (0.2 + Math.random() * 0.8), 1 + Math.random() * 3 * this.dpr);
    }
    ctx.restore();
  }
}
