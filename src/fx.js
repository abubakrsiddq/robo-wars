'use strict';
// ============================================================
// EFFECTS: particles, floating text, banners, screen shake and generic canvas helpers
// OWNS:    canvas handle (cv, ctx), particle/text/banner updates and drawing, roundRect/shade/outlinedText/esc/mulberry32
// EXPORTS: cv, ctx, TAU, mulberry32, esc, sparks, dust, floatText, setBanner, updateEffects, drawParticles, outlinedText, roundRect, shade
// READS:   CONFIG, clamp, rand, fight, rectCentre
// ============================================================
const cv = document.getElementById('arena'), ctx = cv.getContext('2d');
const TAU = Math.PI * 2;

function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

function sparks(x, y, dmg, color) {
  if (!fight) return;
  const X = CONFIG.fx, P = fight.particles;
  if (P.length > X.maxParticles) return;
  color = color || '#ffffff';
  const n = Math.min(X.maxSparks, 5 + Math.round(dmg * 1.2));
  const cols = [color, '#fff2a8', '#ffffff', '#ffb02e', color, '#ff6b3d'];
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), sp = rand(1.5, 4.5) + dmg * 0.15;
    P.push({ kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, life: rand(0.25, 0.6), max: 0.6,
             color: cols[(Math.random() * cols.length) | 0], size: 1.5 + dmg * 0.06 });
  }
  if (dmg >= 3) {
    P.push({ kind: 'ring', x, y, vx: 0, vy: 0, life: X.ringLife, max: X.ringLife, color, size: 14 + Math.min(dmg, 40) * 1.6 });
    P.push({ kind: 'flash', x, y, vx: 0, vy: 0, life: 0.1, max: 0.1, color: '#ffffff', size: 16 + Math.min(dmg, 40) * 1.2 });
    let best = null, bd = 1e9;
    fight.robots.forEach(r => { const d = Math.hypot(r.body.position.x - x, r.body.position.y - y); if (d < bd) { bd = d; best = r; } });
    if (best && bd < 150) best._flash = X.hitFlash;
  }
  if (dmg >= X.debrisMin) {
    const nd = Math.min(X.maxDebris, 3 + Math.round(dmg * 0.25)), dc = ['#8a93a8', '#c3cad8', '#59627a', color];
    for (let i = 0; i < nd; i++) {
      const a = rand(-Math.PI * 0.95, -Math.PI * 0.05), sp = rand(2, 6);
      P.push({ kind: 'debris', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.7, 1.3), max: 1.3,
               rot: rand(0, TAU), vr: rand(-0.3, 0.3), w: rand(3, 7), h: rand(2, 4), color: dc[(Math.random() * dc.length) | 0] });
    }
  }
}
function dust(x, y, n, spd) {
  if (!fight || fight.particles.length > CONFIG.fx.maxParticles) return;
  for (let i = 0; i < n; i++) {
    const dir = Math.random() < 0.5 ? -1 : 1;
    fight.particles.push({ kind: 'dust', x: x + rand(-6, 6), y: y - 2, vx: dir * rand(0.3, 1) * spd, vy: -rand(0.1, 0.7), life: rand(0.35, 0.6), max: 0.6, size: rand(4, 8) });
  }
}
function floatText(x, y, text, color, size) { if (fight) fight.texts.push({ x, y, text, color, size, life: 1 }); }
function setBanner(text, color, dur, sub) { if (fight) fight.banner = { text, color, dur, t: dur, sub: sub || '' }; }

function updateEffects(gdt, dt) {
  const F = fight; if (!F) return;
  const X = CONFIG.fx, A = CONFIG.arena, k = gdt * 60;
  F.particles = F.particles.filter(p => {
    p.life -= gdt;
    if (p.kind === 'spark') { p.x += p.vx * k; p.y += p.vy * k; p.vy += 0.18 * k; p.vx *= 0.98; }
    else if (p.kind === 'debris') {
      p.x += p.vx * k; p.y += p.vy * k; p.vy += 0.28 * k; p.rot += p.vr * k;
      if (p.y > A.floorY - 2 && p.x > F.floorL && p.x < F.floorR && p.vy > 0) { p.y = A.floorY - 2; p.vy *= -0.4; p.vx *= 0.7; p.vr *= 0.6; }
    } else if (p.kind === 'dust') { p.x += p.vx * k; p.y += p.vy * k; p.vx *= 0.95; p.vy *= 0.95; p.size += 0.15 * k; }
    return p.life > 0;
  });
  F.texts = F.texts.filter(t => { t.y -= 0.8 * k; t.life -= gdt * 1.1; return t.life > 0; });
  F.shake *= Math.pow(X.shakeDecay, dt * 60);
  if (F.banner) { F.banner.t -= dt; if (F.banner.t <= 0) F.banner = null; }
  F.robots.forEach(r => {
    r._flash = Math.max(0, (r._flash || 0) - gdt);
    // dust on landings, hops and hard driving
    let low = -1e9; r.wheels.forEach(w => { low = Math.max(low, w.position.y + r.g.r); });
    const px = r.body.position.x, onFloor = low >= A.floorY - 3 && px > F.floorL - 10 && px < F.floorR + 10;
    const vy = r.body.velocity.y;
    if (onFloor && r._air && (r._pvy || 0) > 3.5) r.wheels.forEach(w => dust(w.position.x, A.floorY, 2 + Math.min(4, Math.round(r._pvy * 0.5)), 1.6));
    else if (!onFloor && r._air === false && vy < -3) r.wheels.forEach(w => dust(w.position.x, A.floorY, 2, 1.2));
    else if (onFloor && Math.random() < 0.12 && Math.abs(r.wheels[0].angularVelocity) > 0.22) {
      const w = r.wheels[(r.body.velocity.x * r.f) > 0 ? 1 : 0] || r.wheels[0];
      dust(w.position.x, A.floorY, 1, 0.8);
    }
    r._air = !onFloor; r._pvy = vy;
    // dash afterimages
    const T = r._trail || (r._trail = []);
    if (r.dashT > 0) {
      const c = rectCentre(r), l = T[T.length - 1];
      if (!l || Math.hypot(l.x - c.x, l.y - c.y) > 14) T.push({ x: c.x, y: c.y, a: r.body.angle, life: 1 });
    }
    T.forEach(p => { p.life -= gdt * X.trailFade; });
    while (T.length && T[0].life <= 0) T.shift();
    if (T.length > X.trailMax) T.shift();
  });
}

// front=false: dust (under robots) · front=true: sparks, rings, debris
function drawParticles(F, front) {
  F.particles.forEach(p => {
    const a = clamp(p.life / p.max, 0, 1);
    if (p.kind === 'dust') {
      if (front) return;
      ctx.globalAlpha = a * 0.35; ctx.fillStyle = '#b6bdd4';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
      return;
    }
    if (!front) return;
    if (p.kind === 'debris') {
      ctx.save(); ctx.globalAlpha = clamp(a * 2, 0, 1); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, 1);
      ctx.restore();
      return;
    }
    ctx.globalCompositeOperation = 'lighter';
    if (p.kind === 'spark') {
      ctx.globalAlpha = a; ctx.strokeStyle = p.color; ctx.lineWidth = p.size; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.4, p.y - p.vy * 2.4); ctx.stroke();
      ctx.globalAlpha = a * 0.5; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 1.3, 0, TAU); ctx.fill();
    } else if (p.kind === 'ring') {
      const e = 1 - a;
      ctx.globalAlpha = a * 0.9; ctx.strokeStyle = p.color; ctx.lineWidth = 1 + 5 * a;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.25 + 0.75 * Math.sqrt(e)), 0, TAU); ctx.stroke();
    } else if (p.kind === 'flash') {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
      g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.4, 'rgba(255,220,140,.45)'); g.addColorStop(1, 'rgba(255,160,60,0)');
      ctx.globalAlpha = a; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  });
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
}

function outlinedText(text, x, y, font, color, lw) {
  ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function shade(hex, amt) {
  if (typeof hex !== 'string' || hex[0] !== '#' || hex.length < 7) return hex;
  const n = parseInt(hex.slice(1), 16);
  const ch = s => clamp(Math.round(amt < 0 ? s * (1 + amt) : s + (255 - s) * amt), 0, 255);
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}
