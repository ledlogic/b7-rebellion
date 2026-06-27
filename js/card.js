/* Rebellion — card.js
 * The card data model. Defines what a card IS (suits, ranks, names, points,
 * powers) and the pure predicates that read those properties. No game flow,
 * no DOM, no state. Loadable in Node too.
 */
(function (global) {
  'use strict';

  const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const SUITS = ['H','D','C','S'];
  const SUIT_SYMBOL = { H:'♥', D:'♦', C:'♣', S:'♠', JK:'★' };
  const SUIT_FACTION = {
    H:'Liberator Crew',
    D:'Technology',
    C:'Hazards',
    S:'Federation Forces',
    JK:'Wild'
  };

  function rankValue(r){ return RANKS.indexOf(r) + 2; }   // 2..14
  function isJoker(c){ return c.suit === 'JK'; }

  function buildDeck(){
    const deck = [];
    for (const s of SUITS) for (const r of RANKS) deck.push({ suit:s, rank:r, id:s+r });
    deck.push({ suit:'JK', rank:'JOKER', id:'JOKER' });
    return deck;
  }

  /* cardMeta — the canonical source of truth for every named card in the
     Rebellion deck: name, base point value, in-play power (.power) and
     end-of-mission scoring power (.scorePower). */
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
      if (r==='10') return { name:'IMIPAK', base:1, scorePower:'imipak' };
      if (r==='J')  return { name:'Teleport Bracelet', base:5, power:'teleport' };
      if (r==='Q')  return { name:'Liberator', base:5, power:'destroyReserve' };
      if (r==='K')  return { name:'Zen', base:5, power:'zenLook' };
      if (r==='A')  return { name:'Orac', base:5, power:'oracCancel' };
    }
    if (c.suit === 'C'){
      if (numeric && r!=='10') return { name:'Hazard', base: -parseInt(r,10) };
      if (r==='10') return { name:'Dayna Mellanby', base:10 };
      if (r==='J')  return { name:'System Failure', base:-5 };
      if (r==='Q')  return { name:'Asteroid Field', base:-5 };
      if (r==='K')  return { name:'Carnell', base:-5 };
      if (r==='A')  return { name:'Star One', base:-5, power:'starOneEnd' };
    }
    if (c.suit === 'S'){
      if (numeric)  return { name:'Federation Trooper', base: -parseInt(r,10) };
      if (r==='10') return { name:'Anna Grant', base:-10 };
      if (r==='J')  return { name:'Mutoid', base:-10, scorePower:'mutoid' };
      if (r==='Q')  return { name:'Section Leader', base:-10 };
      if (r==='K')  return { name:'Travis', base:-10, power:'seizeReserve' };
      if (r==='A')  return { name:'Servalan', base:-10, power:'revealHand' };
    }
  }

  function cardLabel(c){ return isJoker(c) ? 'VILA' : (c.rank + SUIT_SYMBOL[c.suit]); }
  function cardName(c){ return cardMeta(c).name; }
  function basePoints(c){ return cardMeta(c).base; }

  function isPrime(c){    return !isJoker(c) && ['2','3','5','7'].includes(c.rank); }
  function isNumbered(c){ return !isJoker(c) && c.rank!=='J' && c.rank!=='Q' && c.rank!=='K' && c.rank!=='A'; }
  function isHeart(c){    return c.suit === 'H'; }
  function isHeartFace(c){return c.suit === 'H' && (c.rank==='J' || c.rank==='Q' || c.rank==='K'); }
  function isHeartAce(c){ return c.suit === 'H' && c.rank === 'A'; }

  /* Card-collection helper. */
  function pileHas(pile, suit, rank){
    return pile.some(c => c.suit === suit && c.rank === rank);
  }

  const api = {
    RANKS, SUITS, SUIT_SYMBOL, SUIT_FACTION,
    rankValue, isJoker, buildDeck, cardMeta, cardLabel, cardName, basePoints,
    isPrime, isNumbered, isHeart, isHeartFace, isHeartAce,
    pileHas
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.Rebellion = global.Rebellion || {};
  global.Rebellion.card = api;

})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));
