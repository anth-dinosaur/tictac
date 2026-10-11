// Visual + gameplay QA in an emulated iPhone (Chromium; WebKit if installed).
// usage: node qa/qa.mjs http://localhost:PORT/ [shotDir]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://localhost:8080/';
const OUT = process.argv[3] || 'qa/shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message} @ ${(e.stack || '').split('\n').slice(0, 4).join(' | ')}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

// Emulate the iPhone notch / home-indicator safe areas (Playwright doesn't).
await page.addInitScript(() => {
  localStorage.clear();
  document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.style.setProperty('--sat', '59px');
    document.documentElement.style.setProperty('--sab', '34px');
  });
});
await page.goto(URL);
await page.waitForTimeout(400);
await page.evaluate(() => window.dispatchEvent(new Event('resize')));
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
};
const S = (fn, arg) => page.evaluate(fn, arg);
let ok = true;
const check = (name, pass, extra = '') => {
  ok &&= !!pass;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
};
const tap = async (i) => {
  const c = await S((i) => window.__tictac.cellCenter(i), i);
  await page.touchscreen.tap(c.x, c.y);
};
const waitState = async (st, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await S(() => window.__tictac.state)) === st) return true;
    await page.waitForTimeout(40);
  }
  return false;
};
const waitHumanTurn = async () => {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    const r = await S(() => {
      const t = window.__tictac;
      return { st: t.state, mine: t.game && t.game.turn === t.human && !t.game.over };
    });
    if (r.st !== 'playing') return false;
    if (r.mine) return true;
    await page.waitForTimeout(40);
  }
  return false;
};

await page.waitForTimeout(3000);
await shot('01-title');

// ---- settings tabs
await page.click('#btn-config');
await page.waitForTimeout(900);
await shot('02-settings-x');
for (const tab of ['o', 'board', 'cpu', 'audio', 'slots']) {
  await page.click(`[data-tab="${tab}"]`);
  await page.waitForTimeout(700);
  await shot(`03-settings-${tab}`);
}
await page.click('#btn-settings-back');

// ---- round 1 vs EASY CPU: play by tapping, win if we can
await S(() => window.__tictac.set('difficulty', 'easy'));
await page.click('#btn-play');
await page.waitForTimeout(500);
await shot('04-ready');
check('hint visible at round start', await page.isVisible('#hint'));
await tap(4);
await page.waitForTimeout(120);
check('tap placed X in center', (await S(() => window.__tictac.game.cells[4])) === 1);
await page.waitForTimeout(80);
await shot('05-place-fx');
// keep playing: take any winning cell, else first free
while (await waitHumanTurn()) {
  const i = await S(async () => {
    const { cpuMove } = await import('/src/game.js');
    return cpuMove(window.__tictac.game, 'insane');
  });
  await tap(i);
  await page.waitForTimeout(150);
}
await page.waitForTimeout(250);
await shot('06-round-end');
check('round ended', await waitState('over', 4000));
await page.waitForTimeout(700);
await shot('07-over');
const t1 = await S(() => ({ ...window.__tictac.tally }));
check('tally recorded', t1.x + t1.o + t1.d === 1, JSON.stringify(t1));

// ---- force a loss: INSANE CPU, we play badly (corner, edge…)
await S(() => window.__tictac.set('difficulty', 'insane'));
await page.click('#btn-again');
for (let k = 0; k < 6 && (await waitHumanTurn()); k++) {
  const i = await S(() => [...window.__tictac.game.cells].findIndex((v, i) => !v && i !== 4));
  await tap(i);
  await page.waitForTimeout(100);
}
await page.waitForTimeout(400);
await shot('08-loss-fx');
await waitState('over');
await page.waitForTimeout(700);
await shot('09-over-loss');
check('loss counted for CPU', (await S(() => window.__tictac.tally.o)) >= 1);

// ---- draw: INSANE vs perfect play
await page.click('#btn-again');
while (await waitHumanTurn()) {
  const i = await S(async () => {
    const { cpuMove } = await import('/src/game.js');
    return cpuMove(window.__tictac.game, 'insane');
  });
  await tap(i);
  await page.waitForTimeout(100);
}
await waitState('over');
await page.waitForTimeout(700);
await shot('10-over-draw');
check('perfect play vs INSANE draws', (await S(() => window.__tictac.game.winner)) === -1);

// ---- pause
await page.click('#btn-again');
await page.waitForTimeout(500);
await page.click('#btn-pause');
await page.waitForTimeout(500);
await shot('11-pause');
await page.click('#btn-resume');

// ---- 5x5 + wrap, pass & play, different looks
await S(() => {
  const t = window.__tictac;
  t.set('grid', '5');
  t.set('wrap', true);
  t.set('mode', 'local');
  t.set('xStyle', 'block');
  t.set('oIcon', 'skull');
  t.set('oColor', 'acid');
  t.set('boardStyle', 'circuit');
  t.set('boardColor', 'violet');
  t.startRound();
});
await page.waitForTimeout(400);
// X wins with a wrapped row: cells 13,14,10,11 (row 2: x=3,4,0,1)
for (const [x, o] of [[13, 0], [14, 1], [10, 2]]) {
  await tap(x);
  await page.waitForTimeout(120);
  await tap(o);
  await page.waitForTimeout(120);
}
await shot('12-5x5-wrap');
await tap(11);
await page.waitForTimeout(450);
await shot('13-wrap-win');
const w = await S(() => ({ winner: window.__tictac.game.winner, cells: window.__tictac.game.winLine?.cells }));
check('wrapped line wins on torus', w.winner === 1, JSON.stringify(w));
await waitState('over');
await page.waitForTimeout(700);
await shot('14-over-2p');

// ---- other styles: rain board, spectrum plasma, pixel O on 4x4
await S(() => {
  const t = window.__tictac;
  t.set('grid', '4');
  t.set('wrap', false);
  t.set('xStyle', 'plasma');
  t.set('xColor', 'spectrum');
  t.set('oIcon', 'letter');
  t.set('oStyle', 'pixel');
  t.set('oColor', 'amber');
  t.set('boardStyle', 'matrix');
  t.set('boardColor', 'acid');
  t.startRound();
});
for (const i of [0, 5, 10, 3, 6, 9]) {
  await tap(i);
  await page.waitForTimeout(90);
}
await page.waitForTimeout(500);
await shot('15-styles');
await S(() => {
  const t = window.__tictac;
  t.set('xStyle', 'shard');
  t.set('xColor', 'glitch');
  t.set('oStyle', 'wire');
  t.set('oColor', 'ice');
  t.set('boardStyle', 'hex');
  t.set('boardColor', 'crimson');
  t.startRound();
});
for (const i of [0, 5, 10, 3, 6, 9, 12]) {
  await tap(i);
  await page.waitForTimeout(90);
}
await page.waitForTimeout(500);
await shot('16-styles-2');

console.log('errors:', errors.length ? errors : 'none');
check('no page errors', errors.length === 0);
await browser.close();
process.exit(ok ? 0 : 1);
