/* Rebellion — flow.js
 * Mission/trick orchestration. Owns the per-mission loop: alternates between
 * normal tricks and invasion waves, dispatches AI/human card choices, fires
 * capture powers, checks the Full Crew opportunity, runs the 5-step scoring,
 * and resolves the final standings.
 *
 * Reads/mutates Rebellion.state.{G,M}. Delegates display to Rebellion.ui and
 * card-pick decisions to Rebellion.ai.
 */
(function () {
  'use strict';
  const R = (window.Rebellion = window.Rebellion || {});
  const C = R.card;
  const E = R.engine;
  const S = R.state;
  const UI = R.ui;
  const POW = R.powers;

  async function runGame(){
    try {
      const G = S.G;
      for (let m = 0; m < G.numPlayers; m++){
        G.missionIndex = m;
        const dealerIdx = (G.startDealer + m) % G.numPlayers;
        await runMission(dealerIdx);
      }
      await UI.showFinalResults(runMission);
    } catch (err){
      window.__LAST_ERROR = (err && err.stack) ? err.stack : String(err);
      console.error(err);
    }
  }

  async function runMission(dealerIdx){
    S.initMissionState(dealerIdx);
    UI.renderAll();
    const G = S.G, M = S.M;
    UI.setCenterMsgHTML('Cards dealt. Reserve of ' + M.reserve.length + ' set aside. ' +
      UI.playerChip(G.players[M.leadIdx]) + ' ' + E.verbFor(G.players[M.leadIdx].name, 'leads') + '.');
    UI.logSystem('— MISSION ' + (G.missionIndex+1) + ' BEGINS — Dealer: ' + G.players[dealerIdx].name + ' · Reserve: ' + M.reserve.length + ' cards —');
    for (const p of G.players){ if (!p.isHuman) UI.say(p, 'start'); await E.sleep(120); }
    await E.sleep(700);

    while (!S.M.missionOver){
      if (S.M.invasionActive) await playInvasionWave();
      else await playNormalTrick();
      if (!S.M.missionOver) checkInvasionTrigger();
    }

    UI.renderAll();
    await E.sleep(300);
    if (S.M.missionResult === 'andromedan'){
      UI.setCenterMsg('The Andromedan tide breaks through. No scoring this Mission.');
      UI.logSystem('☠ THE ANDROMEDANS BREAK THROUGH — Mission ends. No one scores.');
      await UI.showInfoBanner('Mission Lost', 'The Andromedan wave could not be repelled. This Mission scores nothing for anyone.');
    } else {
      const breakdown = scoreMission();
      await UI.showScoringModal(breakdown);
    }
  }

  /* ----- normal trick ----- */
  async function playNormalTrick(){
    const G = S.G, M = S.M;
    M.trickNumber++;
    M.currentTrick = [];
    M.ledSuit = null;
    UI.setCenterMsg('');   // wipe the previous trick's "X wins the trick" announcement
    UI.renderAll();
    const order = [];
    for (let i = 0; i < G.numPlayers; i++) order.push((M.leadIdx + i) % G.numPlayers);

    for (const pIdx of order){
      M.currentTurn = pIdx;
      UI.renderAll();
      const player = G.players[pIdx];
      const legal = E.legalPlays(player.hand, M.ledSuit);
      let card;
      if (player.isHuman){
        UI.setCenterMsg('Your move — play a legal card.');
        card = await UI.getHumanCard(legal);
      } else {
        await E.sleep(200);  // brief deliberation beat
        card = R.ai.chooseCard(player, legal, M.currentTrick, M.ledSuit, false);
        if (M.currentTrick.length === 0) UI.say(player, 'lead');
      }
      player.hand = player.hand.filter(c => c.id !== card.id);
      const ledSuitBefore = M.ledSuit;
      M.currentTrick.push({ playerIdx:pIdx, who:'PLAYER', card, timestamp: new Date() });
      if (!M.ledSuit && !C.isJoker(card)) M.ledSuit = card.suit;
      S.recordPlay(pIdx, card, ledSuitBefore);
      UI.renderAll();
      await E.sleep(800);   // 1s total inter-move pacing (200 think + 800 = 1000)
    }

    const winnerIdx = E.resolveTrickWinner(M.currentTrick, M.ledSuit);
    await resolveTrickEnd(M.currentTrick, winnerIdx, false);
  }

  async function resolveTrickEnd(trick, winnerIdx, isInvasionWave){
    const G = S.G, M = S.M;
    if (winnerIdx === 'ANDROMEDAN'){
      M.missionOver = true; M.missionResult = 'andromedan';
      UI.setCenterMsg('The Andromedan card takes the trick!');
      UI.logSystem('The Andromedan wave wins the trick — incursion successful.');
      return;
    }
    const winner = G.players[winnerIdx];
    const cards = trick.map(p => p.card);
    UI.setCenterMsgHTML(UI.playerChip(winner) + ' ' + E.verbFor(winner.name, 'wins') + ' the trick.');
    UI.logSystem(E.subj(winner.name, 'wins') + ' the trick (' + cards.map(C.cardLabel).join(' ') + ').');

    /* Lift the winner's seat/area for emphasis while the player reads the
       result. The elevation persists through the awaitContinue pause and
       the card animation so cards land on the (elevated) target. */
    const elevatedEl = UI.elevateWinnerSeat(winnerIdx);

    /* Pause for the player to read who won. Cards stay on the table until
       they click Continue, then fly to the winner's name. */
    await UI.awaitContinue('Continue');

    /* Compute the running effective score (winner's pile total *including*
       what they're about to capture, with cancelled/assassinated cards
       counted as 0). Asterisk if any captured card carries an in-play or
       end-game scoring power. */
    const pileScore  = winner.pile.reduce((s, c) => s + ((c._cancelled || c._assassinated) ? 0 : C.basePoints(c)), 0);
    const trickScore = cards.reduce((s, c) => s + C.basePoints(c), 0);
    const effective  = pileScore + trickScore;
    const hasPower   = cards.some(c => {
      const meta = C.cardMeta(c);
      return !!(meta && (meta.power || meta.scorePower));
    });

    /* Fire the score flash concurrent with the card animation so they fade
       together. animateTrickCapture awaits 620ms; the flash uses the same. */
    UI.showWinScoreFlash(effective, hasPower);
    await UI.animateTrickCapture(winnerIdx);
    M.currentTrick = [];

    winner.pile.push(...cards);

    /* Drop the winner back down to their normal row. */
    UI.clearWinnerElevation(elevatedEl);

    const trickPts = cards.reduce((s, c) => s + C.basePoints(c), 0);
    if (!winner.isHuman) UI.say(winner, trickPts >= 0 ? 'winGood' : 'winBad');

    UI.renderAll();
    await E.sleep(400);

    /* capture-triggered powers, in trick play order */
    for (const play of trick){
      await POW.resolveCardPower(play.card, winner);
      if (M.missionOver) return;
    }

    /* Full Crew check (global, once per mission) */
    if (!M.fullCrewClaimed && M.reserve.length > 0){
      if (C.pileHas(winner.pile, 'H', 'A') && winner.pile.some(C.isHeartFace)){
        await resolveFullCrew(winner);
        if (M.missionOver) return;
      }
    }

    /* Star One ends the mission */
    if (cards.some(c => c.suit === 'C' && c.rank === 'A')){
      M.missionOver = true; M.missionResult = 'starOne';
      UI.setCenterMsg('STAR ONE has been captured. Mission ends immediately.');
      UI.logSystem('☢ STAR ONE CAPTURED by ' + winner.name + ' — Mission ends immediately. Cards still in hand score nothing.');
      if (!winner.isHuman) UI.say(winner, 'starOne');
      UI.renderAll();
      await E.sleep(900);
      return;
    }

    M.leadIdx = winnerIdx;

    if (G.players.every(p => p.hand.length === 0)){
      M.missionOver = true; M.missionResult = 'normal';
      UI.renderAll();
      await E.sleep(300);
      return;
    }
    UI.renderAll();
    await E.sleep(250);
  }

  function checkInvasionTrigger(){
    const G = S.G, M = S.M;
    if (M.invasionActive || M.missionOver) return;
    if (M.reserve.length <= 0) return;
    const handLen = G.players[0].hand.length;
    if (handLen === M.reserve.length){
      M.invasionActive = true;
      UI.logSystem('⚠ ANDROMEDAN INCURSION BEGINS — hand size matches Reserve. The Andromedans now lead each trick.');
      G.players.forEach(p => { if (!p.isHuman) UI.say(p, 'andromedan'); });
    }
  }

  /* ----- invasion wave ----- */
  async function playInvasionWave(){
    const G = S.G, M = S.M;
    M.trickNumber++;
    M.currentTrick = [];
    UI.setCenterMsg('');   // wipe any prior "wins" / "repels" announcement
    if (M.reserve.length === 0){ M.invasionActive = false; return; }
    const andCard = M.reserve.shift();
    M.ledSuit = C.isJoker(andCard) ? null : andCard.suit;
    M.currentTrick.push({ playerIdx:'ANDROMEDAN', who:'ANDROMEDAN', card: andCard, timestamp: new Date() });
    S.recordPlay('ANDROMEDAN', andCard, null);
    UI.renderAll();
    UI.setCenterMsg('The Andromedan reveals a card: ' + C.cardLabel(andCard));
    UI.logSystem('Wave ' + M.trickNumber + ': The Andromedans lead with ' + C.cardLabel(andCard) + ' (' + C.cardName(andCard) + ').');
    await E.sleep(1000);   // 1s before the first responder plays

    const order = [];
    for (let i = 0; i < G.numPlayers; i++) order.push((M.leadIdx + i) % G.numPlayers);

    for (const pIdx of order){
      M.currentTurn = pIdx;
      UI.renderAll();
      const player = G.players[pIdx];
      const legal = E.legalPlays(player.hand, M.ledSuit);
      let card;
      if (player.isHuman){
        UI.setCenterMsg('Andromedan wave — respond with a legal card.');
        card = await UI.getHumanCard(legal);
      } else {
        await E.sleep(200);
        card = R.ai.chooseCard(player, legal, M.currentTrick, M.ledSuit, true);
      }
      player.hand = player.hand.filter(c => c.id !== card.id);
      const ledSuitBefore = M.ledSuit;
      M.currentTrick.push({ playerIdx:pIdx, who:'PLAYER', card, timestamp: new Date() });
      if (!M.ledSuit && !C.isJoker(card)) M.ledSuit = card.suit;
      S.recordPlay(pIdx, card, ledSuitBefore);
      UI.renderAll();
      await E.sleep(800);
    }

    const winnerIdx = E.resolveTrickWinner(M.currentTrick, M.ledSuit);
    if (winnerIdx === 'ANDROMEDAN'){
      await resolveTrickEnd(M.currentTrick, 'ANDROMEDAN', true);
      return;
    }
    UI.setCenterMsgHTML(UI.playerChip(G.players[winnerIdx]) + ' ' + E.verbFor(G.players[winnerIdx].name, 'repels') + ' the wave!');
    UI.logSystem(E.subj(G.players[winnerIdx].name, 'repels') + ' the Andromedan wave and claims the trick.');
    const winner = G.players[winnerIdx];
    if (!winner.isHuman) UI.say(winner, 'andromedan');

    await resolveTrickEnd(M.currentTrick, winnerIdx, true);
    if (M.missionOver) return;

    if (M.reserve.length === 0){
      M.invasionActive = false;
      UI.logSystem('Reserve exhausted — the incursion ends.');
    }
  }

  async function resolveFullCrew(winner){
    const M = S.M;
    if (M.reserve.length === 0){ M.fullCrewClaimed = true; return; }
    UI.logSystem('★ FULL CREW: ' + E.subj(winner.name, 'has') + ' Avon and a Liberator officer together. The Reserve is revealed!');
    M.fullCrewClaimed = true;
    const revealed = M.reserve.slice();
    let taken = [];
    if (winner.isHuman){
      const sel = await UI.askCards('Full Crew — Reserve Revealed',
        'Take any, all, or none of the revealed Reserve cards into your pile. Whatever you leave behind is locked away for good.',
        revealed, { multi:true, allowSkip:true, skipLabel:'Take Nothing', confirmLabel:'Take Selected' });
      taken = sel;
    } else {
      taken = revealed.filter(c => C.isJoker(c) || C.basePoints(c) >= 0);
      if (taken.length > 0) UI.say(winner, 'fullCrew');
    }
    winner.pile.push(...taken);
    M.reserve = [];
    M.invasionActive = false;
    UI.logSystem('Full Crew: ' + E.subj(winner.name, 'takes') + ' ' + (taken.length ? taken.map(C.cardLabel).join(' ') : 'nothing') + '. Remaining Reserve cards are locked away for good.');
    UI.renderAll(); await E.sleep(300);
  }

  /* ============================================================ Scoring ============================================================ */
  function scoreMission(){
    const G = S.G, M = S.M;
    const notes = [];
    const order = [];
    for (let i = 0; i < G.numPlayers; i++) order.push((M.dealerIdx + 1 + i) % G.numPlayers);

    /* Step 1: Gauda Prime — any pile all numbered primes zeros ALL Hearts everywhere */
    let gaudaTriggered = false; const gaudaBy = [];
    for (const p of G.players){
      if (p.pile.length > 0 && p.pile.every(c => !C.isJoker(c) && C.isNumbered(c) && C.isPrime(c))){
        gaudaTriggered = true; gaudaBy.push(p.name);
      }
    }
    if (gaudaTriggered){
      for (const p of G.players){
        for (const c of p.pile){ if (C.isHeart(c)) c._cancelled = true; }
      }
      notes.push('Gauda Prime triggered by ' + gaudaBy.join(', ') + ' — ALL Hearts in ALL piles are worth 0.');
    }

    /* Step 2: Mutoid — mandatory Heart devour from own pile */
    for (const p of G.players){
      if (C.pileHas(p.pile, 'S', 'J')){
        const hearts = p.pile.filter(C.isHeart);
        if (hearts.length > 0){
          const target = hearts.find(c => c._cancelled) || hearts.sort((a, b) => C.basePoints(b) - C.basePoints(a))[0];
          target._cancelled = true;
          notes.push('Mutoid in ' + E.possessiveOf(p.name) + ' pile devours ' + C.cardLabel(target) + ' — worth 0.');
        }
      }
    }

    /* Step 3: IMIPAK — paired with another 10, assassinates any card */
    for (const pIdx of order){
      const p = G.players[pIdx];
      const hasImipak = C.pileHas(p.pile, 'D', '10');
      const otherTens = p.pile.filter(c => !C.isJoker(c) && c.rank === '10' && c.suit !== 'D' && !c._assassinated);
      if (hasImipak && otherTens.length > 0){
        const pool = [];
        G.players.forEach(pp => pp.pile.forEach(c => { if (!c._cancelled && !c._assassinated) pool.push({ card:c, owner:pp }); }));
        if (pool.length > 0){
          const pick = pool.sort((a, b) => C.basePoints(b.card) - C.basePoints(a.card))[0];
          pick.card._assassinated = true;
          notes.push('IMIPAK: ' + E.subj(p.name, 'assassinates') + ' ' + C.cardLabel(pick.card) + ' in ' + E.possessiveOf(pick.owner.name) + ' pile — worth 0.');
        }
      }
    }

    /* Step 4: totals */
    const stepTotals = {};
    for (const p of G.players){
      let sum = 0;
      for (const c of p.pile){ if (!c._cancelled && !c._assassinated) sum += C.basePoints(c); }
      stepTotals[p.idx] = sum;
    }

    /* Step 5: Psycho-Strategist's Gambit — K♣ + A♠ in same pile flips sign */
    for (const p of G.players){
      if (C.pileHas(p.pile, 'C', 'K') && C.pileHas(p.pile, 'S', 'A')){
        stepTotals[p.idx] = -stepTotals[p.idx];
        notes.push("Psycho-Strategist's Gambit: " + E.possessiveOf(p.name) + ' total is reversed to ' + stepTotals[p.idx] + '.');
      }
    }

    for (const p of G.players){
      G.totals[p.idx] += stepTotals[p.idx];
      if (!p.isHuman) UI.say(p, stepTotals[p.idx] >= 0 ? 'winGood' : 'winBad');
    }

    return { notes, missionTotals: stepTotals };
  }

  R.flow = {
    runGame, runMission, playNormalTrick, playInvasionWave,
    resolveTrickEnd, checkInvasionTrigger, resolveFullCrew, scoreMission
  };
})();
