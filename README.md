# Rebellion
A trick-taking card game for 2–7 players inspired by Blake's 7. Race to rescue the crew, outmanoeuvre the Federation, and survive the Andromedan invasion before Star One falls.

## AI difficulty tiers

The Federation drafts opponents from four skill grades. Three are shipped; one is on the roadmap.

| Tier | Role | IQ | Approach | Progress | Status |
|---|---|---|---|---|---|
| **Δ Delta**  | Conscript     | **92**  | One-card heuristic, no memory                                | `██████████` 100% | shipped     |
| **Γ Gamma**  | Officer       | **123** | Card counting + void tracking + capture-value evaluation     | `██████████` 100% | shipped     |
| **Β Beta**   | Strategist    | **123** | Gamma-class heuristics with offline-tuned weights loaded from `js/ai/beta-weights.json` (currently identical to Gamma) | `█████░░░░░` 50%  | scaffolded — awaits optimizer |
| **Α Alpha**  | Supreme Cmdr  | **~145**| Lookahead search (PIMC / ISMCTS) over hidden-information game tree | `░░░░░░░░░░` 0%   | not started |

IQ scores are empirically calibrated from headless-tournament results using:
```
IQ = 100 + (winRate − 1/numPlayers) × 250
```
So 100 = baseline competence (winning exactly the share you'd expect by chance), 130+ = strong play, sub-100 = below baseline. Delta's 21.9% win rate against Gamma in 4-player → IQ 92; Gamma's 34.2% → IQ 123. Beta inherits Gamma's number until its weights are tuned. Alpha's 145 is a projection based on typical lookahead-vs-heuristic gaps in similar trick-taking games; will be re-measured when shipped.

**Overall AI roadmap: 62%** &nbsp;`██████░░░░` &nbsp; 2.5 of 4 difficulty tiers complete.

Beta ships with weights identical to Gamma so a fresh install plays the same — its slot exists so an offline optimizer can populate `beta-weights.json` with empirically-tuned values, then Beta diverges from Gamma in measurable ways. Both Gamma and Beta verified to play correctly in 2/3/4/5/7-player smoke tests.

## Changelog

| Version | Date | Changes |
|---|---|---|
| **2.58** | 2026-06-28 | **AI tier glyph shown in opponent seats.** With mixed AI lineups it wasn't possible to tell at the table which opponent was at which tier — the seat just showed the persona role ("WARRANT OFFICER"). New `tierGlyph(player)` helper in `ui.js` reads the first character of the AI's registered label (`'Δ'`, `'Γ'`, `'Β'`) and the seat header now renders the role as `"Γ WARRANT OFFICER"` for an AI player. Applied in three places: the opponent seat header (the main one), the scoreboard modal row, and the chat tooltip on each comms line. Human players continue to show no prefix. Pure display change. |
| **2.57** | 2026-06-28 | **Orac scoring note now names the specific card and owner.** Was vague ("Adjutant Reeve uses Orac (A♦) to cancel a person card this Mission. (See comms log for which card.)") because `powerOracCancel` did its own comms-log line but didn't tell the scoring code what it picked. Fixed by making `powerOracCancel` return its `{card, owner}` pick (or `null` if skipped/no targets). The Step 1 loop in `scoreMission` now uses that to build a detailed note matching the IMIPAK format: `"Adjutant Reeve uses Orac (A♦) to cancel A♥ (Avon) in YOUR captured cards — scores 0."` The comms-log line is unchanged. |
| **2.56** | 2026-06-28 | **Opponent-mix section locked until player count chosen.** The Federation Skill Grade section was visible from initial page load even though presets and counters couldn't do anything sensible without a player count. Added a `.locked` class to the section (initial state in HTML), styled with `opacity:0.42`, `pointer-events:none`, and `filter:saturate(0.4)` plus a 🔒 glyph appended to the title. First click on any player-count button removes the `.locked` class and re-applies the current preset to redistribute the mix across the now-known opponent count. UX-only change. |
| **2.55** | 2026-06-28 | **Two rule reverts + per-opponent mix picker.** (1) Full Crew no longer intercepts Star One when both fire in the same trick — per v2.46 rulebook clarification ("The Full Crew and the Ace of Clubs are completely independent events"), only the Liberator (Q♦) intercepts. The `else if (fullCrewJustFired)` branch and the `fullCrewJustFired` flag both removed from `flow.js`. (2) A♣ pulled from the Reserve via Full Crew **or** Travis-seize now ends the Mission immediately — the silent-A♣ house rule is gone. Both `resolveFullCrew` and `powerSeizeReserve` now check `taken` for A♣ and set `missionResult='starOne'` with clear log lines ("Korben claims Star One (A♣) from the Reserve via Full Crew — Mission ends immediately"). 500-game Gamma-vs-Delta tournament still gives ~34.4% / 21.9%, edge preserved. (3) **Setup-screen opponent mix picker.** Replaced the single-difficulty button row with a presets+counters UI: a row of preset buttons (`All Δ Conscripts`, `All Γ Officers`, `All Β Strategists`, `Balanced Mix`, `Custom`) above three per-tier counter rows (`[−] N [+]` with IQ badge). The total must equal `numPlayers − 1`; the Determine Dealer button stays disabled until it does. Manual counter edits drop the preset selection to `Custom`. Changing the player count re-applies the current preset to redistribute opponents across the new count. Per-seat AI tier is now assigned via a Fisher-Yates shuffle over the mix vector so seat order isn't always Δ Δ Γ Γ Β Β. `G.difficulty` becomes either a single tier key (uniform mix) or a compact glyph label like `"Δ2 Γ2 Β2"` (mixed); new `G.mix` field holds the structured counts for the export schema. Header AI display falls through to the mix label when `R.ai.get(G.difficulty)` returns null. |
| **2.54** | 2026-06-28 | **Mutoid v2.46 rule change.** Per the v2.46 rulebook update, when the Mutoid (J♠) holder has no Hearts available to drain, *she now scores 0 herself* instead of her usual −10 ("she cannot get her serum — she stops working"). Previously she would still score her −10 in that case. Flow.js Step 4 (Mutoid scoring) extended to handle the no-Hearts branch: mark Mutoid `_cancelled`, log a clear scoring note. 200-game smoke test still produces Gamma 34.0% / Delta 22.0% (matching the v2.53 baseline), confirming the change is a small swing effect — only kicks in on the rare mission where a player captures Mutoid but no Hearts. |
| **2.53** | 2026-06-28 | **IQ score on each AI difficulty button.** Each AI registration now carries an empirically-calibrated `iq` field, rendered as a small gold monospace badge below the AI label on the setup-screen difficulty buttons. Calibration formula: `IQ = 100 + (winRate − 1/numPlayers) × 250` — so 25% win rate in 4-player = IQ 100 (baseline), Delta's measured 21.9% = IQ 92, Gamma/Beta's 34.2% = IQ 123, projected Alpha ~ 145. Tooltip on each badge shows the formula. Difficulty buttons now use `.ai-btn` class with stacked layout (label above, IQ below) instead of plain text. README AI-tier table gained an IQ column and explanation paragraph. No gameplay changes — display only. |
| **2.52** | 2026-06-28 | **Beta tier registered.** New `js/ai/beta.js` — architectural twin of Gamma with identical decision logic and an independent `activeWeights` namespace loaded from `js/ai/beta-weights.json` (seeded identical to `gamma-weights.json` so a fresh install plays the same). Adding it required: one new AI module file (cloned from gamma.js, registers as `'beta'` with `setWeights` / `getWeights` hooks for the future optimizer), one new JSON seed file, one new `<script>` tag in `index.html`, and `--beta-weights` CLI plus `'beta'` validation added to `tools/tournament.js`. Difficulty picker auto-discovered Beta via `R.ai.list()` — no app.js change needed. Verified: 500-game Beta-vs-Delta produces byte-identical results to Gamma-vs-Delta (Gamma 34.2% / Beta 34.2% / Delta 21.9% in both runs, with seed 42); 500-game 2-Beta vs 2-Gamma mirror match gave Beta 25.6% / Gamma 24.4% — within statistical noise, confirming no positional bias and that the two are functionally identical until weights diverge. README AI-roadmap table updated (50% → 62%, Beta marked scaffolded). Ready for the optimizer to start tuning `beta-weights.json`. |
| **2.51** | 2026-06-28 | **Actor-first log messages across all scoring and capture events.** Previous messages buried the actor in the prefix (`"IMIPAK: Korben assassinates A♥…"`) so it wasn't obvious who held the power and what triggered it. Every scoring note and capture log line is now lead-with-the-player and explicit about which cards are in play. Examples — IMIPAK: `"Korben uses IMIPAK (10♦) + Anna Grant (10♠) to assassinate A♥ (Avon) in YOUR captured cards — scores 0."` Orac: `"Korben uses Orac (A♦) to cancel A♥ (Avon) in YOUR captured cards — scores 0 this Mission."` Zen+Liberator+Asteroid: `"Korben holds Zen (K♦) + Liberator (Q♦) + Asteroid Field (Q♣) — the Liberator knows these rocks, the Asteroid Field is negated and scores 0."` Mutoid: `"Korben holds the Mutoid (J♠) — she drains 2♥ from Korben's Hearts for blood serum, now scoring 0."` Gambit: `"Korben holds Carnell (K♣) + Servalan (A♠) — the Psycho-Strategist's Gambit reverses their total to -45."` Liberator/Full Crew intercepting Star One now name the player completing the interception. Travis seize and Full Crew take/leave lines named explicitly. No behavior change, presentation only — same 31% / 23% Gamma-vs-Delta split. |
| **2.50** | 2026-06-28 | **IMIPAK fixes (parallel to the v2.49 Orac fix)** + **export filename now includes time**. The IMIPAK Step 5 in `scoreMission` had two bugs: (a) the human holder didn't get a picker — the code auto-selected for everyone, violating the rulebook's "that player may choose" language; (b) the AI heuristic sorted by descending basePoints across all piles, meaning an AI holding IMIPAK whose own pile contained the global max card would assassinate its own best card. Both fixed: human now gets the same owner-badge picker used by Orac (cards from each player's pile labeled with owner, with YOUR pile in gold); AI now uses the swing-maximizing heuristic (`-basePoints` for own pile, `+basePoints` for opponents, pick max). Log message updated to clearly identify the target pile (`"…in YOUR captured cards"` vs `"…in Korben's captured cards"`). Empirical: 500-game sample (seed 42) gives Gamma 34.2% / Delta 21.9% — slight uptick vs v2.49's 33.4% / 22.2% because the AI no longer self-assassinates. **Export filename** changed from `b7-rebellion-YYYYMMDD.json` to `b7-rebellion-YYYYMMDD-HHMMSS.json` so multiple exports on the same day don't collide on disk. New `formatTimestamp(d)` helper in `ui.js` replaces `formatYYYYMMDD(d)`. |
| **2.49** | 2026-06-28 | **Orac targets ANY player's pile** (was bug). Dialog said "any player's captured cards" but the eligible pool was filtered to `winner.pile` only — the player could only cancel cards in their own captured pile. Fixed: `powerOracCancel` now pools eligible person cards across all players' piles, tagged with owner. Human picker shows each card with a coloured owner badge above (`YOUR pile` in gold for own, opponent name in teal for others) via a new `ownerLabels` option on `askCards` that accepts `{text, own}` per card. AI heuristic switched from "cancel most-negative card in own pile" to "maximize swing in own favour" — for each candidate the swing is `-basePoints` if it's the AI's own card and `+basePoints` if it's an opponent's; AI picks the largest positive swing, or skips if no positive option exists. Log line now states which pile the cancellation hit. Empirical: 500-game sample (seed 42, 1 Gamma vs 3 Delta) gives Gamma 33.4% / Delta 22.2% — essentially identical to the pre-fix 34.8% / 21.7%, so Gamma's strategic edge is preserved over the rules-correct implementation. |
| **2.48** | 2026-06-28 | **v2.44 rulebook alignment.** Audited current implementation against the v2.44 rulebook. Dayna Mellanby Step 6 was already present in code (from v2.42 work) — verified. Renumbered scoring-step comments in `flow.js` to match the v2.44 8-step sequence (1-Orac, 2-Zen+Liberator+Asteroid, 3-Gauda Prime, 4-Mutoid, 5-IMIPAK, 6-Dayna, 7-Totals, 8-Psycho-Strategist's Gambit) — the prior "Step 7 Gambit" label was off by one. **Full Crew reveal rule** added: when Full Crew triggers, the entire Reserve contents are now logged publicly to the comms feed before the winner makes their selection — every player sees what's on offer, the choice is fully transparent. Travis's reveal-as-seized was already in place via the existing `taken.map(C.cardLabel).join(' ')` log line; no change needed there. File-header doc comment in `flow.js` updated to reflect the v2.44 scoring sequence. |
| **2.47** | 2026-06-28 | **Replay viewer** — new standalone `replay.html` for stepping through any `b7-rebellion-YYYYMMDD.json` game log. Three loading paths (file picker, drag-and-drop, paste textarea), validates the log against the schema, then flattens the missions into a linear event stream (`game-start` → `mission-start` → `trick`* → `mission-end` → … → `game-end`). Each frame is self-contained — running totals and capture-pile snapshots are computed once during stream-build, so navigation is O(1) in either direction. UI mirrors the game's color palette: trick winner lifts and glows gold (or green for the Andromedan), comms log filters to the current logical position with system/andromedan/chat coloring preserved, scoreboard shows cumulative totals with the leader crowned. Controls: ◀/▶ buttons (or ←/→ keys), ⏮/⏭ jumps, autoplay with speed selector (0.3 / 0.75 / 1.5 / 2.5 sec per step), Space to toggle play/pause. New **↺ Replay Saved Game** link added to the setup-screen footer. See the README's *Replay viewer* section for instructions. Reuses `js/card.js` for card-label/name lookup; otherwise zero coupling to the game's state machine — fully read-only. |
| **2.46** | 2026-06-28 | **Game-log export.** New "⇩ Export" button in the comms-panel header (available the entire game) and a "⇩ Export Game Log" button on the final-results modal as the last chance before a new game wipes state. Clicking either downloads `b7-rebellion-YYYYMMDD.json` (MIME `application/json` via Blob + temporary `<a download>`) — works on every modern browser including mobile Safari. The exported object has schema `b7-rebellion-game-log` v1 with sections: `game` (players, totals, system name, difficulty, duration), `missions` (per-mission summaries with full trick lists, capture piles, scoring notes), `currentMission` (only if mid-game — tricks so far, hands remaining, current piles, reserve size), and `commsLog` (every system / andromedan / chat line with type, text, mission index, trick number, timestamp). Internals: `G.missionLog` is now actually populated (was an empty placeholder), every trick is recorded into `M.tricks` via a new `serializeTrick` helper, and `logSystem`/`logAndromedan`/`logChat` push into a structured `G.commsLog` alongside the DOM render. The headless tournament harness gained a stub `serializeTrick` so existing AI bake-offs keep working unchanged. |
| **2.45** | 2026-06-28 | (1) **HAND EXPOSED banner** is now a dedicated full-width pulsing amber bar between `.human-head` and the hand row, not a small inline tag — when Servalan's effect is active and the human's hand is visible to all AI opponents, it is now unmissable. Toggled by the `hidden` attribute on `#human-exposed-banner`. (2) **Mobile card sizing** — new `@media (max-width:600px)` query shrinks `.card` and `.card-back` from 58×82 to 44×62 px (and `.card.tiny` from 40×56 to 32×44), shrinks suit-mid font 22→17, tightens `.hand-row` gap to 4px, scales the exposed banner. A 7-card hand now fits a ~380px phone viewport without horizontal overflow. (3) **Setup blurb hidden until selection** — the `You'll play N Missions total…` blurb is now `hidden` by default; the player-count buttons unhide it on first click so the screen no longer claims "one Mission" before the user has made any choice. (4) **Full Crew intercepts Star One** — two new interception paths added: (a) if the trick that captures the Ace of Clubs is the same trick where Full Crew fires, Star One's detonation is suppressed and the Mission continues (parallel to the Liberator intercept); (b) if Star One is among the Reserve cards a player claims via Full Crew, the comms log notes that its power is suppressed since the card never entered play — it scores its −5 silently and the game does not end. (5) Version label now carries the build date. |
| **2.44** | 2026-06-28 | Tournament harness (`tools/tournament.js`) — headless Node runner. Loads the browser game files into a `vm` context with a no-op UI shim and a `Math.random` override for determinism (Mulberry32 seedable PRNG), seats N AI players (Delta or Gamma), and runs M missions. ~400 games/sec on a single core. Verified Gamma beats Delta empirically: 34.8% vs 21.7% seat win rate (n=500, 4 players, 1 Gamma vs 3 Deltas). Gamma's `WEIGHTS` constant refactored to `activeWeights` + `setWeights(obj)` / `getWeights()` so the optimizer can swap weights between runs without reloading code; defaults now also mirrored in `js/ai/gamma-weights.json`. `npm run tournament -- --help` for CLI options. JSON output mode (`--json`) emits parsable stats for the offline optimizer to consume. |
| **2.43** | 2026-06-28 | Setup-screen blurb fixed: "5 Missions per player" → "5 Missions total — one per player". One Mission per player matches the rulebook (2 players = 2 Missions, 7 players = 7 Missions), but the old phrasing read as if it meant 5 each. |
| **2.42** | 2026-06-27 | Upgraded to v2.42 rulebook: DEAL_TABLE 2-player fixed (25 cards/hand, 3 reserve); Dayna Mellanby now conditional +10 (scores only if Star One battle occurred); Orac/Teleport Bracelet/IMIPAK now target person cards (Hearts, Spades, Dayna, Vila); Scoring reordered to steps 1-Orac, 2-Zen+Liberator+Asteroid negation, 3-Gauda Prime, 4-Mutoid, 5-IMIPAK, 7-Psycho-Strategist; Star One + Liberator same trick = detonation intercepted; Vila wins any trick he enters (fixed); Anna Grant compulsion enforced in legalPlays; Andromedan leads Vila = "Vila's Galactic Bluff" (Mission ends, no scoring); Full Crew correctly excludes Gan (10♥); Andromedans rendered in GREEN throughout (chip, banner, comms log). |
| **2.26** | (earlier) | Each new game gets a Blake's 7-flavored system name (e.g. *Cygnus Alpha*, *Saurian Major*, *Centero IV*, *Horizon*) — generator weighted across four canonical naming patterns: 40% `Constellation+Greek`, 30% `Name+Major/Prime/Minor`, 20% `Name+Roman numeral`, 10% standalone evocative. Stored on `G.systemName`, persisted into history entries (`e.systemName`), shown in the scoreboard header ("Current Game — *system*") and as the lead of each history row, and logged into the comms feed at the start of Mission 1. Scoreboard heading also clarified ("Current Game" + mission progress subtitle) so it's obvious it's the running totals for this game, not all-time. |
| **2.25** | (earlier) | When Servalan exposes the human's hand, the player now gets a prominent pulsing amber `👁 HAND EXPOSED — visible to all opponents` tag in the human-head row, persistent for the rest of the mission. Two random AI players also taunt with Blake's 7-themed defense-tech commentary — `humanExposed` line bank added to all six default personas (force walls, neutron flare shields, detector grids, the whole bag), each in voice (Korben files it, Magda smells profit, Senn sees the pattern, Tanner taunts prison-yard style, Reeve logs it on Form 9-A, Boz hawks the merchandise). |
| **2.24** | (earlier) | Buttons can no longer be text-selected, anywhere. The `.modal-box *` opt-in (added in 2.19 for selectable scoring/history prose) was inadvertently catching the modal's Continue/Close buttons; new `button, button * { user-select: none !important }` rule wins over the modal opt-in by specificity escalation. Modal prose text still selectable. |
| **2.23** | (earlier) | Comms feed gets `max-height: calc(100vh - 90px)` so its existing `overflow-y: auto` actually engages — log lines now scroll inside the panel rather than stretching the page taller with every entry. Button hover brightness lifted from 1.1 to 1.3 (both regular and primary) so the brightening is more obvious. |
| **2.22** | Button hover swaps the background-color shift for a 10% brightness lift (`filter: brightness(1.1)`), matching what the primary button already did. Hover now reads as "this button is brighter" instead of "this button got a flat shade change." Teal border accent retained as the hover-target cue. |
| **2.21** | Mutoid Heart-devour fixed and re-themed. Previously the live-Heart fallback sorted `(b - a)` and picked the **highest**-value Heart; now sorts `(a - b)` and picks the **lowest**-value Heart for blood serum (less damage to the player). Two distinct scoring notes: one for when the Mutoid feeds on an already-cancelled Heart (no further effect), one for the live-Heart drain (names the lowest-value Heart as the source of blood serum). |
| **2.20** | `DEAL_TABLE`, `dealMission`, and `shuffle` relocated from `engine.js` to `card.js` — all deck/deal concerns are now in one module. `engine.js` is just trick rules (`legalPlays`, `resolveTrickWinner`), `sleep`, and grammar helpers. Score history persists to `localStorage` (key `rebellion.scoreHistory.v1`, 100-row FIFO cap): completed games are saved with date, player count, AI level, duration, full leaderboard, and winner. New "View Score History" buttons on the setup screen and final-results modal open a scrollable list. Clear-history button gated behind confirm dialog. JSDoc tooling added: `card.js` and `engine.js` annotated with full `@typedef` / `@param` / `@returns` types; `jsdoc.json` config drives `npm run docs` (or `npx jsdoc -c jsdoc.json`) to generate browsable HTML in `docs/`. |
| **2.19** | Header gains GAME (running total since first mission) and MISSION (resets each new mission) timers. "PILE" label retitled "CAPTURED" everywhere user-facing (seat stats, human stats, scoreboard column, modal heading, in-play prose). Layout-drift diagnostics: `UI.logLayoutMetrics(label)` (also `window.__LAYOUT(label)`) emits a `console.debug` blob with top/height/bottom of every play-area anchor; fires at mission start, every trick start, and every trick-captured beat. `user-select: none` on body to stop accidental text/button selection during play, with opt-ins for comms feed, modal text, and center message. |
| **2.18** | Card data model split out of `engine.js` into new `card.js` (RANKS, SUITS, `buildDeck`, `cardMeta`, `cardLabel`, `cardName`, `basePoints`, `isJoker`, `isPrime`, `isNumbered`, `isHeart` family, `pileHas`). `engine.js` retains game flow (`dealMission`, `resolveTrickWinner`, `legalPlays`), utilities (`shuffle`, `sleep`), and grammar helpers (`verbFor`, `subj`, `possessiveOf`). AI context now exposes both `ctx.engine` and `ctx.card`. |
| **2.17** | Trick-win message ("X wins the trick") is cleared at the start of each new trick / invasion wave instead of lingering until something else overwrites it. |
| **2.16** | Dealer-draw cards return to a horizontal row, sorted ascending so the leftmost (lowest) is the dealer. Winning cell no longer elevates — sort order is the cue. |
| **2.15** | Dealer-draw cards stack vertically (column) instead of in a horizontal row. Gap widened to 24px so the 20px winner-elevation doesn't crash into the cell above. |
| **2.14** | Dealer-draw stage shows a Federation-flavored rulebook excerpt above the cards, framing "lowest deals" as a dystopian status ritual rather than a neutral procedure. |
| **2.13** | Two-player support (24 cards/hand, 5 reserve); dealer-draw becomes its own dialog with settings locked; "Begin First Mission" button label; this changelog. |
| **2.12** | Color chips next to names in dealer-draw; dealer cell rises 20px when determined; "Determine Dealer" button label; human color set to silver. |
| **2.11** | Human color set to purple (later silver); winner seat rises 20px on win; large score flash in center during card flight, with `*` for power cards; shrinks and fades over ~620ms. |
| **2.10** | "Your move" prompt clears instantly when human plays a card; player names in win/lead/repel messages get colored chips. |
| **2.09** | Colored chip boxes above each played card in the trick area, using each player's color with black text. |
| **2.08** | Trick area locked to fixed height to stop layout creep; Continue button between tricks; "you leads / draws / deals first" grammar fix; suit colors changed to navy/gray/orange/red (S/C/D/H). |
| **2.07** | Cards float to winner's name with shrink+fade animation on trick capture; timestamp timeline (HH:MM:SS, 24-hr) under each played card with timeline dots; 1-second pacing between plays. |
| **2.06** | "PILE: N" in the human area becomes a clickable link that opens a Capture Pile inspector dialog (sorted by suit, marks cancelled/assassinated cards, shows running effective value). |
| **2.05** | Hover tooltips on Intercepted Comms tags showing each persona's full name + role; reserve display switched from a number to gray card-back rectangles with "EMPTY" fallback; AI Zen log "You's hand" grammar fix. |
| **2.04** | Teleport Bracelet combined into a single dialog showing hand cards and pile cards in one modal (instead of two sequential prompts). |
| **2.03** | Subject-verb agreement helpers (`subj`, `verbFor`, `possessiveOf`) applied across all 14+ message sites — "You win the trick", "You have Avon", "You destroy the Reserve", "your pile", "your hand", etc. |
| **2.02** | AI difficulty tier progress diagram added to README (Markdown-rendered table with Unicode progress bars). |
| **2.01** | Initial v2 label set after the v3 modular architecture stabilized; CSS extracted to `css/app.css`; entry-point renamed `main.js` → `app.js`. |

## Replay viewer

A standalone page (`replay.html`) for stepping through any saved game-log JSON. Read-only — no game logic runs, no AI executes. Pure visualization over the serialized record.

**How to use it:**

1. **Open** `replay.html` in your browser. Either:
   - Click **↺ Replay Saved Game** on the game's setup screen, or
   - Open `replay.html` directly (it's a standalone page — no game needs to be running)
2. **Load the JSON**, three ways — pick whichever is easiest:
   - **File picker**: click *"Choose File"* and pick a `b7-rebellion-YYYYMMDD.json` file
   - **Drag-and-drop**: drag the `.json` file from your file browser anywhere onto the page
   - **Paste**: open the `.json` file in any text editor, copy all of it, paste into the textarea, click *Load Pasted JSON*
3. **Step through** with the control bar that appears once the log loads:
   - **◀ / ▶** — previous / next event (or use **← / →** arrow keys)
   - **⏮ / ⏭** — jump to first / last event (or **Home / End** keys)
   - **▶ Play** — auto-advance at the selected speed (or **Space** to toggle play/pause)
   - **Speed dropdown** — slow / normal / fast / very fast (0.3 to 2.5 sec per step)
   - **↺ Load Different Log** — return to the loader to swap in another file

**What you see at each step:**

- **Center**: the trick being played, with each card and the player who played it. The trick winner's slot lifts and glows gold (or green for the Andromedan).
- **Top banner**: event label — *MISSION 2 BEGINS*, *TRICK 7*, *INVASION WAVE 3*, *MISSION 2 ENDS — STAR ONE CAPTURED*, *VILA'S GALACTIC BLUFF*, *GAME COMPLETE — Korben wins*, etc.
- **Right panel**:
  - **Cumulative totals** as of this step (the leader gets a 👑)
  - **Captured cards this mission** for each player, with cancelled/assassinated cards struck through
  - **Comms log** filtered to entries up to the current point (system in muted gray, andromedan in green, chat with each speaker's name)
- **Game header strip**: system name, player count, difficulty, date, duration, build version that produced the log

The event stream is flattened so each frame is self-contained — you can jump anywhere instantly without replay artefacts. Forward and backward navigation are O(1).

**Scope**: in-progress games (exported mid-mission) show as a final "(IN PROGRESS)" mission with whatever tricks were already played; the viewer handles partial logs gracefully.

## Tournament harness

Headless Node runner for AI bake-offs and (eventually) offline weight tuning. No browser required — the game files load into a `vm` context with a stubbed `window` and a no-op UI shim.

```
# 500-game tournament: 1 Gamma vs 3 Deltas
npm run tournament -- --missions 500 --players 4 --seats gamma,delta,delta,delta

# Same with deterministic seed (reproducible across runs)
npm run tournament -- --missions 500 --players 4 --seats gamma,delta,delta,delta --seed 42

# JSON output for the optimizer to parse
npm run tournament -- --missions 100 --players 4 --json

# Full options
npm run tournament -- --help
```

Throughput is ~400 games/sec on a single core, so a 10,000-game tournament finishes in about 25 seconds. The harness reports per-seat win counts, average scores, and per-AI-level aggregates so positional bias gets isolated from skill.

Weights for Gamma load from `js/ai/gamma-weights.json` by default; pass `--weights path/to/file.json` to swap. The browser game ignores the JSON file and uses Gamma's inline `DEFAULT_WEIGHTS` instead — the JSON only matters for the harness.

**Empirical baseline (n=500, seed=42):**

| Arrangement | Win rate (Gamma) | Win rate (Delta) | Score delta |
|---|---|---|---|
| 1 Gamma vs 3 Delta | 34.8% | 21.7% | +15 pts/game |
| 1 Delta vs 3 Gamma | 26.7% | 19.8% | +13 pts/game |

Baseline expectation is 25% per seat in a 4-player game; Gamma sits ~10pp above that, Delta sits ~5pp below.

## Architecture

Plain `<script src>` loading, no build step — open `index.html` directly from disk.

```
rebellion-v3/
├── index.html              markup + CSS link + script tags
├── css/app.css             all styles
├── README.md               this file
└── js/
    ├── card.js             card data model (suits, ranks, names, points, powers, predicates)
    ├── card.js             card data model + deck-level ops (build, shuffle, deal)
    ├── engine.js           trick rules (legal plays, trick winner) + grammar + sleep
    ├── state.js            G (game) and M (mission) state holders
    ├── personas/
    │   ├── registry.js     register / pickLine / pickN
    │   └── default.js      six default Rebellion-universe personas
    ├── ai/
    │   ├── registry.js     register / get / list / buildContext / chooseCard
    │   ├── delta.js        Δ Conscript (one-card heuristic)
    │   └── gamma.js        Γ Officer (counting + voids, with tunable WEIGHTS)
    ├── ui.js               rendering, modals, comms log, animations, timers, history
    ├── powers.js           capture powers (Vila, Zen, Travis, etc.)
    ├── flow.js             mission/trick/wave orchestration + scoring
    └── app.js              setup screen + game bootstrap
```

Drop `js/ai/beta.js` with `Rebellion.ai.register('beta', {…})` and a new `<script>` tag — it appears in the difficulty picker automatically. Same plug-in pattern for custom persona files.

## API documentation

`card.js` and `engine.js` carry full JSDoc annotations (`@typedef`, `@param`, `@returns`). Generate browsable HTML docs into `docs/`:

```
npm install         # one-time, pulls jsdoc
npm run docs        # writes docs/index.html
```

Or without installing globally:

```
npx jsdoc -c jsdoc.json
```

`jsdoc.json` points at the whole `js/` tree, so further modules become annotatable incrementally — add `@typedef` / `@param` blocks to any file and the next docs run picks them up.
