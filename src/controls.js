'use strict';
// ============================================================
// CONTROLS: keyboard input and the single action -> physics path
// OWNS:    INPUT state, humanAction, getAction (human/AI/strategy -> action), cooldown ticking, applyAction (drive/hop/brake/attack/dodge/block/dash)
// EXPORTS: INPUT, IDLE_ACTION, getAction, humanAction, setCd, tickMoves, applyAction, isGrounded
// READS:   CONFIG, clamp, Body, fight, FALLBACK, buildState, fireWeapon, sparks, dust, floatText, rectCentre, setAllVelocity
// ============================================================
// ---- ACTIONS: every robot (human, AI, strategy) produces one action per tick; applyAction is the only
// code path that turns actions into physics, so everyone obeys the same rules and cooldowns.
function isGrounded(r) {
  if (r.flipped) return false;
  const A = CONFIG.arena, tol = CONFIG.controls.hop.groundTol;
  return r.wheels.some(w => w.position.y + r.g.r >= A.floorY - tol && w.position.y + r.g.r <= A.floorY + tol &&
                            w.position.x > fight.floorL - r.g.r && w.position.x < fight.floorR + r.g.r);
}

const IDLE_ACTION = { drive: 0, jump: false, attack: false, dodge: false, block: false, dash: false, brake: false, mode: '' };

function getAction(r, en) {
  if (r.controller === 'human') return humanAction(r, en);
  const s = buildState(r, en);
  try {
    const out = r.behaviour.decide(s);
    if (!out || !isFinite(out.drive)) throw new Error('decide() returned invalid output');
    if (r.controller === 'ai') {
      return { drive: clamp(out.drive, -1, 1), jump: !!out.jump, attack: !!out.attack, dodge: !!out.dodge,
               block: !!out.block, dash: !!out.dash, brake: !!out.brake, mode: String(out.mode || '') };
    }
    return { ...IDLE_ACTION, drive: clamp(out.drive, -1, 1) * r.f, attack: !!out.fire, mode: out.mode || '' };
  } catch (err) {
    if (!r.warned) { console.warn(`[${r.name}] ${r.controller} failed, using fallback:`, err.message); r.warned = true; }
    const fb = FALLBACK.decide(s);
    return { ...IDLE_ACTION, drive: fb.drive * r.f, attack: !!fb.fire, mode: fb.mode };
  }
}

function humanAction(r, en) {
  const k = inputHeld;
  return { drive: (k('right') ? 1 : 0) - (k('left') ? 1 : 0), jump: k('hop'), brake: k('brake'),
           attack: k('attack'), dodge: k('dodge'), block: k('block'), dash: k('dash'), mode: '' };
}

function setCd(r, move, t) { r.moves[move].cd = t; r.moves[move].max = Math.max(t, 0.01); }

function tickMoves(r, gdt) {
  const C = CONFIG.controls, m = r.moves;
  r.dashT = Math.max(0, r.dashT - gdt);
  r.dodgeT = Math.max(0, r.dodgeT - gdt);
  r.revT = Math.max(0, r.revT - gdt);
  r.hopCd = Math.max(0, r.hopCd - gdt);
  m.dodge.cd = Math.max(0, m.dodge.cd - gdt);
  m.block.cd = Math.max(0, m.block.cd - gdt);
  m.dash.cd = Math.max(0, m.dash.cd - gdt);
  m.attack.cd = r.cooldown;
  if (r.blocking) r.blockHold = Math.min(1, r.blockHold + gdt / C.block.maxHold);
  else r.blockHold = Math.max(0, r.blockHold - gdt / C.block.regenSeconds);
}

function applyAction(r, en, act) {
  const F = fight, C = CONFIG.controls, b = r.build, m = r.moves;
  const ch = CONFIG.chassis[b.chassis], wh = CONFIG.wheels[b.wheels];
  const live = F.phase === 'fight';
  const away = -(Math.sign(en.body.position.x - r.body.position.x) || r.f);

  // Block (hold): limited stamina, then a cooldown. Can't block upside down.
  const wantBlock = live && act.block && !r.flipped && !act.dodge && !act.dash;
  if (r.blocking && (!wantBlock || r.blockHold >= 1)) {
    r.blocking = false;
    setCd(r, 'block', r.blockHold >= 1 ? C.block.cooldown : C.block.releaseCooldown);
  } else if (!r.blocking && wantBlock && m.block.cd <= 0 && r.blockHold < 1 - C.block.minStamina) {
    r.blocking = true;
  }
  if (r.blocking) {   // braced: downforce + resist rotation
    r.all.forEach(bd => Body.setVelocity(bd, { x: bd.velocity.x, y: bd.velocity.y + C.block.downforce }));
    Body.setAngularVelocity(r.body, r.body.angularVelocity * C.block.spinDamp);
  }

  if (live && !r.flipped) {
    if (act.dodge && m.dodge.cd <= 0 && !r.blocking) {          // quick hop-back away from the enemy
      r.dodgeT = C.dodge.time; r.dodgeDir = away; setCd(r, 'dodge', C.dodge.cooldown);
      setAllVelocity(r, v => ({ x: away * C.dodge.speed, y: Math.min(v.y, -C.dodge.lift) }));
      const c = rectCentre(r); sparks(c.x - away * r.g.w / 2, c.y + 10, 3, '#9fe8ff');
    } else if (act.dash && m.dash.cd <= 0 && !r.blocking) {     // forward burst toward the enemy
      r.dashT = C.dash.time; r.dashDir = -away; r.dashHit = false; setCd(r, 'dash', C.dash.cooldown);
      setAllVelocity(r, v => ({ x: -away * Math.max(C.dash.speed, Math.abs(v.x)), y: v.y }));
      const c = rectCentre(r); sparks(c.x + away * r.g.w / 2, c.y + 10, 4, '#ffb02e');
    }
    if (act.jump && r.hopCd <= 0 && !r.blocking && isGrounded(r)) {
      r.hopCd = C.hop.cooldown;
      setAllVelocity(r, v => ({ x: v.x, y: Math.min(v.y, -C.hop.velocity) }));
    }
  }

  // Wheels: dodge / dash override the stick; block slows you down; brake damps the spin
  let drive = clamp(act.drive || 0, -1, 1), spinMul = r.blocking ? C.block.driveMul : 1;
  if (r.dodgeT > 0) { drive = r.dodgeDir; spinMul = C.dodge.spinMul; }
  else if (r.dashT > 0) { drive = r.dashDir; spinMul = C.dash.spinMul; }
  const maxSpin = wh.maxSpin * ch.speed * r.overdrive * (r.boostT > 0 ? CONFIG.weapons.ram.boost : 1) * spinMul;
  const target = drive * maxSpin;
  r.wheels.forEach(w => {
    let av = w.angularVelocity + (target - w.angularVelocity) * wh.accel;
    if (act.brake && r.dodgeT <= 0 && r.dashT <= 0) av *= C.brake.factor;
    Body.setAngularVelocity(w, av);
  });
  if (act.attack && r.cooldown <= 0 && live && !r.blocking) fireWeapon(r, en);
  m.attack.cd = r.cooldown;
}

// ---- INPUT: keyboard -> human action (bindings in CONFIG.controls.keys) ---------------------
// INPUT.down = held key codes; INPUT.buffer[action] = seconds a fresh press stays "live" (input buffer).
const INPUT = { down: new Set(), buffer: {} };
function inputHeld(action) {
  return CONFIG.controls.keys[action].some(k => INPUT.down.has(k)) || INPUT.buffer[action] > 0;
}
function keyToAction(code) {
  for (const a in CONFIG.controls.keys) if (CONFIG.controls.keys[a].includes(code)) return a;
  return null;
}
window.addEventListener('keydown', e => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  const fighting = fight && fight.phase !== 'result';
  if (!fighting) return;
  if (e.code && (e.code.startsWith('Arrow') || e.code === 'Space')) e.preventDefault();
  const a = keyToAction(e.code);
  if (!a) return;
  INPUT.down.add(e.code);
  if (!e.repeat) INPUT.buffer[a] = CONFIG.controls.bufferSeconds;
});
window.addEventListener('keyup', e => INPUT.down.delete(e.code));
window.addEventListener('blur', () => { INPUT.down.clear(); INPUT.buffer = {}; });
