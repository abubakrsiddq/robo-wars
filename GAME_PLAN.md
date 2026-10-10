# Robo Olympics: Game Plan & Strategy Design

> Two players build robots from parts, describe a strategy in plain English, and
> watch the robots fight on their own using real 2D physics.
> Deliverable v1: one self-contained `index.html` (Matter.js 0.19.0 from CDN, no build step).

---

## 1. Vision & pillars

| Pillar | What it means in practice |
|---|---|
| **Build** (the meta-game) | A 100-point budget forces trade-offs. Every part changes the physics: mass, grip, reach. |
| **Brief** (the mind-game) | Your English strategy is your "fighter AI". Players see exactly how their words were read. |
| **Watch** (the spectacle) | Physics-driven chaos with fighting-game polish: hit sparks, shake, slow-mo KOs, announcer calls. |

The player never controls the fight directly. **All skill lives in the build and the brief.**
That makes it a "coach" game: the fun comes from predicting and countering your opponent.

---

## 2. Inspiration board: what we borrow from each

| Game | Borrowed mechanic | Where it shows up in v1 |
|---|---|---|
| **Mortal Kombat** | "FINISH IT!" call, slow-mo KO, brutal hit feedback | Banner when a bot drops below 25% HP; 0.3x slow-mo on KO |
| **Dragon Ball Z** | Power-up aura, comeback surges, huge launches | **Rage Mode**: under 25% HP a bot gets a flame aura and +20% damage. Flipper launches send bots flying |
| **WWE** | Entrances, crowd, ring-outs, the showman feel | "NAME vs NAME" intro card, crowd + LED board, **pit ring-outs**, a "push them into the pit" strategy |
| **Street Fighter** | Clean HUD: mirrored health bars, centre timer, "FIGHT!" | Top HUD with a delayed "ghost" damage bar |
| **Super Smash Bros** | Knockback and ring-out as a win route besides HP | Spinner knockback scales with spin; pits at both edges |
| *(Robot Wars / BattleBots)* | Self-righting, flips, wedges, spinners | Flipper and Hammer can self-right; Spinner and Ram can't (a real trade-off) |

---

## 3. Core loop

```
 BUILD (parts + budget) ──► BRIEF (English strategy) ──► FIGHT (auto, 60 s) ──► RESULT
        ▲                                                                          │
        └──────────────── Rematch (same bots) / Back to Builder ◄──────────────────┘
```

A round lasts about 60–90 s, so you can iterate quickly: lose, tweak one word or one part, rematch.

---

## 4. Screens

1. **Builder**: two mirrored panels (P1 blue, P2 red). Each has a name, parts picker, live budget bar,
   live preview, strategy box with preset chips, a parsed-parameter readout, and a Ready toggle.
   The centre column has VS, **FIGHT!** (enabled only when both are Ready), and **Random Match**.
2. **Fight**: side-view arena laid out as wall | pit | floor | pit | wall. HUD on top. Intro card, then "FIGHT!".
3. **Result**: winner, method (KO / Flip / Pit / Time), stats table, **Rematch** and **Back to Builder**.

---

## 5. Systems

### 5.1 Parts & budget (all numbers in one `CONFIG` object)

| Part | Cost | Effect |
|---|---|---|
| Chassis Light / Medium / Heavy | 20 / 35 / 50 | 80 / 120 / 170 HP, speed x1.25 / x1.0 / x0.78, mass 3 / 5 / 8 |
| Wheels Small / Large | 10 / 20 | Small: fast acceleration, low grip. Large: high grip and more pushing power |
| Spinner | 25 | Front drum. Damage ~ relative velocity + spin. Spin drops after each hit, then spins back up |
| Hammer | 25 | Overhead strike on cooldown. x1.6 damage on flipped bots. Can self-right |
| Flipper | 20 | Low ramp + launch impulse (smaller on heavier bots). Damage mostly from the **landing**. Can self-right |
| Ram | 10 | Low wedge. Damage = closing speed x multiplier. "Fire" = short speed boost |
| Armour plate (0–2) | 10 each | -15% incoming damage per plate. Adds mass |

**Strategy refinement: Overdrive.** In the original spec, Light builds can't spend their budget
(max Light spend is 85), so cheap builds are strictly worse. **Unspent points become Overdrive: +1.5% speed per point.**
"Cheap and fast" becomes a real choice instead of a mistake.

### 5.2 Budget archetypes (sanity check that the build space is interesting)

| Archetype | Build | Cost | Effective HP* | Identity |
|---|---|---|---|---|
| Tank Spinner | Heavy + Large + Spinner | 95 | 170 | Slow, devastating, can't self-right |
| Brick | Heavy + Large + Ram + 2 armour | 100 | 243 | Unflippable pusher, ring-out king |
| All-rounder | Medium + Large + Spinner + 2 armour | 100 | 171 | Safe pick |
| Launcher | Medium + Large + Flipper + 2 armour | 95 | 171 | Flip-then-hammer-style finisher |
| Glass Cannon | Light + Small + Spinner | 55 | 80 | +45 pts Overdrive (+68% speed) |
| Hammer Turtle | Medium + Large + Hammer + 2 armour | 100 | 171 | Waits, punishes flips |

\*Effective HP = HP / (1 − armour reduction)

### 5.3 Intended counter cycle (balance target, tune via CONFIG)

```
   Spinner ──beats──► Hammer      (out-damages it up close, knockback interrupts swings)
   Hammer  ──beats──► Ram         (strikes from above while being pushed; wedge doesn't help)
   Ram     ──beats──► Flipper     (heavy bricks resist launches, low wedge gets under first)
   Flipper ──beats──► Spinner     (flips it; spinner has no self-right → 5 s Flip KO)
```
Chassis and armour bend these match-ups but shouldn't flip them completely. Wheels decide who wins pushing contests.

### 5.4 Fight rules
- 60 s timer. Win by **KO** (HP 0), **Flip** (upside down 5 s), **Pit** (fell in).
- Time-out: higher HP% wins, equal is a draw.
- **Anti-stall (refinement):** if nobody deals damage for 8 s, both bots become "impatient":
  +0.3 aggression and they ignore their `attackWhen` gate. Two "wait for them" strategies can't produce a 60 s standoff.

---

## 6. Strategy system (the heart of the game)

### 6.1 Pipeline
```
English text ──► strategyToBehaviour(text) ──► { params, tags, decide(state) }
                       (v1: keyword parser)          │
                 // TODO: Claude API returns          ▼
                 //       a decide() function    every physics tick:
                                                 decide(state) → { drive: -1..1, fire: bool, mode }
                                                 wrapped in try/catch → FALLBACK chase AI
```

### 6.2 Parameters (spec + refinements)

| Param | Range | Default | Keywords (examples) |
|---|---|---|---|
| `aggression` | 0–1 | 0.55 | +: aggressive, charge, rush, nonstop, smash. −: defensive, wait, patient, "don't rush" |
| `preferredDistance` | px | 150 | "keep distance / stay back" → 240+. "200px" → 200. Aggressive → 60 |
| `attackWhen` | always / enemyClose / enemyFlipped / enemyLowHealth | always | "when they get close", "when they flip / are flipped", "finish them off / when they are weak" |
| `retreatBelowHealth` | 0–1 | 0 | "retreat when low" → 0.3, "run at 40%" → 0.4 |
| `edgeCaution` *(new)* | 0–1 | 0.6 | "avoid the edge" → 1.0, "reckless / yolo" → 0.15 |
| `pitPush` *(new)* | bool | false | "push them into the pit", "ring out" |
| `feint` *(new)* | bool | false | bait, juke, feint, dodge, zig-zag |

The parser also handles negation ("don't charge") and a retreat clause ("retreat when low") is removed
before the rest of the text is parsed, so "low" there isn't read as `enemyLowHealth`.

### 6.3 `decide()` is a small state machine

```
            ┌────────── hp < retreatBelowHealth AND losing ──────────┐
            ▼                                                        │
        RETREAT ◄─────────────────────────────────────────────┐      │
            │ (impatient overrides)                           │      │
            ▼                                                 │      │
  HOLD ──(attackWhen satisfied OR impatient OR cornered)──► ENGAGE ──┘
   ▲   keep preferredDistance·(1.25 − 0.5·aggr), optional feint wobble
   └──────────────(condition lost)───────────────────────────┘

Overlays applied every tick:
  EDGE     – if driving toward a pit inside the margin (50 + 110·edgeCaution px), back off,
             unless actively shoving the enemy out (pitPush allows going right to the lip)
  RING-OUT – pitPush + enemy near an edge → full throttle
  CORNERED – holding/retreating but out of room → turn and fight
  FIRE     – weapon-specific: hammer/flipper fire when enemy in front & in range;
             ram fires boost on approach; flipped bot fires to self-right
```

### 6.4 State passed to `decide()`
`me` and `enemy` (x, y, vx, vy, angle, health, hpPct, flipped, rage, weapon), `dx`, `distance`,
`enemyInFront`, `isEnemyFlipped`, `weaponReady`, `weaponRange`, `time`, `stallTime`, `arena {left,right}`.

### 6.5 Claude upgrade path (post-v1)
1. Send the strategy text plus the state schema to Claude and ask for a pure `decide(state)` function body.
2. Run it in a sandbox (Web Worker or `new Function` with a frozen state copy) with a 1 ms time budget per tick.
3. If it throws or times out, fall back to the keyword behaviour (the try/catch path is already in place).
4. Show a one-line "Claude read your strategy as: …" summary instead of the param chips.

---

## 7. Juice / feedback checklist
- [x] Sparks sized by damage, in the attacker's colour
- [x] Screen shake when damage > 15
- [x] Floating damage numbers
- [x] 0.3x slow-mo for 1.5 s on KO / Pit / Flip
- [x] Intro card "A vs B", "FIGHT!", "FINISH IT!", "K.O.!" / "RING OUT!" / "FLIPPED!"
- [x] Rage aura, ram boost flames, spinner motion blur, flip countdown over the stuck bot
- [x] Ghost damage bar (Street Fighter style)
- [ ] Sound (v2: WebAudio bleeps, crowd roar)

---

## 8. Build milestones (following the brief's "How to work")

| # | Milestone | Done when |
|---|---|---|
| 1 | Arena + one robot driving | Wheels grip, robot doesn't jitter, falls into pits |
| 2 | Second robot + chase loop | Both drive at each other, collide believably |
| 3 | Weapons + damage + win conditions | All 4 weapons hurt; KO / Flip / Pit / Time all trigger |
| 4 | Builder + strategy parser | Budget blocks Ready; parsed params visible |
| 5 | Effects + result screen | Rematch and Back work without reload; no console errors |

The rough prototype (`index.html`) covers all five at "first playable" quality so we can judge the feel before polishing.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Physics explosions / jitter from constraints | Fixed 60 Hz step, soft wheel suspension, spinner is light and pinned |
| Robots end up facing away from each other (no turning in 2D) | Drive is relative to the weapon side; a bot drives backwards to chase. Flipper/Hammer self-right |
| Stalemates | Anti-stall impatience at 8 s |
| One weapon dominates | All numbers in CONFIG; add a `#auto` headless mode that runs random matches and logs win methods |
| Bad strategy code (future Claude output) | try/catch + FALLBACK, output clamped and NaN-checked |

---

## 10. After v1
Tournament mode (best of 3, bracket), more arenas (spike strips, a moving hazard, a "WWE ring" with ropes),
part unlocks, replay sharing, Claude-generated strategies and a Claude commentator.
