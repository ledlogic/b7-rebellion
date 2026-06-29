/* Rebellion — flow.js  v2.42
 * Mission/trick orchestration. Owns the per-mission loop: alternates between
 * normal tricks and invasion waves, dispatches AI/human card choices, fires
 * capture powers, checks the Full Crew opportunity, runs scoring, and resolves
 * final standings.
 *
 * v2.42 changes:
 *   - Scoring reordered: 1-Orac, 2-Zen+Lib+AsteroidField, 3-Gauda Prime,
 *   - Scoring sequence (v2.44 rulebook): 1-Orac, 2-Zen+Liberator+Asteroid,
 *     3-Gauda Prime, 4-Mutoid, 5-IMIPAK, 6-Dayna Mellanby (conditional),
 *     7-Totals, 8-Psycho-Strategist's Gambit
 *   - Dayna Mellanby (10♣): conditional +10 (Star One battle must have occurred)
 *   - IMIPAK / Orac: target filter uses isPersonCard (Hearts, Spades, Dayna, Vila)
 *   - Vila leads: capturer declares the suit that must be followed
 *   - Andromedan leads Vila → "Vila's Galactic Bluff" — Mission ends, no scoring
 *   - Anna Grant compulsion passed via currentTrick to legalPlays
 *   - Full Crew: Gan (10♥) does NOT count as a Heart face card
 *   - Star One + Liberator same trick: detonation intercepted, Mission continues
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
      UI.saveGameToHistory(buildHistoryEntry());
      await UI.showFinalResults(runMission);
    } catch (err){
      window.__LAST_ERROR = (err && err.stack) ? err.stack : String(err);
      console.error(err);
    }
  }

  function buildHistoryEntry(){
    const G = S.G;
    const totals = G.totals.slice();
    let winIdx = 0;
    for (let i = 1; i < totals.length; i++) if (totals[i] > totals[winIdx]) winIdx = i;
    return {
      endedAt:    new Date().toISOString(),
      durationMs: G.gameStartedAt ? (Date.now() - G.gameStartedAt) : null,
      numPlayers: G.numPlayers,
      difficulty: G.difficulty,
      systemName: G.systemName || null,
      missions:   G.numPlayers,
      players: G.players.map(p => ({
        idx: p.idx,
        name: p.name,
        isHuman: p.isHuman,
        color: p.color,
        personaTag:  p.persona ? p.persona.tag  : null,
        personaName: p.persona ? p.persona.name : null,
        total: G.totals[p.idx]
      })),
      winner: { idx: winIdx, name: G.players[winIdx].name, total: totals[winIdx] }
    };
  }

  async function runMission(dealerIdx){
    S.initMissionState(dealerIdx);
    if (S.G.gameStartedAt == null) S.G.gameStartedAt = Date.now();
    UI.startTimers();
    UI.renderAll();
    const G = S.G, M = S.M;
    UI.setCenterMsgHTML('Cards dealt. Reserve of ' + M.reserve.length + ' set aside. ' +
      UI.playerChip(G.players[M.leadIdx]) + ' ' + E.verbFor(G.players[M.leadIdx].name, 'leads') + '.');
    UI.logSystem('— MISSION ' + (G.missionIndex+1) + ' BEGINS — Dealer: ' + G.players[dealerIdx].name + ' · Reserve: ' + M.reserve.length + ' cards —');
    if (G.missionIndex === 0 && G.systemName){
      UI.logSystem('▷ Operating zone: ' + G.systemName + '.');
    }
    for (const p of G.players){ if (!p.isHuman) UI.say(p, 'start'); await E.sleep(120); }
    await E.sleep(700);
    UI.logLayoutMetrics('mission-' + (G.missionIndex+1) + '-start');

    while (!S.M.missionOver){
      if (S.M.invasionActive) await playInvasionWave();
      else await playNormalTrick();
      if (!S.M.missionOver) checkInvasionTrigger();
    }

    UI.renderAll();
    await E.sleep(300);
    if (S.M.missionResult === 'andromedan'){
      UI.setCenterMsg('The Andromedan tide breaks through. No scoring this Mission.');
      UI.logAndromedan('☠ THE ANDROMEDANS BREAK THROUGH — Mission ends. No one scores.');
      await UI.showInfoBanner('Mission Lost', 'The Andromedan wave could not be repelled. This Mission scores nothing for anyone.');
      recordMissionSummary(null);
    } else if (S.M.missionResult === 'vilaBluff'){
      UI.setCenterMsg("Vila's Galactic Bluff succeeds. The Andromedans stand down. No scoring this Mission.");
      UI.logAndromedan("🃏 VILA'S GALACTIC BLUFF — The Andromedans are talked out of it entirely. Nobody scores.");
      await UI.showInfoBanner("Vila's Galactic Bluff", "Vila apparently convinced the Andromedan fleet they've attacked entirely the wrong galaxy. The Mission ends — nobody scores, nobody wins, nobody quite knows what just happened.");
      recordMissionSummary(null);
    } else {
      const breakdown = await scoreMission();
      recordMissionSummary(breakdown);
      await UI.showScoringModal(breakdown);
    }
  }

  /** Push a structured per-mission record into G.missionLog. Called from
   *  runMission once outcome and scoring are settled. */
  function recordMissionSummary(breakdown){
    const G = S.G, M = S.M;
    if (!G.missionLog) G.missionLog = [];
    const C = R.card;
    G.missionLog.push({
      missionIndex:      G.missionIndex,
      systemName:        G.systemName || null,
      dealerIdx:         M.dealerIdx,
      reserveSizeAtDeal: (Array.isArray(M.tricks) && M.tricks.length === 0) ? null : undefined,
      result:            M.missionResult,
      starOneBattleOccurred: !!M.starOneBattleOccurred,
      fullCrewClaimed:   !!M.fullCrewClaimed,
      reserveDestroyed:  !!M.reserveDestroyed,
      invasionTriggered: !!M.invasionActive || (M.missionResult === 'andromedan' || M.missionResult === 'vilaBluff'),
      tricks:            Array.isArray(M.tricks) ? M.tricks.slice() : [],
      capturePiles: G.players.map(p => ({
        playerIdx: p.idx,
        name:      p.name,
        cards: p.pile.map(c => ({
          suit: c.suit, rank: c.rank, label: C.cardLabel(c), points: C.basePoints(c),
          cancelled: !!c._cancelled, assassinated: !!c._assassinated, daynaBonus: !!c._daynaBonus
        }))
      })),
      missionScores:     breakdown ? breakdown.missionTotals : null,
      missionNotes:      breakdown ? (breakdown.notes || []) : [],
      totalsAfter:       G.totals.slice(),
      endedAt:           new Date().toISOString()
    });
  }

  /* ----- normal trick ----- */
  async function playNormalTrick(){
    const G = S.G, M = S.M;
    M.trickNumber++;
    M.currentTrick = [];
    /* If the previous trick was led by Vila, M.vilaLedSuit was declared then.
       Use it as the forced ledSuit for this trick, then clear it. */
    M.ledSuit = M.vilaLedSuit || null;
    M.vilaLedSuit = null;
    UI.setCenterMsg('');
    UI.renderAll();
    UI.logLayoutMetrics('trick-' + M.trickNumber + '-start');
    const order = [];
    for (let i = 0; i < G.numPlayers; i++) order.push((M.leadIdx + i) % G.numPlayers);

    for (const pIdx of order){
      M.currentTurn = pIdx;
      UI.renderAll();
      const player = G.players[pIdx];
      const legal = E.legalPlays(player.hand, M.ledSuit, M.currentTrick);
      let card;
      if (player.isHuman){
        // Show Anna Grant compulsion notice if applicable
        if (legal.length === 1 && legal[0].suit === 'H' && legal[0].rank === 'A' &&
            M.currentTrick.some(p => p.card.suit === 'S' && p.card.rank === '10')){
          UI.setCenterMsg('Anna Grant is in the trick — you must play Avon (A♥) immediately!');
        } else {
          UI.setCenterMsg('Your move — play a legal card.');
        }
        card = await UI.getHumanCard(legal);
      } else {
        await E.sleep(200);
        card = R.ai.chooseCard(player, legal, M.currentTrick, M.ledSuit, false);
        if (M.currentTrick.length === 0) UI.say(player, 'lead');
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
    await resolveTrickEnd(M.currentTrick, winnerIdx, false);
  }

  async function resolveTrickEnd(trick, winnerIdx, isInvasionWave){
    const G = S.G, M = S.M;
    /* Record this completed trick for export. We snapshot the plays now,
       before pile mutation; winner-determined state mutations happen below.
       Guarded — the headless tournament harness ships a UI shim that may
       not include this serializer. */
    if (Array.isArray(M.tricks) && typeof UI.serializeTrick === 'function'){
      M.tricks.push(UI.serializeTrick(trick, M.ledSuit, winnerIdx, !!isInvasionWave));
    }
    if (winnerIdx === 'ANDROMEDAN'){
      M.missionOver = true; M.missionResult = 'andromedan';
      UI.setCenterMsg('The Andromedan card takes the trick!');
      UI.logAndromedan('The Andromedan wave wins the trick — incursion successful.');
      return;
    }
    const winner = G.players[winnerIdx];
    const cards = trick.map(p => p.card);
    UI.setCenterMsgHTML(UI.playerChip(winner) + ' ' + E.verbFor(winner.name, 'wins') + ' the trick.');
    UI.logSystem(E.subj(winner.name, 'wins') + ' the trick (' + cards.map(C.cardLabel).join(' ') + ').');

    const elevatedEl = UI.elevateWinnerSeat(winnerIdx);
    await UI.awaitContinue('Continue');

    const pileScore  = winner.pile.reduce((s, c) => s + ((c._cancelled || c._assassinated) ? 0 : C.basePoints(c)), 0);
    const trickScore = cards.reduce((s, c) => s + C.basePoints(c), 0);
    const effective  = pileScore + trickScore;
    const hasPower   = cards.some(c => {
      const meta = C.cardMeta(c);
      return !!(meta && (meta.power || meta.scorePower));
    });

    UI.showWinScoreFlash(effective, hasPower);
    await UI.animateTrickCapture(winnerIdx);
    M.currentTrick = [];

    // Check: Star One (A♣) captured in same trick as Liberator (Q♦) → intercept
    const hasStarOne   = cards.some(c => c.suit === 'C' && c.rank === 'A');
    const hasLiberator = cards.some(c => c.suit === 'D' && c.rank === 'Q');

    winner.pile.push(...cards);
    UI.clearWinnerElevation(elevatedEl);

    const trickPts = cards.reduce((s, c) => s + C.basePoints(c), 0);
    if (!winner.isHuman) UI.say(winner, trickPts >= 0 ? 'winGood' : 'winBad');

    UI.renderAll();
    await E.sleep(400);
    UI.logLayoutMetrics('trick-' + M.trickNumber + '-captured');

    /* capture-triggered powers, in trick play order */
    for (const play of trick){
      await POW.resolveCardPower(play.card, winner);
      if (M.missionOver) return;
    }

    /* Full Crew check (global, once per mission) — Gan (10♥) does NOT count */
    let fullCrewJustFired = false;
    if (!M.fullCrewClaimed && M.reserve.length > 0){
      if (C.pileHas(winner.pile, 'H', 'A') && winner.pile.some(C.isHeartFace)){
        fullCrewJustFired = true;
        await resolveFullCrew(winner);
        if (M.missionOver) return;
      }
    }

    /* Star One ends the mission — unless intercepted.
       Two interceptions are possible:
         (a) Liberator (Q♦) captured in the same trick — classic intercept.
         (b) Full Crew fired this same trick. The elite team locks Star One
             down before the detonation propagates. */
    if (hasStarOne){
      if (hasLiberator){
        UI.logSystem('🚀 ' + winner.name + ' captures the Liberator (Q♦) in the same trick as Star One — the Liberator intercepts the detonation, Mission continues.');
        UI.setCenterMsg('The Liberator intercepts Star One. Mission continues!');
        M.starOneBattleOccurred = true; // counts for Dayna
        await E.sleep(900);
      } else if (fullCrewJustFired){
        UI.logSystem('★ ' + winner.name + ' completes the Full Crew (Avon + a Hearts face) in the same trick as Star One — the crew locks Star One down, Mission continues. The Ace of Clubs scores normally as −5.');
        UI.setCenterMsg('The Full Crew suppresses Star One. Mission continues!');
        M.starOneBattleOccurred = true; // counts for Dayna
        await E.sleep(900);
      } else {
        M.missionOver = true; M.missionResult = 'starOne';
        M.starOneBattleOccurred = true;
        UI.setCenterMsg('STAR ONE has been captured. Mission ends immediately.');
        UI.logSystem('☢ STAR ONE CAPTURED by ' + winner.name + ' — Mission ends immediately. Cards still in hand score nothing.');
        if (!winner.isHuman) UI.say(winner, 'starOne');
        UI.renderAll();
        await E.sleep(900);
        return;
      }
    }

    M.leadIdx = winnerIdx;

    if (G.players.every(p => p.hand.length === 0)){
      M.missionOver = true; M.missionResult = 'normal';
      UI.renderAll();
      await E.sleep(300);
      return;
    }

    /* Vila leads: if Vila was the FIRST card played in this trick (the lead),
       the player who played it declares the suit for the NEXT trick.
       We set M.vilaLedSuit here; playNormalTrick picks it up as ledSuit. */
    const firstPlay = trick[0];
    if (firstPlay && C.isJoker(firstPlay.card) && firstPlay.playerIdx !== 'ANDROMEDAN'){
      const declarer = G.players[firstPlay.playerIdx];
      await resolveVilaLeadSuitDeclaration(declarer);
    }

    UI.renderAll();
    await E.sleep(250);
  }

  /**
   * When Vila leads a trick (is the first card played), the player who
   * played Vila declares which suit must be followed for that trick.
   * In practice in our flow, the winner of the previous trick leads — if
   * they lead Vila, they declare here before the next trick starts.
   */
  async function resolveVilaLeadSuitDeclaration(declarer){
    const M = S.M;
    const suits = [
      { label:'♥ Hearts', value:'H' },
      { label:'♦ Diamonds', value:'D' },
      { label:'♣ Clubs', value:'C' },
      { label:'♠ Spades', value:'S' }
    ];
    if (declarer.isHuman){
      const chosen = await UI.askButtons('Vila — Declare Suit',
        'Vila leads this trick. You must declare which suit all other players must follow.',
        suits.map(s => ({ label:s.label, value:s.value })));
      M.vilaLedSuit = chosen;
      UI.logSystem('Vila: ' + E.subj(declarer.name, 'declares') + ' ' + suits.find(s => s.value===chosen).label + ' as the required suit for this trick.');
    } else {
      // AI picks the suit most opponents are likely void in, or a random suit
      M.vilaLedSuit = ['H','D','C','S'][Math.floor(Math.random()*4)];
      UI.logSystem('Vila: ' + declarer.name + ' declares ' + suits.find(s => s.value===M.vilaLedSuit).label + ' as the required suit for this trick.');
    }
  }

  function checkInvasionTrigger(){
    const G = S.G, M = S.M;
    if (M.invasionActive || M.missionOver) return;
    if (M.reserve.length <= 0) return;
    const handLen = G.players[0].hand.length;
    if (handLen === M.reserve.length){
      M.invasionActive = true;
      M.starOneBattleOccurred = true; // Andromedan invasion counts for Dayna
      UI.logAndromedan('⚠ ANDROMEDAN INCURSION BEGINS — hand size matches Reserve. The Andromedans now lead each trick.');
      G.players.forEach(p => { if (!p.isHuman) UI.say(p, 'andromedan'); });
    }
  }

  /* ----- invasion wave ----- */
  async function playInvasionWave(){
    const G = S.G, M = S.M;
    M.trickNumber++;
    M.currentTrick = [];
    UI.setCenterMsg('');
    if (M.reserve.length === 0){ M.invasionActive = false; return; }
    const andCard = M.reserve.shift();
    M.ledSuit = C.isJoker(andCard) ? null : andCard.suit;
    M.currentTrick.push({ playerIdx:'ANDROMEDAN', who:'ANDROMEDAN', card: andCard, timestamp: new Date() });
    S.recordPlay('ANDROMEDAN', andCard, null);
    UI.renderAll();

    /* Vila's Galactic Bluff: Andromedan leads the Joker → Mission ends, nobody scores */
    if (C.isJoker(andCard)){
      UI.setCenterMsg("Vila's Galactic Bluff! The Andromedan leads Vila — the invasion is cancelled!");
      UI.logAndromedan("🃏 VILA'S GALACTIC BLUFF — Andromedan leads Vila. The invasion is cancelled. Mission ends — nobody scores.");
      M.missionOver = true;
      M.missionResult = 'vilaBluff';
      UI.renderAll();
      await E.sleep(1200);
      return;
    }

    UI.setCenterMsg('The Andromedan reveals a card: ' + C.cardLabel(andCard));
    UI.logAndromedan('Wave ' + M.trickNumber + ': The Andromedans lead with ' + C.cardLabel(andCard) + ' (' + C.cardName(andCard) + ').');
    await E.sleep(1000);

    const order = [];
    for (let i = 0; i < G.numPlayers; i++) order.push((M.leadIdx + i) % G.numPlayers);

    for (const pIdx of order){
      M.currentTurn = pIdx;
      UI.renderAll();
      const player = G.players[pIdx];
      const legal = E.legalPlays(player.hand, M.ledSuit, M.currentTrick);
      let card;
      if (player.isHuman){
        if (legal.length === 1 && legal[0].suit === 'H' && legal[0].rank === 'A' &&
            M.currentTrick.some(p => p.card.suit === 'S' && p.card.rank === '10')){
          UI.setCenterMsg('Anna Grant is in the wave — you must play Avon (A♥)!');
        } else {
          UI.setCenterMsg('Andromedan wave — respond with a legal card.');
        }
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
    UI.logAndromedan(E.subj(G.players[winnerIdx].name, 'repels') + ' the Andromedan wave and claims the trick.');
    const winner = G.players[winnerIdx];
    if (!winner.isHuman) UI.say(winner, 'andromedan');

    await resolveTrickEnd(M.currentTrick, winnerIdx, true);
    if (M.missionOver) return;

    if (M.reserve.length === 0){
      M.invasionActive = false;
      UI.logAndromedan('Reserve exhausted — the incursion ends.');
    }
  }

  async function resolveFullCrew(winner){
    const M = S.M;
    if (M.reserve.length === 0){ M.fullCrewClaimed = true; return; }
    M.starOneBattleOccurred = true; // Full Crew trigger counts for Dayna
    UI.logSystem('★ ' + winner.name + ' completes the Full Crew (Avon + a Liberator officer) — the Reserve is revealed!');
    M.fullCrewClaimed = true;
    const revealed = M.reserve.slice();
    /* Per v2.44 rules: ALL Reserve cards must be revealed face-up to ALL
       players before the winner makes their selection. Public log entry
       documents the full Reserve contents so every player has equal
       information. */
    UI.logSystem('   Reserve revealed (' + revealed.length + ' cards): ' + revealed.map(C.cardLabel).join(' ') + '.');
    let taken = [];
    if (winner.isHuman){
      const sel = await UI.askCards('Full Crew — Reserve Revealed',
        'Take any, all, or none of the revealed Reserve cards into your captured cards. Whatever you leave behind is locked away for good.',
        revealed, { multi:true, allowSkip:true, skipLabel:'Take Nothing', confirmLabel:'Take Selected' });
      taken = sel;
    } else {
      taken = revealed.filter(c => C.isJoker(c) || C.basePoints(c) >= 0);
      if (taken.length > 0) UI.say(winner, 'fullCrew');
    }
    winner.pile.push(...taken);
    M.reserve = [];
    M.invasionActive = false;
    UI.logSystem(winner.name + ' (Full Crew) takes ' + (taken.length ? taken.map(C.cardLabel).join(' ') : 'nothing from the Reserve') + '. Remaining Reserve cards are locked away for good.');
    /* If Star One (A♣) was among the Reserve cards just claimed, its
       Mission-ending power is suppressed — it never entered play, it was
       lifted silently out of the Reserve by the Full Crew. It still scores
       its −5, but the game does not end. */
    if (taken.some(c => c.suit === 'C' && c.rank === 'A')){
      UI.logSystem('★ ' + winner.name + ' takes Star One (A♣) silently from the Reserve — its detonation never fires, since the card never entered play. It scores normally as −5; the Mission continues.');
    }
    UI.renderAll(); await E.sleep(300);
  }

  /* ============================================================ Scoring ============================================================ */
  async function scoreMission(){
    const G = S.G, M = S.M;
    const notes = [];
    const order = [];
    for (let i = 0; i < G.numPlayers; i++) order.push((M.dealerIdx + 1 + i) % G.numPlayers);

    const battleOccurred = !!M.starOneBattleOccurred;

    /* Step 1 — Orac: cancel one person card from any player's pile (optional, once per Mission) */
    for (const pIdx of order){
      const p = G.players[pIdx];
      if (C.pileHas(p.pile, 'D', 'A') && !p.oracUsed){
        await POW.powerOracCancel(p);
        if (p.oracUsed) notes.push(p.name + ' uses Orac (A♦) to cancel a person card this Mission. (See comms log for which card.)');
      }
    }

    /* Step 2 — Zen + Liberator + Asteroid Field: if all three in same pile, Asteroid Field scores 0 */
    for (const p of G.players){
      if (C.pileHas(p.pile, 'D', 'K') && C.pileHas(p.pile, 'D', 'Q') && C.pileHas(p.pile, 'C', 'Q')){
        const asteroidField = p.pile.find(c => c.suit === 'C' && c.rank === 'Q');
        if (asteroidField && !asteroidField._cancelled){
          asteroidField._cancelled = true;
          notes.push(p.name + ' holds Zen (K♦) + Liberator (Q♦) + Asteroid Field (Q♣) — the Liberator knows these rocks, the Asteroid Field is negated and scores 0.');
        }
      }
    }

    /* Step 3 — Gauda Prime: any pile is all numbered primes → ALL Hearts in ALL piles score 0 */
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
      notes.push(gaudaBy.join(' + ') + (gaudaBy.length > 1 ? ' both hold' : ' holds') + ' an all-prime numbered pile — Gauda Prime triggers, every Heart in every pile scores 0 this Mission.');
    }

    /* Step 4 — Mutoid: mandatory Heart devour from own pile */
    for (const p of G.players){
      if (C.pileHas(p.pile, 'S', 'J')){
        const hearts = p.pile.filter(C.isHeart);
        if (hearts.length > 0){
          const alreadyDead = hearts.find(c => c._cancelled);
          if (alreadyDead){
            notes.push(p.name + ' holds the Mutoid (J♠) — she feeds on the already-cancelled ' + C.cardLabel(alreadyDead) + ' in their pile; no further effect.');
          } else {
            const target = hearts.slice().sort((a, b) => C.basePoints(a) - C.basePoints(b))[0];
            target._cancelled = true;
            notes.push(p.name + ' holds the Mutoid (J♠) — she drains ' + C.cardLabel(target) + ' from ' + E.possessiveOf(p.name) + ' Hearts for blood serum (the lowest-value Heart), now scoring 0.');
          }
        }
      }
    }

    /* Step 5 — IMIPAK: paired with another 10, assassinates a person card.
       Per v2.44 rulebook: "that player may choose to assassinate one card of
       their choice from any player's Capture Pile, including their own".
       The holder picks. Human gets a picker (with owner badges); AI uses
       the same swing-maximizing heuristic as Orac. */
    for (const pIdx of order){
      const p = G.players[pIdx];
      const hasImipak = C.pileHas(p.pile, 'D', '10');
      const otherTens = p.pile.filter(c => !C.isJoker(c) && c.rank === '10' && c.suit !== 'D' && !c._assassinated);
      if (!hasImipak || otherTens.length === 0) continue;

      const pool = [];
      G.players.forEach(pp => pp.pile.forEach(c => {
        if (!c._cancelled && !c._assassinated && C.isPersonCard(c)) pool.push({ card:c, owner:pp });
      }));
      if (pool.length === 0) continue;

      let pick;
      if (p.isHuman){
        const labels = pool.map(({owner}) => ({
          text: (owner.idx === p.idx) ? 'YOUR pile' : owner.name + "'s pile",
          own:  (owner.idx === p.idx)
        }));
        const cards = pool.map(x => x.card);
        const sel = await UI.askCards('IMIPAK — Assassinate a Person Card',
          "IMIPAK and another 10 are both in your captured cards. Assassinate one person card (Hearts, Spades, Dayna, or Vila) from any player's captured cards — it scores 0 this Mission. Choose one, or skip.",
          cards, { allowSkip:true, skipLabel:'Skip — do not use IMIPAK', ownerLabels: labels });
        if (sel.length){
          const chosen = sel[0];
          pick = pool.find(x => x.card === chosen) || pool.find(x => x.card.id === chosen.id);
        }
      } else {
        /* AI: maximize swing in own favour. -basePoints for own pile, +basePoints for opponents. */
        let best = null, bestSwing = 0;
        for (const opt of pool){
          const bp = C.basePoints(opt.card);
          const swing = (opt.owner.idx === p.idx) ? -bp : bp;
          if (swing > bestSwing){ best = opt; bestSwing = swing; }
        }
        pick = best;
      }

      if (pick){
        pick.card._assassinated = true;
        const where = (pick.owner.idx === p.idx) ? 'their own captured cards'
                                                 : E.possessiveOf(pick.owner.name) + ' captured cards';
        /* Name the specific "other 10" that paired with IMIPAK so it's clear
           what triggered the power. Prefer a non-Dayna 10 if present (more
           thematic — Gan or Anna Grant), but any non-IMIPAK 10 in the pile works. */
        const trigger = otherTens[0];
        notes.push(p.name + ' uses IMIPAK (10♦) + ' + C.cardLabel(trigger) + ' (' + C.cardName(trigger) + ') to assassinate ' + C.cardLabel(pick.card) + ' (' + C.cardName(pick.card) + ') in ' + where + ' — scores 0.');
      }
    }

    /* Step 6 — Dayna Mellanby: +10 only if Star One battle occurred this Mission */
    for (const p of G.players){
      const dayna = p.pile.find(c => c.suit === 'C' && c.rank === '10');
      if (dayna && !dayna._cancelled && !dayna._assassinated){
        if (battleOccurred){
          dayna._daynaBonus = true;
          notes.push(p.name + ' holds Dayna Mellanby (10♣) — the Star One battle occurred this Mission, so she scores +10.');
        } else {
          dayna._daynaSuppressed = true;
          notes.push(p.name + ' holds Dayna Mellanby (10♣) — no Star One battle this Mission, so she scores 0.');
        }
      }
    }

    /* Step 7 — Totals (implicit): each player sums up their non-cancelled
       card values below. Dayna uses _daynaBonus instead of basePoints. */
    /* Totals */
    const stepTotals = {};
    for (const p of G.players){
      let sum = 0;
      for (const c of p.pile){
        if (c._cancelled || c._assassinated) continue;
        let pts = C.basePoints(c);
        // Dayna: base is 0; add 10 if battle occurred
        if (c.suit === 'C' && c.rank === '10'){
          pts = c._daynaBonus ? 10 : 0;
        }
        sum += pts;
      }
      stepTotals[p.idx] = sum;
    }

    /* Step 8 — Psycho-Strategist's Gambit: K♣ + A♠ in same pile flips sign */
    for (const p of G.players){
      if (C.pileHas(p.pile, 'C', 'K') && C.pileHas(p.pile, 'S', 'A')){
        stepTotals[p.idx] = -stepTotals[p.idx];
        notes.push(p.name + " holds Carnell (K♣) + Servalan (A♠) — the Psycho-Strategist's Gambit reverses their total to " + stepTotals[p.idx] + '.');
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
