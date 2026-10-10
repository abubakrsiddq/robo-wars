'use strict';
// ============================================================
// PARTS: part costs, geometry (builder preview + physics), random builds
// OWNS:    PARTS: cost, geometry, fromCards, randomBuild, randomName; name word lists
// EXPORTS: PARTS
// READS:   CONFIG, pick
// ============================================================
const NAME_A = ['Iron', 'Turbo', 'Mega', 'Hyper', 'Saiyan', 'Steel', 'Doom', 'Rusty', 'Atomic', 'Kaiju', 'Neon', 'Ultra'];
const NAME_B = ['Crusher', 'Fang', 'Bolt', 'Smasher', 'Titan', 'Wrecker', 'Dynamo', 'Fist', 'Blitz', 'Kong', 'Viper', 'Mauler'];

const PARTS = {
  cost(b) {
    return CONFIG.chassis[b.chassis].cost + CONFIG.wheels[b.wheels].cost +
           CONFIG.weapons[b.weapon].cost + b.armour * CONFIG.armour.cost;
  },
  overdrive(b) { return 1 + Math.max(0, CONFIG.budget - PARTS.cost(b)) * CONFIG.overdrivePerPoint; },
  // Local coords: origin = chassis centre, y down, f = facing (+1 right, -1 left)
  geometry(b, f) {
    const ch = CONFIG.chassis[b.chassis], wh = CONFIG.wheels[b.wheels], wp = CONFIG.weapons[b.weapon];
    const w = ch.w, h = ch.h, r = wh.r;
    const wheelY = h / 2 - 2, wheelX = w / 2 - r - 2;
    const ground = wheelY + r;
    const fx = f * w / 2;
    const g = { w, h, r, f, ground, wheels: [{ x: f * wheelX, y: wheelY }, { x: -f * wheelX, y: wheelY }] };
    if (b.weapon === 'ram')     g.wedge = [{ x: fx, y: -h / 2 }, { x: fx, y: ground - 5 }, { x: fx + f * 32, y: ground - 5 }];
    if (b.weapon === 'flipper') g.wedge = [{ x: fx, y: -2 }, { x: fx, y: ground - 4 }, { x: fx + f * 44, y: ground - 4 }];
    if (b.weapon === 'spinner') g.spinner = { x: fx + f * 10, y: -2, r: wp.radius };
    if (b.weapon === 'hammer')  g.hammer = { x: f * w * 0.05, y: -h / 2, len: 0.45 * w + 38 };
    return g;
  },
  randomBuild() {
    for (let i = 0; i < 200; i++) {
      const b = { chassis: pick(Object.keys(CONFIG.chassis)), wheels: pick(Object.keys(CONFIG.wheels)),
                  weapon: pick(Object.keys(CONFIG.weapons)), armour: Math.floor(Math.random() * (CONFIG.armour.max + 1)) };
      if (PARTS.cost(b) <= CONFIG.budget) return b;
    }
    return { chassis: 'medium', wheels: 'large', weapon: 'spinner', armour: 0 };
  },
  randomName() { return pick(NAME_A) + ' ' + pick(NAME_B); },
  // Card ids -> build, e.g. fromCards({body:'tank', attack:'ram', defence:'plated'})
  fromCards(c) {
    const B = CONFIG.builder, bo = B.body[c.body], at = B.attack[c.attack], de = B.defence[c.defence];
    return { chassis: bo.chassis, wheels: bo.wheels, weapon: at.weapon, armour: de.armour };
  },
};
