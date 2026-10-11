// Renders the app icon with the game's own drawing code → public/icon-{180,192,512}.png
// usage: node qa/icon.mjs http://localhost:PORT/
import { chromium } from 'playwright';
import fs from 'node:fs';
const URL = process.argv[2];
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
await p.goto(URL);
for (const size of [180, 192, 512]) {
  const data = await p.evaluate(async (size) => {
    const { drawMark, hexA } = await import('/src/render.js');
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const bg = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.75);
    bg.addColorStop(0, '#0a1a2a');
    bg.addColorStop(1, '#020309');
    g.fillStyle = bg;
    g.fillRect(0, 0, size, size);
    // fine background grid
    g.strokeStyle = hexA('#00f0ff', 0.1);
    g.lineWidth = Math.max(1, size / 256);
    for (let i = 0; i <= 12; i++) {
      const q = (i * size) / 12;
      g.beginPath(); g.moveTo(q, 0); g.lineTo(q, size); g.stroke();
      g.beginPath(); g.moveTo(0, q); g.lineTo(size, q); g.stroke();
    }
    // neon lattice
    const pad = size * 0.12;
    const cell = (size - pad * 2) / 3;
    g.lineCap = 'round';
    for (let i = 1; i < 3; i++) {
      for (const [x0, y0, x1, y1] of [
        [pad + i * cell, pad, pad + i * cell, size - pad],
        [pad, pad + i * cell, size - pad, pad + i * cell],
      ]) {
        g.strokeStyle = '#00f0ff';
        g.shadowColor = '#00f0ff';
        g.shadowBlur = size * 0.04;
        g.lineWidth = size * 0.022;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        g.shadowBlur = 0;
        g.strokeStyle = 'rgba(255,255,255,0.75)';
        g.lineWidth = size * 0.008;
        g.stroke();
      }
    }
    const at = (cx, cy) => [pad + (cx + 0.5) * cell, pad + (cy + 0.5) * cell];
    const m = cell * 0.62;
    for (const [cx, cy] of [[0, 0], [1, 1], [2, 2]]) drawMark(g, 1, ...at(cx, cy), m, { style: 'neon', icon: 'letter', colorId: 'cyan', glow: 1.3 });
    for (const [cx, cy] of [[2, 0], [0, 2]]) drawMark(g, 2, ...at(cx, cy), m, { style: 'neon', icon: 'letter', colorId: 'magenta', glow: 1.3 });
    return c.toDataURL('image/png');
  }, size);
  fs.writeFileSync(`public/icon-${size}.png`, Buffer.from(data.split(',')[1], 'base64'));
  console.log('wrote icon', size);
}
await b.close();
