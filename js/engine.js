/* Rebellion — engine.js
 * Game-flow rules: dealing, legal plays, trick resolution, plus utilities
 * (shuffle, sleep) and grammar helpers. The card data model lives in card.js;
 * engine.js depends on it. No DOM, no global state. Safe in Node too.
 */
(function (global) {
  'use strict';

  // Dependency on card.js — browser path uses the already-loaded global,
  // Node path uses require. card.js must be loaded first in the browser.
  const card = (global.Rebellion && global.Rebellion.card)
    || ((typeof require !== 'undefined') ? require('./card') : null);
  if (!card) throw new Error('Rebellion engine.js requires card.js to be loaded first');
  const { isJoker, rankValue, buildDeck } = card;

  const DEAL_TABLE = {
    2:{reserve:5, hand:24},
    3:{reserve:5, hand:16},
    4:{reserve:5, hand:12},
    5:{reserve:3, hand:10},
    6:{reserve:5, hand:8},
    7:{reserve:4, hand:7}
  };

  function shuffle(arr){
    const a = arr.slice();
    for (let i = a.length-1; i > 0; i--){
      const j = Math.floor(Math.random()*(i+1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function sleep(ms){ return new Promise(res => setTimeout(res, ms)); }

  function legalPlays(hand, ledSuit){
    if (!ledSuit) return hand.slice();
    const followers = hand.filter(c => c.suit === ledSuit);
    if (followers.length > 0) return followers.concat(hand.filter(isJoker));
    return hand.slice();
  }

  function dealMission(numPlayers, dealerIdx){
    const cfg = DEAL_TABLE[numPlayers];
    const deck = shuffle(buildDeck());
    const reserve = deck.slice(0, cfg.reserve);
    const rest = deck.slice(cfg.reserve);
    const hands = Array.from({length: numPlayers}, () => []);
    let pos = (dealerIdx + 1) % numPlayers;
    for (let i = 0; i < rest.length; i++){
      hands[pos].push(rest[i]);
      pos = (pos + 1) % numPlayers;
    }
    return { reserve, hands };
  }

  function resolveTrickWinner(trick, ledSuit){
    let best = null;
    for (const play of trick){
      if (isJoker(play.card)) continue;
      if (play.card.suit !== ledSuit) continue;
      if (!best || rankValue(play.card.rank) > rankValue(best.card.rank)) best = play;
    }
    if (!best) best = trick[0];
    return best.playerIdx === 'ANDROMEDAN' ? 'ANDROMEDAN' : best.playerIdx;
  }

  /* ----- Grammar helpers for "You" vs persona names -----
     The human player's name is the pronoun "You", so any message built as
     `name + ' verb'` produces ungrammatical output ("You wins") when the
     human is the subject. These helpers map the third-person form back to
     the bare form when (and only when) the subject is "You". */
  function verbFor(name, thirdPersonSingular){
    if (name !== 'You') return thirdPersonSingular;
    const irregular = { has:'have', is:'are', does:'do', was:'were' };
    if (irregular[thirdPersonSingular]) return irregular[thirdPersonSingular];
    const v = thirdPersonSingular;
    if (v.length > 3 && v.endsWith('ies')) return v.slice(0, -3) + 'y';            // tries → try
    if (/(?:ss|x|sh|ch|zz)es$/.test(v)) return v.slice(0, -2);                     // passes/boxes/wishes/watches/buzzes
    if (v.endsWith('s')) return v.slice(0, -1);                                    // wins → win, seizes → seize
    return v;
  }
  function subj(name, thirdPersonSingular){ return name + ' ' + verbFor(name, thirdPersonSingular); }
  function possessiveOf(name){ return name === 'You' ? 'your' : (name + "'s"); }

  const api = {
    DEAL_TABLE, shuffle, sleep,
    legalPlays, dealMission, resolveTrickWinner,
    verbFor, subj, possessiveOf
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.Rebellion = global.Rebellion || {};
  global.Rebellion.engine = api;

})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));
