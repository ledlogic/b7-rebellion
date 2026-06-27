# Rebellion
A trick-taking card game for 2–7 players inspired by Blake's 7. Race to rescue the crew, outmanoeuvre the Federation, and survive the Andromedan invasion before Star One falls.

## AI difficulty tiers

The Federation drafts opponents from four skill grades. Two are shipped; two are on the roadmap.

| Tier | Role | Approach | Progress | Status |
|---|---|---|---|---|
| **Δ Delta**  | Conscript     | One-card heuristic, no memory                                | `██████████` 100% | shipped     |
| **Γ Gamma**  | Officer       | Card counting + void tracking + capture-value evaluation     | `██████████` 100% | shipped     |
| **Β Beta**   | Strategist    | Same shape as Gamma, weights tuned offline by a Node simulator over thousands of self-play missions | `░░░░░░░░░░` 0%   | not started |
| **Α Alpha**  | Supreme Cmdr  | Lookahead search (PIMC / ISMCTS) over hidden-information game tree | `░░░░░░░░░░` 0%   | not started |

**Overall AI roadmap: 50%** &nbsp;`█████░░░░░` &nbsp; 2 of 4 difficulty tiers complete.

Both shipped tiers verified to play correctly in 2/3/4/5/7-player smoke tests, with Gamma scoring measurably higher than Delta across 450+ tournament missions.

## Changelog

| Version | Changes |
|---|---|
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

## Architecture

Plain `<script src>` loading, no build step — open `index.html` directly from disk.

```
rebellion-v3/
├── index.html              markup + CSS link + script tags
├── css/app.css             all styles
├── README.md               this file
└── js/
    ├── card.js             card data model (suits, ranks, names, points, powers, predicates)
    ├── engine.js           game-flow rules (deal, legal plays, trick winner) + utilities + grammar helpers
    ├── state.js            G (game) and M (mission) state holders
    ├── personas/
    │   ├── registry.js     register / pickLine / pickN
    │   └── default.js      six default Rebellion-universe personas
    ├── ai/
    │   ├── registry.js     register / get / list / buildContext / chooseCard
    │   ├── delta.js        Δ Conscript (one-card heuristic)
    │   └── gamma.js        Γ Officer (counting + voids, with tunable WEIGHTS)
    ├── ui.js               rendering, modals, comms log, animations
    ├── powers.js           capture powers (Vila, Zen, Travis, etc.)
    ├── flow.js             mission/trick/wave orchestration + scoring
    └── app.js              setup screen + game bootstrap
```

Drop `js/ai/beta.js` with `Rebellion.ai.register('beta', {…})` and a new `<script>` tag — it appears in the difficulty picker automatically. Same plug-in pattern for custom persona files.
