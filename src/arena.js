'use strict';
// ============================================================
// ARENA: physics world (floor, walls, pit gaps) + stadium drawing
// OWNS:    createArenaWorld, cached offscreen static layers, drawArena
// EXPORTS: createArenaWorld, drawArena
// READS:   CONFIG, rand, Engine, Bodies, Composite, ctx, fight, roundRect, shade, mulberry32, outlinedText, TAU, pick
// ============================================================
// Engine + static bodies. Pits are the gaps between the floor and the walls.
function createArenaWorld() {
  const A = CONFIG.arena;
  const engine = Engine.create();
  engine.gravity.y = 1;
  engine.positionIterations = 8; engine.velocityIterations = 6;
  const floorL = A.wallW + A.pitW, floorR = A.w - A.wallW - A.pitW;
  Composite.add(engine.world, [
    Bodies.rectangle((floorL + floorR) / 2, A.floorY + 50, floorR - floorL, 100, { isStatic: true, friction: 1 }),
    Bodies.rectangle(A.wallW / 2, A.h / 2 - 500, A.wallW, A.h + 1000, { isStatic: true }),
    Bodies.rectangle(A.w - A.wallW / 2, A.h / 2 - 500, A.wallW, A.h + 1000, { isStatic: true }),
  ]);
  return { engine, floorL, floorR };
}

// ---- arena: static layers are pre-rendered once to an offscreen canvas ----
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

// Everything in the arena that never changes. Draws to any 2D context.
function paintStatic(c, F) {
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
  F.flashSpots = spots;
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
}

function drawArena() {
  const F = fight, A = CONFIG.arena, t = F.clock;
  if (F.layer === undefined) {
    F.layer = null;
    const L = makeLayer(A.w, A.h);
    if (L) { try { paintStatic(L.x, F); F.layer = L.c; } catch (e) { F.layer = null; } }
  }
  ctx.fillStyle = '#05060a'; ctx.fillRect(-30, -30, A.w + 60, A.h + 60);
  if (F.layer) ctx.drawImage(F.layer, 0, 0); else paintStatic(ctx, F);

  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  // sweeping light beams
  const beams = [[160, '#3aa0ff', 0], [440, '#9a5cff', 1.7], [760, '#ffd23f', 3.1], [1040, '#ff4d5e', 4.6]];
  beams.forEach(([x, col, ph]) => {
    const ang = Math.PI / 2 + Math.sin(t * 0.6 + ph) * 0.38, len = 520, sp = 0.07;
    const x1 = x + Math.cos(ang - sp) * len, y1 = 28 + Math.sin(ang - sp) * len, x2 = x + Math.cos(ang + sp) * len, y2 = 28 + Math.sin(ang + sp) * len;
    const g = ctx.createLinearGradient(x, 28, x + Math.cos(ang) * len, 28 + Math.sin(ang) * len);
    g.addColorStop(0, col + '55'); g.addColorStop(1, col + '00');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x, 28); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath(); ctx.fill();
  });
  // camera flashes
  if (!F.flashes) F.flashes = [];
  if (F.flashSpots && F.flashSpots.length && Math.random() < 0.1) { const s = pick(F.flashSpots); F.flashes.push({ x: s.x, y: s.y, life: 1 }); }
  F.flashes = F.flashes.filter(f => {
    f.life -= 0.1;
    ctx.globalAlpha = Math.max(0, f.life); ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(f.x, f.y, 2 + f.life * 2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(f.x - 7 * f.life, f.y); ctx.lineTo(f.x + 7 * f.life, f.y); ctx.moveTo(f.x, f.y - 7 * f.life); ctx.lineTo(f.x, f.y + 7 * f.life); ctx.stroke();
    return f.life > 0;
  });
  // rising pit embers
  ctx.globalAlpha = 1;
  const pits = [[A.wallW, F.floorL], [F.floorR, A.w - A.wallW]];
  for (let i = 0; i < 18; i++) {
    const [x0, x1] = pits[i % 2], life = (t * 0.4 + i * 0.137) % 1, sx = (i * 0.6180339) % 1;
    const ex = x0 + 6 + sx * (x1 - x0 - 12) + Math.sin(t * 2 + i) * 6, ey = A.h - life * 120;
    ctx.globalAlpha = (1 - life) * 0.85; ctx.fillStyle = i % 3 ? '#ff8a1f' : '#ffd23f';
    ctx.beginPath(); ctx.arc(ex, ey, 1 + (1 - life) * 1.4, 0, TAU); ctx.fill();
  }
  ctx.restore();
  // scrolling LED text
  ctx.save(); ctx.beginPath(); ctx.rect(0, 434, A.w, 36); ctx.clip();
  ctx.fillStyle = 'rgba(255,210,63,.55)'; ctx.font = 'italic 900 20px "Segoe UI", sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const off = (t * 60) % 300;
  for (let x = -off; x < A.w; x += 300) ctx.fillText('ROBO OLYMPICS ★', x, 453);
  ctx.restore();
}
