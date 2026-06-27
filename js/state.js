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
      const { reserve, hands } = E.dealMission(G.numPlayers, dealerIdx);
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
        currentTrick: [],
        trickNumber: 0,
        playedCards: [],    // every card revealed in play this mission
        knownVoids: {},     // playerIdx -> Set of suit chars they're known void in
        missionOver: false,
        missionResult: null,  // 'normal' | 'starOne' | 'andromedan'
        awaitingHumanCard: false,
        _humanResolve: null
      };
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
    }
  };

  R.state = state;
})();
