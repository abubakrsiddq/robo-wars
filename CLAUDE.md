# Robo Olympics

A 2D robot fighter with real physics. **Single player: you (keyboard) vs a Claude AI bot.** The opponent model
sets the difficulty: Haiku = Easy, Sonnet = Medium, Opus = Hard (behaviour profiles in `CONFIG.ai`, no API calls yet).
You build your robot from simple cards (Body / Attack / Defence). Controls: ← → drive, ↑ hop, ↓ brake;
W attack, A dodge, S block, D dash. The original bot-vs-bot English-strategy mode stays as the test harness (`#auto`).
Inspirations: Mortal Kombat, Dragon Ball Z, WWE, Street Fighter, Smash Bros. Full design: `GAME_PLAN.md`.

## Hard constraints
- **No build step, no frameworks.** `index.html` (markup + CSS) loads `src/*.js` as plain classic `<script>` tags.
  **No ES modules** (`import`/`export` break on `file://`), and no `fetch`/network.
- Physics: **Matter.js 0.19.0** from `https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js`.
- Must run by opening `index.html` directly in a browser. Target 60 fps on a laptop. No console errors.
- `tools/` is dev-only (test harness and guardrails). The game must never depend on it.

## Components (`src/`, load order matters)
`config` → `parts` → `ai` → `character` → `arena` → `controls` → `combat` → `fx` → `hud` → `builder` → `main`.
APIs, data contracts and CONFIG-key ownership are in **`docs/ARCHITECTURE.md`**, the source of truth for boundaries.
- Each file starts with `'use strict';` and an `OWNS / EXPORTS / READS` header. Only use another file's EXPORTS.
- Top-level code that runs at load time may only use names from earlier files (check.js can't catch this).
- **All tunable numbers live in `CONFIG`** (`src/config.js`). Don't hard-code balance values elsewhere.
- `PARTS.geometry(build, facing)` is the single source of robot shape, used by both the builder preview and physics.
- Every robot (human, AI, strategy bot) goes through the same action object
  `{ drive, jump, attack, dodge, block, dash, mode }`, so the AI obeys the same rules and cooldowns as the player.
- AI brains (`aiBehaviour(model)`) and `strategyToBehaviour(text)` are always called inside try/catch with `FALLBACK`.
  Keep the `// TODO: replace with Claude API call…` marker.
- Robot parts carry `part.robot` and `part.robo.role` (`chassis | wheel | spinner | ram | flipper`) for collision handling.
- Physics runs at a fixed 60 Hz step. Slow-mo uses `engine.timing.timeScale`, never a variable delta.

## Guardrails and parallel work
- Before committing, run `cd tools && node check.js --fights 10`. It must print `OK`. It checks load order, headers,
  EXPORTS and boundaries, forbidden constructs, and new magic numbers in gameplay files (against
  `tools/numbers-baseline.json`; `// cfg-ok` exempts a line). Then it runs headless fights.
- Parallel workers each own **one component file plus their CONFIG keys**. Changing an EXPORT or a shared contract
  means updating the file header and `docs/ARCHITECTURE.md` in the same commit.
- Only regenerate the number baseline (`--update-baseline`) deliberately, never just to silence a failure.

## Testing
- **Headless balance and smoke test** (real Matter.js, stubbed DOM):
  `cd tools && npm i && node autotest.js ../index.html 40`
  It runs N random fights and prints one line per fight plus any `console.warn` output. Look for: no `ERROR`/`UNCAUGHT`,
  `warnings: []`, a healthy mix of win methods (KO / Pit / Flip / Time), and no weapon dominating.
- **AI difficulty test:** `node autotest.js ../index.html 60 ai` runs AI vs AI and prints a win-rate matrix.
  Target ordering: Opus > Sonnet > Haiku.
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
- Give parallel subagents **separate component files** (in worktrees for big jobs) and merge carefully.

## Status / next up
- v2: single player vs Claude AI (Haiku/Sonnet/Opus), keyboard controls, card builder, graphics overhaul,
  split into `src/` components with guardrails.
- Known issues: Sonnet vs Haiku difficulty gap is weak or noisy (Opus is clearly hardest). Couplings to clean up
  (see ARCHITECTURE.md): `createRobot` builds AI brains and reads `AUTO`; `combat.js` writes `autolog`.
- Candidates: sound (WebAudio), real Claude API opponents, tournament mode, more arenas, balance.
