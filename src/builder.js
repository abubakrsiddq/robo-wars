'use strict';
// ============================================================
// BUILDER UI: card-based builder screen, previews, player setup, persistence
// OWNS:    players[], cards, arena choice (getArena/setArena), setModel, localStorage save/load, builder panels, previews, arena picker
// EXPORTS: cards, players, setModel, getArena, setArena, saveChoices, loadChoices, buildPanel, refreshPanel, buildArenaPicker
// READS:   CONFIG, PARTS, drawChassisLocal, drawWheel, drawSpinner, arenaKey, drawArenaThumb
// ============================================================
// ============================================================
// controller: 'human' (keyboard) | 'ai' (CONFIG.ai[model]) | 'strategy' (English text, used by #auto)
const cards = { body: CONFIG.builder.defaults.body, attack: CONFIG.builder.defaults.attack, defence: CONFIG.builder.defaults.defence };
const players = [
  { id: 0, color: '#3aa0ff', facing: 1, name: CONFIG.builder.defaults.name, controller: 'human',
    build: PARTS.fromCards(cards),
    strategy: 'Aggressive. Charge and attack nonstop. Retreat when low.' },
  { id: 1, facing: -1, controller: 'ai', model: CONFIG.builder.defaultModel,
    name: '', color: '', build: {},
    strategy: 'Patient. Wait until they get close, then flip them. Push them into the pit.' },
];

function setModel(model) {
  const m = CONFIG.ai[model]; if (!m) return;
  const p = players[1];
  p.model = model; p.name = m.label; p.color = m.color; p.build = Object.assign({}, m.build);
}

// arena choice: a CONFIG.arenas.list key, or 'random' (a new arena every fight); main.js resolves it when a fight starts
let arenaChoice = CONFIG.arenas.default;
function getArena() { return arenaChoice; }
function setArena(key) { if (CONFIG.arenas.list[key] || key === 'random') arenaChoice = key; }

function saveChoices() {
  try { localStorage.setItem(CONFIG.builder.storageKey, JSON.stringify({ name: players[0].name, cards, model: players[1].model, arena: arenaChoice })); } catch (e) {}
}
function loadChoices() {
  try {
    const d = JSON.parse(localStorage.getItem(CONFIG.builder.storageKey) || 'null'); if (!d) return;
    if (typeof d.name === 'string' && d.name) players[0].name = d.name.slice(0, 18);
    ['body', 'attack', 'defence'].forEach(k => { if (d.cards && CONFIG.builder[k][d.cards[k]]) cards[k] = d.cards[k]; });
    if (CONFIG.ai[d.model]) players[1].model = d.model;
    setArena(d.arena);
  } catch (e) {}
  players[0].build = PARTS.fromCards(cards);
}

// ---- stat bars: normalised across the cards of the same row, so they follow CONFIG ----
function rawStats(cat, card) {
  const C = CONFIG;
  if (cat === 'body') {
    const ch = C.chassis[card.chassis], wh = C.wheels[card.wheels];
    return { Speed: ch.speed * wh.maxSpin, Grip: ch.mass * wh.friction, Tough: ch.hp };
  }
  if (cat === 'attack') {
    const w = C.weapons[card.weapon], v = C.builder.typicalSpeed;
    const hit = { spinner: w.base + w.mul * v, hammer: w.damage, flipper: w.damage + w.launch * 0.8, ram: w.mul * v }[card.weapon];
    return { Power: hit, Rate: 1 / (w.hitCooldown || w.cooldown), Reach: w.reach };
  }
  const n = card.armour;
  return { Tough: 1 / (1 - C.armour.reduction * n), Speed: 1 / (1 + C.armour.mass * n * 0.1) };
}
function statBars(cat, key) {
  const row = CONFIG.builder[cat], me = rawStats(cat, row[key]), all = Object.values(row).map(c => rawStats(cat, c));
  return Object.keys(me).map(k => {
    const mx = Math.max(...all.map(a => a[k])), mn = Math.min(...all.map(a => a[k]));
    const v = mx === mn ? 0.6 : 0.25 + 0.75 * (me[k] - mn) / (mx - mn);
    return `<div class="stat"><span>${k}</span><i><u style="width:${Math.round(v * 100)}%"></u></i></div>`;
  }).join('');
}
function cardRow(cat) {
  return Object.entries(CONFIG.builder[cat]).map(([k, c]) =>
    `<button class="pick" data-cat="${cat}" data-key="${k}"><span class="ic">${c.icon}</span><b>${c.name}</b><small>${c.desc}</small>${statBars(cat, k)}</button>`).join('');
}

function buildPanel(i) {
  const el = document.getElementById('panel' + i);
  if (i === 0) {
    el.innerHTML = `
      <h2>Your Robot</h2>
      <div class="row"><input class="name" maxlength="18" spellcheck="false"><button class="small-btn rand" title="Random name">\u{1F3B2}</button></div>
      <canvas class="preview" width="540" height="124"></canvas>
      <div class="group"><span class="lbl">Body</span><div class="cards">${cardRow('body')}</div></div>
      <div class="group"><span class="lbl">Attack</span><div class="cards">${cardRow('attack')}</div></div>
      <div class="group"><span class="lbl">Defence</span><div class="cards">${cardRow('defence')}</div></div>`;
    el.querySelector('.name').value = players[0].name;
    el.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('button'); if (!b) return;
      if (b.classList.contains('pick')) cards[b.dataset.cat] = b.dataset.key;
      else if (b.classList.contains('rand')) { players[0].name = PARTS.randomName(); el.querySelector('.name').value = players[0].name; }
      else return;
      players[0].build = PARTS.fromCards(cards);
      refreshPanel(0); saveChoices();
    });
    el.querySelector('.name').addEventListener('input', e => { players[0].name = e.target.value || 'Robot'; saveChoices(); });
  } else {
    el.innerHTML = `<h2>Opponent</h2>` + Object.entries(CONFIG.ai).map(([k, m]) =>
      `<button class="pick foe" data-model="${k}" style="--c:${m.color}"><canvas width="192" height="112"></canvas>` +
      `<div class="tx"><b>${m.label}</b><span class="tier" style="background:${m.color}">${m.tier}</span></div>` +
      `<small style="grid-column:1/3">${m.desc}</small></button>`).join('');
    el.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('button.pick'); if (!b) return;
      setModel(b.dataset.model); refreshPanel(1); saveChoices();
    });
  }
}

function refreshPanel(i) {
  const p = players[i], el = document.getElementById('panel' + i);
  if (i === 0) {
    el.querySelectorAll('.pick').forEach(b => b.classList.toggle('sel', cards[b.dataset.cat] === b.dataset.key));
    drawPreview(el.querySelector('canvas.preview'), p, 1.25);
  } else {
    el.querySelectorAll('.pick').forEach(b => {
      b.classList.toggle('sel', b.dataset.model === p.model);
      const m = CONFIG.ai[b.dataset.model];
      drawPreview(b.querySelector('canvas'), { build: m.build, facing: -1, color: m.color }, 0.8);
    });
  }
}

// k = drawing scale. Calls the robot draw helpers (signatures are stable).
function drawPreview(cv, p, k) {
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const g = PARTS.geometry(p.build, p.facing), floorY = cv.height * 0.86;
  ctx.fillStyle = '#2a3150'; ctx.fillRect(10, floorY, cv.width - 20, 3);
  ctx.save();
  ctx.translate(cv.width / 2, floorY - g.ground * k);
  ctx.scale(k, k);
  drawChassisLocal(ctx, p.build, g, p.color, { hammer: CONFIG.hammerAngles.rest, flip: 0 });
  g.wheels.forEach(w => drawWheel(ctx, w.x, w.y, g.r, 0));
  if (g.spinner) drawSpinner(ctx, g.spinner.x, g.spinner.y, g.spinner.r, 0.3, 0);
  ctx.restore();
}

// ---- arena picker: a row of cards with a thumbnail rendered from each arena's backdrop ----
function buildArenaPicker() {
  const el = document.getElementById('arenaPick'); if (!el) return;
  el.innerHTML = '<span class="lbl">Arena</span><div class="arenas">' + Object.entries(CONFIG.arenas.list).map(([k, a]) =>
    `<button class="pick arena-opt" data-arena="${k}" style="--c:${a.accent}"><canvas width="240" height="120"></canvas>` +
    `<b>${a.name}</b><small>${a.place}</small></button>`).join('') +
    '<button class="pick arena-opt arena-rand" data-arena="random"><div class="rand-thumb">\u{1F3B2}</div>' +
    '<b>Random</b><small>A new arena every fight</small></button></div>';
  el.querySelectorAll('.arena-opt').forEach(b => { const cv = b.querySelector('canvas'); if (cv) drawArenaThumb(cv, b.dataset.arena); });
  el.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button.arena-opt'); if (!b) return;
    setArena(b.dataset.arena); refreshArenaPicker(); saveChoices();
  });
  refreshArenaPicker();
}
function refreshArenaPicker() {
  const el = document.getElementById('arenaPick'), k = arenaChoice === 'random' ? 'random' : arenaKey(arenaChoice); if (!el) return;
  el.querySelectorAll('.arena-opt').forEach(b => b.classList.toggle('sel', b.dataset.arena === k));
}
