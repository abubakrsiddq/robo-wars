'use strict';
// ============================================================
// ARENA: physics world (floor, walls, pit gaps) + every arena's look (stadium, Taj Mahal, Hampi, Gomateshwara)
// OWNS:    createArenaWorld, arenaKey, per-arena art (backdrops, themes, live animation), DPR-aware cached layers, drawArena, drawArenaThumb
// EXPORTS: createArenaWorld, arenaKey, drawArena, drawArenaThumb
// READS:   CONFIG, clamp, lerp, Engine, Bodies, Composite, ctx, DPR, fight, roundRect, mulberry32, TAU, pick
// ============================================================
// Engine + static bodies. Pits are the gaps between the floor and the walls.
// Arenas differ only in looks: the physics (CONFIG.arena) is identical for all of them.
function arenaGeom() {
  const A = CONFIG.arena;
  return { floorL: A.wallW + A.pitW, floorR: A.w - A.wallW - A.pitW };
}
function createArenaWorld() {
  const A = CONFIG.arena;
  const engine = Engine.create();
  engine.gravity.y = 1;
  engine.positionIterations = 8; engine.velocityIterations = 6;
  const { floorL, floorR } = arenaGeom();
  Composite.add(engine.world, [
    Bodies.rectangle((floorL + floorR) / 2, A.floorY + 50, floorR - floorL, 100, { isStatic: true, friction: 1 }),
    Bodies.rectangle(A.wallW / 2, A.h / 2 - 500, A.wallW, A.h + 1000, { isStatic: true }),
    Bodies.rectangle(A.w - A.wallW / 2, A.h / 2 - 500, A.wallW, A.h + 1000, { isStatic: true }),
  ]);
  return { engine, floorL, floorR };
}

// ---- static layers are pre-rendered once per arena to an offscreen canvas (null in the headless stub) ----
function makeLayer(w, h) {
  try {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext && c.getContext('2d');
    if (!x || typeof x.fillRect !== 'function') return null;
    return { c, x };
  } catch (e) { return null; }
}

function hazardStrip(c, x, y, w, h, sw) {
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = '#14141a'; c.fillRect(x, y, w, h);
  c.fillStyle = '#ffd23f';
  for (let i = -h; i < w + h; i += sw * 2) {
    c.beginPath(); c.moveTo(x + i, y + h); c.lineTo(x + i + sw, y + h); c.lineTo(x + i + sw + h, y); c.lineTo(x + i + h, y); c.closePath(); c.fill();
  }
  c.restore();
}

// ---- STADIUM (default arena): everything that never changes. Draws to any 2D context; F = { floorL, floorR }.
// Returns the crowd spots used for camera flashes.
function paintStadium(c, F) {
  const A = CONFIG.arena, W = A.w, H = A.h, rng = mulberry32(7), spots = [];
  let g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#070a1c'); g.addColorStop(0.45, '#141238'); g.addColorStop(0.75, '#1c1030'); g.addColorStop(1, '#05060a');
  c.fillStyle = g; c.fillRect(-20, -20, W + 40, H + 40);
  g = c.createRadialGradient(W / 2, 300, 20, W / 2, 300, 560);
  g.addColorStop(0, 'rgba(90,110,255,.20)'); g.addColorStop(1, 'rgba(90,110,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // crowd tiers, back to front (parallax-style depth through size/colour)
  const rows = [{ y: 318, r: 5, step: 11, col: '#1b2142', rim: 0.10 }, { y: 350, r: 6.5, step: 14, col: '#141a38', rim: 0.14 }, { y: 388, r: 8.5, step: 18, col: '#0d1129', rim: 0.18 }];
  rows.forEach((row, ri) => {
    c.fillStyle = row.col; c.fillRect(0, row.y + row.r, W, 120);
    for (let x = -4; x < W + 10; x += row.step) {
      const px = x + (rng() - 0.5) * row.step * 0.6, py = row.y + (rng() - 0.5) * 6, r = row.r * (0.85 + rng() * 0.3);
      c.fillStyle = row.col;
      roundRect(c, px - r * 1.5, py + r * 0.6, r * 3, 60, r); c.fill();
      c.beginPath(); c.arc(px, py, r, 0, TAU); c.fill();
      c.strokeStyle = `rgba(150,180,255,${row.rim})`; c.lineWidth = 1;
      c.beginPath(); c.arc(px, py, r, -Math.PI * 0.95, -Math.PI * 0.05); c.stroke();
      if (rng() < 0.09) {   // raised arm, some with glow sticks
        c.strokeStyle = row.col; c.lineWidth = r * 0.7; c.lineCap = 'round';
        c.beginPath(); c.moveTo(px + r, py + r); c.lineTo(px + r * 1.8, py - r * 1.8); c.stroke();
        if (rng() < 0.5) { c.fillStyle = ['#3aa0ff', '#ff4d5e', '#3ddc97', '#ffd23f'][(rng() * 4) | 0]; c.fillRect(px + r * 1.6, py - r * 3, 2, 6); }
      }
      if (rng() < 0.12) spots.push({ x: px, y: py - r });
    }
    if (ri < rows.length - 1) { c.fillStyle = 'rgba(8,10,24,.45)'; c.fillRect(0, row.y + 28, W, 6); }
  });
  // lighting truss
  c.fillStyle = '#0b0e1c'; c.fillRect(0, 0, W, 26);
  c.strokeStyle = '#2a3150'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(0, 25.5); c.lineTo(W, 25.5); c.moveTo(0, 8.5); c.lineTo(W, 8.5); c.stroke();
  for (let x = 20; x < W; x += 40) { c.beginPath(); c.moveTo(x, 9); c.lineTo(x + 20, 25); c.lineTo(x + 40, 9); c.stroke(); }
  for (let x = 40; x < W; x += 80) {
    const col = ['#3aa0ff', '#ffffff', '#ff4d5e'][((x / 80) | 0) % 3];
    g = c.createRadialGradient(x, 30, 1, x, 30, 18); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalAlpha = 0.5; c.fillStyle = g; c.fillRect(x - 18, 12, 36, 36); c.globalAlpha = 1;
    c.fillStyle = '#e8f1ff'; c.beginPath(); c.arc(x, 28, 3, 0, TAU); c.fill();
  }
  // apron + LED board
  c.fillStyle = '#080a16'; c.fillRect(0, 468, W, A.floorY - 468 + 4);
  c.fillStyle = '#080a14'; c.fillRect(0, 432, W, 40);
  c.fillStyle = 'rgba(255,255,255,.035)';
  for (let x = 0; x < W; x += 6) for (let y = 434; y < 470; y += 6) c.fillRect(x, y, 4, 4);
  g = c.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#3aa0ff'); g.addColorStop(0.5, '#ffd23f'); g.addColorStop(1, '#ff4d5e');
  c.fillStyle = g; c.fillRect(0, 430, W, 2); c.fillRect(0, 472, W, 2);
  // pits: depth, hazard lips, ember glow
  const pits = [[A.wallW, F.floorL], [F.floorR, A.w - A.wallW]];
  pits.forEach(([x0, x1], pi) => {
    g = c.createLinearGradient(0, A.floorY, 0, H);
    g.addColorStop(0, '#020204'); g.addColorStop(0.6, '#0e0306'); g.addColorStop(1, '#2a0804');
    c.fillStyle = g; c.fillRect(x0, A.floorY - 4, x1 - x0, H - A.floorY + 4);
    g = c.createRadialGradient((x0 + x1) / 2, H + 10, 5, (x0 + x1) / 2, H + 10, (x1 - x0) * 1.1);
    g.addColorStop(0, 'rgba(255,90,20,.75)'); g.addColorStop(0.5, 'rgba(255,40,10,.25)'); g.addColorStop(1, 'rgba(255,40,10,0)');
    c.fillStyle = g; c.fillRect(x0, A.floorY, x1 - x0, H - A.floorY);
    g = c.createLinearGradient(x0, 0, x1, 0);   // side shading for depth
    g.addColorStop(0, 'rgba(0,0,0,.7)'); g.addColorStop(0.3, 'rgba(0,0,0,0)'); g.addColorStop(0.7, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.7)');
    c.fillStyle = g; c.fillRect(x0, A.floorY, x1 - x0, H - A.floorY);
    c.fillStyle = 'rgba(255,90,70,.45)'; c.font = '900 14px "Segoe UI", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('PIT', (x0 + x1) / 2, H - 28);
    // hazard lip on the floor edge + orange glow spilling up the pit side
    const ex = pi === 0 ? x1 : x0;
    g = c.createLinearGradient(ex, 0, pi === 0 ? ex - 46 : ex + 46, 0);
    g.addColorStop(0, 'rgba(255,120,30,.55)'); g.addColorStop(1, 'rgba(255,120,30,0)');
    c.fillStyle = g; c.fillRect(pi === 0 ? ex - 46 : ex, A.floorY, 46, H - A.floorY);
    hazardStrip(c, pi === 0 ? ex - 9 : ex, A.floorY, 9, H - A.floorY, 7);
  });
  // floor: brushed metal plates
  const fl = F.floorL, fr = F.floorR, fw = fr - fl;
  g = c.createLinearGradient(0, A.floorY, 0, H);
  g.addColorStop(0, '#4a5478'); g.addColorStop(0.12, '#323a5c'); g.addColorStop(1, '#10132a');
  c.fillStyle = g; c.fillRect(fl, A.floorY, fw, H - A.floorY);
  c.lineWidth = 1;
  for (let x = fl + 60; x < fr; x += 120) {
    c.strokeStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.moveTo(x + 0.5, A.floorY + 12); c.lineTo(x + 0.5, H); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.07)'; c.beginPath(); c.moveTo(x + 1.5, A.floorY + 12); c.lineTo(x + 1.5, H); c.stroke();
  }
  [A.floorY + 12, A.floorY + 52].forEach(y => {
    c.strokeStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.moveTo(fl, y + 0.5); c.lineTo(fr, y + 0.5); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.08)'; c.beginPath(); c.moveTo(fl, y + 1.5); c.lineTo(fr, y + 1.5); c.stroke();
  });
  for (let x = fl + 60; x < fr; x += 120) [A.floorY + 32, A.floorY + 72].forEach(y => {
    [-7, 8].forEach(o => { c.fillStyle = 'rgba(0,0,0,.5)'; c.beginPath(); c.arc(x + o, y, 2.4, 0, TAU); c.fill(); c.fillStyle = 'rgba(255,255,255,.22)'; c.beginPath(); c.arc(x + o - 0.6, y - 0.7, 1, 0, TAU); c.fill(); });
  });
  g = c.createLinearGradient(fl, 0, fr, 0);   // sheen band + specular streak on the top edge
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.35, 'rgba(255,255,255,.10)'); g.addColorStop(0.5, 'rgba(255,255,255,.16)'); g.addColorStop(0.65, 'rgba(255,255,255,.10)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(fl, A.floorY, fw, 12);
  g = c.createLinearGradient(fl, 0, fr, 0);
  g.addColorStop(0, 'rgba(180,200,255,.2)'); g.addColorStop(0.5, 'rgba(235,242,255,.95)'); g.addColorStop(1, 'rgba(180,200,255,.2)');
  c.fillStyle = g; c.fillRect(fl, A.floorY, fw, 2);
  [[fl, 1], [fr, -1]].forEach(([ex, d]) => {   // pit glow reflecting on the floor
    g = c.createLinearGradient(ex, 0, ex + d * 70, 0);
    g.addColorStop(0, 'rgba(255,120,30,.35)'); g.addColorStop(1, 'rgba(255,120,30,0)');
    c.fillStyle = g; c.fillRect(d > 0 ? ex : ex - 70, A.floorY, 70, H - A.floorY);
  });
  hazardStrip(c, fl, A.floorY + 2, 40, 9, 6); hazardStrip(c, fr - 40, A.floorY + 2, 40, 9, 6);
  // walls with rivets
  [[0, 1], [W - A.wallW, -1]].forEach(([x, d], wi) => {
    g = c.createLinearGradient(x, 0, x + A.wallW, 0);
    g.addColorStop(wi ? 1 : 0, '#0b0d1a'); g.addColorStop(wi ? 0 : 1, '#2a3050');
    c.fillStyle = g; c.fillRect(x, 0, A.wallW, H);
    for (let y = 30; y < H; y += 80) {
      c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(x, y, A.wallW, 2);
      c.fillStyle = 'rgba(255,255,255,.08)'; c.fillRect(x, y + 2, A.wallW, 1);
    }
    for (let y = 14; y < H; y += 40) {
      const rx = x + A.wallW / 2;
      c.fillStyle = 'rgba(0,0,0,.55)'; c.beginPath(); c.arc(rx + 0.5, y + 1, 3.4, 0, TAU); c.fill();
      c.fillStyle = '#6b7596'; c.beginPath(); c.arc(rx, y, 3, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.arc(rx - 0.9, y - 1, 1.1, 0, TAU); c.fill();
    }
    const ix = wi ? x : x + A.wallW - 2;
    c.fillStyle = wi ? 'rgba(255,77,94,.65)' : 'rgba(58,160,255,.65)'; c.fillRect(ix, 0, 2, H);
    g = c.createLinearGradient(ix + (wi ? 0 : 2), 0, ix + (wi ? -30 : 32), 0);
    g.addColorStop(0, wi ? 'rgba(255,77,94,.18)' : 'rgba(58,160,255,.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(wi ? ix - 30 : ix + 2, 0, 30, H);
  });
  // vignette
  g = c.createRadialGradient(W / 2, H / 2, 280, W / 2, H / 2, 780);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.5)');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  return spots;
}

// Stadium animation drawn over its cached layer: sweeping beams and rising pit embers.
function stadiumOver(c, F, t) {
  const A = CONFIG.arena;
  c.save(); c.globalCompositeOperation = 'lighter';
  const beams = [[160, '#3aa0ff', 0], [440, '#9a5cff', 1.7], [760, '#ffd23f', 3.1], [1040, '#ff4d5e', 4.6]];
  beams.forEach(([x, col, ph]) => {
    const ang = Math.PI / 2 + Math.sin(t * 0.6 + ph) * 0.38, len = 520, sp = 0.07;
    const x1 = x + Math.cos(ang - sp) * len, y1 = 28 + Math.sin(ang - sp) * len, x2 = x + Math.cos(ang + sp) * len, y2 = 28 + Math.sin(ang + sp) * len;
    const g = c.createLinearGradient(x, 28, x + Math.cos(ang) * len, 28 + Math.sin(ang) * len);
    g.addColorStop(0, col + '55'); g.addColorStop(1, col + '00');
    c.fillStyle = g; c.beginPath(); c.moveTo(x, 28); c.lineTo(x1, y1); c.lineTo(x2, y2); c.closePath(); c.fill();
  });
  const pits = [[A.wallW, F.floorL], [F.floorR, A.w - A.wallW]];
  for (let i = 0; i < 18; i++) {
    const [x0, x1] = pits[i % 2], life = (t * 0.4 + i * 0.137) % 1, sx = (i * 0.6180339) % 1;
    const ex = x0 + 6 + sx * (x1 - x0 - 12) + Math.sin(t * 2 + i) * 6, ey = A.h - life * 120;
    c.globalAlpha = (1 - life) * 0.85; c.fillStyle = i % 3 ? '#ff8a1f' : '#ffd23f';
    c.beginPath(); c.arc(ex, ey, 1 + (1 - life) * 1.4, 0, TAU); c.fill();
  }
  c.restore();
}

// Camera flashes popping in the crowd (spots come from the cached crowd painter).
function drawFlashes(c, F, spots) {
  if (!F.flashes) F.flashes = [];
  if (spots && spots.length && Math.random() < 0.1) { const s = pick(spots); F.flashes.push({ x: s.x, y: s.y, life: 1 }); }
  if (!F.flashes.length) return;
  c.save(); c.globalCompositeOperation = 'lighter';
  F.flashes = F.flashes.filter(f => {
    f.life -= 0.1;
    c.globalAlpha = Math.max(0, f.life); c.fillStyle = '#ffffff'; c.strokeStyle = '#ffffff'; c.lineWidth = 1;
    c.beginPath(); c.arc(f.x, f.y, 2 + f.life * 2, 0, TAU); c.fill();
    c.beginPath(); c.moveTo(f.x - 7 * f.life, f.y); c.lineTo(f.x + 7 * f.life, f.y); c.moveTo(f.x, f.y - 7 * f.life); c.lineTo(f.x, f.y + 7 * f.life); c.stroke();
    return f.life > 0;
  });
  c.restore();
}

// ============================================================
// LANDMARK ARENAS (Taj Mahal, Hampi, Gomateshwara): 2D backdrops painted once into a cached layer.
// Each scene fills the sky/landmark area; live() adds cheap animation (birds, clouds, water) every frame.
// Themes (colours for floor, pits, walls, crowd, LED board) live in CONFIG.arenas.list[key].theme.
// ============================================================
const LANDMARK_ART = (function () {
  function grad(c, x0, y0, x1, y1, stops) {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
    return g;
  }
  const vGrad = (c, y0, y1, stops) => grad(c, 0, y0, 0, y1, stops);
  const hGrad = (c, x0, x1, stops) => grad(c, x0, 0, x1, 0, stops);
  function glow(c, x, y, r, rgb, a) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function seeded(seed) {   // deterministic random so scenery is identical every match
    return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  }
  function arch(c, x, y, w, h) {   // pointed (Mughal-style) arch, bottom-left at (x, y)
    c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - h + w * 0.55);
    c.quadraticCurveTo(x, y - h + w * 0.1, x + w / 2, y - h);
    c.quadraticCurveTo(x + w, y - h + w * 0.1, x + w, y - h + w * 0.55);
    c.lineTo(x + w, y); c.closePath();
  }
  function boulder(c, x, y, rx, ry, cols, rnd) {   // irregular rounded rock lit from the upper left
    const n = 10, pts = [];
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, k = 0.85 + rnd() * 0.25; pts.push({ x: x + Math.cos(a) * rx * k, y: y + Math.sin(a) * ry * k }); }
    const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    c.beginPath();
    let s = mid(pts[n - 1], pts[0]); c.moveTo(s.x, s.y);
    for (let i = 0; i < n; i++) { const q = mid(pts[i], pts[(i + 1) % n]); c.quadraticCurveTo(pts[i].x, pts[i].y, q.x, q.y); }
    c.closePath();
    const g = c.createRadialGradient(x - rx * 0.4, y - ry * 0.45, 2, x, y, Math.max(rx, ry) * 1.15);
    g.addColorStop(0, cols[0]); g.addColorStop(0.5, cols[1]); g.addColorStop(1, cols[2]);
    c.fillStyle = g; c.fill();
  }
  function cloud(c, x, y, s, top, bottom) {
    c.fillStyle = vGrad(c, y - 30 * s, y + 14 * s, [top, bottom]);
    [[0, 0, 34], [-36, 6, 24], [36, 6, 26], [-14, -16, 24], [16, -12, 22]].forEach(([dx, dy, r]) => {
      c.beginPath(); c.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2); c.fill();
    });
  }
  function birds(c, t, n, y0, color) {
    c.strokeStyle = color; c.lineWidth = 1.6; c.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const x = ((t * 28 + i * 190) % 1500) - 150, y = y0 + i * 14 + Math.sin(t * 1.3 + i) * 8, f = Math.sin(t * 9 + i * 2) * 3;
      c.beginPath(); c.moveTo(x - 7, y - f); c.quadraticCurveTo(x - 3, y - 3, x, y); c.quadraticCurveTo(x + 3, y - 3, x + 7, y - f); c.stroke();
    }
  }
  function palm(c, x, base, h, lean) {
    const tx = x + lean, ty = base - h;
    c.strokeStyle = '#6b4a2a'; c.lineWidth = 7; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x, base); c.quadraticCurveTo(x + lean * 0.2, base - h * 0.6, tx, ty); c.stroke();
    c.strokeStyle = '#2f6a2c'; c.lineWidth = 4;
    for (let k = 0; k < 8; k++) {
      const a = -Math.PI / 2 + (k - 3.5) * 0.42, len = 46;
      const ex = tx + Math.cos(a) * len * 1.2, ey = ty + Math.sin(a) * len * 0.5 + 24;
      c.beginPath(); c.moveTo(tx, ty); c.quadraticCurveTo(tx + Math.cos(a) * len * 0.7, ty + Math.sin(a) * len * 0.6 - 10, ex, ey); c.stroke();
    }
  }

  // ---- Taj Mahal: golden-hour sunset, marble lit from the left ----
  function minaret(c, x, w, top, base) {
    c.fillStyle = hGrad(c, x - w / 2, x + w / 2, ['#fff6ea', '#eadbca', '#bea8a2']);
    c.beginPath(); c.moveTo(x - w / 2, base); c.lineTo(x - w * 0.38, top); c.lineTo(x + w * 0.38, top); c.lineTo(x + w / 2, base); c.fill();
    for (const f of [0.3, 0.6, 0.88]) {
      const y = base - (base - top) * f;
      c.fillStyle = '#fbf3e8'; c.fillRect(x - w * 0.62, y - 3, w * 1.24, 5);
      c.fillStyle = 'rgba(90,60,70,.3)'; c.fillRect(x - w * 0.55, y + 2, w * 1.1, 3);
    }
    c.fillStyle = '#efe2d2';
    c.fillRect(x - w * 0.48, top - 13, 3, 13); c.fillRect(x + w * 0.48 - 3, top - 13, 3, 13);
    c.fillStyle = hGrad(c, x - w / 2, x + w / 2, ['#fff8ee', '#e2d0c4']);
    c.beginPath(); c.ellipse(x, top - 12, w * 0.56, w * 0.5, 0, Math.PI, 2 * Math.PI); c.fill();
    c.fillStyle = '#d9b24e'; c.fillRect(x - 1, top - 12 - w * 0.5 - 9, 2, 10);
  }
  function tajScene(c, A) {
    c.fillStyle = vGrad(c, 0, 432, ['#1c2457', '#4f3b78', '#c26c7e', '#f2a678', '#ffd9a0']);
    c.fillRect(0, 0, A.w, 432);
    glow(c, 170, 352, 300, '255,214,150', 0.6);
    c.fillStyle = '#fff1d0'; c.beginPath(); c.arc(170, 352, 24, 0, Math.PI * 2); c.fill();
    const r = seeded(7);
    for (let i = 0; i < 50; i++) { c.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.5})`; c.fillRect(r() * A.w, r() * 140, 1.6, 1.6); }
    [[280, 150, 230], [900, 118, 270], [660, 196, 170], [1080, 210, 140]].forEach(([x, y, w]) => {
      c.fillStyle = 'rgba(255,180,170,.2)'; c.beginPath(); c.ellipse(x, y, w, 8, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,230,205,.18)'; c.beginPath(); c.ellipse(x + 30, y - 5, w * 0.6, 4, 0, 0, Math.PI * 2); c.fill();
    });
    // distant tree line
    c.fillStyle = '#5a3c5c';
    c.beginPath(); c.moveTo(0, 410);
    for (let x = 0; x <= A.w; x += 12) c.lineTo(x, 380 - 9 * Math.abs(Math.sin(x * 0.07)) - 5 * Math.sin(x * 0.019));
    c.lineTo(A.w, 410); c.fill();
    // red sandstone mosque (left) and jawab (right)
    [70, 950].forEach(x => {
      c.fillStyle = vGrad(c, 318, 404, ['#c06446', '#7a3326']); c.fillRect(x, 318, 180, 86);
      c.fillStyle = '#e9d9c4'; c.fillRect(x, 316, 180, 4);
      c.fillStyle = '#4e1e16'; for (let k = 0; k < 3; k++) { arch(c, x + 20 + k * 52, 400, 36, 58); c.fill(); }
      c.fillStyle = hGrad(c, x, x + 180, ['#fff4e6', '#d8c4b8']);
      [[x + 42, 18], [x + 90, 27], [x + 138, 18]].forEach(([dx, rr]) => { c.beginPath(); c.ellipse(dx, 316, rr, rr * 1.15, 0, Math.PI, 2 * Math.PI); c.fill(); });
    });
    // back minarets, plinth, front minarets frame the tomb
    minaret(c, 404, 17, 196, 376); minaret(c, 796, 17, 196, 376);
    c.fillStyle = hGrad(c, 330, 870, ['#fbf1e4', '#efe1d0', '#cdb8ae']); c.fillRect(330, 372, 540, 30);
    c.fillStyle = 'rgba(150,110,105,.35)';
    for (let x = 340; x < 860; x += 30) { arch(c, x, 398, 18, 18); c.fill(); }
    // main tomb body
    const marble = hGrad(c, 450, 750, ['#fff8ee', '#f3e6d6', '#cfb9b0']);
    c.fillStyle = marble; c.fillRect(450, 250, 300, 122);
    c.fillStyle = 'rgba(110,80,95,.16)'; c.fillRect(722, 250, 28, 122);
    c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(450, 250, 26, 122);
    [[478, 44], [668, 44], [452, 24], [724, 24]].forEach(([x, w]) => {
      c.fillStyle = 'rgba(160,125,120,.42)'; arch(c, x, 312, w, 54); c.fill(); arch(c, x, 368, w, 50); c.fill();
    });
    // central pishtaq (great arch)
    c.fillStyle = '#fffaf2'; c.fillRect(540, 230, 120, 142);
    c.strokeStyle = '#c9b090'; c.lineWidth = 2; c.strokeRect(547, 237, 106, 135);
    c.fillStyle = vGrad(c, 250, 372, ['#a98e8c', '#dccbc0']); arch(c, 562, 372, 76, 120); c.fill();
    c.fillStyle = '#6e5658'; arch(c, 584, 372, 32, 54); c.fill();
    c.fillStyle = '#f7eee2'; c.fillRect(448, 245, 304, 6);
    [452, 546, 652, 746].forEach(x => c.fillRect(x - 2, 230, 4, 16));
    // roof chhatris
    [486, 714].forEach(x => {
      c.fillStyle = '#efe2d2'; c.fillRect(x - 16, 222, 32, 24);
      c.fillStyle = 'rgba(150,120,115,.5)'; arch(c, x - 8, 246, 16, 20); c.fill();
      c.fillStyle = hGrad(c, x - 20, x + 20, ['#fff8ee', '#d9c6bc']);
      c.beginPath(); c.ellipse(x, 222, 20, 20, 0, Math.PI, 2 * Math.PI); c.fill();
      c.fillStyle = '#d9b24e'; c.fillRect(x - 1, 194, 2, 9);
    });
    // drum and onion dome
    c.fillStyle = hGrad(c, 538, 662, ['#fff8ee', '#efe0d0', '#cdb7ae']); c.fillRect(538, 198, 124, 48);
    c.fillStyle = 'rgba(150,120,110,.35)'; c.fillRect(538, 205, 124, 2); c.fillRect(538, 238, 124, 2);
    c.beginPath(); c.moveTo(540, 202);
    c.bezierCurveTo(516, 178, 514, 128, 562, 112);
    c.bezierCurveTo(584, 104, 596, 100, 600, 94);
    c.bezierCurveTo(604, 100, 616, 104, 638, 112);
    c.bezierCurveTo(686, 128, 684, 178, 660, 202); c.closePath();
    const dg = c.createRadialGradient(566, 138, 6, 600, 160, 96);
    dg.addColorStop(0, '#fffbf4'); dg.addColorStop(0.6, '#efdfd0'); dg.addColorStop(1, '#b49c9a');
    c.fillStyle = dg; c.fill();
    c.fillStyle = 'rgba(160,120,110,.35)';
    for (let k = 0; k < 7; k++) { c.beginPath(); c.ellipse(552 + k * 16, 202, 7, 5, 0, Math.PI, 2 * Math.PI); c.fill(); }
    c.fillStyle = '#d9b24e'; c.fillRect(598.5, 72, 3, 24);
    [90, 82].forEach(y => { c.beginPath(); c.arc(600, y, 3.5, 0, Math.PI * 2); c.fill(); });
    minaret(c, 352, 24, 168, 400); minaret(c, 848, 24, 168, 400);
    // garden, reflecting pool, cypress rows
    c.fillStyle = vGrad(c, 400, 432, ['#4f6b36', '#36502a']); c.fillRect(0, 400, A.w, 32);
    c.save();
    c.beginPath(); c.moveTo(574, 402); c.lineTo(626, 402); c.lineTo(668, 432); c.lineTo(532, 432); c.closePath(); c.clip();
    c.fillStyle = vGrad(c, 402, 432, ['#e8b49a', '#6f8fb4', '#3c5f86']); c.fillRect(530, 400, 140, 34);
    c.fillStyle = 'rgba(255,248,236,.55)';
    c.beginPath(); c.ellipse(600, 408, 22, 7, 0, 0, Math.PI * 2); c.fill(); c.fillRect(592, 402, 16, 4);
    c.restore();
    for (let k = 0; k < 6; k++) {
      const h = 34 + k * 5, rw = 5 + k * 0.7;
      [560 - k * 32, 640 + k * 32].forEach(x => {
        c.fillStyle = hGrad(c, x - rw, x + rw, ['#3d6040', '#1c3322']);
        c.beginPath(); c.ellipse(x, 432 - h / 2, rw, h / 2, 0, 0, Math.PI * 2); c.fill();
      });
    }
  }
  function tajLive(c, A, t) {
    c.fillStyle = 'rgba(255,255,255,.22)';
    for (let k = 0; k < 4; k++) { const y = 410 + k * 6, w = 12 + k * 6; c.fillRect(600 - w / 2 + Math.sin(t * 2 + k) * (6 + k * 3), y, w, 1.5); }
    birds(c, t, 3, 130, 'rgba(40,20,40,.7)');
  }

  // ---- Hampi: bright afternoon, granite boulders, Virupaksha gopuram ----
  const HAMPI_ROCK = ['#e8ad7a', '#b7744a', '#64381e'];
  function hampiScene(c, A) {
    c.fillStyle = vGrad(c, 0, 432, ['#3a84c4', '#78b4de', '#c8e2ee', '#ffe2b0']); c.fillRect(0, 0, A.w, 432);
    glow(c, 200, 96, 220, '255,244,210', 0.7);
    c.fillStyle = '#fff6dc'; c.beginPath(); c.arc(200, 96, 32, 0, Math.PI * 2); c.fill();
    // hazy far hills
    c.fillStyle = '#b9a59a';
    c.beginPath(); c.moveTo(0, 410);
    for (let x = 0; x <= A.w; x += 10) c.lineTo(x, 330 - 40 * Math.sin(x * 0.006 + 1) - 14 * Math.sin(x * 0.03));
    c.lineTo(A.w, 410); c.fill();
    // boulder heaps on both sides (bigger and lower = closer)
    const r = seeded(11);
    [[0, 360], [850, 350]].forEach(([x0, w]) => {
      const rocks = Array.from({ length: 22 }, () => ({ x: x0 + r() * w, y: 300 + r() * 104, s: 16 + r() * 38 })).sort((a, b) => a.y - b.y);
      rocks.forEach(k => boulder(c, k.x, k.y, k.s * 1.25, k.s, HAMPI_ROCK, r));
    });
    palm(c, 330, 404, 120, 18); palm(c, 880, 404, 104, -14);
    // Vittala stone chariot
    c.fillStyle = vGrad(c, 384, 404, ['#a39684', '#6d6253']); c.fillRect(378, 384, 104, 20);
    c.fillStyle = hGrad(c, 392, 468, ['#c4b6a0', '#9d8f7c', '#6f6455']); c.fillRect(392, 338, 76, 46);
    c.fillStyle = 'rgba(60,50,40,.4)'; for (let y = 346; y < 384; y += 9) c.fillRect(392, y, 76, 2);
    c.fillStyle = hGrad(c, 400, 460, ['#c4b6a0', '#7d7262']);
    c.beginPath(); c.moveTo(398, 338); c.lineTo(408, 316); c.lineTo(452, 316); c.lineTo(462, 338); c.fill();
    c.beginPath(); c.ellipse(430, 316, 22, 14, 0, Math.PI, 2 * Math.PI); c.fill();
    [402, 458].forEach(x => {
      c.fillStyle = '#8a7e6c'; c.beginPath(); c.arc(x, 390, 17, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#5c5246'; c.lineWidth = 2;
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; c.beginPath(); c.moveTo(x, 390); c.lineTo(x + Math.cos(a) * 15, 390 + Math.sin(a) * 15); c.stroke(); }
      c.beginPath(); c.arc(x, 390, 15, 0, Math.PI * 2); c.stroke();
    });
    // ruined pillared mandapa
    c.fillStyle = hGrad(c, 716, 846, ['#b7a58e', '#7d6c58']);
    [728, 758, 788, 818].forEach(x => { c.fillRect(x, 330, 12, 74); c.fillRect(x - 4, 324, 20, 7); });
    c.fillRect(716, 314, 130, 11); c.fillRect(724, 306, 78, 8);
    // gopuram: 9 whitewashed tiers, lit from the left
    const X = 620;
    c.fillStyle = hGrad(c, 545, 695, ['#a79680', '#7a6a56']); c.fillRect(545, 330, 150, 74);
    c.fillStyle = '#2e2218'; arch(c, 604, 404, 32, 56); c.fill();
    for (let i = 0; i < 9; i++) {
      const y1 = 330 - i * 20, y0 = y1 - 20, w1 = 140 - i * 9.5, w0 = w1 - 9.5;
      c.fillStyle = hGrad(c, X - w1 / 2, X + w1 / 2, ['#f7ecd8', '#e6d4b6', '#a68f6e']);
      c.beginPath(); c.moveTo(X - w1 / 2, y1); c.lineTo(X - w0 / 2, y0); c.lineTo(X + w0 / 2, y0); c.lineTo(X + w1 / 2, y1); c.fill();
      c.fillStyle = 'rgba(80,60,40,.45)'; c.fillRect(X - w1 / 2, y1 - 2, w1, 2);
      c.fillStyle = 'rgba(90,70,50,.5)';
      for (let x = X - w0 / 2 + 5; x < X + w0 / 2 - 8; x += 13) c.fillRect(x, y0 + 6, 5, 9);
    }
    c.fillStyle = hGrad(c, X - 32, X + 32, ['#f4e8d0', '#b9a482']);
    c.fillRect(X - 30, 134, 60, 16);
    c.beginPath(); c.ellipse(X, 134, 32, 12, 0, Math.PI, 2 * Math.PI); c.fill();
    c.fillStyle = '#d9a83e';
    for (let x = X - 24; x <= X + 24; x += 12) { c.fillRect(x - 1, 112, 2, 10); c.beginPath(); c.arc(x, 114, 3, 0, Math.PI * 2); c.fill(); }
    // Tungabhadra river with rocks
    c.fillStyle = vGrad(c, 404, 432, ['#7cb4c8', '#2f6a80']); c.fillRect(0, 404, A.w, 28);
    [[470, 414, 16], [700, 420, 12], [540, 424, 9]].forEach(([x, y, s]) => boulder(c, x, y, s * 1.4, s * 0.8, HAMPI_ROCK, r));
  }
  function hampiLive(c, A, t) {
    [[0, 90, 1], [460, 64, 1.3], [860, 140, 0.8]].forEach(([x, y, s]) =>
      cloud(c, ((x + t * 8) % (A.w + 300)) - 150, y, s, 'rgba(255,255,255,.95)', 'rgba(220,226,236,.9)'));
    c.fillStyle = 'rgba(255,255,255,.25)';
    for (let y = 410; y < 432; y += 6) c.fillRect(((t * 30 + y * 13) % (A.w + 100)) - 50, y, 60, 1.5);
    birds(c, t, 2, 170, 'rgba(50,40,30,.75)');
    // coracle drifting on the river
    const cx = 360 + ((t * 10) % 480);
    c.fillStyle = '#5a3a1e'; c.beginPath(); c.ellipse(cx, 420, 13, 5, 0, 0, Math.PI); c.fill();
  }

  // ---- Gomateshwara: morning light from the right, statue on Vindhyagiri hill ----
  function gomatScene(c, A) {
    c.fillStyle = vGrad(c, 0, 432, ['#6ca4d4', '#a9cde6', '#e4eef0', '#fbe3c0']); c.fillRect(0, 0, A.w, 432);
    glow(c, 1010, 250, 280, '255,226,170', 0.65);
    c.fillStyle = '#fff3d8'; c.beginPath(); c.arc(1010, 250, 26, 0, Math.PI * 2); c.fill();
    // Chandragiri hill in the haze
    c.fillStyle = '#9aaab2'; c.beginPath(); c.ellipse(210, 420, 320, 110, 0, Math.PI, 2 * Math.PI); c.fill();
    c.fillStyle = '#8796a0';
    [[150, 314], [196, 310], [246, 314]].forEach(([x, y]) => { c.fillRect(x - 8, y, 16, 12); c.beginPath(); c.moveTo(x - 9, y); c.lineTo(x, y - 12); c.lineTo(x + 9, y); c.fill(); });
    c.fillStyle = '#8fa396';
    c.beginPath(); c.moveTo(0, 432);
    for (let x = 0; x <= A.w; x += 10) c.lineTo(x, 392 - 6 * Math.abs(Math.sin(x * 0.09)));
    c.lineTo(A.w, 432); c.fill();
    // Vindhyagiri granite dome, lit from the right
    c.fillStyle = hGrad(c, 330, 1000, ['#5f594e', '#8a8477', '#bdb6a6']);
    c.beginPath(); c.moveTo(300, 432); c.bezierCurveTo(400, 330, 520, 286, 640, 284); c.bezierCurveTo(780, 286, 900, 340, 1010, 432); c.fill();
    c.strokeStyle = 'rgba(50,45,38,.25)'; c.lineWidth = 2;
    [[430, 400, 520, 330], [760, 330, 860, 400], [690, 360, 720, 420]].forEach(([x0, y0, x1, y1]) => {
      c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo((x0 + x1) / 2 + 20, (y0 + y1) / 2, x1, y1); c.stroke();
    });
    // rock-cut steps zig-zagging to the top
    c.strokeStyle = 'rgba(245,238,222,.7)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(560, 430); c.lineTo(600, 400); c.lineTo(570, 370); c.lineTo(612, 338); c.lineTo(596, 306); c.stroke();
    c.strokeStyle = 'rgba(80,70,60,.4)'; c.lineWidth = 1;
    for (let k = 0; k < 18; k++) { const y = 428 - k * 7, x = 560 + Math.abs(((k * 7) % 60) - 30); c.beginPath(); c.moveTo(x - 4, y); c.lineTo(x + 4, y); c.stroke(); }
    // the statue (kayotsarga pose: arms hanging free of the body)
    const X = 640;
    const stone = hGrad(c, X - 60, X + 60, ['#a39c8e', '#d6d0c2', '#f4efe3']);
    c.fillStyle = stone;
    c.beginPath();
    c.moveTo(X - 46, 142); c.quadraticCurveTo(X - 44, 172, X - 26, 200);
    c.lineTo(X - 28, 226); c.lineTo(X - 24, 300); c.lineTo(X - 2, 300); c.lineTo(X - 2, 232);
    c.lineTo(X + 2, 232); c.lineTo(X + 2, 300); c.lineTo(X + 24, 300); c.lineTo(X + 28, 226);
    c.lineTo(X + 26, 200); c.quadraticCurveTo(X + 44, 172, X + 46, 142);
    c.quadraticCurveTo(X, 132, X - 46, 142); c.closePath(); c.fill();
    [-1, 1].forEach(s => {
      c.beginPath();
      c.moveTo(X + s * 46, 140); c.quadraticCurveTo(X + s * 58, 150, X + s * 56, 182);
      c.lineTo(X + s * 53, 264); c.lineTo(X + s * 43, 264); c.lineTo(X + s * 40, 190);
      c.quadraticCurveTo(X + s * 38, 160, X + s * 36, 148); c.closePath(); c.fill();
    });
    c.fillStyle = 'rgba(70,64,54,.18)';
    c.fillRect(X - 2, 232, 4, 68); c.fillRect(X - 30, 200, 60, 3);
    c.fillStyle = hGrad(c, X - 9, X + 9, ['#b8b1a3', '#ece6d8']); c.fillRect(X - 8, 120, 16, 22);
    c.fillStyle = hGrad(c, X - 16, X + 16, ['#b2ab9d', '#e2dccf', '#f6f1e6']);
    c.beginPath(); c.ellipse(X, 110, 15, 18, 0, 0, Math.PI * 2); c.fill();
    [-1, 1].forEach(s => { c.beginPath(); c.ellipse(X + s * 15, 117, 3.5, 11, 0, 0, Math.PI * 2); c.fill(); });
    c.fillStyle = '#76716a';
    for (let row = 0; row < 3; row++) {
      const rr = 15 - row * 4.5, n = 9 - row * 3;
      for (let k = 0; k <= n; k++) { const a = Math.PI + 0.25 + k / n * (Math.PI - 0.5); c.beginPath(); c.arc(X + rr * Math.cos(a), 104 + rr * Math.sin(a) * 1.05, 3, 0, Math.PI * 2); c.fill(); }
    }
    // madhavi creepers winding up legs and arms
    c.strokeStyle = '#5f8a3e'; c.lineWidth = 2.2;
    [[X - 14, 300, X - 22, 230], [X + 14, 300, X + 22, 230], [X - 48, 262, X - 50, 160], [X + 48, 262, X + 50, 160]].forEach(([x0, y0, x1, y1]) => {
      c.beginPath(); c.moveTo(x0, y0);
      for (let k = 1; k <= 6; k++) { const f = k / 6; c.lineTo(lerp(x0, x1, f) + (k % 2 ? 6 : -6), lerp(y0, y1, f)); }
      c.stroke();
    });
    // hilltop enclosure with small gopuras and Jain flag bunting
    c.fillStyle = vGrad(c, 284, 312, ['#e6dfcd', '#b7ae9b']); c.fillRect(530, 284, 220, 28);
    c.fillStyle = 'rgba(70,60,50,.4)'; for (let x = 540; x < 744; x += 16) c.fillRect(x, 292, 6, 16);
    [530, 750].forEach(x => {
      for (let i = 0; i < 4; i++) {
        const w1 = 44 - i * 8, y1 = 312 - i * 12;
        c.fillStyle = hGrad(c, x - w1 / 2, x + w1 / 2, ['#a89f8e', '#e9e2d2']);
        c.fillRect(x - w1 / 2, y1 - 12, w1, 12);
      }
      c.fillStyle = '#d9a83e'; c.fillRect(x - 1, 254, 2, 10);
    });
    const flagCols = ['#e23b3b', '#f2c230', '#ffffff', '#3d9a4a', '#3a6fd1'];
    c.strokeStyle = 'rgba(60,50,40,.6)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(530, 266); c.quadraticCurveTo(640, 286, 750, 266); c.stroke();
    for (let k = 0; k < 20; k++) {
      const f = (k + 0.5) / 20, x = lerp(530, 750, f), y = 266 + 20 * 2 * f * (1 - f);
      c.fillStyle = flagCols[k % 5];
      c.beginPath(); c.moveTo(x - 4, y); c.lineTo(x + 4, y); c.lineTo(x, y + 9); c.fill();
    }
    // foreground trees either side
    [[300, 380, 50], [360, 396, 34], [900, 384, 48], [850, 400, 30]].forEach(([x, y, rr]) => {
      c.fillStyle = '#4f4032'; c.fillRect(x - 3, y, 6, 432 - y);
      const g = c.createRadialGradient(x + rr * 0.3, y - rr * 0.4, 4, x, y, rr);
      g.addColorStop(0, '#6f9a52'); g.addColorStop(1, '#2e4a2a');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, rr, 0, Math.PI * 2); c.fill();
    });
  }
  function gomatLive(c, A, t) {
    [[0, 372, 380], [600, 346, 300]].forEach(([x, y, w], i) => {
      const mx = ((x + t * (6 + i * 3)) % (A.w + w * 2)) - w;
      c.fillStyle = 'rgba(255,255,255,.22)'; c.beginPath(); c.ellipse(mx, y, w, 12, 0, 0, Math.PI * 2); c.fill();
    });
    [[200, 120, 0.9], [820, 90, 1.1]].forEach(([x, y, s]) => {
      const cx = ((x + t * 6) % (A.w + 300)) - 150;
      const fade = clamp((Math.abs(cx - 640) - 90) / 120, 0, 1);   // thin out while passing the statue
      if (fade > 0) cloud(c, cx, y, s, `rgba(255,255,255,${0.85 * fade})`, `rgba(230,226,220,${0.8 * fade})`);
    });
    birds(c, t, 3, 150, 'rgba(40,40,50,.7)');
  }

  return {
    taj:          { scene: tajScene,   live: tajLive },
    hampi:        { scene: hampiScene, live: hampiLive },
    gomateshwara: { scene: gomatScene, live: gomatLive },
  };
})();

// Back layer of a landmark arena: scene + soft stage spotlights (baked here so they cost nothing per frame).
function paintLandmarkBack(c, key) {
  const A = CONFIG.arena;
  LANDMARK_ART[key].scene(c, A);
  [[300, '#3aa0ff'], [900, '#ff4d5e'], [600, '#ffffff']].forEach(([x, col]) => {
    const s = c.createRadialGradient(x, 0, 10, x, 0, 520);
    s.addColorStop(0, col + '22'); s.addColorStop(1, col + '00');
    c.fillStyle = s; c.fillRect(0, 0, A.w, A.h);
  });
}

// Front layer of a landmark arena (transparent canvas over the animated sky): crowd stands either side of the
// landmark, LED board, ground strip, themed pits, tiled floor, walls. Returns the crowd spots for camera flashes.
function paintLandmarkFront(c, F, T) {
  const A = CONFIG.arena, AR = CONFIG.arenas, rng = mulberry32(11), spots = [], n = AR.crowdCount;
  for (let k = 0; k < n; k++) {
    const x = (k / n) * A.w + (rng() - 0.5) * 8, y = 392 + rng() * 32, r = 6 + rng() * 3, s = 0.55 + rng() * 0.35;
    if (x > AR.crowdGap[0] && x < AR.crowdGap[1]) continue;   // keep the landmark visible
    c.fillStyle = `rgba(${T.crowd},${s})`;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    c.fillRect(x - r, y + r * 0.6, r * 2, 30);
    if (rng() < 0.12) spots.push({ x, y: y - 4 });
  }
  // LED board + ground strip
  c.fillStyle = T.board; c.fillRect(0, 432, A.w, 40);
  c.fillStyle = 'rgba(255,255,255,.035)';
  for (let x = 0; x < A.w; x += 6) for (let y = 434; y < 470; y += 6) c.fillRect(x, y, 4, 4);
  c.fillStyle = T.ground; c.fillRect(0, 472, A.w, 30);
  // pits
  [[A.wallW, F.floorL], [F.floorR, A.w - A.wallW]].forEach(([x0, x1]) => {
    const pg = c.createLinearGradient(0, A.floorY, 0, A.h);
    pg.addColorStop(0, T.pit[0]); pg.addColorStop(1, T.pit[1]);
    c.fillStyle = pg; c.fillRect(x0, A.floorY - 10, x1 - x0, A.h);
    c.fillStyle = 'rgba(255,255,255,.45)'; c.font = '900 13px "Segoe UI", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(T.pitLabel, (x0 + x1) / 2, A.h - 30);
  });
  // floor with tile seams
  const g = c.createLinearGradient(0, A.floorY, 0, A.h);
  g.addColorStop(0, T.floor[0]); g.addColorStop(1, T.floor[1]);
  c.fillStyle = g; c.fillRect(F.floorL, A.floorY, F.floorR - F.floorL, A.h - A.floorY);
  c.fillStyle = 'rgba(0,0,0,.12)';
  for (let x = F.floorL + 60; x < F.floorR; x += 60) c.fillRect(x, A.floorY, 2, A.h - A.floorY);
  c.fillRect(F.floorL, A.floorY + 45, F.floorR - F.floorL, 2);
  c.fillStyle = T.edge; c.fillRect(F.floorL, A.floorY, F.floorR - F.floorL, 3);
  [F.floorL, F.floorR - 24].forEach(x => {
    for (let i = 0; i < 4; i++) { c.fillStyle = i % 2 ? '#111' : '#ffd23f'; c.fillRect(x + i * 6, A.floorY + 2, 6, 10); }
  });
  // walls
  c.fillStyle = T.wall[0];
  c.fillRect(0, 0, A.wallW, A.h); c.fillRect(A.w - A.wallW, 0, A.wallW, A.h);
  c.fillStyle = T.wall[1];
  for (let y = 0; y < A.h; y += 40) { c.fillRect(4, y, A.wallW - 8, 3); c.fillRect(A.w - A.wallW + 4, y, A.wallW - 8, 3); }
  return spots;
}

// Animated ripples on water pits (drawn over the front layer).
function landmarkOver(c, F, t, T) {
  if (!T.water) return;
  const A = CONFIG.arena;
  c.fillStyle = 'rgba(255,255,255,.18)';
  [[A.wallW, F.floorL], [F.floorR, A.w - A.wallW]].forEach(([x0, x1]) => {
    for (let k = 0; k < 4; k++) c.fillRect(x0 + ((t * 25 + k * 37) % (x1 - x0 - 20)), A.floorY + 6 + k * 22, 20, 2);
  });
}

// ---- arena selection + layer cache ----
// Valid arena key, or the default one.
function arenaKey(key) { return CONFIG.arenas.list[key] ? key : CONFIG.arenas.default; }
const arenaLayers = {};   // key -> { back, front, spots }: painted once at screen pixel density, reused by every fight
function getLayers(key) {
  if (arenaLayers[key]) return arenaLayers[key];
  const A = CONFIG.arena, G = arenaGeom(), T = CONFIG.arenas.list[key].theme, L = { back: null, front: null, spots: null };
  const paint = fn => {
    const l = makeLayer(Math.round(A.w * DPR), Math.round(A.h * DPR));
    if (!l) return null;
    try { l.x.scale(DPR, DPR); const r = fn(l.x); return { c: l.c, r }; } catch (e) { return null; }
  };
  if (key === 'stadium') {
    const b = paint(c => paintStadium(c, G));
    if (b) { L.back = b.c; L.spots = b.r; }
  } else {
    const b = paint(c => paintLandmarkBack(c, key)), f = paint(c => paintLandmarkFront(c, G, T));
    if (b && f) { L.back = b.c; L.front = f.c; L.spots = f.r; }
  }
  arenaLayers[key] = L;
  return L;
}

// Per frame: cached back layer -> live animation -> cached front layer -> overlays -> LED text.
// Without offscreen canvases (headless stub) the static layers are painted straight to ctx.
function drawArena() {
  const F = fight, A = CONFIG.arena, t = F.clock, key = arenaKey(F.arena), L = getLayers(key);
  const T = CONFIG.arenas.list[key].theme;
  let spots = L.spots;
  ctx.fillStyle = '#05060a'; ctx.fillRect(-30, -30, A.w + 60, A.h + 60);
  if (key === 'stadium') {
    if (L.back) ctx.drawImage(L.back, 0, 0, A.w, A.h); else spots = paintStadium(ctx, F);
    stadiumOver(ctx, F, t);
  } else {
    if (L.back) ctx.drawImage(L.back, 0, 0, A.w, A.h); else paintLandmarkBack(ctx, key);
    ctx.save(); LANDMARK_ART[key].live(ctx, A, t); ctx.restore();
    if (L.front) ctx.drawImage(L.front, 0, 0, A.w, A.h); else spots = paintLandmarkFront(ctx, F, T);
    landmarkOver(ctx, F, t, T);
  }
  drawFlashes(ctx, F, spots);
  // scrolling LED text
  ctx.save(); ctx.beginPath(); ctx.rect(0, 434, A.w, 36); ctx.clip();
  ctx.fillStyle = (T && T.led) || 'rgba(255,210,63,.55)'; ctx.font = 'italic 900 20px "Segoe UI", sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const off = (t * 60) % 300;
  for (let x = -off; x < A.w; x += 300) ctx.fillText('ROBO OLYMPICS ★', x, 453);
  ctx.restore();
}

// Builder thumbnail: the arena's static art (plus one still frame of its animation) scaled into a small canvas.
function drawArenaThumb(cv, key) {
  try {
    const c = cv.getContext && cv.getContext('2d'); if (!c) return;
    key = arenaKey(key);
    const A = CONFIG.arena, G = arenaGeom(), k = cv.width / A.w, T = CONFIG.arenas.list[key].theme;
    c.save(); c.setTransform(k, 0, 0, k, 0, 0); c.clearRect(0, 0, A.w, A.h);
    if (key === 'stadium') paintStadium(c, G);
    else { paintLandmarkBack(c, key); LANDMARK_ART[key].live(c, A, 0); paintLandmarkFront(c, G, T); }
    c.restore();
  } catch (e) {}
}
