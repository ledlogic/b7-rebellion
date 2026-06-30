/**
 * @file Card data model for Rebellion. The canonical source of truth for what
 * cards exist (suits, ranks, joker), what they're called, what they're worth,
 * and what powers they carry. Also owns the deck-level operations that are
 * intrinsic to "cards": building the deck, shuffling it, and dealing a
 * mission. No DOM, no game-flow state, no live mutation. Safe to load in
 * Node too via the UMD wrap at the bottom.
 *
 * @module Rebellion.card
 */
(function (global) {
  'use strict';

  /**
   * Card-rank string. The deck uses standard playing-card ranks; aces are
   * high. The Joker is encoded with `suit: 'JK'` and `rank: 'JOKER'` and is
   * matched via {@link module:Rebellion.card.isJoker}, not via this enum.
   *
   * @typedef {('2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'J'|'Q'|'K'|'A')} Rank
   */

  /**
   * Card-suit code. Standard four plus `'JK'` for the Joker.
   *
   * @typedef {('H'|'D'|'C'|'S'|'JK')} Suit
   */

  /**
   * A playing card.
   *
   * @typedef {Object} Card
   * @property {Suit} suit
   * @property {Rank|'JOKER'} rank
   * @property {string} id   Stable identifier (`suit + rank`, e.g. `'HQ'`,
   *                         or `'JOKER'`). Used for DOM keys and equality.
   */

  /**
   * Metadata for one card: in-universe name, base point value, optional
   * in-play power (resolved when the card is captured) and optional
   * end-of-mission scoring power.
   *
   * @typedef {Object} CardMeta
   * @property {string}  name        In-universe name (e.g. `'Avon'`, `'IMIPAK'`).
   * @property {number}  base        Base point value before scoring rules apply.
   * @property {string} [power]      In-play power identifier (e.g. `'teleport'`).
   * @property {string} [scorePower] End-of-mission scoring power (e.g. `'mutoid'`).
   */

  /**
   * Deal configuration for one player count.
   *
   * @typedef {Object} DealConfig
   * @property {number} reserve  Number of cards withheld face-down as the Reserve.
   * @property {number} hand     Number of cards dealt to each player.
   */

  /** @type {Rank[]} */
  const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

  /** @type {Suit[]} */
  const SUITS = ['H','D','C','S'];

  /**
   * Glyph map for suit codes. Joker uses '★'.
   * @type {Object<Suit, string>}
   */
  const SUIT_SYMBOL = { H:'♥', D:'♦', C:'♣', S:'♠', JK:'★' };

  /**
   * In-universe faction names by suit.
   * @type {Object<Suit, string>}
   */
  const SUIT_FACTION = {
    H:'Liberator Crew',
    D:'Technology',
    C:'Hazards',
    S:'Federation Forces',
    JK:'Wild'
  };

  /**
   * Deal table indexed by player count. For each supported player count, gives
   * the size of the Reserve and the size of each player's hand.
   *
   * @type {Object<number, DealConfig>}
   */
  const DEAL_TABLE = {
    2:{reserve:3, hand:25},
    3:{reserve:5, hand:16},
    4:{reserve:5, hand:12},
    5:{reserve:3, hand:10},
    6:{reserve:5, hand:8},
    7:{reserve:4, hand:7}
  };

  /**
   * Numeric value of a rank (2 → 2, 10 → 10, J → 11, Q → 12, K → 13, A → 14).
   * Used by `engine.resolveTrickWinner` for follow-suit comparison and by AIs
   * for strength ordering. Aces are high.
   *
   * @param {Rank} r
   * @returns {number} 2..14
   */
  function rankValue(r){ return RANKS.indexOf(r) + 2; }

  /**
   * Is this card the Joker?
   * @param {Card} c
   * @returns {boolean}
   */
  function isJoker(c){ return c.suit === 'JK'; }

  /**
   * Build a fresh 53-card Rebellion deck: 52 standard cards plus one Joker
   * (Vila). Cards are returned in canonical order (suit blocks H, D, C, S,
   * then JOKER). Used internally by `dealMission` and externally by the
   * dealer-draw flow.
   *
   * @returns {Card[]} 53 cards, unshuffled.
   */
  function buildDeck(){
    const deck = [];
    for (const s of SUITS) for (const r of RANKS) deck.push({ suit:s, rank:r, id:s+r });
    deck.push({ suit:'JK', rank:'JOKER', id:'JOKER' });
    return deck;
  }

  /**
   * Fisher–Yates shuffle. Returns a new array; the input is not mutated.
   * The only consumer in Rebellion is the deck (dealer-draw + dealMission)
   * which is why it lives in card.js — there is no card-agnostic call site.
   *
   * @template T
   * @param {T[]} arr
   * @returns {T[]} A freshly-shuffled copy.
   */
  function shuffle(arr){
    const a = arr.slice();
    for (let i = a.length-1; i > 0; i--){
      const j = Math.floor(Math.random()*(i+1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * Deal one mission. Sets aside the Reserve (face-down, top of deck), then
   * deals the rest one card at a time starting from the player to the left
   * of the dealer. Returns the Reserve and each player's hand. The G/M state
   * objects are not touched — the caller (state.initMissionState) installs
   * the result.
   *
   * @param {number} numPlayers  2..7 (must be a key in DEAL_TABLE).
   * @param {number} dealerIdx   Seat index of the dealer; first card lands on
   *                             `(dealerIdx + 1) % numPlayers`.
   * @returns {{reserve: Card[], hands: Card[][]}} Reserve cards and per-seat
   *          hands in seat order.
   */
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

  /**
   * Canonical metadata for a card: its in-universe name, base point value,
   * and any in-play or end-of-mission powers. This is the **only** place
   * card identities are defined; all other modules read names/points/powers
   * through this function.
   *
   * @param {Card} c
   * @returns {CardMeta}
   */
  function cardMeta(c){
    if (isJoker(c)) return { name:'Vila Restal', base:10, power:'pickLock' };
    const r = c.rank;
    const numeric = r!=='J' && r!=='Q' && r!=='K' && r!=='A';
    if (c.suit === 'H'){
      if (numeric) return { name:'Rescued Crew', base: parseInt(r,10) };
      const nm = { '10':'Gan', J:'Cally', Q:'Jenna Stannis', K:'Blake', A:'Avon' }[r];
      return { name: nm, base: 10 };
    }
    if (c.suit === 'D'){
      if (numeric && r!=='10') return { name:'Tech Salvage', base:1 };
      /* IMIPAK: aligned with the other named Diamond techs at +5 (Teleport,
         Liberator, Zen, Orac all +5). User decision; rulebook through
         v2.48 listed +1 but the named-tech parity is the design intent. */
      if (r==='10') return { name:'IMIPAK', base:5, scorePower:'imipak' };
      if (r==='J')  return { name:'Teleport Bracelet', base:5, power:'teleport' };
      if (r==='Q')  return { name:'Liberator', base:5, power:'destroyReserve' };
      if (r==='K')  return { name:'Zen', base:5 };
      if (r==='A')  return { name:'Orac', base:5, power:'oracPeek', scorePower:'oracCancel' };
    }
    if (c.suit === 'C'){
      /* Per rulebook v2.48 line 90: Clubs 2-9 are −1 each (uniform), NOT
         face-value −2 to −9 as the code previously had. Long-standing bug
         — every game scored Clubs too punitively. The Gamma/Beta tunings
         were calibrated against the wrong values, so AI strength
         measurements will shift after this fix. */
      if (numeric && r!=='10') return { name:'Hazard', base: -1 };
      if (r==='10') return { name:'Dayna Mellanby', base:0, scorePower:'dayna' };
      if (r==='J')  return { name:'System Failure', base:-5 };
      if (r==='Q')  return { name:'Asteroid Field', base:-5 };
      if (r==='K')  return { name:'Carnell', base:-5 };
      if (r==='A')  return { name:'Star One', base:-5, power:'starOneEnd' };
    }
    if (c.suit === 'S'){
      /* Anna Grant is rank 10 — must match BEFORE the generic numeric
         branch, since `numeric` is true for ranks 2-10. Previously the
         generic branch caught Spades 10 first and labeled it "Federation
         Trooper" (value was right, name was wrong). */
      if (r==='10') return { name:'Anna Grant', base:-10 };
      if (numeric)  return { name:'Federation Trooper', base: -parseInt(r,10) };
      if (r==='J')  return { name:'Mutoid', base:-10, scorePower:'mutoid' };
      if (r==='Q')  return { name:'Section Leader', base:-10 };
      if (r==='K')  return { name:'Travis', base:-10, power:'seizeReserve' };
      if (r==='A')  return { name:'Servalan', base:-10, power:'revealHand' };
    }
  }

  /**
   * Short text label for UI rendering. Joker becomes `'VILA'`; all others
   * become `rank + suit-symbol` (e.g. `'7♥'`, `'A♠'`).
   *
   * @param {Card} c
   * @returns {string}
   */
  function cardLabel(c){ return isJoker(c) ? 'VILA' : (c.rank + SUIT_SYMBOL[c.suit]); }

  /**
   * In-universe name for a card. Convenience wrapper for `cardMeta(c).name`.
   * @param {Card} c
   * @returns {string}
   */
  function cardName(c){ return cardMeta(c).name; }

  /**
   * Base point value for a card (before scoring rules apply). May be
   * negative. Convenience wrapper for `cardMeta(c).base`.
   *
   * @param {Card} c
   * @returns {number}
   */
  function basePoints(c){ return cardMeta(c).base; }

  /** @param {Card} c @returns {boolean} True for ranks 2, 3, 5, 7. */
  function isPrime(c){    return !isJoker(c) && ['2','3','5','7'].includes(c.rank); }
  /** @param {Card} c @returns {boolean} True for non-face, non-ace numeric cards. */
  function isNumbered(c){ return !isJoker(c) && c.rank!=='J' && c.rank!=='Q' && c.rank!=='K' && c.rank!=='A'; }
  /** @param {Card} c @returns {boolean} */
  function isHeart(c){    return c.suit === 'H'; }
  /** @param {Card} c @returns {boolean} True for Hearts J/Q/K. */
  function isHeartFace(c){return c.suit === 'H' && (c.rank==='J' || c.rank==='Q' || c.rank==='K'); }
  /** @param {Card} c @returns {boolean} */
  function isHeartAce(c){ return c.suit === 'H' && c.rank === 'A'; }

  /**
   * Does the given pile contain a card with the given suit and rank?
   * Used by the scoring rules (Psycho-Strategist Gambit, IMIPAK).
   *
   * @param {Card[]} pile
   * @param {Suit} suit
   * @param {Rank|'JOKER'} rank
   * @returns {boolean}
   */
  function pileHas(pile, suit, rank){
    return pile.some(c => c.suit === suit && c.rank === rank);
  }

  /**
   * Is this card a valid target for IMIPAK, Orac, or Teleport Bracelet?
   * Targets: any Hearts card, any Spades card, Dayna Mellanby (10♣), or Vila (Joker).
   * @param {Card} c
   * @returns {boolean}
   */
  function isPersonCard(c){
    if (isJoker(c)) return true;                           // Vila
    if (c.suit === 'H') return true;                       // any Heart
    if (c.suit === 'S') return true;                       // any Spade
    if (c.suit === 'C' && c.rank === '10') return true;   // Dayna Mellanby
    return false;
  }

  const api = {
    RANKS, SUITS, SUIT_SYMBOL, SUIT_FACTION, DEAL_TABLE,
    rankValue, isJoker, buildDeck, shuffle, dealMission,
    cardMeta, cardLabel, cardName, basePoints,
    isPrime, isNumbered, isHeart, isHeartFace, isHeartAce,
    pileHas, isPersonCard
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.Rebellion = global.Rebellion || {};
  global.Rebellion.card = api;

})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));
