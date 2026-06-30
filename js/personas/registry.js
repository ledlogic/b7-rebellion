/* Rebellion — personas/registry.js
 * Pluggable persona/personality registry. Custom personalities can be added by
 * dropping a new JS file that calls Rebellion.personas.register({...}).
 *
 * Each persona shape:
 *   {
 *     id:       'unique_id',
 *     name:     'Display Name',
 *     role:     'Short Role Subtitle',
 *     color:    '#hex',           // seat accent + chat tag color
 *     tag:      'XX',             // 2-char chat tag
 *     lines: {
 *       start:[...], lead:[...], winGood:[...], winBad:[...],
 *       sluff:[...], power:[...], reserve:[...], andromedan:[...],
 *       starOne:[...], missionEnd:[...], idle:[...], fullCrew:[...]
 *     }
 *   }
 *
 * pickLine(persona, category) returns one line from that category, cycling
 * through all of them before repeating.
 */
(function () {
  'use strict';
  const R = (window.Rebellion = window.Rebellion || {});

  const registry = [];
  const history = {};  // persona.id + '/' + category -> remaining indices

  function shuffleArr(arr){
    const a = arr.slice();
    for (let i = a.length-1; i > 0; i--){
      const j = Math.floor(Math.random() * (i+1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  R.personas = {
    register(persona){
      if (!persona || !persona.id) throw new Error('Persona must have an id');
      const existingIdx = registry.findIndex(p => p.id === persona.id);
      if (existingIdx >= 0) registry[existingIdx] = persona;
      else registry.push(persona);
    },
    list(){ return registry.slice(); },
    pickLine(persona, category){
      if (!persona) return null;
      const pool = persona.lines && persona.lines[category];
      if (!pool || !pool.length) return null;
      const key = persona.id + '/' + category;
      if (!history[key] || history[key].length === 0){
        history[key] = shuffleArr(pool.map((_, i) => i));
      }
      const idx = history[key].pop();
      return pool[idx];
    },
    /* Used by setup. Returns N randomly-selected personas with names
     *  resolved per-game from each persona's nameOptions pool if present.
     *  Each call produces a fresh sample, so successive games get different
     *  names from the same archetype pool — same personality/dialogue,
     *  different label. Personas without nameOptions are returned unchanged. */
    pickN(n){
      const picked = shuffleArr(registry).slice(0, n);
      return picked.map(p => {
        if (!p.nameOptions || !p.nameOptions.length) return p;
        const opt = p.nameOptions[Math.floor(Math.random() * p.nameOptions.length)];
        /* Shallow copy with overridden name/tag — original persona object
           in the registry is not mutated, so the next call rerolls freely. */
        return Object.assign({}, p, { name: opt.name, tag: opt.tag });
      });
    },
    /* Test/dev helper. */
    _clear(){ registry.length = 0; for (const k of Object.keys(history)) delete history[k]; }
  };
})();
