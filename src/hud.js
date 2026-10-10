'use strict';
// ============================================================
// HUD: in-fight HUD, intro countdown, banners, result screen
// OWNS:    drawHUD (health bars, move bar), drawIntro, drawBanner, showResult
// EXPORTS: skewPath, drawHUD, showResult
// READS:   CONFIG, clamp, ctx, fight, AUTO, autoNext, roundRect, outlinedText, esc, shade, TAU
// ============================================================
function skewPath(c, x, y, w, h, sk) {
  c.beginPath(); c.moveTo(x + sk, y); c.lineTo(x + w + sk, y); c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.closePath();
}

function drawHealthBar(r, i, x, y, W, H) {
  const sk = i ? -16 : 16, pct = clamp(r.hp / r.maxHp, 0, 1), ghost = clamp(r.ghost / r.maxHp, 0, 1), low = pct < CONFIG.rageBelow;
  const col = low ? '#ff6b3d' : r.color;
  ctx.save();
  skewPath(ctx, x - 4, y - 4, W + 8, H + 8, sk); ctx.fillStyle = 'rgba(4,6,12,.8)'; ctx.fill();
  skewPath(ctx, x, y, W, H, sk); ctx.fillStyle = '#240c12'; ctx.fill();
  ctx.save(); skewPath(ctx, x, y, W, H, sk); ctx.clip();
  const fx = p => i ? x + W - W * p : x;
  ctx.fillStyle = '#ffe9a0'; ctx.fillRect(fx(ghost), y, W * ghost + 2, H);   // ghost damage
  const hg = ctx.createLinearGradient(0, y, 0, y + H);
  hg.addColorStop(0, shade(col, 0.45)); hg.addColorStop(0.45, col); hg.addColorStop(1, shade(col, -0.5));
  ctx.fillStyle = hg; ctx.fillRect(fx(pct), y, W * pct + 2, H);
  ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(fx(pct), y, W * pct, H * 0.4);
  if (low) { ctx.fillStyle = `rgba(255,255,255,${0.12 + 0.12 * Math.sin(fight.clock * 16)})`; ctx.fillRect(fx(pct), y, W * pct, H); }
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  for (let k = 1; k < 10; k++) ctx.fillRect(x + W * k / 10, y, 1, H);
  ctx.restore();
  skewPath(ctx, x, y, W, H, sk); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
}

function drawHUD() {
  const F = fight, A = CONFIG.arena, X = CONFIG.fx;
  F.robots.forEach((r, i) => {
    const W = 440, H = 24, x = i ? A.w - 38 - W : 38, y = 24, edge = i ? x + W : x, al = i ? 'right' : 'left';
    drawHealthBar(r, i, x, y, W, H);
    const isAI = r.controller === 'ai' || !!r.model, cfg = isAI && CONFIG.ai && CONFIG.ai[r.model] || null;
    const nm = (cfg && cfg.label ? cfg.label : r.name || '').toUpperCase();
    ctx.textBaseline = 'top'; ctx.textAlign = al;
    ctx.font = 'italic 900 19px "Segoe UI", sans-serif'; ctx.lineJoin = 'round';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(nm, edge, y + H + 7);
    ctx.fillStyle = '#fff'; ctx.fillText(nm, edge, y + H + 7);
    let nameW = nm.length * 11.5;
    if (cfg && cfg.tier) {   // tier badge in the model colour
      const label = String(cfg.tier).toUpperCase(), bw = label.length * 7.4 + 14, bx = i ? edge - nameW - bw - 8 : edge + nameW + 8, by = y + H + 9;
      ctx.fillStyle = cfg.color || '#ffd23f'; roundRect(ctx, bx, by, bw, 17, 4); ctx.fill();
      ctx.fillStyle = '#10131e'; ctx.font = '900 11px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + bw / 2, by + 9); ctx.textAlign = al; ctx.textBaseline = 'top';
    } else if (!isAI && r.controller === 'human') {
      const bw = 38, bx = edge + (i ? -nameW - bw - 8 : nameW + 8), by = y + H + 9;
      ctx.fillStyle = r.color; roundRect(ctx, bx, by, bw, 17, 4); ctx.fill();
      ctx.fillStyle = '#10131e'; ctx.font = '900 11px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('YOU', bx + bw / 2, by + 9); ctx.textAlign = al; ctx.textBaseline = 'top';
    }
    ctx.font = '600 11px "Segoe UI", sans-serif'; ctx.fillStyle = '#9aa6c4'; ctx.textAlign = al;
    let info = `${CONFIG.weapons[r.build.weapon].name.toUpperCase()} · ${Math.ceil(r.hp)}/${r.maxHp} HP${r.rage ? ' · RAGE' : ''}`;
    if (!isAI && r.mode) info += ' · ' + r.mode;
    ctx.fillText(info, edge, y + H + 31);
    if (isAI && r.mode) {   // subtle AI "thought"
      ctx.font = 'italic 600 11px "Segoe UI", sans-serif'; ctx.fillStyle = 'rgba(190,205,235,.6)';
      ctx.fillText('thinking: ' + String(r.mode).toUpperCase(), edge, y + H + 46);
    }
  });
  // timer: ring progress + big number
  const tx = A.w / 2, ty = 44, tf = clamp(F.time / CONFIG.fightSeconds, 0, 1), urgent = F.time < 10;
  const tcol = urgent ? '#ff4d5e' : '#ffd23f';
  ctx.fillStyle = 'rgba(4,6,12,.8)'; ctx.beginPath(); ctx.arc(tx, ty, 35, 0, TAU); ctx.fill();
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.beginPath(); ctx.arc(tx, ty, 30, 0, TAU); ctx.stroke();
  ctx.strokeStyle = tcol; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(tx, ty, 30, -Math.PI / 2, -Math.PI / 2 + TAU * tf); ctx.stroke();
  const tp = urgent ? 1 + 0.08 * Math.sin(F.clock * 12) : 1;
  ctx.save(); ctx.translate(tx, ty + 1); ctx.scale(tp, tp);
  outlinedText(String(Math.ceil(F.time)), 0, 0, '900 30px "Segoe UI", sans-serif', urgent ? '#ff4d5e' : '#fff', 3);
  ctx.restore();

  drawMoveBar(F);

  if (F.phase === 'intro') drawIntro(F, A);
  else if (F.banner) drawBanner(F.banner, A);
}

function drawMoveBar(F) {
  const hr = F.robots.find(r => r.controller === 'human');
  if (!hr || !hr.moves) return;
  const A = CONFIG.arena, S = 56, gap = 8, x0 = 38, y0 = A.h - S - 18;
  const names = ['attack', 'dodge', 'block', 'dash'], labels = ['ATTACK', 'DODGE', 'BLOCK', 'DASH'], dk = 'WASD';
  const active = [false, hr.dodgeT > 0, !!hr.blocking, hr.dashT > 0];
  ctx.fillStyle = 'rgba(4,6,12,.55)'; roundRect(ctx, x0 - 10, y0 - 10, 4 * (S + gap) - gap + 20 + 190, S + 20, 10); ctx.fill();
  names.forEach((nm, i) => {
    const m = hr.moves[nm]; if (!m) return;
    const x = x0 + i * (S + gap), ready = !(m.cd > 0), frac = m.max > 0 ? clamp(m.cd / m.max, 0, 1) : 0;
    ctx.save();
    roundRect(ctx, x, y0, S, S, 8); ctx.fillStyle = ready ? '#1b2238' : '#121626'; ctx.fill();
    if (!ready) {
      ctx.save(); roundRect(ctx, x, y0, S, S, 8); ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.beginPath(); ctx.moveTo(x + S / 2, y0 + S / 2);
      ctx.arc(x + S / 2, y0 + S / 2, S, -Math.PI / 2, -Math.PI / 2 + TAU * frac); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    const glow = active[i] ? '#5adcff' : ready ? hr.color : '#3a4258';
    if (ready || active[i]) { ctx.shadowColor = glow; ctx.shadowBlur = active[i] ? 14 : 6; }
    roundRect(ctx, x, y0, S, S, 8); ctx.strokeStyle = glow; ctx.lineWidth = active[i] ? 3 : 2; ctx.stroke();
    ctx.restore();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 22px "Segoe UI", sans-serif'; ctx.fillStyle = ready ? '#fff' : '#6d768f';
    ctx.fillText(m.key || dk[i], x + S / 2, y0 + S / 2 - 6);
    ctx.font = '700 9px "Segoe UI", sans-serif'; ctx.fillStyle = ready ? '#aab6d6' : '#5b647c';
    ctx.fillText(labels[i], x + S / 2, y0 + S - 11);
    if (!ready) { ctx.font = '800 12px "Segoe UI", sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(m.cd.toFixed(1), x + S / 2, y0 + 12); }
  });
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '600 11px "Segoe UI", sans-serif'; ctx.fillStyle = 'rgba(190,205,235,.7)';
  ctx.fillText('← → move', x0 + 4 * (S + gap) + 2, y0 + S / 2 - 14);
  ctx.fillText('↑ hop', x0 + 4 * (S + gap) + 2, y0 + S / 2);
  ctx.fillText('↓ brake', x0 + 4 * (S + gap) + 2, y0 + S / 2 + 14);
}

function drawIntro(F, A) {
  const total = CONFIG.introSeconds, seg = total / 3, n = clamp(Math.ceil(F.introT / seg), 1, 3);
  const p = clamp(1 - (F.introT / seg - (n - 1)), 0, 1);   // 0..1 progress through this digit
  const ease = 1 - Math.pow(1 - clamp((total - F.introT) / 0.6, 0, 1), 3);   // names slide in
  const cy = A.h / 2 - 110;
  ctx.save();
  const dim = ctx.createLinearGradient(0, cy - 70, 0, cy + 260);
  dim.addColorStop(0, 'rgba(0,0,0,0)'); dim.addColorStop(0.25, 'rgba(0,0,0,.4)'); dim.addColorStop(0.75, 'rgba(0,0,0,.4)'); dim.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = dim; ctx.fillRect(0, cy - 70, A.w, 330);
  F.robots.forEach((r, i) => {
    const isAI = r.controller === 'ai' || !!r.model, cfg = isAI && CONFIG.ai && CONFIG.ai[r.model];
    const nm = (cfg && cfg.label ? cfg.label : r.name || '').toUpperCase(), dir = i ? 1 : -1;
    const px = A.w / 2 + dir * (150 + (1 - ease) * 500);
    ctx.save(); ctx.globalAlpha = ease; ctx.textAlign = i ? 'left' : 'right';
    ctx.translate(px, cy); ctx.transform(1, 0, dir * -0.15, 1, 0, 0);
    ctx.textAlign = i ? 'left' : 'right'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.font = 'italic 900 40px "Segoe UI", sans-serif'; ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(nm, 0, 0);
    ctx.fillStyle = r.color; ctx.shadowColor = r.color; ctx.shadowBlur = 14; ctx.fillText(nm, 0, 0); ctx.shadowBlur = 0;
    ctx.font = '700 13px "Segoe UI", sans-serif'; ctx.fillStyle = '#cfd6ea';
    ctx.fillText(CONFIG.weapons[r.build.weapon].name.toUpperCase() + (cfg && cfg.tier ? ' · ' + String(cfg.tier).toUpperCase() : ''), 0, 30);
    ctx.restore();
  });
  ctx.save(); ctx.translate(A.w / 2, cy); ctx.scale(0.8 + ease * 0.2, 0.8 + ease * 0.2); ctx.globalAlpha = ease;
  outlinedText('VS', 0, 0, 'italic 900 52px "Segoe UI", sans-serif', '#ffd23f', 8);
  ctx.restore();
  // countdown digit
  const s = 1 + (1 - p) * 0.9, a = p > 0.75 ? 1 - (p - 0.75) * 4 : 1;
  ctx.translate(A.w / 2, cy + 160); ctx.scale(s, s); ctx.globalAlpha = clamp(a, 0, 1);
  ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 30;
  outlinedText(String(n), 0, 0, 'italic 900 150px "Segoe UI", sans-serif', n === 1 ? '#ff8a1f' : '#ffd23f', 10);
  ctx.restore();
}

function drawBanner(b, A) {
  const age = b.dur - b.t, s = 1 + Math.max(0, 0.4 - age) * 1.5, al = clamp(b.t * 3, 0, 1);
  ctx.save(); ctx.globalAlpha = al; ctx.translate(A.w / 2, A.h / 2 - 60);
  const bh = b.sub ? 130 : 100, bg = ctx.createLinearGradient(0, 0, A.w, 0);
  bg.addColorStop(0, 'rgba(0,0,0,0)'); bg.addColorStop(0.2, 'rgba(0,0,0,.55)'); bg.addColorStop(0.8, 'rgba(0,0,0,.55)'); bg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bg; ctx.fillRect(-A.w / 2, -bh / 2 - 10, A.w, bh);
  ctx.scale(s, s);
  const size = b.text.length > 14 ? 44 : 78;
  ctx.shadowColor = b.color; ctx.shadowBlur = 24;
  outlinedText(b.text, 0, 0, `italic 900 ${size}px "Segoe UI", sans-serif`, b.color, 8);
  ctx.shadowBlur = 0;
  if (b.sub) outlinedText(b.sub, 0, size * 0.75, '700 18px "Segoe UI", sans-serif', '#cfd6ea', 4);
  ctx.restore();
}

// ============================================================
// RESULT SCREEN
// ============================================================
function showResult() {
  const F = fight;
  F.phase = 'result';
  const methods = { KO: 'Knockout · HP reached 0', Pit: 'Ring out · fell into the pit', Flip: 'Flipped · stuck upside down for 5 s', Time: 'Time up · higher HP % wins' };
  const human = F.robots.find(r => r.controller === 'human');
  const label = r => { const c = r.model && CONFIG.ai && CONFIG.ai[r.model]; return (c && c.label) || r.name; };
  const W = F.winner;
  let title, badge, col = W ? W.color : '#ffffff';
  if (!W) { title = 'DRAW!'; badge = 'NO CONTEST'; }
  else if (human) { title = W === human ? 'YOU WIN!' : label(W).toUpperCase() + ' WINS'; badge = W === human ? 'VICTORY' : 'DEFEAT'; }
  else { title = W.name + ' wins!'; badge = 'WINNER'; }
  const w = document.getElementById('resWinner');
  w.textContent = title;
  w.style.color = col;
  w.style.textShadow = `0 0 24px ${col}, 0 0 60px ${col}`;
  const bd = document.getElementById('resBadge');
  if (bd) { bd.textContent = badge; bd.style.color = col; }
  const card = document.getElementById('resCard');
  if (card) { try { card.style.setProperty('--wc', col); } catch (e) {} }
  document.getElementById('resMethod').textContent = methods[F.method] || '';
  const [a, b] = F.robots;
  const rows = [
    ['Damage dealt', r => Math.round(r.stats.dealt)], ['Biggest hit', r => Math.round(r.stats.biggest)],
    ['Hits landed', r => r.stats.hits], ['HP left', r => Math.round(r.hp / r.maxHp * 100)],
  ];
  document.getElementById('resStats').innerHTML =
    `<tr><th></th><th style="color:${esc(a.color)}">${esc(label(a))}</th><th style="color:${esc(b.color)}">${esc(label(b))}</th></tr>` +
    rows.map(([n, f], i) => {
      const va = f(a), vb = f(b), sfx = i === 3 ? '%' : '';
      return `<tr><td class="lbl2">${n}</td><td class="${va > vb ? 'best' : ''}">${va}${sfx}</td><td class="${vb > va ? 'best' : ''}">${vb}${sfx}</td></tr>`;
    }).join('');
  document.getElementById('result').style.display = 'flex';
  if (AUTO) autoNext();
}
