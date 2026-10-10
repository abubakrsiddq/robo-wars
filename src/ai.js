'use strict';
// ============================================================
// STRATEGY: English strategy -> behaviour, fallback brain, per-model AI brains
// OWNS:    STRATEGY_PRESETS, strategyToBehaviour (TODO Claude API hook), FALLBACK, aiBehaviour (decide() returning actions)
// EXPORTS: STRATEGY_PRESETS, strategyToBehaviour, FALLBACK, aiBehaviour
// READS:   CONFIG, clamp, lerp, rand, pick
// ============================================================
const STRATEGY_PRESETS = [
  { label: 'Berserker',   text: 'Aggressive! Rush them nonstop and never back down.' },
  { label: 'Turtle',      text: 'Defensive. Keep distance and wait. Attack when they get close. Retreat when low.' },
  { label: 'Executioner', text: 'Patient. Stay back until they are flipped, then smash them.' },
  { label: 'Ring-Out',    text: 'Charge and push them into the pit. Reckless.' },
  { label: 'Trickster',   text: 'Bait and juke at 200px, finish them off when they are weak. Avoid the edge.' },
];

function strategyToBehaviour(text) {
  // TODO: replace with Claude API call that returns a decide() function
  let t = ' ' + (text || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
  const p = { aggression: 0.55, preferredDistance: 150, attackWhen: 'always', retreatBelowHealth: 0,
              edgeCaution: 0.6, pitPush: false, feint: false };
  const tags = [];

  // Retreat clause first, then strip it so "low" isn't read as "enemy low health"
  const rm = t.match(/(retreat|run away|run|back off|flee|escape|fall back)[^.!;,]*?(?:(\d{1,2})\s*%|low|hurt|damaged|weak|losing)/);
  if (rm) {
    p.retreatBelowHealth = rm[2] ? clamp(+rm[2] / 100, 0.05, 0.9) : 0.3;
    tags.push('retreat clause'); t = t.replace(rm[0], ' ');
  }
  const neg = t.match(/(don'?t|do not|never|no)\s+(rush|charge|attack|be aggressive)/);
  if (neg) { p.aggression -= 0.3; tags.push('negated "' + neg[2] + '"'); t = t.replace(neg[0], ' '); }

  const aggro = t.match(/aggress|charge|rush|berserk|relentless|all.?out|hunt|destroy|smash|full speed|go hard|wreck|attack|pressure|nonstop|non-stop/g) || [];
  const def = t.match(/defen|careful|cautious|patient|wait|keep (my |a |our )?distance|stay (away|back)|kite|hold back|safe|turtle|bait/g) || [];
  p.aggression = clamp(p.aggression + 0.17 * aggro.length - 0.17 * def.length, 0, 1);
  if (aggro.length) tags.push('aggro: ' + [...new Set(aggro)].join(', '));
  if (def.length) { tags.push('defensive: ' + [...new Set(def)].join(', ')); p.preferredDistance = 240 + 25 * (def.length - 1); }
  if (aggro.length > def.length) p.preferredDistance = 60;
  const px = t.match(/(\d{2,3})\s*(px|pixels)/);
  if (px) { p.preferredDistance = clamp(+px[1], 40, 450); tags.push(px[1] + 'px'); }

  // Attack gate, highest priority first
  if (/(they|enemy|opponent|it|he)\s*(are|is|get|gets|got|'re|'s)?\s*(flipped|upside|on (its|their|his) back|turned over)/.test(t) ||
      /(when|once|after|until|if)\s*(they|enemy|opponent|it)?\s*flips?\b/.test(t)) p.attackWhen = 'enemyFlipped';
  else if (/(they|enemy|opponent|it)\s*(are|is|get|gets|'re)?\s*(low|weak|hurt|damaged|almost dead|dying)|finish (them|him|it|her) off|go for the kill/.test(t)) p.attackWhen = 'enemyLowHealth';
  else if (/(they|enemy|opponent|it)\s*(are|is|get|gets|come|comes|'re)?\s*(close|near|in range)|counter.?attack|up close/.test(t)) p.attackWhen = 'enemyClose';
  if (p.attackWhen !== 'always') tags.push('gate: ' + p.attackWhen);

  if (/(push|shove|knock|ram)[^.!;]*(pit|edge|off|out)|ring.?out/.test(t)) { p.pitPush = true; tags.push('pit push'); }
  if (/(avoid|careful|stay away from|watch|mind)[^.!;]*(pit|edge)/.test(t)) { p.edgeCaution = 1; tags.push('edge-aware'); }
  else if (/reckless|yolo|crazy|fearless/.test(t)) { p.edgeCaution = 0.15; tags.push('reckless'); }
  if (/feint|juke|bait|fake|dodge|zig.?zag|trick/.test(t)) { p.feint = true; tags.push('feints'); }
  if (!tags.length) tags.push('no keywords: balanced defaults');

  function decide(s) {
    const me = s.me, en = s.enemy;
    const toward = (Math.sign(s.dx) || 1) * me.facing;           // +1 = enemy is on my weapon side
    const impatient = s.stallTime > CONFIG.stallSeconds;
    const aggr = clamp(p.aggression + (impatient ? 0.3 : 0) + (me.rage ? 0.15 : 0), 0, 1);
    const closeRange = Math.max(s.weaponRange + 30, Math.min(p.preferredDistance * 0.7, 170));

    let engage;
    switch (p.attackWhen) {
      case 'enemyClose':     engage = s.distance < closeRange; break;
      case 'enemyFlipped':   engage = s.isEnemyFlipped; break;
      case 'enemyLowHealth': engage = en.hpPct < 0.35; break;
      default:               engage = true;
    }
    if (impatient) engage = true;
    const losing = p.retreatBelowHealth > 0 && me.hpPct < p.retreatBelowHealth && me.hpPct < en.hpPct;
    let mode = (losing && !impatient) ? 'RETREAT' : engage ? 'ENGAGE' : 'HOLD';

    let drive;
    if (mode === 'ENGAGE') {
      drive = toward * (0.45 + 0.55 * aggr);
      if (p.feint && s.distance > 180) drive *= 0.75 + 0.5 * Math.sin(s.time * 6);
      const enRoom = Math.min(en.x - s.arena.left, s.arena.right - en.x);
      if (p.pitPush && enRoom < 200 && s.distance < 260) { drive = toward; mode = 'RING-OUT'; }
    } else if (mode === 'HOLD') {
      const target = p.preferredDistance * (1.25 - 0.5 * aggr);
      drive = toward * clamp((s.distance - target) / 90, -1, 1) * 0.8;
      if (p.feint) drive += 0.45 * Math.sin(s.time * 4.5);
    } else {
      drive = -toward * (s.distance < 320 ? 0.9 : 0.2);
    }

    // Edge awareness: don't drive into a pit unless shoving the enemy over it
    const worldDir = Math.sign(drive * me.facing);
    const room = worldDir > 0 ? s.arena.right - me.x : me.x - s.arena.left;
    const margin = 70 + 110 * p.edgeCaution;
    const shoving = toward * Math.sign(drive) > 0 && s.distance < 160 && Math.sign(s.dx) === worldDir;
    if (worldDir !== 0 && room < margin && !(shoving && room > (p.pitPush ? 12 : 45))) {
      drive = -Math.sign(drive) * 0.5;
      mode = (mode === 'HOLD' || mode === 'RETREAT') && s.distance < 220 ? 'CORNERED' : 'EDGE';
    }

    let fire = false;
    if (s.weaponReady) {
      const inRange = s.enemyInFront && s.distance < s.weaponRange;
      if (me.flipped) fire = true;                                      // self-right attempt
      else if (me.weapon === 'ram') fire = mode !== 'HOLD' && toward > 0 && s.distance > s.weaponRange && s.distance < 320;
      else fire = inRange && (mode !== 'HOLD' || s.distance < s.weaponRange * 0.9);
    }
    return { drive: clamp(drive, -1, 1), fire, mode };
  }

  return { params: p, tags, decide };
}

// Used whenever a strategy's decide() throws or returns garbage
const FALLBACK = {
  decide(s) {
    const toward = (Math.sign(s.dx) || 1) * s.me.facing;
    return { drive: toward * 0.7, fire: s.weaponReady && s.enemyInFront && s.distance < s.weaponRange, mode: 'FALLBACK' };
  },
};

// ---- AI BRAINS: one behaviour profile per Claude model (tuned in CONFIG.ai[model]) ----------
// decide(state) returns the extended action { drive (screen dir -1..1), jump, attack, dodge, block, dash, brake, mode }.
// The brain sees the enemy through a reaction-delay buffer and re-plans every decisionInterval. It uses
// the exact same action interface (and therefore the same cooldowns and physics) as the keyboard player.
function aiBehaviour(modelKey) {
  const P = CONFIG.ai[modelKey] || CONFIG.ai.sonnet, C = CONFIG.controls;
  const hist = [];
  const mem = { next: -1, plan: null, mistakeT: 0, mistakeDrive: 0, threat: false, defend: null,
                aggroRoll: Math.random(), aggroNext: 0, punishing: false, phase: Math.random() * 6 };
  const perSec = (rate, dt) => 1 - Math.exp(-rate * dt);   // chance per decision from a rate per second

  // Enemy seen `reaction` seconds late, optionally extrapolated forward by its velocity (`predict`)
  function perceive(s) {
    hist.push(s);
    const lag = Math.max(1, Math.round(P.reaction * 60));
    while (hist.length > lag + 1) hist.shift();
    const en = hist[0].enemy, ahead = (hist.length - 1) * P.predict;
    const ex = en.x + en.vx * ahead, dx = ex - s.me.x, dir = Math.sign(dx) || s.me.facing;
    return { ...s, enemy: { ...en, x: ex }, dx, distance: Math.abs(dx), enemyInFront: dx * s.me.facing > 0,
             meInEnemyFront: -dx * en.facing > 0, closing: -(en.vx - s.me.vx) * dir, isEnemyFlipped: en.flipped };
  }

  function think(s, dt) {
    const me = s.me, en = s.enemy, A = s.arena, W = me.weapon;
    const out = { drive: 0, jump: false, attack: false, dodge: false, block: false, dash: false, brake: false, mode: '' };
    const toward = Math.sign(s.dx) || me.facing;
    const dist = s.distance + (Math.random() * 2 - 1) * P.aimError;
    const myRange = s.weaponRange, enRange = s.enemyRange;
    const ready = me.moves.attack <= 0, enCd = en.moves.attack;
    const enDanger = !en.flipped && (en.weapon === 'spinner' ? en.spinFrac > 0.4 : enCd <= 0.15);
    const roomBack = toward > 0 ? me.x - A.left : A.right - me.x;      // floor behind me (away from enemy)
    const enRoomBack = toward > 0 ? A.right - en.x : en.x - A.left;    // floor behind the enemy
    const impatient = s.stallTime > CONFIG.stallSeconds;
    const lead = W === 'hammer' ? 10 * P.predict : 2 * P.predict;       // hammer lands ~10 steps after the swing
    const futureDist = dist - Math.max(-3, s.closing) * lead;
    const inRange = s.enemyInFront && futureDist < myRange;

    if (me.flipped) { out.attack = ready; out.drive = 0; out.mode = 'RECOVER'; return out; }

    // ---- defence: roll once per threat (a telegraphed attack), not every tick
    const threat = s.meInEnemyFront && !en.flipped &&
      (en.attacking || (enDanger && dist < enRange + Math.max(0, s.closing) * 12 + 10));
    if (threat && !mem.threat) {
      mem.defend = null;
      if (Math.random() < P.defendRate) {
        const dodgeSafe = P.pitMargin < 60 || roomBack > C.dodge.safeRoom + P.pitMargin * 0.3;
        if (me.moves.dodge <= 0 && dodgeSafe && Math.random() < P.dodgeBias) mem.defend = 'dodge';
        else if (me.moves.block <= 0 && me.blockHold < 1 - C.block.minStamina) mem.defend = 'block';
      }
    }
    mem.threat = threat;
    if (!threat) mem.defend = null;

    // ---- intent
    if (s.time >= mem.aggroNext) { mem.aggroRoll = Math.random(); mem.aggroNext = s.time + rand(0.6, 1.1); }
    const punishWin = !enDanger && !en.blocking && enCd > 0.35;
    if (!punishWin) mem.punishing = false;
    else if (!mem.punishing && P.punish > 0 && Math.random() < perSec(P.punish * 6, dt)) mem.punishing = true;
    const outranging = myRange > enRange + 8;
    let mode;
    if (en.flipped) mode = 'EXECUTE';
    else if (P.retreatBelow && me.hpPct < P.retreatBelow && me.hpPct < en.hpPct && !impatient) mode = 'RETREAT';
    else if (mem.punishing && ready) mode = 'PUNISH';
    else if (P.readsBlock && en.blocking) mode = 'BAIT';
    else if (P.pitPush && enRoomBack < P.pitPushRoom && dist < 260) mode = 'RING-OUT';
    else if (ready && (mem.aggroRoll < P.aggression || impatient)) mode = 'PRESSURE';
    else mode = outranging && ready ? 'POKE' : 'SPACING';

    // ---- movement: drive toward a target distance
    const attackDist = W === 'spinner' || W === 'ram' ? 0 : myRange * 0.7;
    let target;
    switch (mode) {
      case 'EXECUTE': case 'PUNISH': case 'PRESSURE': case 'RING-OUT': target = attackDist; break;
      case 'RETREAT': target = 320; break;
      case 'POKE': target = myRange - 8; break;
      default: target = Math.max(enRange + P.spacing, W === 'ram' ? 200 : 0) + (mode === 'BAIT' ? 20 * Math.sin(s.time * 4 + mem.phase) : 0);
    }
    if (W === 'ram' && !ready && mode !== 'EXECUTE' && mode !== 'RING-OUT') { target = 210; mode = 'RELOAD'; }
    out.drive = toward * clamp((dist - target) / P.spacingGain, -1, 1);
    if (P.wobble) out.drive = clamp(out.drive + P.wobble * Math.sin(s.time * 3.1 + mem.phase), -1, 1);
    if (mode === 'RING-OUT' && dist < myRange + 40) out.drive = toward;

    // ---- mistakes (mostly Haiku): wander off for a moment
    if (mem.mistakeT > 0) { mem.mistakeT -= dt; out.drive = mem.mistakeDrive; mode = 'OOPS'; }
    else if (Math.random() < perSec(P.mistakeRate, dt)) { mem.mistakeT = rand(0.3, 0.9); mem.mistakeDrive = pick([-1, -0.6, 0, 0.6, 1]); }

    // ---- defence actions
    if (mem.defend === 'dodge' && me.moves.dodge <= 0) { out.dodge = true; mem.defend = 'done'; mode = 'DODGE'; }
    else if (mem.defend === 'block' && me.blockHold < 0.92) { out.block = true; out.drive *= 0.3; mode = 'BLOCK'; }

    // ---- attacks
    const engaged = mode !== 'SPACING' && mode !== 'RETREAT' && mode !== 'RELOAD' && mode !== 'BAIT';
    if (ready && !out.block && !out.dodge) {
      const intoBlock = P.readsBlock && en.blocking && !(W === 'hammer' && en.flipped);
      if (W === 'ram') {
        out.attack = engaged && s.enemyInFront && dist > myRange + 10 && dist < 320 && !intoBlock;
      } else if (W === 'spinner') {
        out.attack = (engaged || dist < myRange) && me.spinFrac < 0.7 && dist < myRange + 70;
      } else {
        out.attack = !intoBlock && s.enemyInFront && futureDist < myRange + P.fireSlop * Math.random() &&
                     (inRange || P.fireSlop > 0);
      }
      if (!out.attack && Math.random() < perSec(P.randomFire, dt)) out.attack = true;
    }

    // ---- dash: Opus only commits to punish / ring-out / execute; others dash when engaging
    if (me.moves.dash <= 0 && !out.block && !out.dodge && s.enemyInFront && dist > myRange * 0.8 && dist < myRange + C.dash.reach) {
      const smart = P.readsBlock ? (mode === 'PUNISH' || mode === 'RING-OUT' || mode === 'EXECUTE') && !en.blocking : engaged;
      if ((smart || P.aggression >= 1) && Math.random() < perSec(P.dashRate, dt)) { out.dash = true; mode = 'DASH'; }
    }
    if (me.grounded && Math.random() < perSec(P.hopRate, dt)) out.jump = true;

    // ---- pit awareness: never drive (or dodge) toward a nearby edge unless shoving the enemy over it
    const worldDir = Math.sign(out.drive);
    const room = worldDir > 0 ? A.right - me.x : me.x - A.left;
    const shoving = worldDir === toward && dist < myRange + 30;
    if (worldDir && room < P.pitMargin && !(shoving && room > 30)) { out.drive = -worldDir * 0.5; mode = 'EDGE'; }
    if (out.dodge && P.pitMargin >= 60 && roomBack < C.dodge.safeRoom) { out.dodge = false; }

    out.mode = mode;
    return out;
  }

  function decide(s) {
    const ps = perceive(s);
    if (mem.plan && s.time < mem.next) {   // between decisions: keep driving/holding, no new one-shot moves
      const p = mem.plan;
      return { drive: p.drive, block: p.block, brake: p.brake, jump: false, attack: false, dodge: false, dash: false, mode: p.mode };
    }
    const dt = P.decisionInterval * rand(0.8, 1.2);
    mem.next = s.time + dt;
    mem.plan = think(ps, dt);
    return mem.plan;
  }

  return { params: P, model: modelKey, decide };
}
