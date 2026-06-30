/* Rebellion — ai/beta.js
 * Β BETA — Strategist tier.
 *
 * Architectural twin of Gamma — same decision logic, same knob structure,
 * but its own independent weights namespace loaded from beta-weights.json.
 * Initially ships with weights identical to Gamma, so a fresh install has
 * Beta playing the same way Gamma does. The offline optimizer (tools/
 * optimize.js, future work) tunes beta-weights.json against a fitness
 * function (win rate / score-diff in headless tournaments), leaving Gamma
 * untouched as a reproducible baseline to A/B against.
 *
 * Behavior summary (matches Gamma until weights diverge):
 *   - Leading: prefer dumping low-rank spades/clubs (force opponents to capture
 *     negatives). Never lead hearts, joker, Servalan or Star One.
 *   - Following: compute the real value of capturing this trick (including
 *     Star One mission-end risk, Servalan exposure penalty, diamond-power
 *     bonus, invasion-repel bias). Play the LOWEST card that beats everything
 *     still possible when we want the trick; play the HIGHEST card guaranteed
 *     not to win when we don't.
 *   - Sluffing: dump the most-negative card (worst for whoever captures).
 *
 * All knobs sit in WEIGHTS below — replaced wholesale by setWeights() at
 * tournament-harness or optimizer startup.
 */
(function () {
  'use strict';
  const R = (window.Rebellion = window.Rebellion || {});

  /* ---- Tunable weights. The optimizer overwrites these via setWeights().
   * The defaults below match the shipping beta-weights.json. ---- */
  const DEFAULT_WEIGHTS = {
    /* Leading bias by suit (lower = more preferred to lead) */
    lead_heart_bias:    60,
    lead_diamond_bias:  20,
    lead_club_bias:    -25,
    lead_spade_bias:   -30,
    /* Rank multipliers (higher rank → higher score → less preferred) */
    lead_heart_rank_mult:    1,
    lead_diamond_rank_mult:  0.5,
    lead_club_rank_mult:     2,
    lead_spade_rank_mult:    2,
    /* Specific never-lead penalties */
    lead_star_one_penalty:   150,    // A♣
    lead_servalan_penalty:   200,    // A♠
    lead_joker_penalty:      1000,
    lead_basepoints_tiebreak:0.1,

    /* Follow-phase capture-value adjustments */
    capval_star_one_in_trick:  -4,   // mission ends with -5
    capval_servalan_in_trick:  -8,   // exposes capturer
    capval_diamond_power_bonus: 4,   // J♦/Q♦/K♦/A♦
    capval_joker_bonus:         3,   // Vila pick-lock useful
    capval_invasion_bias:       7,   // repel waves

    /* Gamble threshold: take the highest-follower long-shot only if the
       captureValue at stake is at least this big. */
    gamble_capval_threshold: 8
  };

  /** Default weights for both variants — used to fill in any keys missing
   *  from the JSON files loaded at startup. The actual per-variant
   *  activeWeights lives in the makeVariant closure below. */
  function chooseCard(W, player, legal, trick, ledSuit, isInvasion, ctx){
    const { basePoints, isJoker, rankValue, RANKS } = ctx.card;

    /* ---- knowledge state ---- */
    const seenIds = new Set();
    ctx.playedCards.forEach(c => seenIds.add(c.id));
    player.hand.forEach(c => seenIds.add(c.id));
    trick.forEach(p => seenIds.add(p.card.id));

    function highestPlayableInSuit(suit){
      let max = 0;
      for (const r of RANKS){
        if (!seenIds.has(suit + r)) max = Math.max(max, rankValue(r));
      }
      return max;
    }
    function topOfTrick(suit){
      let top = 0;
      for (const p of trick){
        if (!isJoker(p.card) && p.card.suit === suit){
          top = Math.max(top, rankValue(p.card.rank));
        }
      }
      return top;
    }
    function playersAfterMe(){
      const realPlayed = trick.filter(p => p.playerIdx !== 'ANDROMEDAN' && p.who !== 'ANDROMEDAN').length;
      return ctx.numPlayers - 1 - realPlayed;
    }

    /* ---- LEAD ---- */
    if (trick.length === 0 && !isInvasion){
      function leadScore(card){
        if (isJoker(card)) return W.lead_joker_penalty;
        let score = 0;
        if (card.suit === 'H'){
          score += W.lead_heart_bias;
          score += rankValue(card.rank) * W.lead_heart_rank_mult;
        } else if (card.suit === 'D'){
          score += W.lead_diamond_bias;
          score += rankValue(card.rank) * W.lead_diamond_rank_mult;
        } else if (card.suit === 'C'){
          score += W.lead_club_bias;
          score += rankValue(card.rank) * W.lead_club_rank_mult;
          if (card.rank === 'A') score += W.lead_star_one_penalty;
        } else if (card.suit === 'S'){
          score += W.lead_spade_bias;
          score += rankValue(card.rank) * W.lead_spade_rank_mult;
          if (card.rank === 'A') score += W.lead_servalan_penalty;
        }
        score += basePoints(card) * W.lead_basepoints_tiebreak;
        return score;
      }
      return legal.slice().sort((a, b) => leadScore(a) - leadScore(b))[0];
    }

    /* ---- FOLLOW (or respond to invasion) ---- */
    let captureValue = trick.reduce((s, p) => s + basePoints(p.card), 0);
    if (trick.some(p => p.card.id === 'CA')) captureValue += W.capval_star_one_in_trick;
    if (trick.some(p => p.card.id === 'SA')) captureValue += W.capval_servalan_in_trick;
    if (trick.some(p => !isJoker(p.card) && p.card.suit === 'D' && ['J','Q','K','A'].includes(p.card.rank))){
      captureValue += W.capval_diamond_power_bonus;
    }
    if (trick.some(p => isJoker(p.card))) captureValue += W.capval_joker_bonus;
    if (isInvasion) captureValue += W.capval_invasion_bias;

    const followers = legal.filter(c => !isJoker(c) && c.suit === ledSuit);
    if (followers.length > 0){
      followers.sort((a, b) => rankValue(a.rank) - rankValue(b.rank));
      const trickTop  = topOfTrick(ledSuit);
      const left      = playersAfterMe();
      const futureTop = left > 0 ? highestPlayableInSuit(ledSuit) : 0;

      if (captureValue > 0){
        const safeWinners = followers.filter(c => rankValue(c.rank) > Math.max(trickTop, futureTop));
        if (safeWinners.length > 0) return safeWinners[0];           // lowest guaranteed winner
        const gambleWinners = followers.filter(c => rankValue(c.rank) > trickTop);
        if (gambleWinners.length > 0 && captureValue >= W.gamble_capval_threshold){
          return gambleWinners[gambleWinners.length-1];               // gamble high for big prizes
        }
        return followers[0];                                          // duck low otherwise
      } else {
        const safeDucks = followers.filter(c => rankValue(c.rank) <= trickTop);
        if (safeDucks.length > 0) return safeDucks[safeDucks.length-1]; // highest non-winning
        return followers[0];                                           // all win — least committed
      }
    }

    /* ---- SLUFF — dump most-negative card on the capturer ---- */
    const nonJoker = legal.filter(c => !isJoker(c));
    if (nonJoker.length > 0){
      nonJoker.sort((a, b) => basePoints(a) - basePoints(b));
      return nonJoker[0];
    }
    return legal[0];
  }

  function chooseZenTarget(W, player, others, ctx){
    /* Prefer unexposed opponent with most cards — max info per peek. */
    const useful = others.filter(p => !p.exposed);
    const pool = useful.length ? useful : others;
    return pool.slice().sort((a, b) => b.hand.length - a.hand.length)[0];
  }

  function choosePickLockTarget(W, player, others, ctx){
    /* Prefer exposed opponent (known hand → safer choice), then largest hand. */
    const exposed = others.find(p => p.exposed);
    return exposed || others.slice().sort((a, b) => b.hand.length - a.hand.length)[0];
  }

  /* ============================================================
   * Variant factory — each Beta specialist gets its own weights
   * namespace and registers as its own AI key. Shared chooseCard /
   * chooseZenTarget / choosePickLockTarget logic above closes over
   * the W parameter, not a module-level activeWeights — so two
   * variants live side-by-side without stepping on each other.
   * ============================================================ */
  function makeVariant(spec){
    let activeWeights = Object.assign({}, DEFAULT_WEIGHTS);
    R.ai.register(spec.key, {
      label:       spec.label,
      description: spec.description,
      iq:          spec.iq,
      chooseCard:           (p, legal, trick, ledSuit, isInv, ctx) => chooseCard(activeWeights, p, legal, trick, ledSuit, isInv, ctx),
      chooseZenTarget:      (p, others, ctx) => chooseZenTarget(activeWeights, p, others, ctx),
      choosePickLockTarget: (p, others, ctx) => choosePickLockTarget(activeWeights, p, others, ctx),
      setWeights: (obj) => { activeWeights = Object.assign({}, DEFAULT_WEIGHTS, obj || {}); },
      getWeights: () => Object.assign({}, activeWeights),
      get weights(){ return activeWeights; }
    });
  }

  /* Β-Γ Beta-Gamma — specialist tuned to exploit Gamma-class opponents.
     Empirical: 34.5% win rate vs 3 Gamma (your 600-gen, 1200-game tune,
     8000-game validation). Lower 29.4% vs 3 Delta — narrowly specialized.
     IQ shown here is the vs-Delta measurement so the badge is comparable
     to Gamma's published 123. */
  makeVariant({
    key: 'beta-vs-gamma',
    label: 'ΒΓ Beta-Gamma — Strategist',
    description: 'Specialist tuned by the (1+1)-ES optimizer to beat Gamma-class opponents. Devastating vs Gamma (IQ 124 in that matchup); softer vs Delta (IQ 111 in that matchup).',
    iq: 111   // measured: 29.4% win rate vs 3 Delta in 5000-game tournament, seed 42
  });

  /* Β-Δ Beta-Delta — specialist tuned by the (1+1)-ES optimizer to exploit
     Delta-class opponents. Found rational refinements rather than degenerate
     strategies (unlike Beta-Gamma): more cautious about Star One (penalty
     150 → 290), more willing to gamble (threshold 8 → 4), values diamond
     powers more (4 → 8). Empirical: 37.2% win rate vs 3 Delta (your
     8000-game validation). Plays Gamma-like against Gamma (IQ ~98 there)
     — so loses to Beta-Gamma whose whole purpose is exploiting Gamma. */
  makeVariant({
    key: 'beta-vs-delta',
    label: 'ΒΔ Beta-Delta — Strategist',
    description: 'Specialist tuned by the (1+1)-ES optimizer to beat Delta-class opponents. Sharp vs Delta (IQ 131); generic vs Gamma (IQ ~98). Use against tables of weaker opponents.',
    iq: 131   // measured: 37.2% win rate vs 3 Delta in 8000-game tournament, seed 7777
  });

})();
