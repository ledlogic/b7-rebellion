/* Rebellion — engine.js
 * Pure rules: cards, ranks, suits, deck building, legal plays, trick resolution, pile predicates.
 * No DOM, no global state. Safe to load in Node too (UMD-ish at bottom).
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

  const DEAL_TABLE = {
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

  function pileHas(pile, suit, rank){
    return pile.some(c => c.suit === suit && c.rank === rank);
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
    RANKS, SUITS, SUIT_SYMBOL, SUIT_FACTION,
    rankValue, isJoker, buildDeck, cardMeta, cardLabel, cardName, basePoints,
    isPrime, isNumbered, isHeart, isHeartFace, isHeartAce,
    DEAL_TABLE, shuffle, sleep,
    legalPlays, dealMission, resolveTrickWinner, pileHas,
    verbFor, subj, possessiveOf
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.Rebellion = global.Rebellion || {};
  global.Rebellion.engine = api;

})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));
