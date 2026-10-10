'use strict';
// ============================================================
// CONFIG: shared helpers + every tunable number
// OWNS:    CONFIG (all balance/tuning numbers), the Matter.js destructuring, tiny math/random helpers
// EXPORTS: Engine, Bodies, Body, Composite, Constraint, Events, Vertices, clamp, lerp, rand, pick, CONFIG
// READS:   Matter
// ============================================================
if (typeof Matter === 'undefined') {
  document.body.innerHTML = '<h2 style="padding:40px;color:#ff4d5e">Could not load Matter.js. Check your internet connection and reload.</h2>';
  throw new Error('Matter.js missing');
}
const { Engine, Bodies, Body, Composite, Constraint, Events, Vertices } = Matter;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];

// ============================================================
// CONFIG: every tunable number lives here
// ============================================================
const CONFIG = {
  budget: 100,
  overdrivePerPoint: 0.015,      // unspent budget -> +1.5% speed per point
  fightSeconds: 60,
  flipKOSeconds: 5,
  introSeconds: 2.4,
  stallSeconds: 8,               // no damage for this long -> both bots get impatient
  slowMo: { scale: 0.3, seconds: 1.5 },
  bigHit: 15,                    // screen shake threshold
  rageBelow: 0.25, rageDamageBonus: 0.2,
  arena: { w: 1200, h: 600, floorY: 500, pitW: 100, spawnOffset: 170, wallW: 30, pitKODepth: 70 },
  // ---- ARENAS: picked in the builder (or #arena=<key>&fight). Physics (CONFIG.arena) is the same everywhere;
  // only the look changes. theme colours: crowd = 'r,g,b', floor/pit = [top, bottom], wall = [base, stripe].
  arenas: {
    default: 'stadium',
    maxDPR: 2,                 // canvas + cached backdrop resolution cap (screen pixel density)
    crowdCount: 140,           // landmark arenas: crowd heads across the width...
    crowdGap: [360, 840],      // ...minus this x range, so the landmark in the middle stays visible
    list: {
      stadium:      { name: 'Robo Stadium', place: 'Neon night arena', accent: '#3aa0ff' },
      taj:          { name: 'Taj Mahal', place: 'Agra, Uttar Pradesh', accent: '#f2a678',
                      theme: { crowd: '58,36,64', board: '#1a1024', ground: '#5d7a3e', floor: ['#f2ebe0', '#b5a794'], edge: '#d4a84a',
                               pit: ['#2a5a80', '#0b1a28'], water: true, pitLabel: 'POOL', wall: ['#7a3326', '#9a4a36'], led: 'rgba(255,210,63,.4)' } },
      hampi:        { name: 'Hampi', place: 'Vijayanagara, Karnataka', accent: '#e6b072',
                      theme: { crowd: '74,40,20', board: '#24150c', ground: '#a8794a', floor: ['#b39a7c', '#5e4a38'], edge: '#e6b072',
                               pit: ['#2b6276', '#0e2630'], water: true, pitLabel: 'RIVER', wall: ['#6b5444', '#86705c'], led: 'rgba(255,210,63,.4)' } },
      gomateshwara: { name: 'Gomateshwara Statue', place: 'Shravanabelagola, Karnataka', accent: '#e8c35a',
                      theme: { crowd: '38,46,42', board: '#141a18', ground: '#8f897a', floor: ['#d8d1c1', '#7a7468'], edge: '#e8c35a',
                               pit: ['#3a3630', '#0e0c0a'], water: false, pitLabel: 'LEDGE', wall: ['#5d5850', '#78726a'], led: 'rgba(255,210,63,.4)' } },
    },
  },
  chassis: {
    light:  { name: 'Light',  cost: 20, hp: 80,  w: 74,  h: 24, mass: 3, speed: 1.25, desc: 'Fast, fragile' },
    medium: { name: 'Medium', cost: 35, hp: 120, w: 86,  h: 28, mass: 5, speed: 1.0,  desc: 'All-rounder' },
    heavy:  { name: 'Heavy',  cost: 50, hp: 170, w: 100, h: 34, mass: 8, speed: 0.78, desc: 'Slow, tanky' },
  },
  wheels: {
    small: { name: 'Small', cost: 10, r: 11, friction: 0.55, accel: 0.45, maxSpin: 0.55, mass: 0.3, desc: 'Quick accel, low grip' },
    large: { name: 'Large', cost: 20, r: 16, friction: 1.0,  accel: 0.22, maxSpin: 0.38, mass: 0.6, desc: 'Grip & push power' },
  },
  weapons: {
    spinner: { name: 'Spinner', cost: 25, desc: 'Big damage on contact', radius: 14, spinMax: 0.9, spinUp: 0.025, base: 3, mul: 0.95, hitCooldown: 0.25, knock: 2.2, reach: 24 },
    hammer:  { name: 'Hammer',  cost: 25, desc: 'Overhead strike',       cooldown: 0.5, damage: 8, flippedBonus: 1.6, reach: 40,
               anim: { strike: 0.1, hold: 0.1, back: 0.25 } }   // swing timings (s); strike+hold+back must be <= minCooldown
,
    flipper: { name: 'Flipper', cost: 20, desc: 'Launches enemy up',     cooldown: 0.5, damage: 3, launch: 10.5, push: 1.5, spin: 0.24, reach: 48,
               repeatGuard: 1.2, repeatLaunchMul: 0.25,        // a target flipped within this many s only gets a small shove (no juggle-lock)
               anim: { strike: 0.05, hold: 0.1, back: 0.25 } },
    ram:     { name: 'Ram',     cost: 10, desc: 'Speed = damage',        mul: 3.4, minSpeed: 2, cooldown: 0.5, boost: 1.3, boostTime: 0.3, reach: 34 },
  },
  armour: { cost: 10, max: 2, reduction: 0.15, mass: 0.8 },
  bump: { minSpeed: 5, mul: 0.8 },
  landing: { minSpeed: 7, mul: 2.2 },
  hammerAngles: { rest: -1.75, strike: 0.05 },

  // ---- AI OPPONENTS: one per Claude model; the model choice = difficulty -------------
  // label/tier/desc/color/build are read by the builder; the rest tunes the AI brain.
  ai: {
    // Brain tuning (all AI): reaction = perception lag (s); decisionInterval = re-plan period (s);
    // predict = 0..1 how far it extrapolates your motion over its lag; aimError = px noise on range reads;
    // fireSlop = px it will swing early (whiffs); randomFire/mistakeRate/dashRate/hopRate = chance per second;
    // defendRate = chance to block/dodge a telegraphed attack; dodgeBias = dodge vs block preference;
    // pitMargin = px it keeps from a pit; aggression = 0..1 engage when ready; punish = 0..1 attack your cooldowns;
    // readsBlock = waits out your block; retreatBelow = HP% to back off; spacing = px kept outside your reach;
    // spacingGain = px per full drive (lower = tighter footsies); wobble = random drive jitter; pitPushRoom = px.
    haiku:  { label: 'Claude Haiku',  tier: 'Easy',   color: '#4ade80', desc: 'Quick but sloppy. Swings wildly, rarely dodges.',
              build: { chassis: 'light',  wheels: 'small', weapon: 'ram',     armour: 0 },
              reaction: 0.45, decisionInterval: 0.3, predict: 0, aimError: 45, fireSlop: 80, randomFire: 0.35,
              mistakeRate: 0.2, defendRate: 0.1, dodgeBias: 0.5, dashRate: 0.12, hopRate: 0.15, pitMargin: 25,
              aggression: 1, punish: 0, readsBlock: false, retreatBelow: 0, spacing: 0, spacingGain: 70, wobble: 0.45,
              pitPush: false, pitPushRoom: 0 },
    sonnet: { label: 'Claude Sonnet', tier: 'Medium', color: '#fbbf24', desc: 'Solid fighter. Times attacks, backs off when hurt.',
              build: { chassis: 'medium', wheels: 'large', weapon: 'hammer',  armour: 1 },
              reaction: 0.25, decisionInterval: 0.14, predict: 0.5, aimError: 14, fireSlop: 0, randomFire: 0,
              mistakeRate: 0.05, defendRate: 0.45, dodgeBias: 0.35, dashRate: 0.6, hopRate: 0.03, pitMargin: 120,
              aggression: 0.7, punish: 0.35, readsBlock: false, retreatBelow: 0.3, spacing: 25, spacingGain: 60, wobble: 0.1,
              pitPush: false, pitPushRoom: 0 },
    opus:   { label: 'Claude Opus',   tier: 'Hard',   color: '#c084fc', desc: 'Reads you. Punishes cooldowns and corners you at the pit.',
              build: { chassis: 'medium', wheels: 'large', weapon: 'flipper', armour: 1 },
              reaction: 0.1, decisionInterval: 0.05, predict: 0.9, aimError: 4, fireSlop: 0, randomFire: 0,
              mistakeRate: 0.02, defendRate: 0.72, dodgeBias: 0.45, dashRate: 3, hopRate: 0, pitMargin: 140,
              aggression: 0.3, punish: 0.9, readsBlock: true, retreatBelow: 0, spacing: 18, spacingGain: 35, wobble: 0,
              pitPush: true, pitPushRoom: 230 },
  },

  // ---- PLAYER CONTROLS: arrows move, WASD = moves -------------------------------------
  // Same rules for the human and the AI. Times in seconds, speeds in px/step (60 Hz).
  controls: {
    overdrive: 1,                  // builder-made bots (human + AI) ignore the budget, so no overdrive bonus
    bufferSeconds: 0.15,           // a move pressed this long before it is ready still fires
    keys: { left: ['ArrowLeft'], right: ['ArrowRight'], hop: ['ArrowUp'], brake: ['ArrowDown'],
            attack: ['KeyW'], dodge: ['KeyA'], block: ['KeyS'], dash: ['KeyD'] },
    hop:    { velocity: 5.6, cooldown: 0.6, groundTol: 4 },          // ~56 px: still too low to leapfrog
    brake:  { factor: 0.55 },                                         // wheel spin kept per tick while braking
    attack: { revCooldown: 0.5, revTime: 0.3, revDamageMul: 1.15 },     // spinner W = rev burst
    dodge:  { cooldown: 1.2, time: 0.32, speed: 10, lift: 1.5, reduction: 0.6, spinMul: 1.6, safeRoom: 130 },
    block:  { maxHold: 1.6, cooldown: 2.2, releaseCooldown: 0.35, regenSeconds: 1.8, minStamina: 0.25,
              reduction: 0.65, driveMul: 0.35, launchMul: 0.3, knockMul: 0.4, downforce: 0.3, spinDamp: 0.8 },
    dash:   { cooldown: 2.2, time: 0.35, speed: 11, spinMul: 1.8, damage: 7, speedMul: 0.8, knock: 3, reach: 170 },
  },

  // ---- SIMPLE BUILDER: Body / Attack / Defence cards -----------------------------------
  builder: {
    storageKey: 'roboOlympics.builder.v2',
    defaultModel: 'sonnet',
    defaults: { name: 'Blue Thunder', body: 'brawler', attack: 'spinner', defence: 'plated' },
    // card -> part mapping (stat bars are computed from the CONFIG.chassis/wheels/weapons/armour numbers)
    body: {
      scout:   { name: 'Scout',   icon: '\u{1F3CE}\uFE0F', desc: 'Light and zippy. Hard to pin down.', chassis: 'light',  wheels: 'small' },
      brawler: { name: 'Brawler', icon: '\u{1F916}',        desc: 'Balanced frame with strong grip.',   chassis: 'medium', wheels: 'large' },
      tank:    { name: 'Tank',    icon: '\u{1F6E1}\uFE0F', desc: 'Slow, heavy and very sturdy.',       chassis: 'heavy',  wheels: 'large' },
    },
    attack: {
      spinner: { name: 'Spinner', icon: '\u{1F300}', desc: 'Buzzsaw. Shreds on contact.',   weapon: 'spinner' },
      hammer:  { name: 'Hammer',  icon: '\u{1F528}', desc: 'Big overhead smash.',           weapon: 'hammer' },
      flipper: { name: 'Flipper', icon: '\u{1F94F}', desc: 'Launch them. Flip them over.',  weapon: 'flipper' },
      ram:     { name: 'Ram',     icon: '\u{1F40F}', desc: 'Charge up speed for damage.',   weapon: 'ram' },
    },
    defence: {
      agile:    { name: 'Agile',    icon: '\u{1F4A8}', desc: 'No armour. Maximum speed.',    armour: 0 },
      plated:   { name: 'Plated',   icon: '\u{1F9BE}', desc: 'One plate. Takes less damage.', armour: 1 },
      fortress: { name: 'Fortress', icon: '\u{1F3F0}', desc: 'Two plates. Hard to hurt.',    armour: 2 },
    },
    typicalSpeed: 6,   // rough closing speed of a Ram/Spinner hit (only used for the stat bars)
  },

  // ---- GRAPHICS -----------------------------------------------------------------------
  fx: {
    maxParticles: 260,    // hard cap on live particles (perf)
    maxSparks: 40, maxDebris: 10, debrisMin: 12,   // debris chunks appear on hits >= debrisMin damage
    ringLife: 0.3,        // impact ring seconds
    hitFlash: 0.12,       // white flash on the hit robot (seconds)
    shakeDecay: 0.85,     // per-frame screen shake decay
    trailMax: 7, trailFade: 6,   // dash afterimages
  },
};
