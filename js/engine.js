/**
 * @file Game-flow rules for Rebellion: legal-play computation, trick
 * resolution, grammar helpers for "You"-vs-persona-name messages, and the
 * `sleep` timing utility used by the async game loop. Depends on
 * `Rebellion.card` (loaded first). No DOM, no live state.
 *
 * @module Rebellion.engine
 */
(function (global) {
  'use strict';

  // Card module dependency — browser path uses the already-loaded global,
  // Node path falls back to require. card.js must be loaded first in the
  // browser.
  const card = (global.Rebellion && global.Rebellion.card)
    || ((typeof require !== 'undefined') ? require('./card') : null);
  if (!card) throw new Error('Rebellion engine.js requires card.js to be loaded first');
  const { isJoker, rankValue } = card;

  /**
   * One play in a trick — a card put down by either a seated player (by index)
   * or by the Andromedan invasion (by the literal string `'ANDROMEDAN'`).
   *
   * @typedef {Object} Play
   * @property {number|'ANDROMEDAN'} playerIdx
   * @property {Card} card
   */

  /**
   * Promise-based sleep helper. The game loop awaits this between beats so
   * the user can read what just happened.
   *
   * @param {number} ms Milliseconds to wait.
   * @returns {Promise<void>}
   */
  function sleep(ms){ return new Promise(res => setTimeout(res, ms)); }

  /**
   * Compute which cards in `hand` may legally be played given the led suit.
   * Standard follow-suit rule plus the Joker exception: the Joker can be
   * played at any time, but if the player can follow suit they must (the
   * Joker rides along with the followers in the returned list).
   *
   * @param {Card[]} hand
   * @param {Suit|null} ledSuit  The suit led in the current
   *        trick, or `null` if the player is leading.
   * @returns {Card[]} A new array (shares card object refs).
   */
  function legalPlays(hand, ledSuit, currentTrick){
    // Anna Grant compulsion: if 10♠ is already in the trick, holder of A♥ must play Avon
    if (currentTrick && currentTrick.some(p => p.card.suit === 'S' && p.card.rank === '10')){
      const avon = hand.find(c => c.suit === 'H' && c.rank === 'A');
      if (avon) return [avon];
    }
    if (!ledSuit) return hand.slice();
    const followers = hand.filter(c => c.suit === ledSuit);
    if (followers.length > 0) return followers.concat(hand.filter(isJoker));
    return hand.slice();
  }

  /**
   * Resolve the winner of a completed trick. Highest card of the led suit
   * wins; off-suit cards and the Joker can never win a trick. The Andromedan
   * (during invasion waves) can win and is returned as the literal string
   * `'ANDROMEDAN'`.
   *
   * @param {Play[]} trick    The trick in play order.
   * @param {Suit} ledSuit
   * @returns {number|'ANDROMEDAN'} Winner's player index, or `'ANDROMEDAN'`.
   */
  function resolveTrickWinner(trick, ledSuit){
    // Vila (Joker) wins any trick he enters — first Joker in play order wins
    const vilaPlay = trick.find(p => isJoker(p.card));
    if (vilaPlay) return vilaPlay.playerIdx === 'ANDROMEDAN' ? 'ANDROMEDAN' : vilaPlay.playerIdx;
    let best = null;
    for (const play of trick){
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

  /**
   * Conjugate a third-person-singular verb to match the subject. If `name`
   * is anything other than the literal `'You'`, the third-person form is
   * returned unchanged. If `name === 'You'`, the verb is bare-formed,
   * handling regular `-s`/`-es`/`-ies` endings and the common irregulars
   * (`has → have`, `is → are`, `does → do`, `was → were`).
   *
   * @param {string} name                    The grammatical subject.
   * @param {string} thirdPersonSingular     The verb in third-person-singular
   *                                         form, e.g. `'wins'`, `'has'`.
   * @returns {string}
   *
   * @example
   *   verbFor('Avon',  'wins')  // → 'wins'
   *   verbFor('You',   'wins')  // → 'win'
   *   verbFor('You',   'has')   // → 'have'
   *   verbFor('You',   'tries') // → 'try'
   */
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

  /**
   * Build a grammatical "subject verb" phrase, e.g. `subj('Avon', 'wins')` →
   * `'Avon wins'`, `subj('You', 'wins')` → `'You win'`.
   *
   * @param {string} name
   * @param {string} thirdPersonSingular
   * @returns {string}
   */
  function subj(name, thirdPersonSingular){ return name + ' ' + verbFor(name, thirdPersonSingular); }

  /**
   * Build a possessive for either a persona name or `'You'`.
   *
   * @param {string} name
   * @returns {string} `'your'` if `name === 'You'`, else `name + "'s"`.
   */
  function possessiveOf(name){ return name === 'You' ? 'your' : (name + "'s"); }

  const api = {
    sleep,
    legalPlays, resolveTrickWinner,
    verbFor, subj, possessiveOf
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.Rebellion = global.Rebellion || {};
  global.Rebellion.engine = api;

})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));
