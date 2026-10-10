# Robo Olympics

A 2D robot fighting auto-battler. Two players build robots from parts (100-pt budget), write a strategy
in plain English, and watch the robots fight with real physics. Inspirations: Mortal Kombat, Dragon Ball Z,
WWE, Street Fighter, Smash Bros. Full design: `GAME_PLAN.md`.

## Hard constraints
- The game is **one self-contained file: `index.html`** (HTML + CSS + JS inline). No build step, no frameworks.
- Physics: **Matter.js 0.19.0** from `https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js`.
- Must run by opening `index.html` directly in a browser. Target 60 fps on a laptop. No console errors.
- `tools/` is dev-only (test harness). The game must never depend on it.

## Code layout (inside `index.html`)
Keep these clearly marked sections, in this order:
`CONFIG` → `PARTS` → `STRATEGY` → `BUILDER UI` → `ROBOT FACTORY` → `FIGHT LOOP` → `DAMAGE` → `EFFECTS` → `RESULT SCREEN` → `BOOT`.
- **All tunable numbers live in `CONFIG`.** Don't hard-code balance values elsewhere.
- `PARTS.geometry(build, facing)` is the single source of robot shape, used by both the builder preview and physics.
- `strategyToBehaviour(text)` returns `{ params, tags, decide(state) }`. `decide` returns `{ drive: -1..1, fire, mode }`.
  It is always called inside try/catch with `FALLBACK`. Keep the `// TODO: replace with Claude API call…` marker.
- Robot parts carry `part.robot` and `part.robo.role` (`chassis | wheel | spinner | ram | flipper`) for collision handling.
- Physics runs at a fixed 60 Hz step. Slow-mo uses `engine.timing.timeScale`, never a variable delta.

## Testing
- **Headless balance and smoke test** (real Matter.js, stubbed DOM):
  `cd tools && npm i && node autotest.js ../index.html 40`
  It runs N random fights and prints one line per fight plus any `console.warn` output. Look for: no `ERROR`/`UNCAUGHT`,
  `warnings: []`, a healthy mix of win methods (KO / Pit / Flip / Time), and no weapon dominating.
- In the browser, `index.html#auto40` runs the same auto mode visually.
- Headless Edge `--virtual-time-budget` hangs with this game loop, so don't use it.
- After changes, also open `index.html` in a browser for a feel check. The harness can't judge visuals or feel.

## Work style (model delegation)
- **Opus 5.5 (main session)**: planning, game design, architecture, complex or cross-cutting changes, and
  reviewing and merging all subagent output.
- **Subagents, model chosen by need** (Agent tool `model` override):
  - `opus`: tricky subtasks (physics or AI behaviour, hard debugging, the Claude `decide()` sandbox)
  - `sonnet`: standard implementation from a clear spec (UI sections, effects, sound, refactors, balance sweeps)
  - `haiku`: mechanical work (searches, renames, summarising test logs and stats)
- Plan first, then split into independent subtasks with precise specs and run them in parallel where possible.
- Don't delegate trivial one-step edits. After integrating, report which model handled what.
- Since everything is in one file, give parallel subagents **non-overlapping sections** (or worktrees) and merge carefully.

## Status / next up
- v1 first cut done: builder, strategy parser, 4 weapons, 4 win methods, effects, result screen.
- Candidates: balance (Flipper slightly strong, results noisy), sound (WebAudio), Claude-generated strategies,
  tournament mode, more arenas.
