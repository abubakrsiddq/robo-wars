# Robo Olympics architecture

The game is plain HTML + classic `<script src>` files (no modules, no build step, works from `file://`).
`index.html` holds the markup, CSS and the script tags. All JS lives in `src/`. Everything is a top-level
`const`/`function` in the shared global scope, so **file order matters only for code that runs at load time**
(a file may call any name from an *earlier* file at load; names from later files only inside functions).

## Components and load order

Load order (also the canonical list in `tools/check.js`):
`config -> parts -> ai -> character -> arena -> controls -> combat -> fx -> hud -> builder -> main`

The table is copied from each file's header block (the headers are the source of truth; `node tools/check.js` verifies them).

| # | File | Purpose; owns | Exports | Reads |
|---|---|---|---|---|
| 1 | `src/config.js` | shared helpers + every tunable number. Owns: CONFIG (all balance/tuning numbers), the Matter.js destructuring, tiny math/random helpers | `Engine` `Bodies` `Body` `Composite` `Constraint` `Events` `Vertices` `clamp` `lerp` `rand` `pick` `CONFIG` | `Matter` |
| 2 | `src/parts.js` | part costs, geometry (builder preview + physics), random builds. Owns: PARTS: cost, geometry, fromCards, randomBuild, randomName; name word lists | `PARTS` | `CONFIG` `pick` |
| 3 | `src/ai.js` | English strategy -> behaviour, fallback brain, per-model AI brains. Owns: STRATEGY_PRESETS, strategyToBehaviour (TODO Claude API hook), FALLBACK, aiBehaviour (decide() returning actions) | `STRATEGY_PRESETS` `strategyToBehaviour` `FALLBACK` `aiBehaviour` | `CONFIG` `clamp` `lerp` `rand` `pick` |
| 4 | `src/character.js` | build Matter bodies for a robot; draw robots and their cues. Owns: createRobot (runtime robot fields), robot-local geometry helpers, hammer/flip animation curves, drawRobot, chassis/wheel/spinner/shield/trail drawing | `createRobot` `rectCentre` `localToWorld` `hammerAngle` `flipAngle` `drawRobot` `drawChassisLocal` `drawWheel` `drawSpinner` | `CONFIG` `PARTS` `clamp` `lerp` `Bodies` `Body` `Composite` `Constraint` `Vertices` `ctx` `roundRect` `shade` `outlinedText` `fight` `AUTO` `AUTO_AI` `TAU` `aiBehaviour` `rand` `strategyToBehaviour` |
| 5 | `src/arena.js` | physics world (floor, walls, pit gaps) + stadium drawing. Owns: createArenaWorld, cached offscreen static layers, drawArena | `createArenaWorld` `drawArena` | `CONFIG` `rand` `Engine` `Bodies` `Composite` `ctx` `fight` `roundRect` `shade` `mulberry32` `outlinedText` `TAU` `pick` |
| 6 | `src/controls.js` | keyboard input and the single action -> physics path. Owns: INPUT state, humanAction, getAction (human/AI/strategy -> action), cooldown ticking, applyAction (drive/hop/brake/attack/dodge/block/dash) | `INPUT` `IDLE_ACTION` `getAction` `humanAction` `setCd` `tickMoves` `applyAction` `isGrounded` | `CONFIG` `clamp` `Body` `fight` `FALLBACK` `buildState` `fireWeapon` `sparks` `dust` `floatText` `rectCentre` `setAllVelocity` |
| 7 | `src/combat.js` | weapons, collision damage, win conditions. Owns: fireWeapon, weapon impacts, collision handling, damage/rage/block reduction, checkWin, endFight | `fireWeapon` `setAllVelocity` `selfRight` `flipperImpact` `hammerImpact` `handlePair` `damage` `checkWin` `endFight` | `CONFIG` `clamp` `rand` `Body` `Events` `fight` `AUTO_AI` `autolog` `localToWorld` `rectCentre` `sparks` `dust` `floatText` `setBanner` |
| 8 | `src/fx.js` | particles, floating text, banners, screen shake and generic canvas helpers. Owns: canvas handle (cv, ctx), particle/text/banner updates and drawing, roundRect/shade/outlinedText/esc/mulberry32 | `cv` `ctx` `TAU` `mulberry32` `esc` `sparks` `dust` `floatText` `setBanner` `updateEffects` `drawParticles` `outlinedText` `roundRect` `shade` | `CONFIG` `clamp` `rand` `fight` `rectCentre` |
| 9 | `src/hud.js` | in-fight HUD, intro countdown, banners, result screen. Owns: drawHUD (health bars, move bar), drawIntro, drawBanner, showResult | `skewPath` `drawHUD` `showResult` | `CONFIG` `clamp` `ctx` `fight` `AUTO` `autoNext` `roundRect` `outlinedText` `esc` `shade` `TAU` |
| 10 | `src/builder.js` | card-based builder screen, previews, player setup, persistence. Owns: players[], cards, setModel, localStorage save/load, builder panels and previews | `cards` `players` `setModel` `saveChoices` `loadChoices` `buildPanel` `refreshPanel` | `CONFIG` `PARTS` `drawChassisLocal` `drawWheel` `drawSpinner` `roundRect` |
| 11 | `src/main.js` | per-fight lifecycle, fixed-step loop, state for decide(), render pipeline, wiring, #auto mode. Owns: fight (the live fight object), rafId, AUTO flags, startFight/teardown/backToBuilder, frame/step, buildState, controlRobot, render, DOM button wiring, auto-mode loop | `fight` `AUTO` `AUTO_AI` `STEP` `startFight` `backToBuilder` `buildState` `controlRobot` `render` `autolog` `autoNext` | `CONFIG` `PARTS` `Events` `Composite` `Engine` `performance` `STRATEGY_PRESETS` `pick` `createRobot` `createArenaWorld` `handlePair` `checkWin` `getAction` `applyAction` `tickMoves` `hammerImpact` `INPUT` `IDLE_ACTION` `updateEffects` `setBanner` `showResult` `drawArena` `drawParticles` `drawRobot` `drawHUD` `outlinedText` `ctx` `clamp` `rand` `players` `setModel` `loadChoices` `buildPanel` `refreshPanel` `Body` `isGrounded` |


Boundary judgement calls:
- `isGrounded` lives in `controls.js` (the hop rule needs it); `buildState` in `main.js` reads it.
- `hammerAngle` / `flipAngle` (weapon animation curves) live in `character.js`; `combat.js` and the drawing code share them.
- `createArenaWorld()` (engine + floor + walls) was extracted from `startFight` into `arena.js`; `startFight` calls it.
- `createRobot` (character.js) also instantiates the controller's `behaviour` (`aiBehaviour` / `strategyToBehaviour`).
- `getAction` (controller -> action, with the `FALLBACK` try/catch) is in `controls.js`; `buildState` (the `state` for `decide()`) is in `main.js`.
- `controlRobot` (per-tick timers + weapon animation + `getAction` + `applyAction`) is the orchestration step, so it is in `main.js`.
- `cv`/`ctx` (the canvas handle) and `esc`, `mulberry32`, `TAU` are in `fx.js`; every drawing file reads `ctx` from there.
- `pick` and `rand` are shared helpers in `config.js`. `endFight` (combat.js) calls `autolog` (main.js) when `AUTO_AI` is set.

## Data contracts

### CONFIG key ownership
All tunable numbers live in `CONFIG` (`config.js`). Each key is *owned* by one component: that component's owner edits the values.
Everyone else only reads them.

| CONFIG key | Owner |
|---|---|
| `budget`, `overdrivePerPoint` | parts (`PARTS.cost/overdrive`) |
| `chassis`, `wheels`, `armour` | parts + character (shape/mass) |
| `weapons` | combat |
| `bump`, `landing`, `bigHit`, `rageBelow`, `rageDamageBonus`, `flipKOSeconds`, `stallSeconds`, `fightSeconds` | combat |
| `hammerAngles` | character (animation) + combat |
| `slowMo`, `introSeconds` | main (fight loop) |
| `arena` | arena |
| `ai` (per-model brains + builds) | ai |
| `controls` (keys, hop, brake, attack, dodge, block, dash) | controls |
| `builder` | builder |
| `fx` | fx (+ character/arena for look-and-feel keys) |

### Build object
`{ chassis: 'light'|'medium'|'heavy', wheels: 'small'|'large', weapon: 'spinner'|'hammer'|'flipper'|'ram', armour: 0|1|2 }`.
Produced by `PARTS.fromCards(cards)`, `PARTS.randomBuild()` or `CONFIG.ai[model].build`.
`PARTS.geometry(build, facing)` is the single source of robot shape (builder preview and physics).

### players[]
Defined in `builder.js`, read by `main.js` (`startFight`) and `character.js` (`createRobot`).
```
players[0] = { id:0, color, facing:1,  name, controller:'human', build, strategy }
players[1] = { id:1, color, facing:-1, name, controller:'ai', model:'haiku'|'sonnet'|'opus', build, strategy }
```
`controller` is `'human'` (keyboard), `'ai'` (`CONFIG.ai[model]`) or `'strategy'` (English text; used by `#auto`).
`setModel(model)` copies label/color/build from `CONFIG.ai[model]` into `players[1]`.

### Robot runtime object (`createRobot` in character.js; `fight.robots[i]`)
- identity/physics: `player, name, color, build, g (geometry), f (facing +1/-1), body, wheels[], spinner, cons[], all[], rectOffset, totalMass`
- health: `maxHp, hp, ghost (delayed bar), rage, stats{dealt, biggest, hits}`
- weapon: `cooldown, spin, hammerT, flipT, boostT, overdrive, revT`
- state flags: `flipped, flippedTime, mode, warned`
- controller: `controller, model, behaviour` (`{params, tags?, decide}`)
- action system (read by the HUD): `blocking, blockHold (0..1 stamina used), dashT, dodgeT, hopCd, dashDir, dodgeDir, dashHit`
- `moves: { attack, dodge, block, dash }`, each `{ cd (seconds left, 0 = ready), max (full cooldown), key ('W'|'A'|'S'|'D') }`
- bookkeeping: `lastSpinHit, lastLand, lastBump, lastHitBy, lastHitAt, lastBlockText`
- every Matter body carries `body.robot` and `body.robo.role` (`chassis|wheel|spinner|ram|flipper`)

### Action object (one per robot per tick; consumed only by `applyAction`)
`{ drive: -1..1, jump, attack, dodge, block, dash, brake, mode }`. `drive` is a screen direction for human/AI actions
(for `strategy` bots `decide` returns drive relative to facing and `getAction` multiplies by `r.f`). `IDLE_ACTION` is the all-false default.
Human actions come from `humanAction` (keys in `CONFIG.controls.keys`, with an input buffer). AI/strategy actions come from `behaviour.decide(state)`.
`decide` is always called inside try/catch with `FALLBACK`.

### `state` passed to `decide()` (built by `buildState(r, en)` in main.js)
```
{ me, enemy,   // snapshots: x,y,vx,vy,angle,health,maxHealth,hpPct,facing,flipped,rage,weapon,grounded,
               //   blocking,blockHold,dashT,dodgeT,spinFrac,attacking, moves{attack,dodge,block,dash} (cooldown seconds)
  dx, distance, enemyInFront, isEnemyFlipped, weaponReady, weaponRange, enemyRange,
  meInEnemyFront, closing, time, stallTime, arena:{left,right} }
```
`decide(state)` returns `{ drive, fire (strategy) | attack/jump/dodge/block/dash/brake (ai), mode }`.
`strategyToBehaviour(text)` returns `{ params, tags, decide }` (keep the `TODO: replace with Claude API call` marker in `ai.js`).

### Fight object (`fight`, main.js)
`{ engine, robots[2], floorL, floorR, phase:'intro'|'fight'|'ko'|'result', introT, time, clock, stall, koT, slow, winner, method,
shake, particles[], texts[], banner, last, acc, crowd[] }` plus `layer` (arena cache, arena.js). Physics is a fixed 60 Hz step
(`step`); slow-mo only changes `engine.timing.timeScale`.

## How to work in parallel
1. Edit **only your component file** and the `CONFIG` keys you own. Do not hard-code balance numbers elsewhere
   (the checker flags new numeric literals in `ai/character/controls/combat`; use `CONFIG`, or `// cfg-ok` on the line if it is not a tunable).
2. If you change an **EXPORT** (add/remove/rename) or any **contract** above, update this document and the file header
   (`EXPORTS`/`READS`) in the same commit. The checker fails when a file uses another file's name that is not in that file's `EXPORTS`.
3. Load-time code (top-level statements) may only use names from earlier files. Anything else goes inside a function or into `main.js` (BOOT).
4. No ES modules, no `fetch`/network, no `tools/` references, no `setInterval` physics, Matter stays at 0.19.0.
5. Before committing: `cd tools && node check.js --fights 10` (static checks + headless fights in normal and `ai` mode).
   After intentional new tunables are moved into place, regenerate the baseline with `node check.js --update-baseline`.
6. The harness cannot judge visuals or feel: open `index.html` in a browser too.
