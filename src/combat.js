'use strict';
// ============================================================
// COMBAT: weapons, collision damage, win conditions
// OWNS:    fireWeapon (slot 2 = build.weapon2), weapon impacts, collision handling, damage/rage/block reduction, checkWin, endFight
// EXPORTS: fireWeapon, setAllVelocity, selfRight, flipperImpact, hammerImpact, handlePair, damage, checkWin, endFight
// READS:   CONFIG, clamp, rand, Body, Events, fight, AUTO_AI, autolog, localToWorld, rectCentre, sparks, dust, floatText, setBanner
// ============================================================
// slot 2 fires the optional second weapon (build.weapon2, AI only) with its own cooldown2 / moves.attack2
function fireWeapon(r, en, slot) {
  const key = slot === 2 ? r.build.weapon2 : r.build.weapon, wp = CONFIG.weapons[key];
  let cd;
  switch (key) {
    case 'hammer':
      r.hammerT = 0; cd = Math.max(wp.cooldown / r.overdrive, animLen(wp));
      if (r.flipped) selfRight(r, 0.75);
      break;
    case 'flipper':
      r.flipT = 0; cd = Math.max(wp.cooldown / r.overdrive, animLen(wp));
      if (r.flipped) selfRight(r, 1); else flipperImpact(r, en);
      break;
    case 'ram':
      if (r.flipped) return;
      r.boostT = wp.boostTime; cd = wp.cooldown;
      break;
    default:   // spinner is always on: strategy bots just tick; human/AI get a rev burst
      if (r.controller === 'strategy') { cd = 0.5; break; }
      r.spin = wp.spinMax; r.revT = CONFIG.controls.attack.revTime; cd = CONFIG.controls.attack.revCooldown;
      sparks(r.spinner.position.x, r.spinner.position.y, 5, '#9fe8ff');
      floatText(r.spinner.position.x, r.spinner.position.y - 40, 'REV!', '#9fe8ff', 16);
  }
  if (slot === 2) r.cooldown2 = cd; else r.cooldown = cd;
  r.moves[slot === 2 ? 'attack2' : 'attack'].max = Math.max(cd, 0.01);
}

// total swing time of a weapon animation: refire is blocked until it ends
function animLen(wp) { return wp.anim.strike + wp.anim.hold + wp.anim.back; }

function setAllVelocity(r, fn) { r.all.forEach(bd => Body.setVelocity(bd, fn(bd.velocity))); }

function selfRight(r, power) {
  const a = Math.atan2(Math.sin(r.body.angle), Math.cos(r.body.angle));
  setAllVelocity(r, v => ({ x: v.x, y: -7 * power }));
  Body.setAngularVelocity(r.body, -Math.sign(a || 1) * 0.24 * power);
  const c = rectCentre(r);
  sparks(c.x, c.y + 10, 6, '#ffffff');
  floatText(c.x, c.y - 40, 'SELF-RIGHT!', '#9fe8ff', 16);
}

function flipperImpact(r, en) {
  const wp = CONFIG.weapons.flipper;
  const dx = (en.body.position.x - r.body.position.x) * r.f, dy = en.body.position.y - r.body.position.y;
  const reach = r.g.w / 2 + wp.reach + en.g.w / 2 + 10;
  if (dx <= 0 || dx > reach || Math.abs(dy) > 80) return;
  const k = clamp(Math.sqrt(5.5 / en.totalMass), 0.6, 1.25);
  let brace = en.blocking ? CONFIG.controls.block.launchMul : 1;   // a braced robot barely leaves the ground
  // anti juggle-lock: a recently flipped target only gets a small shove
  if (fight.clock - (en.lastFlipped ?? -99) < wp.repeatGuard) brace *= wp.repeatLaunchMul; else en.lastFlipped = fight.clock;  // cfg-ok
  setAllVelocity(en, v => ({ x: r.f * wp.push * (en.blocking ? CONFIG.controls.block.knockMul : 1), y: -wp.launch * k * brace }));
  Body.setAngularVelocity(en.body, r.f * wp.spin * brace);
  const tip = localToWorld(r, r.g.wedge[2].x, r.g.wedge[2].y);
  damage(en, wp.damage, r, tip.x, tip.y);
  floatText(en.body.position.x, en.body.position.y - 70, 'FLIP!', '#ffd23f', 22);
}

function hammerImpact(r, en) {
  const wp = CONFIG.weapons.hammer, h = r.g.hammer, th = CONFIG.hammerAngles.strike;
  const head = localToWorld(r, h.x + r.f * h.len * Math.cos(th), h.y + h.len * Math.sin(th));
  const bd = en.body.bounds;
  if (head.x > bd.min.x - 18 && head.x < bd.max.x + 18 && head.y > bd.min.y - 30 && head.y < bd.max.y + 15) {
    const bonus = en.flipped ? wp.flippedBonus : 1;
    damage(en, wp.damage * bonus, r, head.x, head.y);
    const kb = en.blocking ? CONFIG.controls.block.knockMul : 1;
    Body.setVelocity(en.body, { x: en.body.velocity.x + r.f * 1.5 * kb, y: en.body.velocity.y + 4 });
    if (bonus > 1) floatText(head.x, head.y - 50, 'SMASH!', '#ffd23f', 22);
  } else {
    sparks(head.x, head.y, 2, '#888888');
  }
}

function contactPoint(pair) {
  const s = pair.collision.supports && pair.collision.supports[0];
  return s ? { x: s.x, y: s.y } : { x: (pair.bodyA.position.x + pair.bodyB.position.x) / 2, y: (pair.bodyA.position.y + pair.bodyB.position.y) / 2 };
}

function handlePair(pair, active) {
  if (!fight || fight.phase !== 'fight') return;
  const a = pair.bodyA, b = pair.bodyB, ra = a.robot, rb = b.robot;
  if (ra && rb && ra !== rb) {
    dashContact(ra, rb, pair);
    dashContact(rb, ra, pair);
    weaponHit(a, ra, b, rb, pair, active);
    weaponHit(b, rb, a, ra, pair, active);
    if (!active && a.robo.role === 'chassis' && b.robo.role === 'chassis') bump(ra, rb, pair);
  } else if (!active && (ra || rb) && !(ra && rb)) {
    const part = ra ? a : b, r = ra || rb;
    if (part.robo.role !== 'wheel' && part.robo.role !== 'spinner') landing(r, pair);
  }
}

function weaponHit(atkPart, atk, defPart, def, pair, active) {
  const role = atkPart.robo.role, F = fight;
  if (role === 'spinner') {
    const wp = CONFIG.weapons.spinner;
    if (F.clock - atk.lastSpinHit < wp.hitCooldown || atk.spin < wp.spinMax * 0.25) return;
    const n = pair.collision.normal;
    const rel = Math.abs((def.body.velocity.x - atk.body.velocity.x) * n.x + (def.body.velocity.y - atk.body.velocity.y) * n.y);
    const dmg = (wp.base + wp.mul * (rel + atk.spin * wp.radius * 0.5)) * (atk.revT > 0 ? CONFIG.controls.attack.revDamageMul : 1);
    const dir = Math.sign(def.body.position.x - atk.body.position.x) || atk.f;
    const k = wp.knock * (atk.spin / wp.spinMax) * clamp(Math.sqrt(5.5 / def.totalMass), 0.5, 1.3) *
              (def.blocking ? CONFIG.controls.block.knockMul : 1);
    setAllVelocity(def, v => ({ x: v.x + dir * k, y: v.y - k * 0.7 }));
    setAllVelocity(atk, v => ({ x: v.x - dir * k * 0.3, y: v.y }));
    atk.lastSpinHit = F.clock;
    atk.spin *= 0.35;
    const p = contactPoint(pair);
    damage(def, dmg, atk, p.x, p.y);
    return;
  }
  if (active) return;
  if (role === 'ram' || role === 'flipper') {
    const wp = CONFIG.weapons.ram;
    const closing = (atk.body.velocity.x - def.body.velocity.x) * atk.f;
    if (closing > wp.minSpeed) {
      const p = contactPoint(pair);
      damage(def, closing * wp.mul * (role === 'ram' ? 1 : 0.4), atk, p.x, p.y);
    }
  }
}

// Dash attack: the first contact during a dash (in the dash direction) deals bonus damage + knockback
function dashContact(atk, def, pair) {
  if (atk.dashT <= 0 || atk.dashHit) return;
  if ((Math.sign(def.body.position.x - atk.body.position.x) || atk.dashDir) !== atk.dashDir) return;
  atk.dashHit = true;
  const D = CONFIG.controls.dash;
  const closing = Math.max(0, (atk.body.velocity.x - def.body.velocity.x) * atk.dashDir);
  const k = D.knock * clamp(Math.sqrt(5.5 / def.totalMass), 0.6, 1.25) * (def.blocking ? CONFIG.controls.block.knockMul : 1);
  setAllVelocity(def, v => ({ x: v.x + atk.dashDir * k, y: v.y - k * 0.4 }));
  const p = contactPoint(pair);
  damage(def, D.damage + closing * D.speedMul, atk, p.x, p.y);
  floatText(p.x, p.y - 60, 'DASH!', '#ffb02e', 20);
}

function bump(ra, rb, pair) {
  if (fight.clock - ra.lastBump < 0.3) return;
  const n = pair.collision.normal;
  const rel = Math.abs((ra.body.velocity.x - rb.body.velocity.x) * n.x + (ra.body.velocity.y - rb.body.velocity.y) * n.y);
  if (rel < CONFIG.bump.minSpeed) return;
  ra.lastBump = rb.lastBump = fight.clock;
  const d = (rel - CONFIG.bump.minSpeed) * CONFIG.bump.mul, p = contactPoint(pair);
  damage(ra, d, rb, p.x, p.y);
  damage(rb, d, ra, p.x, p.y);
}

function landing(r, pair) {
  if (fight.clock - r.lastLand < 0.3) return;
  const n = pair.collision.normal, v = r.body.velocity;
  const s = Math.abs(v.x * n.x + v.y * n.y);
  if (s < CONFIG.landing.minSpeed) return;
  r.lastLand = fight.clock;
  const src = r.lastHitBy && fight.clock - r.lastHitAt < 3 ? r.lastHitBy : null;
  const p = contactPoint(pair);
  damage(r, (s - CONFIG.landing.minSpeed) * CONFIG.landing.mul, src, p.x, p.y);
}

function damage(target, amount, attacker, x, y) {
  const F = fight;
  if (!F || F.phase !== 'fight' || target.hp <= 0) return;
  let d = amount * (1 - target.build.armour * CONFIG.armour.reduction);
  if (attacker && attacker.rage) d *= 1 + CONFIG.rageDamageBonus;
  const C = CONFIG.controls, raw = d;
  if (target.blocking) d *= 1 - C.block.reduction;
  else if (target.dodgeT > 0) d *= 1 - C.dodge.reduction;
  if (d < raw && raw > 2 && F.clock - target.lastBlockText > 0.4) {
    target.lastBlockText = F.clock;
    floatText(target.body.position.x, target.body.position.y - 80, target.blocking ? 'BLOCKED' : 'EVADE', '#9fe8ff', 18);
  }
  if (d < 0.5) return;
  target.hp = Math.max(0, target.hp - d);
  if (attacker) {
    attacker.stats.dealt += d; attacker.stats.hits++;
    attacker.stats.biggest = Math.max(attacker.stats.biggest, d);
    target.lastHitBy = attacker; target.lastHitAt = F.clock;
  }
  F.stall = 0;
  sparks(x, y, d, attacker ? attacker.color : '#ffffff');
  floatText(target.body.position.x + rand(-10, 10), target.body.position.y - 50, '-' + Math.max(1, Math.round(d)),
            d > CONFIG.bigHit ? '#ffd23f' : '#ffffff', clamp(16 + d * 0.7, 16, 42));
  if (d > CONFIG.bigHit) F.shake = Math.min(16, 5 + d * 0.3);
  if (!target.rage && target.hp > 0 && target.hp / target.maxHp < CONFIG.rageBelow) {
    target.rage = true;
    setBanner('FINISH IT!', '#ff4d5e', 1.1, `${target.name} enters RAGE MODE (+${CONFIG.rageDamageBonus * 100}% dmg)`);
  }
  if (target.hp <= 0) endFight(F.robots.find(r => r !== target), 'KO');
}

function checkWin() {
  const F = fight, A = CONFIG.arena;
  for (const r of F.robots) {
    const other = F.robots.find(o => o !== r);
    if (r.body.position.y > A.floorY + A.pitKODepth) return endFight(other, 'Pit');
    if (r.flippedTime >= CONFIG.flipKOSeconds) return endFight(other, 'Flip');
  }
  if (F.time <= 0) {
    const [a, b] = F.robots, pa = a.hp / a.maxHp, pb = b.hp / b.maxHp;
    endFight(Math.abs(pa - pb) < 1e-6 ? null : pa > pb ? a : b, 'Time');
  }
}

function endFight(winner, method) {
  const F = fight;
  if (F.phase !== 'fight') return;
  F.phase = 'ko'; F.winner = winner; F.method = method;
  if (AUTO_AI && typeof autolog === 'function') {   // AI-vs-AI harness line (parsed by the headless test harness)
    const [a, b] = F.robots;
    autolog(`AI ${a.model} vs ${b.model} -> ${winner ? winner.model : 'draw'} by ${method} at ${Math.round(CONFIG.fightSeconds - F.time)}s` +
            ` hp ${Math.round(a.hp / a.maxHp * 100)}%/${Math.round(b.hp / b.maxHp * 100)}%`);
  }
  F.slow = method !== 'Time';
  F.koT = F.slow ? CONFIG.slowMo.seconds : 1.4;
  const label = { KO: 'K.O.!', Pit: 'RING OUT!', Flip: 'FLIPPED!', Time: 'TIME!' }[method];
  setBanner(label, method === 'Time' ? '#ffffff' : '#ff4d5e', F.koT + 0.3);
  if (F.slow) F.shake = 14;
}

