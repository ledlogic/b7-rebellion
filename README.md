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

Both shipped tiers verified to play correctly in 3/4/5/7-player smoke tests, with Gamma scoring measurably higher than Delta across 450+ tournament missions.
