#!/usr/bin/env node
/**
 * Stage 1 test harness for cloneState / restoreState / rolloutMission.
 *
 * Five tests:
 *   1.  CLONE FIDELITY — clone, compare structurally, expect identical
 *   2.  CLONE INDEPENDENCE — mutate live, verify clone unchanged
 *   3.  RESTORE — restore from clone, verify state equals clone
 *   4.  ROLLOUT COMPLETION — from a mid-Mission state, rolloutMission
 *       runs to completion and returns sensible totals
 *   5.  ROLLOUT DETERMINISM — same state + same AI calls + no RNG inside
 *       chooseCard = same result twice (rolloutMission is deterministic
 *       for AI tiers that don't randomize)
 *
 * Run:
 *   node tools/test-rollout.js
 */
'use strict';
const harn = require('./tournament.js');

function assertEq(label, a, b){
  if (a !== b){
    console.error('  FAIL ' + label + ': ' + a + ' !== ' + b);
    process.exit(1);
  }
}
function assertDeepEq(label, a, b){
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb){
    console.error('  FAIL ' + label);
    console.error('    a = ' + sa.slice(0, 200));
    console.error('    b = ' + sb.slice(0, 200));
    process.exit(1);
  }
}
function pass(label){ console.log('  PASS  ' + label); }

async function main(){
  /* ---- Bootstrap: set up an all-AI 4-player game and play one mission
     partway, so we have a meaningful mid-state to test against. ---- */
  console.log('Bootstrapping game context...');
  const rng = harn.makeRng(42);
  const ctx = harn.loadGameContext(rng);
  const R = ctx.window.Rebellion;
  const S = R.state, C = R.card, E = R.engine;

  const seats = ['gamma', 'delta', 'delta', 'delta'];
  const pool = R.personas.pickN(4);
  const players = seats.map((lvl, i) => S.newPlayer(i, false, pool[i], lvl));
  S.G = {
    numPlayers: 4, players,
    missionIndex: 0,
    totals: [0,0,0,0],
    missionLog: [],
    startDealer: 0,
    difficulty: 'mixed',
    systemName: 'TestZone',
    gameStartedAt: null
  };
  S.initMissionState(0);   /* deals cards, sets M */
  console.log('  reserve=' + S.M.reserve.length + ', hand0=' + S.G.players[0].hand.length);

  /* ---- Play two tricks manually so we have history + voids etc. ---- */
  console.log('Playing 2 tricks to build mid-state...');
  for (let t = 0; t < 2; t++){
    const M = S.M;
    M.trickNumber++;
    M.currentTrick = [];
    M.ledSuit = null;
    const order = [];
    for (let i = 0; i < 4; i++) order.push((M.leadIdx + i) % 4);
    for (const pIdx of order){
      M.currentTurn = pIdx;
      const player = S.G.players[pIdx];
      const legal = E.legalPlays(player.hand, M.ledSuit, M.currentTrick);
      const card = R.ai.chooseCard(player, legal, M.currentTrick, M.ledSuit, false);
      player.hand = player.hand.filter(c => c.id !== card.id);
      const ledBefore = M.ledSuit;
      M.currentTrick.push({ playerIdx: pIdx, who: 'PLAYER', card, timestamp: new Date() });
      if (!M.ledSuit && !C.isJoker(card)) M.ledSuit = card.suit;
      S.recordPlay(pIdx, card, ledBefore);
    }
    const winner = E.resolveTrickWinner(M.currentTrick, M.ledSuit);
    /* Move trick to winner's pile, set leadIdx for next trick */
    for (const p of M.currentTrick) S.G.players[winner].pile.push(p.card);
    M.leadIdx = winner;
    M.currentTrick = [];
  }
  console.log('  trick=' + S.M.trickNumber + ', voids=' + Object.keys(S.M.knownVoids).length);
  console.log();

  /* ============================================================
   * TEST 1 — CLONE FIDELITY
   * ============================================================ */
  console.log('Test 1: clone fidelity');
  const snap = S.cloneState();
  assertEq('numPlayers', snap.G.numPlayers, S.G.numPlayers);
  assertEq('totals length', snap.G.totals.length, S.G.totals.length);
  assertEq('player count', snap.G.players.length, S.G.players.length);
  assertEq('player 0 name', snap.G.players[0].name, S.G.players[0].name);
  assertEq('player 0 hand size', snap.G.players[0].hand.length, S.G.players[0].hand.length);
  assertEq('M trickNumber', snap.M.trickNumber, S.M.trickNumber);
  assertEq('M leadIdx', snap.M.leadIdx, S.M.leadIdx);
  assertEq('reserve size', snap.M.reserve.length, S.M.reserve.length);
  assertEq('playedCards size', snap.M.playedCards.length, S.M.playedCards.length);
  pass('all fields match');

  /* ============================================================
   * TEST 2 — CLONE INDEPENDENCE
   * ============================================================ */
  console.log('Test 2: clone independence — mutate live, clone must not change');
  const origHand0Size = snap.G.players[0].hand.length;
  const origPlayedSize = snap.M.playedCards.length;
  /* Mutate live: drop a card from player 0's hand */
  S.G.players[0].hand.pop();
  S.M.playedCards.push({ suit: 'X', rank: 'X', id: 'fake' });
  assertEq('snap hand 0 unchanged after live pop', snap.G.players[0].hand.length, origHand0Size);
  assertEq('snap playedCards unchanged after live push', snap.M.playedCards.length, origPlayedSize);
  pass('clone is independent of live mutations');

  /* ============================================================
   * TEST 3 — RESTORE
   * ============================================================ */
  console.log('Test 3: restoreState — restoring snap matches snap exactly');
  S.restoreState(snap);
  assertEq('hand 0 size matches snap', S.G.players[0].hand.length, snap.G.players[0].hand.length);
  assertEq('playedCards size matches snap', S.M.playedCards.length, snap.M.playedCards.length);
  pass('state restored from snapshot');

  /* ============================================================
   * TEST 4 — ROLLOUT COMPLETION
   * ============================================================ */
  console.log('Test 4: rolloutMission completes the Mission and returns scores');
  /* Snapshot before rollout so we can test determinism after */
  const preRolloutSnap = S.cloneState();
  const result = await R.flow.runHeadless(async () => {
    return await R.flow.rolloutMission();
  });
  if (!result) { console.error('  FAIL rollout returned null'); process.exit(1); }
  assertEq('missionOver true', S.M.missionOver, true);
  /* Totals should be assigned (non-zero somewhere unless andromedan/vilaBluff) */
  const totalSum = result.totals.reduce((s,x) => s + x, 0);
  console.log('  result.totals = [' + result.totals.join(', ') + ']  sum = ' + totalSum + '  missionResult=' + result.missionResult);
  pass('rollout completed the mission');

  /* ============================================================
   * TEST 5 — ROLLOUT DETERMINISM
   * ============================================================ */
  console.log('Test 5: rollout determinism — same input = same output');
  /* Restore the pre-rollout snap and run rollout again. Should produce the
     same totals since Gamma+Delta are deterministic given a state. */
  S.restoreState(preRolloutSnap);
  const result2 = await R.flow.runHeadless(async () => {
    return await R.flow.rolloutMission();
  });
  assertDeepEq('totals match on second rollout', result.totals, result2.totals);
  assertEq('missionResult matches', result.missionResult, result2.missionResult);
  pass('rollout is deterministic');

  console.log();
  console.log('============================================');
  console.log('  ALL TESTS PASSED  —  Stage 1 foundation OK');
  console.log('============================================');
}

main().catch(err => { console.error(err.stack || err); process.exit(1); });
