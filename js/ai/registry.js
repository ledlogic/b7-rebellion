/* Rebellion — ai/registry.js
 * Pluggable AI registry. Each AI registers itself once at load:
 *
 *   Rebellion.ai.register('mylevel', {
 *     label: 'My — Description shown in setup',
 *     description: '(optional) short explanation',
 *     chooseCard(player, legal, trick, ledSuit, isInvasion, ctx) { return card; },
 *     // optional power hooks — fall back to random pick when missing:
 *     chooseZenTarget(player, others, ctx) { return others[0]; },
 *     choosePickLockTarget(player, others, ctx) { return others[0]; },
 *   });
 *
 * Setup screen auto-discovers all registered AIs. Adding a new tier later is
 * just one more file + one more <script> tag — no core changes needed.
 *
 * ctx (built by buildContext below) gives AIs everything they need without
 * having to import other modules:
 *   { playedCards, knownVoids, numPlayers, players, reserve, invasionActive,
 *     engine: { legalPlays, resolveTrickWinner, sleep, subj, verbFor, ... },
 *     card:   { basePoints, isJoker, rankValue, RANKS, SUITS, cardMeta, ... } }
 */
(function () {
  'use strict';
  const R = (window.Rebellion = window.Rebellion || {});

  const registry = {};
  const order = []; // preserves registration order for setup-screen button layout

  R.ai = {
    register(key, def){
      if (!registry[key]) order.push(key);
      registry[key] = Object.assign({ key }, def);
    },
    get(key){
      return registry[key] || registry[order[0]] || null;
    },
    list(){
      return order.map(k => registry[k]);
    },

    /* Builds the context blob passed into AI hooks. Pulls live state lazily
       so AIs always see up-to-date M.playedCards / knownVoids. */
    buildContext(player){
      const M = R.state.M, G = R.state.G;
      return {
        playedCards: M ? M.playedCards : [],
        knownVoids: M ? M.knownVoids : {},
        numPlayers: G ? G.numPlayers : 0,
        players: G ? G.players : [],
        reserve: M ? M.reserve : [],
        invasionActive: M ? M.invasionActive : false,
        engine: R.engine,
        card: R.card
      };
    },

    /* Dispatcher used by flow.js. Falls back to delta if the requested level
       isn't registered (defensive). */
    chooseCard(player, legal, trick, ledSuit, isInvasion){
      const def = R.ai.get(player.aiLevel);
      const ctx = R.ai.buildContext(player);
      return def.chooseCard(player, legal, trick, ledSuit, isInvasion, ctx);
    }
  };
})();
