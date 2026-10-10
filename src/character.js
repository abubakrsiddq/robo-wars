'use strict';
// ============================================================
// ROBOT FACTORY + DRAWING: build Matter bodies for a robot; draw robots and their cues
// OWNS:    createRobot (runtime robot fields), robot-local geometry helpers, hammer/flip animation curves, drawRobot, chassis/wheel/spinner/shield/trail drawing
// EXPORTS: createRobot, rectCentre, localToWorld, hammerAngle, flipAngle, drawRobot, drawChassisLocal, drawWheel, drawSpinner
// READS:   CONFIG, PARTS, clamp, lerp, Bodies, Body, Composite, Constraint, Vertices, ctx, roundRect, shade, outlinedText, fight, AUTO, AUTO_AI, TAU, aiBehaviour, rand, strategyToBehaviour
// ============================================================
function createRobot(player, x) {
  const b = player.build, f = player.facing, g = PARTS.geometry(b, f);
  const ch = CONFIG.chassis[b.chassis], wh = CONFIG.wheels[b.wheels], wp = CONFIG.weapons[b.weapon];
  const filter = { group: Body.nextGroup(true) };        // a robot's own parts never collide with each other
  const y = CONFIG.arena.floorY - g.ground - 1;

  const rect = Bodies.rectangle(x, y, g.w, g.h, { chamfer: { radius: 4 }, collisionFilter: filter });
  rect.robo = { role: 'chassis' };
  const parts = [rect];
  if (g.wedge) {
    const verts = g.wedge.map(v => ({ x: x + v.x, y: y + v.y }));
    const c = Vertices.centre(verts);
    const wedge = Bodies.fromVertices(c.x, c.y, [verts], { collisionFilter: filter });
    wedge.robo = { role: b.weapon };
    parts.push(wedge);
  }
  const body = Body.create({ parts, collisionFilter: filter, friction: 0.2, restitution: 0.05 });
  Body.setMass(body, ch.mass + b.armour * CONFIG.armour.mass);
  const rel = pt => ({ x: pt.x - body.position.x, y: pt.y - body.position.y });

  const wheels = g.wheels.map(o => {
    const w = Bodies.circle(x + o.x, y + o.y, g.r, { friction: wh.friction, frictionStatic: 1, restitution: 0, collisionFilter: filter });
    Body.setMass(w, wh.mass); w.robo = { role: 'wheel' };
    return w;
  });
  const cons = wheels.map((w, k) => Constraint.create({
    bodyA: body, pointA: rel({ x: x + g.wheels[k].x, y: y + g.wheels[k].y }), bodyB: w, pointB: { x: 0, y: 0 },
    length: 0, stiffness: 0.6, damping: 0.08 }));

  let spinner = null;
  if (g.spinner) {
    spinner = Bodies.circle(x + g.spinner.x, y + g.spinner.y, g.spinner.r, { friction: 1, restitution: 0.3, collisionFilter: filter });
    Body.setMass(spinner, 0.4); spinner.robo = { role: 'spinner' };
    cons.push(Constraint.create({ bodyA: body, pointA: rel({ x: x + g.spinner.x, y: y + g.spinner.y }), bodyB: spinner, length: 0, stiffness: 1 }));
  }

  // #auto runs everyone as a strategy bot (balance harness); #auto..ai runs everyone as an AI
  const controller = AUTO_AI ? 'ai' : AUTO ? 'strategy' : (player.controller || 'strategy');
  const model = controller === 'ai' ? (CONFIG.ai[player.model] ? player.model : 'sonnet') : null;
  const C = CONFIG.controls;
  const robot = {
    player, name: player.name, color: player.color, build: b, g, f, body, wheels, spinner, cons,
    rectOffset: rel(rect.position), all: [body, ...wheels, ...(spinner ? [spinner] : [])],
    maxHp: ch.hp, hp: ch.hp, ghost: ch.hp,
    overdrive: controller === 'strategy' ? PARTS.overdrive(b) : C.overdrive,
    cooldown: 0.5, spin: 0, hammerT: -1, flipT: -1, boostT: 0, flipped: false, flippedTime: 0,
    rage: false, lastSpinHit: -9, lastLand: -9, lastBump: -9, lastHitBy: null, lastHitAt: -9,
    mode: '', warned: false, controller, model,
    behaviour: controller === 'ai' ? aiBehaviour(model) : controller === 'strategy' ? strategyToBehaviour(player.strategy) : null,
    // action-system runtime (read by the HUD): cd = seconds left (0 = ready), max = full cooldown
    blocking: false, blockHold: 0, dashT: 0, dodgeT: 0, revT: 0, hopCd: 0, dashDir: 0, dodgeDir: 0, dashHit: false,
    lastBlockText: -9,
    moves: {
      attack: { cd: 0.5, max: b.weapon === 'spinner' ? C.attack.revCooldown : (wp.cooldown || 0.5), key: 'W' },
      dodge:  { cd: 0, max: C.dodge.cooldown, key: 'A' },
      block:  { cd: 0, max: C.block.cooldown, key: 'S' },
      dash:   { cd: 0, max: C.dash.cooldown, key: 'D' },
    },
    stats: { dealt: 0, biggest: 0, hits: 0 },
  };
  robot.totalMass = robot.all.reduce((s, bd) => s + bd.mass, 0);
  [...parts, ...wheels, spinner].forEach(bd => { if (bd) bd.robot = robot; });
  return robot;
}

function rectCentre(r) {
  const a = r.body.angle, o = r.rectOffset, c = Math.cos(a), s = Math.sin(a);
  return { x: r.body.position.x + o.x * c - o.y * s, y: r.body.position.y + o.x * s + o.y * c };
}
function localToWorld(r, lx, ly) {
  const c = rectCentre(r), a = r.body.angle, co = Math.cos(a), si = Math.sin(a);
  return { x: c.x + lx * co - ly * si, y: c.y + lx * si + ly * co };
}
function hammerAngle(t) {
  const { rest, strike } = CONFIG.hammerAngles;
  if (t < 0) return rest;
  if (t < 0.16) return lerp(rest, strike, (t / 0.16) ** 2);
  if (t < 0.3) return strike;
  return lerp(strike, rest, Math.min(1, (t - 0.3) / 0.5));
}
function flipAngle(t) {
  if (t < 0) return 0;
  if (t < 0.08) return t / 0.08;
  if (t < 0.2) return 1;
  return lerp(1, 0, Math.min(1, (t - 0.2) / 0.3));
}

// ---- robots ----
function drawRobot(r) {
  const F = fight, A = CONFIG.arena, X = CONFIG.fx, g = r.g, t = F.clock;
  const c = rectCentre(r), flashK = clamp((r._flash || 0) / X.hitFlash, 0, 1);
  let low = -1e9; r.wheels.forEach(w => { low = Math.max(low, w.position.y + g.r); });
  // floor shadow shrinks with height
  if (c.x > F.floorL - 20 && c.x < F.floorR + 20) {
    const k = clamp(1 - Math.max(0, A.floorY - low) / 220, 0, 1);
    if (k > 0.02) {
      ctx.fillStyle = `rgba(0,0,0,${0.4 * k})`; ctx.beginPath();
      ctx.ellipse(c.x, A.floorY + 2, g.w * 0.62 * (0.6 + 0.4 * k), 6 * (0.5 + 0.5 * k), 0, 0, TAU); ctx.fill();
    }
  }
  if (r.rage) {   // DBZ-style aura: glow + flame tongues
    const pulse = 1 + Math.sin(t * 14) * 0.08, R = (g.w / 2 + 34) * pulse;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const ag = ctx.createRadialGradient(c.x, c.y, 8, c.x, c.y, R);
    ag.addColorStop(0, 'rgba(255,210,70,.5)'); ag.addColorStop(0.55, 'rgba(255,110,20,.25)'); ag.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, TAU); ctx.fill();
    for (let i = 0; i < 7; i++) {
      const ph = t * 7 + i * 1.7, px = c.x + (i - 3) * g.w / 7.5, hh = 30 + 20 * Math.sin(ph * 1.3 + i), base = c.y + g.h / 2;
      ctx.fillStyle = i % 2 ? 'rgba(255,150,30,.42)' : 'rgba(255,220,90,.35)';
      ctx.beginPath(); ctx.moveTo(px - 8, base); ctx.quadraticCurveTo(px - 6, base - hh * 0.6, px + Math.sin(ph) * 7, base - g.h - hh);
      ctx.quadraticCurveTo(px + 6, base - hh * 0.6, px + 8, base); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  ctx.save();
  if (r.dodgeT > 0) ctx.globalAlpha = 0.42;
  // dash afterimages + speed lines
  const T = r._trail;
  if (T && T.length) {
    T.forEach(p => {
      ctx.save(); ctx.globalAlpha = (r.dodgeT > 0 ? 0.42 : 1) * p.life * 0.32; ctx.translate(p.x, p.y); ctx.rotate(p.a);
      drawChassisLocal(ctx, r.build, g, r.color, { hammer: CONFIG.hammerAngles.rest, flip: 0, t });
      ctx.restore();
    });
  }
  if (r.dashT > 0) {
    const dir = Math.sign(r.body.velocity.x) || r.f;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const yy = c.y + (i - 3) * (g.h / 4.5) + rand(-2, 2), len = rand(30, 70), sx = c.x - dir * (g.w / 2 + rand(0, 14));
      ctx.strokeStyle = i % 2 ? 'rgba(255,255,255,.55)' : r.color; ctx.lineWidth = rand(1, 2.4);
      ctx.beginPath(); ctx.moveTo(sx, yy); ctx.lineTo(sx - dir * len, yy); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(r.body.angle);
  drawChassisLocal(ctx, r.build, g, r.color, { hammer: hammerAngle(r.hammerT), flip: flipAngle(r.flipT), boost: r.boostT > 0, flash: flashK, t });
  ctx.restore();
  r.wheels.forEach(w => drawWheel(ctx, w.position.x, w.position.y, g.r, w.angle));
  if (r.spinner) drawSpinner(ctx, r.spinner.position.x, r.spinner.position.y, g.spinner.r, r.spinner.angle, r.spin / CONFIG.weapons.spinner.spinMax);
  ctx.restore();
  if (r.blocking) drawShield(r, c);
  if (r.flippedTime > 0.3 && F.phase === 'fight') {
    outlinedText(`FLIPPED ${Math.max(0, CONFIG.flipKOSeconds - r.flippedTime).toFixed(1)}`, c.x, c.y - 60, '900 16px "Segoe UI", sans-serif', '#ff8a1f', 4);
  }
}

// Translucent hex energy shield in front of the robot, fading as stamina (blockHold) is used up
function drawShield(r, c) {
  const t = fight.clock, f = r.f, R = r.g.h + 22, cx = c.x + f * (r.g.w / 2 + 6), cy = c.y - 2;
  const life = clamp(1 - (r.blockHold || 0) * 0.75, 0.2, 1), flick = 0.9 + Math.sin(t * 30) * 0.1;
  ctx.save(); ctx.translate(cx, cy);
  ctx.beginPath(); ctx.arc(0, 0, R, f > 0 ? -Math.PI * 0.5 : Math.PI * 0.5, f > 0 ? Math.PI * 0.5 : Math.PI * 1.5); ctx.closePath();
  const g = ctx.createRadialGradient(-f * R * 0.4, 0, R * 0.2, 0, 0, R);
  g.addColorStop(0, 'rgba(90,220,255,.04)'); g.addColorStop(1, 'rgba(90,220,255,.45)');
  ctx.globalAlpha = life * flick; ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.clip(); ctx.strokeStyle = 'rgba(180,245,255,.55)'; ctx.lineWidth = 1;
  const hr = 9, hw = hr * 1.5, hh = hr * 1.732;
  for (let col = -1; col < 5; col++) for (let row = -4; row <= 4; row++) {
    const hx = f * (col * hw), hy = row * hh + (col & 1 ? hh / 2 : 0);
    ctx.beginPath();
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; ctx.lineTo(hx + Math.cos(a) * (hr - 1), hy + Math.sin(a) * (hr - 1)); }
    ctx.closePath(); ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(200,250,255,.95)'; ctx.lineWidth = 2.5; ctx.shadowColor = '#5adcff'; ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.arc(0, 0, R, f > 0 ? -Math.PI * 0.5 : Math.PI * 0.5, f > 0 ? Math.PI * 0.5 : Math.PI * 1.5); ctx.stroke();
  ctx.restore();
}

// Shared by builder preview and fight: draws chassis, wedge, armour, hammer in chassis-local space.
// anim: { hammer, flip, boost, flash?, t? }
function drawChassisLocal(c, b, g, color, anim) {
  const { w, h, f } = g, t = anim.t || 0, dark = '#0b0d14';
  if (anim.boost) {
    c.fillStyle = Math.random() < 0.5 ? '#ffb02e' : '#ff5a1f';
    c.beginPath(); c.moveTo(-f * w / 2, -6); c.lineTo(-f * (w / 2 + rand(18, 30)), 0); c.lineTo(-f * w / 2, 6); c.fill();
    c.fillStyle = '#fff2a8'; c.beginPath(); c.moveTo(-f * w / 2, -3); c.lineTo(-f * (w / 2 + rand(8, 14)), 0); c.lineTo(-f * w / 2, 3); c.fill();
  }
  if (g.wedge && b.weapon === 'ram') {
    const wd = g.wedge, mg = c.createLinearGradient(0, wd[0].y, 0, wd[1].y);
    mg.addColorStop(0, '#e4e9f2'); mg.addColorStop(0.5, '#9aa3b5'); mg.addColorStop(1, '#565e72');
    c.fillStyle = mg; c.strokeStyle = dark; c.lineWidth = 2; c.lineJoin = 'round';
    c.beginPath(); wd.forEach((v, i) => i ? c.lineTo(v.x, v.y) : c.moveTo(v.x, v.y)); c.closePath(); c.fill(); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1;   // bevel highlight + ridges
    c.beginPath(); c.moveTo(wd[0].x, wd[0].y + 1); c.lineTo(wd[2].x - f * 1.5, wd[2].y - 0.5); c.stroke();
    c.strokeStyle = 'rgba(0,0,0,.35)';
    for (let i = 1; i < 4; i++) { const u = i / 4; c.beginPath(); c.moveTo(wd[0].x + f * 32 * u, lerp(wd[1].y, wd[0].y, 1 - u) + 4); c.lineTo(wd[0].x + f * 32 * u, wd[1].y - 1); c.stroke(); }
  }
  if (g.wedge && b.weapon === 'flipper') {
    const hinge = g.wedge[1], rot = -f * anim.flip * 0.9, co = Math.cos(rot), si = Math.sin(rot);
    const mid = { x: (g.wedge[2].x - hinge.x) * 0.55, y: (g.wedge[2].y - hinge.y) * 0.55 };
    const mx = hinge.x + mid.x * co - mid.y * si, my = hinge.y + mid.x * si + mid.y * co;
    const bx = f * (w / 2 - 22), by = h / 2 - 2;   // hydraulic piston: cylinder + chrome rod
    const dx = mx - bx, dy = my - by, len = Math.hypot(dx, dy) || 1, cut = 0.5;
    c.lineCap = 'round';
    c.strokeStyle = dark; c.lineWidth = 7; c.beginPath(); c.moveTo(bx, by); c.lineTo(mx, my); c.stroke();
    c.strokeStyle = '#4a5268'; c.lineWidth = 5; c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + dx * cut, by + dy * cut); c.stroke();
    c.strokeStyle = '#cfd6e6'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(bx + dx * cut, by + dy * cut); c.lineTo(mx, my); c.stroke();
    c.save(); c.translate(hinge.x, hinge.y); c.rotate(rot);
    const fg = c.createLinearGradient(0, -44, 0, 0); fg.addColorStop(0, '#fff0a0'); fg.addColorStop(0.5, '#ffd23f'); fg.addColorStop(1, '#b8860b');
    c.fillStyle = fg; c.strokeStyle = dark; c.lineWidth = 2; c.lineJoin = 'round';
    c.beginPath(); g.wedge.forEach((v, i) => i ? c.lineTo(v.x - hinge.x, v.y - hinge.y) : c.moveTo(v.x - hinge.x, v.y - hinge.y)); c.closePath(); c.fill(); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.6)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(g.wedge[0].x - hinge.x, g.wedge[0].y - hinge.y + 1); c.lineTo(g.wedge[2].x - hinge.x - f * 2, g.wedge[2].y - hinge.y - 0.5); c.stroke();
    c.fillStyle = '#e4e9f2'; c.beginPath(); c.arc(0, -1, 3, 0, TAU); c.fill(); c.strokeStyle = dark; c.stroke();
    c.restore();
  }
  // body: metal gradient, dark outline, rim light
  const bg = c.createLinearGradient(0, -h / 2, 0, h / 2);
  bg.addColorStop(0, shade(color, 0.35)); bg.addColorStop(0.35, color); bg.addColorStop(1, shade(color, -0.55));
  c.fillStyle = bg; c.strokeStyle = dark; c.lineWidth = 2.5; c.lineJoin = 'round';
  roundRect(c, -w / 2, -h / 2, w, h, 5); c.fill(); c.stroke();
  c.save(); roundRect(c, -w / 2, -h / 2, w, h, 5); c.clip();
  c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.5;   // top rim light
  c.beginPath(); c.moveTo(-w / 2 + 4, -h / 2 + 2); c.lineTo(w / 2 - 4, -h / 2 + 2); c.stroke();
  c.strokeStyle = shade(color, 0.5); c.globalAlpha = 0.5; c.lineWidth = 2;   // front-edge rim
  c.beginPath(); c.moveTo(f * (w / 2 - 1), -h / 2 + 4); c.lineTo(f * (w / 2 - 1), h / 2 - 4); c.stroke(); c.globalAlpha = 1;
  // panel seams
  c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 1;
  [-0.18, 0.2].forEach(u => { const sx = u * w; c.beginPath(); c.moveTo(sx, -h / 2 + 3); c.lineTo(sx, h / 2 - 3); c.stroke(); });
  c.beginPath(); c.moveTo(-w / 2 + 3, h * 0.18); c.lineTo(w / 2 - 3, h * 0.18); c.stroke();
  c.restore();
  c.fillStyle = 'rgba(0,0,0,.22)'; roundRect(c, -w / 2 + 6, -h / 2 + 6, w - 12, h - 12, 3); c.fill();
  // bolts
  [[-w / 2 + 5, -h / 2 + 5], [w / 2 - 5, -h / 2 + 5], [-w / 2 + 5, h / 2 - 5], [w / 2 - 5, h / 2 - 5]].forEach(([bx, by]) => {
    c.fillStyle = '#1a1d28'; c.beginPath(); c.arc(bx, by, 1.9, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,.6)'; c.beginPath(); c.arc(bx - 0.5, by - 0.5, 0.8, 0, TAU); c.fill();
  });
  // visor eye: glowing in the robot's colour
  const vx = f > 0 ? w / 2 - 20 : -w / 2 + 8, pulse = 0.75 + 0.25 * Math.sin(t * 6);
  c.fillStyle = dark; roundRect(c, vx - 1.5, -h / 2 + 3.5, 15, 8, 2); c.fill();
  c.save(); c.shadowColor = color; c.shadowBlur = 10 * pulse;
  c.fillStyle = shade(color, 0.75); roundRect(c, vx, -h / 2 + 5, 12, 5, 1.5); c.fill(); c.restore();
  c.fillStyle = '#ffffff'; c.globalAlpha = 0.85; c.fillRect(vx + (f > 0 ? 6 : 1), -h / 2 + 6, 4, 2); c.globalAlpha = 1;
  // armour plates on top
  for (let i = 0; i < b.armour; i++) {
    const py = -h / 2 - 5 - i * 5, pg = c.createLinearGradient(0, py, 0, py + 5);
    pg.addColorStop(0, '#e6ebf5'); pg.addColorStop(1, i ? '#6f788f' : '#8e98ad');
    c.fillStyle = pg; c.strokeStyle = dark; c.lineWidth = 1.2;
    roundRect(c, -w / 2 + 6, py, w - 22, 5, 1.5); c.fill(); c.stroke();
    c.fillStyle = '#3a4156'; c.fillRect(-w / 2 + 11, py + 2, 2, 1); c.fillRect(w / 2 - 21, py + 2, 2, 1);
  }
  // hammer arm
  if (g.hammer) {
    const hm = g.hammer, th = anim.hammer;
    const hx = hm.x + f * hm.len * Math.cos(th), hy = hm.y + hm.len * Math.sin(th);
    c.lineCap = 'round';
    c.strokeStyle = dark; c.lineWidth = 8; c.beginPath(); c.moveTo(hm.x, hm.y); c.lineTo(hx, hy); c.stroke();
    c.strokeStyle = '#7d879f'; c.lineWidth = 5; c.beginPath(); c.moveTo(hm.x, hm.y); c.lineTo(hx, hy); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(hm.x, hm.y - 1.5); c.lineTo(hx, hy - 1.5); c.stroke();
    c.save(); c.translate(hx, hy); c.rotate(Math.atan2(Math.sin(th), f * Math.cos(th)) + Math.PI / 2);
    const hg = c.createLinearGradient(-13, 0, 13, 0);
    hg.addColorStop(0, '#6f788f'); hg.addColorStop(0.3, '#e4e9f2'); hg.addColorStop(0.6, '#8d97ad'); hg.addColorStop(1, '#4a5268');
    c.fillStyle = hg; c.strokeStyle = dark; c.lineWidth = 2;
    roundRect(c, -13, -9, 26, 18, 3); c.fill(); c.stroke();
    c.fillStyle = color; c.fillRect(-13, -2, 26, 4);   // team stripe
    c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(-13, -2, 26, 1);
    c.restore();
    c.fillStyle = dark; c.beginPath(); c.arc(hm.x, hm.y, 6, 0, TAU); c.fill();
    c.fillStyle = '#c8cfdd'; c.beginPath(); c.arc(hm.x, hm.y, 4.5, 0, TAU); c.fill();
    c.fillStyle = '#4a5268'; c.beginPath(); c.arc(hm.x, hm.y, 1.8, 0, TAU); c.fill();
  }
  if (anim.flash > 0) {   // hit flash: fake hit-stop
    c.fillStyle = `rgba(255,255,255,${0.85 * anim.flash})`; roundRect(c, -w / 2, -h / 2, w, h, 5); c.fill();
  }
}

function drawWheel(c, x, y, r, a) {
  c.save(); c.translate(x, y); c.rotate(a);
  c.fillStyle = '#0c0d12'; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
  c.fillStyle = '#2b2f3c';   // tread blocks
  const n = Math.max(10, Math.round(r * 0.9));
  for (let i = 0; i < n; i++) { c.save(); c.rotate(i * TAU / n); c.fillRect(r - 3, -1.3, 3, 2.6); c.restore(); }
  c.strokeStyle = '#4a5068'; c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, r - 1, 0, TAU); c.stroke();
  const rg = c.createRadialGradient(-r * 0.2, -r * 0.2, 1, 0, 0, r * 0.75);
  rg.addColorStop(0, '#9aa3b5'); rg.addColorStop(1, '#3a4054');
  c.fillStyle = rg; c.beginPath(); c.arc(0, 0, r * 0.72, 0, TAU); c.fill();
  c.strokeStyle = '#161922'; c.lineWidth = 1.5; c.stroke();
  c.strokeStyle = '#5a6278'; c.lineWidth = 2;
  for (let i = 0; i < 3; i++) { const th = i * TAU / 3; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(th) * r * 0.62, Math.sin(th) * r * 0.62); c.stroke(); }
  c.fillStyle = '#d7deea'; c.beginPath(); c.arc(0, 0, r * 0.24, 0, TAU); c.fill();
  c.fillStyle = '#2a2f3f'; c.beginPath(); c.arc(0, 0, r * 0.09, 0, TAU); c.fill();
  c.restore();
}

function drawSpinner(c, x, y, r, a, spinFrac) {
  c.save(); c.translate(x, y);
  if (spinFrac > 0.35) {   // motion-blur discs
    const k = (spinFrac - 0.35) / 0.65;
    for (let i = 3; i >= 1; i--) {
      c.fillStyle = `rgba(215,225,245,${0.09 * k * (4 - i) / 3 + 0.02})`;
      c.beginPath(); c.arc(0, 0, r + 6 - i, 0, TAU); c.fill();
    }
    c.strokeStyle = `rgba(255,255,255,${0.15 + spinFrac * 0.3})`; c.lineWidth = 2;
    c.beginPath(); c.arc(0, 0, r + 6, 0, TAU); c.stroke();
    c.strokeStyle = `rgba(255,255,255,${0.25 * k})`; c.lineWidth = 3;
    for (let i = 0; i < 3; i++) { const s0 = a + i * TAU / 3; c.beginPath(); c.arc(0, 0, r + 1, s0 - 0.9, s0); c.stroke(); }
  }
  c.rotate(a);
  const rg = c.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r);
  rg.addColorStop(0, '#f4f7fc'); rg.addColorStop(0.6, '#aab2c4'); rg.addColorStop(1, '#656e84');
  c.fillStyle = rg; c.strokeStyle = '#0b0d14'; c.lineWidth = 2;
  c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill(); c.stroke();
  c.fillStyle = '#e9edf5'; c.strokeStyle = '#0b0d14'; c.lineWidth = 1.2; c.lineJoin = 'round';
  for (let i = 0; i < 3; i++) {
    c.rotate(TAU / 3);
    c.beginPath(); c.moveTo(r - 3, -4); c.lineTo(r + 6, 0); c.lineTo(r - 3, 5); c.closePath(); c.fill(); c.stroke();
  }
  c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, r * 0.62, 0, TAU); c.stroke();
  c.fillStyle = '#2a2f3f'; c.beginPath(); c.arc(0, 0, r * 0.32, 0, TAU); c.fill();
  c.fillStyle = '#c8cfdd'; c.beginPath(); c.arc(0, 0, r * 0.12, 0, TAU); c.fill();
  c.restore();
}
