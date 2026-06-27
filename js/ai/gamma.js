/* Rebellion — ai/gamma.js
 * Γ GAMMA — Officer tier.
 *
 * Tracks every revealed card and every known void during the mission, then:
 *   - Leading: prefer dumping low-rank spades/clubs (force opponents to capture
 *     negatives). Never lead hearts, joker, Servalan or Star One.
 *   - Following: compute the real value of capturing this trick (including
 *     Star One mission-end risk, Servalan exposure penalty, diamond-power
 *     bonus, invasion-repel bias). Play the LOWEST card that beats everything
 *     still possible when we want the trick; play the HIGHEST card guaranteed
 *     not to win when we don't.
 *   - Sluffing: dump the most-negative card (worst for whoever captures).
 *
 * All knobs sit in WEIGHTS below — separated so an offline tuner can later
 * replace them with empirically-optimized values without touching the logic.
 */
(function () {
  'use strict';
  const R = (window.Rebellion = window.Rebellion || {});

  /* ---- Tunable weights. A future Node optimizer can overwrite this object. ---- */
  const WEIGHTS = {
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

  function chooseCard(player, legal, trick, ledSuit, isInvasion, ctx){
    const { basePoints, isJoker, rankValue, RANKS } = ctx.card;
    const W = WEIGHTS;

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

  function chooseZenTarget(player, others, ctx){
    /* Prefer unexposed opponent with most cards — max info per peek. */
    const useful = others.filter(p => !p.exposed);
    const pool = useful.length ? useful : others;
    return pool.slice().sort((a, b) => b.hand.length - a.hand.length)[0];
  }

  function choosePickLockTarget(player, others, ctx){
    /* Prefer exposed opponent (known hand → safer choice), then largest hand. */
    const exposed = others.find(p => p.exposed);
    return exposed || others.slice().sort((a, b) => b.hand.length - a.hand.length)[0];
  }

  R.ai.register('gamma', {
    label: 'Γ Gamma — Officer',
    description: 'Tracks every play, counts what is still out, exploits known voids.',
    chooseCard,
    chooseZenTarget,
    choosePickLockTarget,
    weights: WEIGHTS                // exposed so tuners/inspectors can introspect
  });
})();
