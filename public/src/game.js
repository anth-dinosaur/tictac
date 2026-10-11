// Pure tic-tac-toe simulation: N×N grid, K in a row wins, optional torus (edges wrap).

export const X = 1;
export const O = 2;
export const other = (p) => (p === X ? O : X);

const DIRS = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
];

// Every winning line: { cells: [idx…], dir }. On a torus, lines wrap and duplicates collapse.
export function buildLines(n, k, wrap) {
  const lines = [];
  const seen = new Set();
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      for (const d of DIRS) {
        const cells = [];
        for (let i = 0; i < k; i++) {
          let cx = x + d.x * i;
          let cy = y + d.y * i;
          if (wrap) {
            cx = ((cx % n) + n) % n;
            cy = ((cy % n) + n) % n;
          } else if (cx < 0 || cy < 0 || cx >= n || cy >= n) break;
          cells.push(cy * n + cx);
        }
        if (cells.length < k) continue;
        const key = [...cells].sort((a, b) => a - b).join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push({ cells, dir: d });
      }
  return lines;
}

export class Game {
  constructor(n, k, wrap = false) {
    this.n = n;
    this.k = k;
    this.wrap = wrap;
    this.lines = buildLines(n, k, wrap);
    this.cellLines = Array.from({ length: n * n }, () => []);
    this.lines.forEach((l, i) => l.cells.forEach((c) => this.cellLines[c].push(i)));
    this.reset();
  }

  reset() {
    this.cells = new Uint8Array(this.n * this.n);
    this.turn = X;
    this.moves = [];
    this.winner = 0; // 0 = none yet, X, O, or -1 = draw
    this.winLine = null;
    this.over = false;
  }

  free(i) {
    return !this.over && this.cells[i] === 0;
  }

  // Place the current player's mark. Returns { placed, win, draw } or null if illegal.
  play(i) {
    if (!this.free(i)) return null;
    const p = this.turn;
    this.cells[i] = p;
    this.moves.push(i);
    for (const li of this.cellLines[i]) {
      const line = this.lines[li];
      if (line.cells.every((c) => this.cells[c] === p)) {
        this.winner = p;
        this.winLine = line;
        this.over = true;
        return { at: i, by: p, win: true };
      }
    }
    if (this.moves.length === this.n * this.n) {
      this.winner = -1;
      this.over = true;
      return { at: i, by: p, draw: true };
    }
    this.turn = other(p);
    return { at: i, by: p };
  }
}

// ---------- CPU opponent ----------

const WEIGHT = [0, 1, 12, 150, 2000, 30000];

// Static score from `me`'s point of view: open lines only, more marks = much more value.
function evaluate(g, cells, me) {
  let s = 0;
  for (const l of g.lines) {
    let a = 0;
    let b = 0;
    for (const c of l.cells) {
      const v = cells[c];
      if (v === me) a++;
      else if (v) b++;
    }
    if (a && !b) s += WEIGHT[a];
    else if (b && !a) s -= WEIGHT[b] * 1.1;
  }
  return s;
}

function winsAt(g, cells, i, p) {
  for (const li of g.cellLines[i]) if (g.lines[li].cells.every((c) => cells[c] === p)) return true;
  return false;
}

// Moves sorted by how many still-open lines run through each cell (better pruning).
function ordered(g, cells, me) {
  const out = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]) continue;
    let h = 0;
    for (const li of g.cellLines[i]) {
      let mine = 0;
      let theirs = 0;
      for (const c of g.lines[li].cells) {
        if (cells[c] === me) mine++;
        else if (cells[c]) theirs++;
      }
      if (!theirs) h += 1 + mine * mine * 3;
      if (!mine) h += 1 + theirs * theirs * 2;
    }
    out.push([i, h]);
  }
  out.sort((a, b) => b[1] - a[1]);
  return out.map((m) => m[0]);
}

function negamax(g, cells, me, depth, alpha, beta, left, ply, deadline) {
  if (depth === 0 || left === 0 || performance.now() > deadline) return evaluate(g, cells, me);
  let best = -Infinity;
  for (const i of ordered(g, cells, me)) {
    cells[i] = me;
    let v;
    if (winsAt(g, cells, i, me)) v = 1e6 - ply;
    else if (left === 1) v = 0;
    else v = -negamax(g, cells, other(me), depth - 1, -beta, -alpha, left - 1, ply + 1, deadline);
    cells[i] = 0;
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];

function immediate(g, cells, p) {
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]) continue;
    cells[i] = p;
    const w = winsAt(g, cells, i, p);
    cells[i] = 0;
    if (w) return i;
  }
  return -1;
}

// level: easy | normal | hard | insane
export function cpuMove(g, level = 'normal', rand = Math.random) {
  const cells = g.cells.slice();
  const me = g.turn;
  const free = [];
  for (let i = 0; i < cells.length; i++) if (!cells[i]) free.push(i);
  if (!free.length) return -1;

  const win = immediate(g, cells, me);
  const block = immediate(g, cells, other(me));
  if (level === 'easy') {
    if (win >= 0 && rand() < 0.5) return win;
    if (block >= 0 && rand() < 0.3) return block;
    return pick(free, rand);
  }
  if (win >= 0) return win;
  if (block >= 0 && (level !== 'normal' || rand() < 0.85)) return block;
  if (level === 'normal' && rand() < 0.45) return pick(free, rand);
  if (level === 'hard' && rand() < 0.12) return pick(free, rand);

  // Full search on 3×3; depth-limited alpha-beta with a time box on bigger boards.
  const small = g.n * g.n <= 9;
  const depth = small ? 9 : g.n <= 4 ? 5 : 4;
  const deadline = performance.now() + (small ? 1e9 : 260);
  let best = -Infinity;
  let moves = [];
  for (const i of ordered(g, cells, me)) {
    cells[i] = me;
    const v = winsAt(g, cells, i, me) ? 1e6 : -negamax(g, cells, other(me), depth - 1, -Infinity, Infinity, free.length - 1, 1, deadline);
    cells[i] = 0;
    if (v > best + 1e-9) {
      best = v;
      moves = [i];
    } else if (Math.abs(v - best) < 1e-9) moves.push(i);
  }
  return pick(moves, rand);
}
