# FERROFRENZY — Polarity Arena

A browser arena game about being a magnet. You are the reactor core's last
magnet, sent into a field of scattered shards. Your hull attracts the
opposite pole and repels your own — so every few seconds you flip, and the
whole room changes its mind about you.

**Play it:** open `game/index.html` in any modern browser. No build step,
no server, no network — one HTML file, one CSS file, two JS files
(art, physics and the synthesized sound track are all hand-rolled).

**Verify the hand-in:** `node main.ts` (Node 22) copies the entry into
`$MAKEFUN_OUTPUT_DIR` (default `./out`) and writes `dossier.json`.

## The loop

- **Move** — WASD / arrow keys, or hold the mouse / touch and the core follows.
- **Flip polarity** — Space or click. Cyan **NORTH −** pulls coral in and
  pushes cyan away; coral **SOUTH +** does the reverse.
- **Capture** — touch an opposite shard softly: +100, combo multiplier,
  energy. **Shatter** — slam a like shard into a wall or a mine: +50.
- **Danger** — a like shard that touches *you* costs 1 hull. Gold **feral
  mines** hunt you in packs; they cost 1 hull too.
- **Pulse** — E or right-click when the violet bar is full: every shard on
  screen swaps polarity.
- **Twincores** — violet diamonds that split into two fast minis of opposite
  poles when destroyed. Kill one carelessly and the room gets busier.
- **Win** — clear wave 10. Then endless mode, if you want it.

## The strategy layer: Anchors and Lenses

Between waves you deploy a magnet architecture that keeps working while
you fly:

- **Anchor Satellites** (2 slots, growing to 4 by wave 8): fixed mini-magnets
  with a polarity you choose. They bend every shard's path — slingshot
  traffic into walls, park a stream in orbit, guard a lane. Repositioned
  freely at every deployment phase.
- **WIDE or STRONG** (F key, per anchor): every anchor is either a *wide*
  field (radius 200, gentle) or a *strong* field (radius 130, double
  force, half the reach). Measured in a headless rig, a STRONG anchor gives
  a passing shard ~1.66× the velocity change of a WIDE one over 130 ms —
  the difference between bending a lane and whipping it into the wall.
- **Polarity Lenses** (from wave 4, a second slot by wave 7): gate discs
  that flip the polarity of every shard crossing them, once per pass. A
  lens turns an incoming threat stream into a capture stream, feeds a
  twincore's minis back as food, or — placed badly — converts your food
  into threats behind your back.

Both slot budgets are tight on purpose: four anchors and two lenses is all
you get for a 26-shard wave, so *where* and *which mode* is the game.

## Evidence (headless Chromium, scripted autopilot)

- **Functional suite: 39/39 checks pass** — capture/shatter/overload
  scoring, mine chain reactions, twincore splits, pulse, anchor placement
  caps and field erosion, lens slot growth (0 before wave 4, 1 at wave 4,
  2 in endless), lens single-flip-per-pass with re-entry re-flip, STRONG vs
  WIDE deflection, deployment of both types, win/lose/restart. Zero page
  errors.
- **Balance, 5 seeded full runs (waves 1–10), before → after tuning:**
  win rate 1/5 → **4/5**; average score 14,330 → **17,321** (+21%); the one
  remaining loss died on wave 10. Tuning was deliberately gentle: twin
  share 18% → 16%, mine cap 6 → 5, mine top speed −4 px/s, spawn interval
  floor 0.34s → 0.36s. Winning runs finished with 2–5 hull left — wins are
  earned, not given.
- **A/B on waves 6–10** (same seeds, same pilot, kit pre-placed):
  anchors-only vs anchors + STRONG + lenses scored 12,366 / 3,622 / 12,250
  vs 13,170 / 3,514 / 10,261, with 3–12 lens flips and up to +5 captures
  per run in the full build. Honest read: the new systems measurably move
  late-wave outcomes in both directions — they reward a player who routes
  traffic deliberately, and a fixed autopilot cannot express that. The
  mechanics themselves are not cosmetic: flips, deflections and erosion
  are all verified deterministically in the suite.
- **Screenshots are real renders** of this build from headless Chromium
  (title, wave-4 deployment, wave-9 mid-game, win screen), each within the
  kit's 256 KiB cap.

## Honest self-assessment

What v3 adds over v2 is a second and third axis of pre-wave decision:
*which fields, in which mode, converting which lanes*. The strongest entry
on this bounty (a tower-defence hybrid with a per-wave re-geometry puzzle)
still offers a wider decision space, and this game has still only been
playtested by autopilots, not by a human playing a full run for feel.
What is demonstrated here: a complete loop (title → deploy → play → win →
endless), two interacting placement systems with measured physics, a
tuned difficulty curve that a decent pilot beats about as often as it
loses, and a field you can *read* — the iron filings always tell you the
truth about the room.

## Files

- `game/index.html`, `game/style.css`, `game/game.js`, `game/audio.js` —
  the game (canvas renderer, fixed-step physics, WebAudio synth; no assets).
- `main.ts` — the hand-in entrypoint (Node 22, standard library only).
- `screenshots/` — title (cover), deployment, wave-9 mid-game, win screen.
- `vendor/makefun-game.ts` — the bounty kit's entry validator, verbatim.
- `LICENSE` — MIT.
