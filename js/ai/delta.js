/* Rebellion — ai/delta.js
 * Δ DELTA — Conscript tier.
 * One-card heuristic with no memory. Looks only at the cards currently on the
 * table to decide whether to dump high or duck low, then commits.
 */
(function () {
  'use strict';
  const R = (window.Rebellion = window.Rebellion || {});

  function chooseCard(player, legal, trick, ledSuit, isInvasion, ctx){
    const { basePoints, isJoker, rankValue } = ctx.engine;

    // LEAD — play the smallest-magnitude card we can spare.
    if (trick.length === 0 && !isInvasion){
      const nonJoker = legal.filter(c => !isJoker(c));
      const pool = nonJoker.length ? nonJoker : legal;
      pool.sort((a, b) => Math.abs(basePoints(a)) - Math.abs(basePoints(b)));
      return pool[0];
    }

    // FOLLOW — eyeball the trick's running value, decide to win or duck.
    let desire = trick.reduce((s, p) => s + (isJoker(p.card) ? -3 : basePoints(p.card)), 0);
    if (trick.some(p => !isJoker(p.card) && p.card.suit==='S' && (p.card.rank==='A' || p.card.rank==='K'))) desire -= 14;
    if (trick.some(p => !isJoker(p.card) && p.card.suit==='C' && p.card.rank==='A')) desire -= 8;
    if (trick.some(p => !isJoker(p.card) && p.card.suit==='D' && ['J','Q','K','A'].includes(p.card.rank))) desire += 4;

    const followers = legal.filter(c => !isJoker(c) && c.suit === ledSuit);
    if (followers.length > 0){
      followers.sort((a, b) => rankValue(a.rank) - rankValue(b.rank));
      return desire > 0 ? followers[followers.length-1] : followers[0];
    }

    // SLUFF — dump our most-negative card.
    const pool = legal.slice();
    pool.sort((a, b) => {
      const av = isJoker(a) ? -3 : basePoints(a);
      const bv = isJoker(b) ? -3 : basePoints(b);
      return av - bv;
    });
    return pool[0];
  }

  R.ai.register('delta', {
    label: 'Δ Delta — Conscript',
    description: 'One-card heuristic, no memory. Quick, reactive, exploitable.',
    chooseCard
    /* no chooseZenTarget / choosePickLockTarget — both default to random */
  });
})();
