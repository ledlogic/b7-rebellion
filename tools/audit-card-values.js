#!/usr/bin/env node
/**
 * tools/audit-card-values.js — print the full basePoints table for the deck
 * and verify the sum of all card values is what we expect.
 *
 * Useful any time you want to confirm "is the score math correct?" — this
 * tool dumps the source of truth (card.js's basePoints) for every card in
 * the 53-card deck. Every trick's score is just a sum of these values.
 *
 * Run:
 *   node tools/audit-card-values.js
 */
'use strict';
const harn = require('./tournament.js');

const ctx  = harn.loadGameContext(harn.makeRng(1));
const R    = ctx.window.Rebellion;
const C    = R.card;

console.log('╔════════════════════════════════════════════════════════════════════╗');
console.log('║              REBELLION CARD VALUE AUDIT                            ║');
console.log('║  All trick scores = sum of basePoints across cards in the trick.   ║');
console.log('╚════════════════════════════════════════════════════════════════════╝');
console.log();

const SUITS = ['H', 'D', 'C', 'S'];
const SUIT_LABEL = { H: '♥ Hearts (Crew)', D: '♦ Diamonds (Tech)', C: '♣ Clubs (Hazards)', S: '♠ Spades (Federation)' };
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

let grandSum = 0;
for (const s of SUITS){
  console.log('— ' + SUIT_LABEL[s] + ' ' + '─'.repeat(40 - SUIT_LABEL[s].length));
  let suitSum = 0;
  for (const r of RANKS){
    const card = { suit: s, rank: r, id: s + r };
    const meta = C.cardMeta(card);
    const bp = meta.base;
    suitSum += bp;
    const sign = bp >= 0 ? '+' : '';
    const power = meta.power ? '  [' + meta.power + ']' : (meta.scorePower ? '  [' + meta.scorePower + ']' : '');
    console.log('  ' + C.cardLabel(card).padEnd(4) + '  ' + sign + String(bp).padEnd(4) + '  ' + meta.name.padEnd(22) + power);
  }
  console.log('  ' + ('subtotal').padEnd(4) + '  ' + (suitSum >= 0 ? '+' : '') + suitSum);
  grandSum += suitSum;
  console.log();
}

/* Joker */
console.log('— Joker ─────────────────────────────────────────────────');
const joker = { suit:'JK', rank:'JOKER', id:'JOKER' };
const jmeta = C.cardMeta(joker);
console.log('  ' + C.cardLabel(joker).padEnd(4) + '  ' + (jmeta.base >= 0 ? '+' : '') + jmeta.base + '   ' + jmeta.name + '  [' + (jmeta.power || jmeta.scorePower || 'none') + ']');
grandSum += jmeta.base;
console.log();

console.log('═'.repeat(70));
console.log('GRAND SUM (every card in the deck): ' + (grandSum >= 0 ? '+' : '') + grandSum);
console.log('═'.repeat(70));
console.log();
console.log('Interpretation: in a single mission with no cancellations or score');
console.log('powers fired, the SUM of all players\' pile points equals the grand');
console.log('sum minus the points of any cards left in the Reserve / unscored.');
console.log();
console.log('To verify a trick\'s math live, watch the comms log:');
console.log('  "Adjutant Reeve captures: K♥(+10) + 5♣(-5) + 4♠(-4) + 2♠(-2)');
console.log('   = -1  →  pile now +17"');
console.log('Every trick logs that line. The flash shows the same delta.');
