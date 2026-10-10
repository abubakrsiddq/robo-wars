'use strict';
// ============================================================
// FIGHT LOOP + BOOT: per-fight lifecycle, fixed-step loop, state for decide(), render pipeline, wiring, #auto mode
// OWNS:    fight (the live fight object), rafId, AUTO flags, startFight/teardown/backToBuilder, frame/step, buildState, controlRobot, render, DOM button wiring, auto-mode loop
// EXPORTS: fight, AUTO, AUTO_AI, STEP, startFight, backToBuilder, buildState, controlRobot, render, autolog, autoNext
// READS:   CONFIG, PARTS, DPR, arenaKey, getArena, setArena, buildArenaPicker, Events, Composite, Engine, performance, STRATEGY_PRESETS, pick, createRobot, createArenaWorld, handlePair, checkWin, getAction, applyAction, tickMoves, hammerImpact, INPUT, IDLE_ACTION, updateEffects, setBanner, showResult, drawArena, drawParticles, drawRobot, drawHUD, outlinedText, ctx, clamp, rand, players, setModel, loadChoices, buildPanel, refreshPanel, Body, isGrounded
// ============================================================
let fight = null, rafId = null;
const AUTO = location.hash.includes('auto');
const AUTO_AI = /^#auto\d*ai/.test(location.hash);   // #auto30ai: AI vs AI; #auto30aisame: same random build for both
const STEP = 1 / 60;
const ARENA_HASH = (/arena=(\w+)/.exec(location.hash) || [])[1] || '';   // e.g. index.html#arena=hampi&fight
let autoAiK = 0;

// AI-vs-AI harness: cycle through every ordered pair of different models so each side plays each matchup
function setupAutoAI() {
  const keys = Object.keys(CONFIG.ai), pairs = [];
  keys.forEach(a => keys.forEach(b => a !== b && pairs.push([a, b])));
  const pr = pairs[autoAiK++ % pairs.length];
  const same = location.hash.includes('aisame') ? PARTS.randomBuild() : null;
  players.forEach((p, i) => {
    p.controller = 'ai'; p.model = pr[i];
    p.build = { ...(same || CONFIG.ai[p.model].build) };
    p.name = CONFIG.ai[p.model].label;
  });
}

function startFight() {
  teardown();
  if (AUTO_AI) setupAutoAI();
  const A = CONFIG.arena;
  const { engine, floorL, floorR } = createArenaWorld();
  const r1 = createRobot(players[0], A.w / 2 - A.spawnOffset), r2 = createRobot(players[1], A.w / 2 + A.spawnOffset);
  [r1, r2].forEach(r => Composite.add(engine.world, [...r.all, ...r.cons]));

  fight = {
    engine, robots: [r1, r2], floorL, floorR, phase: 'intro', introT: CONFIG.introSeconds,
    time: CONFIG.fightSeconds, clock: 0, stall: 0, koT: 0, slow: false, winner: null, method: '',
    shake: 0, particles: [], texts: [], banner: null, last: performance.now(), acc: 0,
    arena: fightArena(),
  };
  setBanner(`${r1.name}  VS  ${r2.name}`, '#ffffff', 1.4, 'ROUND 1');
  Events.on(engine, 'collisionStart', e => e.pairs.forEach(pr => handlePair(pr, false)));
  Events.on(engine, 'collisionActive', e => e.pairs.forEach(pr => handlePair(pr, true)));
  document.getElementById('builderScreen').style.display = 'none';
  document.querySelector('header').style.display = 'none';
  document.getElementById('result').style.display = 'none';
  const ar = CONFIG.arenas.list[fight.arena];
  document.getElementById('arenaName').textContent = ar.name + ' · ' + ar.place;
  document.getElementById('fightScreen').style.display = 'block';
  if (AUTO) { const f = fight; setTimeout(() => fight === f && frame(0), 0); } else rafId = requestAnimationFrame(frame);
}

// Arena for this fight: the builder choice. #auto runs pick a random arena unless #...arena=<key> pins one.
function fightArena() {
  if (AUTO && !ARENA_HASH) return pick(Object.keys(CONFIG.arenas.list));
  return arenaKey(getArena());
}

function teardown() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (fight) { Events.off(fight.engine); Composite.clear(fight.engine.world, false); Engine.clear(fight.engine); }
  fight = null;
}

function backToBuilder() {
  teardown();
  document.getElementById('result').style.display = 'none';
  document.getElementById('fightScreen').style.display = 'none';
  document.getElementById('builderScreen').style.display = 'grid';
  document.querySelector('header').style.display = 'block';
  refreshPanel(0); refreshPanel(1);
}

function frame(now) {
  if (!fight) return;
  if (AUTO) {   // headless test mode: fast-forward with fixed steps, no rAF
    for (let i = 0; i < 30 && fight; i++) step(STEP);
    if (fight) { render(); const f = fight; setTimeout(() => fight === f && frame(0), 0); }
    return;
  }
  const dt = Math.min(0.05, (now - fight.last) / 1000);
  fight.last = now;
  fight.acc += dt;
  let n = 0;
  while (fight && fight.acc >= STEP && n < 4) { step(STEP); fight && (fight.acc -= STEP); n++; }
  if (!fight) return;
  if (n === 4) fight.acc = 0;
  render();
  rafId = requestAnimationFrame(frame);
}

function step(dt) {
  const F = fight;
  const ts = (F.phase === 'ko' && F.slow) ? CONFIG.slowMo.scale : 1;
  F.engine.timing.timeScale = ts;
  const gdt = dt * ts;
  F.clock += gdt;

  if (F.phase === 'intro') {
    F.introT -= dt;
    if (F.introT <= 0) { F.phase = 'fight'; setBanner('FIGHT!', '#ffd23f', 0.9); }
  }
  for (const k in INPUT.buffer) INPUT.buffer[k] -= dt;
  F.robots.forEach((r, i) => controlRobot(r, F.robots[1 - i], gdt));
  Engine.update(F.engine, 1000 / 60);

  if (F.phase === 'fight') {
    F.time = Math.max(0, F.time - dt);
    F.stall += dt;
    if (Math.abs(F.stall - CONFIG.stallSeconds) < dt / 2) setBanner('REF: FIGHT!', '#ff8a1f', 0.9, 'both bots get impatient');
    checkWin();
  } else if (F.phase === 'ko') {
    F.koT -= dt;
    if (F.koT <= 0) showResult();
  }
  updateEffects(gdt, dt);
}

function buildState(r, en) {
  const snap = x => ({
    x: x.body.position.x, y: x.body.position.y, vx: x.body.velocity.x, vy: x.body.velocity.y, angle: x.body.angle,
    health: x.hp, maxHealth: x.maxHp, hpPct: x.hp / x.maxHp, facing: x.f, flipped: x.flipped, rage: x.rage, weapon: x.build.weapon,
    grounded: isGrounded(x), blocking: x.blocking, blockHold: x.blockHold, dashT: x.dashT, dodgeT: x.dodgeT,
    spinFrac: x.spinner ? x.spin / CONFIG.weapons.spinner.spinMax : 0,
    attacking: (x.hammerT >= 0 && x.hammerT < CONFIG.weapons.hammer.anim.strike) || x.boostT > 0 || x.dashT > 0 || x.revT > 0,
    moves: { attack: x.moves.attack.cd, dodge: x.moves.dodge.cd, block: x.moves.block.cd, dash: x.moves.dash.cd,
             attack2: x.moves.attack2 ? x.moves.attack2.cd : 0 },
    weapon2: x.build.weapon2 || null,
  });
  const me = snap(r), enemy = snap(en), dx = enemy.x - me.x;
  return {
    me, enemy, dx, distance: Math.abs(dx), enemyInFront: dx * r.f > 0, isEnemyFlipped: en.flipped,
    weaponReady: r.cooldown <= 0, weaponRange: r.g.w / 2 + CONFIG.weapons[r.build.weapon].reach + en.g.w / 2,
    enemyRange: en.g.w / 2 + CONFIG.weapons[en.build.weapon].reach + r.g.w / 2,
    weapon2Range: r.build.weapon2 ? r.g.w / 2 + CONFIG.weapons[r.build.weapon2].reach + en.g.w / 2 : 0,
    meInEnemyFront: -dx * en.f > 0, closing: -(enemy.vx - me.vx) * (Math.sign(dx) || 1),
    time: fight.clock, stallTime: fight.stall, arena: { left: fight.floorL, right: fight.floorR },
  };
}

// Per-tick robot update: timers, weapon animation, then one action through applyAction.
function controlRobot(r, en, gdt) {
  const F = fight, b = r.build, wp = CONFIG.weapons[b.weapon];
  r.cooldown = Math.max(0, r.cooldown - gdt);
  r.boostT = Math.max(0, r.boostT - gdt);
  r.flipped = Math.cos(r.body.angle) < -0.1;
  r.flippedTime = (r.flipped && F.phase === 'fight') ? r.flippedTime + gdt : 0;
  if (r.ghost > r.hp) r.ghost = Math.max(r.hp, r.ghost - Math.max(0.25, (r.ghost - r.hp) * 0.04));

  if (r.spinner) {
    r.spin = Math.min(wp.spinMax, r.spin + wp.spinUp * r.overdrive);
    Body.setAngularVelocity(r.spinner, -r.f * r.spin);   // front of drum moves upward -> launches
  }
  if (r.hammerT >= 0) {   // hammer/flipper timings come from their own CONFIG (either may be weapon2)
    const hA = CONFIG.weapons.hammer.anim, prev = r.hammerT; r.hammerT += gdt;
    if (prev < hA.strike && r.hammerT >= hA.strike) hammerImpact(r, en);
    if (r.hammerT > hA.strike + hA.hold + hA.back) r.hammerT = -1;
  }
  if (r.flipT >= 0) { r.flipT += gdt; const fA = CONFIG.weapons.flipper.anim; if (r.flipT > fA.strike + fA.hold + fA.back) r.flipT = -1; }
  tickMoves(r, gdt);

  const act = F.phase === 'fight' ? getAction(r, en) : IDLE_ACTION;
  r.mode = act.mode || '';
  applyAction(r, en, act);
}

// ---- render pipeline: arena -> particles -> robots -> texts -> HUD ----
function render() {
  const F = fight, X = CONFIG.fx;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);   // canvas backing store is DPR x CONFIG.arena size
  ctx.save();
  if (F.shake > 0.3) ctx.translate(rand(-F.shake, F.shake), rand(-F.shake, F.shake));
  drawArena();
  drawParticles(F, false);
  F.robots.forEach(drawRobot);
  drawParticles(F, true);
  F.texts.forEach(t => {
    const pop = 1 + Math.max(0, t.life - 0.85) * 4;
    ctx.save(); ctx.globalAlpha = clamp(t.life * 1.5, 0, 1); ctx.translate(t.x, t.y); ctx.scale(pop, pop);
    outlinedText(t.text, 0, 0, `900 ${Math.round(t.size)}px "Segoe UI", sans-serif`, t.color, 4);
    ctx.restore();
  });
  ctx.globalAlpha = 1;
  ctx.restore();
  drawHUD();
}

// ============================================================
// BOOT (+ #auto headless test mode: random matches, results logged to the page)
// ============================================================
document.getElementById('fightBtn').addEventListener('click', startFight);
document.getElementById('rematchBtn').addEventListener('click', startFight);
document.getElementById('backBtn').addEventListener('click', backToBuilder);
document.getElementById('abortBtn').addEventListener('click', backToBuilder);
// #auto harness hook (button is hidden): random builds for both sides, English-strategy controllers
document.getElementById('randomMatchBtn').addEventListener('click', () => {
  players.forEach(p => {
    p.build = PARTS.randomBuild(); p.name = PARTS.randomName(); p.strategy = pick(STRATEGY_PRESETS).text; p.ready = true;
    p.controller = 'strategy';
  });
  startFight();
});
if (!AUTO) loadChoices();
if (ARENA_HASH && CONFIG.arenas.list[ARENA_HASH]) setArena(ARENA_HASH);
setModel(players[1].model);
buildPanel(0); buildPanel(1); refreshPanel(0); refreshPanel(1);
buildArenaPicker();
if (!AUTO && /\bfight\b/.test(location.hash)) startFight();   // #arena=<key>&fight opens a fight directly

let autoCount = 0;
function autolog(s) { document.getElementById('autolog').textContent += s + '\n'; }
function autoNext() {
  const F = fight;
  autolog(`#${++autoCount} ${F.robots.map(r => `${r.build.chassis}/${r.build.wheels}/${r.build.weapon}/a${r.build.armour} ${Math.round(r.hp)}hp`).join(' vs ')}` +
          ` -> ${F.winner ? 'P' + (F.winner.player.id + 1) + ' ' + F.winner.build.weapon : 'draw'} by ${F.method} at ${Math.round(CONFIG.fightSeconds - F.time)}s` +
          (F.method === 'Pit' ? ` (loser mode ${F.robots.find(r => r !== F.winner).mode}, hit ${(F.clock - F.robots.find(r => r !== F.winner).lastHitAt).toFixed(1)}s ago)` : ''));
  if (autoCount >= (parseInt(location.hash.slice(5)) || 8)) { document.title = 'AUTODONE'; return; }
  setTimeout(() => document.getElementById('randomMatchBtn').click(), 300);
}
if (AUTO) {
  window.addEventListener('error', e => autolog('ERROR ' + e.message + ' @' + e.lineno));
  document.getElementById('randomMatchBtn').click();
}
