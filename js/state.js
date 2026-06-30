/* Rebellion — state.js
 * Holds the live game (G) and mission (M) state objects, plus the helpers that
 * build/mutate them. All other modules read/write through Rebellion.state.G / .M.
 */
(function () {
  'use strict';
  const R = (window.Rebellion = window.Rebellion || {});
  const C = R.card;
  const E = R.engine;

  const state = {
    G: null,   // game: { numPlayers, players, missionIndex, totals, missionLog, startDealer, difficulty }
    M: null,   // mission: { dealerIdx, reserve, currentTrick, ledSuit, playedCards, knownVoids, ... }

    newPlayer(idx, isHuman, persona, aiLevel){
      return {
        idx,
        isHuman,
        persona,
        aiLevel: isHuman ? null : (aiLevel || 'delta'),
        name: isHuman ? 'You' : persona.name,
        color: isHuman ? '#c0c0c0' : persona.color,
        hand: [], pile: [], total: 0,
        exposed: false, oracUsed: false
      };
    },

    initMissionState(dealerIdx){
      const G = state.G;
      const { reserve, hands } = C.dealMission(G.numPlayers, dealerIdx);
      for (let i = 0; i < G.numPlayers; i++){
        G.players[i].hand    = hands[i];
        G.players[i].pile    = [];
        G.players[i].exposed = false;
        G.players[i].oracUsed = false;
      }
      state.M = {
        dealerIdx,
        reserve,
        reserveDestroyed: false,
        fullCrewClaimed: false,
        invasionActive: false,
        currentTurn: null,
        leadIdx: (dealerIdx + 1) % G.numPlayers,
        ledSuit: null,
        vilaLedSuit: null,       // declared suit when Vila leads a trick
        currentTrick: [],
        tricks: [],              // completed tricks this mission, for export/replay
        trickNumber: 0,
        playedCards: [],
        knownVoids: {},
        missionOver: false,
        missionResult: null,     // 'normal' | 'starOne' | 'andromedan' | 'vilaBluff'
        starOneBattleOccurred: false, // true if A♣ captured, Full Crew fired, Travis seized, or Invasion began
        awaitingHumanCard: false,
        _humanResolve: null,
        startedAt: Date.now()
      };
      /* Ensure G has a commsLog array on first mission init. The UI logSystem /
         logAndromedan / logChat helpers also push into this so the export
         can dump a structured comms transcript instead of DOM-scraping. */
      if (!G.commsLog) G.commsLog = [];
    },

    /* Called after every card play (real and Andromedan). Adds the card to the
       global history and, if a led suit was already established and the player
       didn't follow it, records a void. Used by Gamma and any future AI. */
    recordPlay(playerIdx, card, ledSuitBefore){
      const M = state.M;
      M.playedCards.push(card);
      if (ledSuitBefore && playerIdx !== 'ANDROMEDAN' && !C.isJoker(card) && card.suit !== ledSuitBefore){
        if (!M.knownVoids[playerIdx]) M.knownVoids[playerIdx] = new Set();
        M.knownVoids[playerIdx].add(ledSuitBefore);
      }
    },

    /** Deep-clone the full game state (G + M) into a snapshot suitable for
     *  restoring later. This is the foundation for Alpha-tier rollouts —
     *  Alpha will snapshot before hypothesizing a move, run the Mission
     *  forward via fastForward, then restore the snapshot to try another
     *  move. Same card.id appears in multiple places (hand, pile, trick,
     *  playedCards) so we use a per-clone Map to preserve identity:
     *  the SAME cloned card object is referenced everywhere the original
     *  was, keeping `===` comparisons valid.
     *
     *  NOT cloned (intentionally): persona objects (read-only config shared
     *  by all clones), UI promise handles like `_humanResolve`, the function
     *  object inside `aiLevel`. Cloned: every mutable array and object,
     *  including each card (since `_cancelled` / `_assassinated` flags mutate).
     *
     *  @returns {?{G, M}}  Snapshot, or null if state isn't initialized yet.
     */
    cloneState(){
      const G = state.G;
      if (!G) return null;
      const M = state.M;

      const cardMap = new Map();
      function cloneCard(c){
        if (!c) return c;
        const cached = cardMap.get(c.id);
        if (cached) return cached;
        const cc = Object.assign({}, c);
        cardMap.set(c.id, cc);
        return cc;
      }
      function cloneCardArr(arr){ return arr ? arr.map(cloneCard) : arr; }

      const players = G.players.map(p => ({
        idx:      p.idx,
        isHuman:  p.isHuman,
        persona:  p.persona,                 // shared read-only config
        aiLevel:  p.aiLevel,
        name:     p.name,
        color:    p.color,
        hand:     cloneCardArr(p.hand),
        pile:     cloneCardArr(p.pile),
        total:    p.total,
        exposed:  p.exposed,
        oracUsed: p.oracUsed
      }));

      const Gc = {
        numPlayers:    G.numPlayers,
        players,
        missionIndex:  G.missionIndex,
        totals:        G.totals.slice(),
        missionLog:    G.missionLog ? JSON.parse(JSON.stringify(G.missionLog)) : [],
        startDealer:   G.startDealer,
        difficulty:    G.difficulty,
        systemName:    G.systemName,
        gameStartedAt: G.gameStartedAt,
        commsLog:      G.commsLog ? G.commsLog.slice() : null,
        mix:           G.mix ? Object.assign({}, G.mix) : undefined
      };

      let Mc = null;
      if (M){
        const knownVoids = {};
        for (const k of Object.keys(M.knownVoids || {})){
          knownVoids[k] = new Set(M.knownVoids[k]);
        }
        Mc = {
          dealerIdx:              M.dealerIdx,
          reserve:                cloneCardArr(M.reserve),
          reserveDestroyed:       M.reserveDestroyed,
          fullCrewClaimed:        M.fullCrewClaimed,
          invasionActive:         M.invasionActive,
          currentTurn:            M.currentTurn,
          leadIdx:                M.leadIdx,
          ledSuit:                M.ledSuit,
          vilaLedSuit:            M.vilaLedSuit,
          currentTrick:           (M.currentTrick || []).map(p => ({
            playerIdx: p.playerIdx,
            who:       p.who,
            card:      cloneCard(p.card),
            timestamp: p.timestamp
          })),
          tricks:                 M.tricks ? JSON.parse(JSON.stringify(M.tricks)) : [],
          trickNumber:            M.trickNumber,
          playedCards:            cloneCardArr(M.playedCards),
          knownVoids,
          missionOver:            M.missionOver,
          missionResult:          M.missionResult,
          starOneBattleOccurred:  M.starOneBattleOccurred,
          awaitingHumanCard:      false,           // UI-coupled; reset to safe default
          _humanResolve:          null,            // UI-coupled; not carried into clones
          startedAt:              M.startedAt
        };
      }

      return { G: Gc, M: Mc };
    },

    /** Restore a snapshot returned by cloneState(). Replaces state.G and
     *  state.M with the snapshot's objects. The snapshot is taken over
     *  by reference — discard it after restoring or further mutations
     *  to the live state will affect what you thought was a snapshot.
     *
     *  Typical pattern in Alpha rollouts:
     *      const snap = S.cloneState();
     *      // ... mutate live state, run rollout ...
     *      S.restoreState(snap);
     */
    restoreState(snap){
      if (!snap) return;
      state.G = snap.G;
      state.M = snap.M;
    }
  };

  R.state = state;
})();
