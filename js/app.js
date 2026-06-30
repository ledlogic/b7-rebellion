/* Rebellion — app.js
 * Entry point. Wires the setup screen (player count + AI difficulty buttons,
 * auto-populated from registered AIs), runs the dealer-draw, builds the game,
 * and kicks off the mission loop.
 */
(function () {
  'use strict';
  const R = (window.Rebellion = window.Rebellion || {});
  const C = R.card;
  const E = R.engine;
  const S = R.state;
  const UI = R.ui;

  /* ---- Blake's 7-style system-name generator ----
     Per the rulebook's naming conventions: stars are named "Constellation
     Greek" (Cygnus Alpha) or "Name Major/Prime" (Saurian Major); worlds add
     a Roman numeral (Centero IV); some are standalone evocative names
     (Horizon, Destiny). The four patterns below are weighted to match the
     show's actual frequency. */
  const NAME_DATA = {
    constellations:['Cygnus','Lyra','Hydra','Cetus','Orion','Centauri','Draconis',
      'Auriga','Reticuli','Eridani','Pavonis','Carina','Boötes','Pegasi','Aquilae',
      'Andromedae','Cassiopeiae','Aquarii','Crateris','Velorum','Sextantis'],
    greek:['Alpha','Beta','Gamma','Delta','Epsilon','Zeta','Eta','Theta','Iota',
      'Kappa','Lambda','Sigma','Tau','Phi','Chi','Psi','Omega'],
    latinNames:['Saurian','Cephlon','Vandor','Helotrix','Bucol','Centero','Aristo',
      'Albian','Domo','Goth','Lindor','Obsidian','Sarran','Auros','Astra','Sardos',
      'Kaliope','Solaris','Tharkos','Vendros','Mestor','Tarriel','Korsis','Thallian',
      'Pellarian','Drakos','Ferzaal','Helex','Phylor','Calion','Vorax','Phovon'],
    suffixes:['Major','Minor','Prime','Secundus'],
    roman:['II','III','IV','V','VI','VII','VIII','IX','X','XII'],
    standalone:['Horizon','Destiny','Sanctuary','Refuge','Outpost','Eclipse',
      'Aurora','Penumbra','Borealis','Ascendant','Convergence','Halcyon','Ascension',
      'Vanguard','Threshold']
  };
  function pickFrom(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
  function generateSystemName(){
    const r = Math.random();
    if (r < 0.40) return pickFrom(NAME_DATA.constellations) + ' ' + pickFrom(NAME_DATA.greek);
    if (r < 0.70) return pickFrom(NAME_DATA.latinNames)     + ' ' + pickFrom(NAME_DATA.suffixes);
    if (r < 0.90) return pickFrom(NAME_DATA.latinNames)     + ' ' + pickFrom(NAME_DATA.roman);
    return pickFrom(NAME_DATA.standalone);
  }

  /* ---- Build player count buttons (2..7) ---- */
  const countRow = document.getElementById('count-row');
  let chosenCount = null;
  for (let n = 2; n <= 7; n++){
    const b = document.createElement('button');
    b.textContent = n; b.dataset.n = n;
    b.addEventListener('click', () => {
      chosenCount = n;
      [...countRow.children].forEach(c => c.classList.remove('selected'));
      b.classList.add('selected');
      document.getElementById('blurb-missions').textContent = (n === 1 ? 'one Mission' : n + ' Missions total');
      document.getElementById('setup-blurb').removeAttribute('hidden');
      /* Unlock the opponent-mix section now that we know the opponent count.
         The .locked class on the section dims it and blocks pointer events
         until this point. Safe to call repeatedly. */
      document.getElementById('difficulty-section').classList.remove('locked');
      /* Player-count drives opponent-count, so re-apply the current preset
         to redistribute the mix across the new opponent-count. */
      reapplyCurrentPreset();
    });
    countRow.appendChild(b);
  }

  /* ============================================================
   * Opponent mix picker — presets row + per-tier counters.
   * AI tier list is built dynamically from R.ai.list() so adding
   * a new tier (alpha later) auto-extends both presets and counters.
   *
   * Plus one virtual tier — 'beta-random' — handled at the app layer.
   * It appears in the picker like any real tier, but at game start each
   * 'beta-random' seat is independently resolved to either beta-vs-gamma
   * or beta-vs-delta with 50/50 probability. The seat then plays as that
   * variant for the whole game so it stays learnable.
   * ============================================================ */
  const aiList = R.ai.list();                            // [delta, gamma, beta-vs-delta, beta-vs-gamma]
  const REAL_AI_KEYS = aiList.map(a => a.key);

  /** Virtual-tier metadata. Same shape as an R.ai entry's render-relevant
   *  fields, so the picker code can treat real and virtual tiers uniformly. */
  const VIRTUAL_TIERS = [{
    key:         'beta-random',
    label:       'ΒΔ/ΒΓ Beta — Random Variant',
    description: 'Each seat assigned this tier randomly becomes Beta-Delta or Beta-Gamma at game start, then plays as that variant for the whole game.',
    iq:          'random',                                /* string flags non-numeric formatting */
    resolveTo:   ['beta-vs-delta', 'beta-vs-gamma']       /* options at resolution time */
  }];

  const aiKeys = REAL_AI_KEYS.concat(VIRTUAL_TIERS.map(v => v.key));

  /** Combined picker metadata — used for rendering counter rows. Real tiers
   *  come from R.ai; virtuals from the table above. */
  function pickerEntry(key){
    const real = aiList.find(a => a.key === key);
    if (real) return real;
    return VIRTUAL_TIERS.find(v => v.key === key);
  }

  /** Current opponent mix — counts per tier. Sums to numOpponents. */
  let chosenMix = Object.fromEntries(aiKeys.map(k => [k, 0]));
  let selectedPreset = 'officers';      // default preset matches old "all Gamma" behavior

  function numOpponents(){ return chosenCount == null ? 0 : (chosenCount - 1); }
  function mixTotal(){ return aiKeys.reduce((s, k) => s + chosenMix[k], 0); }

  /** Distribute n opponents as evenly as possible across the tiers,
   *  biasing the remainder toward whichever tiers come first in aiKeys
   *  (registration order). Works for any tier count. */
  function balancedSplit(n){
    const result = Object.fromEntries(aiKeys.map(k => [k, 0]));
    if (n <= 0) return result;
    const base = Math.floor(n / aiKeys.length);
    let rem = n - base * aiKeys.length;
    for (const k of aiKeys) result[k] = base;
    for (let i = 0; i < rem; i++) result[aiKeys[i % aiKeys.length]]++;
    return result;
  }

  /** Distribute n opponents across a given list of tiers, evenly. Used by
   *  presets that target a subset of tiers (e.g. "All Strategists" puts
   *  opponents in both Β-Δ and Β-Γ in a roughly equal mix). */
  function distributeAcross(tierList, n){
    const result = Object.fromEntries(aiKeys.map(k => [k, 0]));
    if (!tierList || tierList.length === 0 || n <= 0) return result;
    const base = Math.floor(n / tierList.length);
    let rem = n - base * tierList.length;
    for (const t of tierList) result[t] = base;
    for (let i = 0; i < rem; i++) result[tierList[i % tierList.length]]++;
    return result;
  }

  /* Presets — id, label, and a function that maps n→mix. The "custom"
     preset has no distribute function; it's set whenever the user manually
     edits a counter, leaving the current mix as-is. */
  const PRESETS = [
    { id:'conscripts',  label:'All Δ Conscripts',  distribute:n => distributeAcross(['delta'], n) },
    { id:'officers',    label:'All Γ Officers',    distribute:n => distributeAcross(['gamma'], n) },
    { id:'strategists', label:'All Β Strategists', distribute:n => distributeAcross(['beta-vs-delta', 'beta-vs-gamma'], n) },
    { id:'balanced',    label:'Balanced Mix',      distribute:balancedSplit },
    { id:'custom',      label:'Custom',            distribute:null }
  ];

  function applyPreset(id){
    selectedPreset = id;
    const preset = PRESETS.find(p => p.id === id);
    if (preset && preset.distribute){
      chosenMix = preset.distribute(numOpponents());
    }
    renderMixUI();
    updateStartButton();
  }

  function reapplyCurrentPreset(){
    if (selectedPreset && selectedPreset !== 'custom') applyPreset(selectedPreset);
    else { renderMixUI(); updateStartButton(); }
  }

  function adjustMix(tier, delta){
    const newVal = (chosenMix[tier] || 0) + delta;
    if (newVal < 0) return;
    if (mixTotal() + delta > numOpponents() && delta > 0) return; // don't exceed total
    chosenMix[tier] = newVal;
    selectedPreset = 'custom';
    renderMixUI();
    updateStartButton();
  }

  /* Build presets row (once) */
  const presetsRow = document.getElementById('presets-row');
  for (const p of PRESETS){
    const b = document.createElement('button');
    b.textContent = p.label;
    b.dataset.preset = p.id;
    if (p.id === 'custom') b.classList.add('custom');
    b.addEventListener('click', () => applyPreset(p.id));
    presetsRow.appendChild(b);
  }

  /* Build counter rows (once) — labels, IQ badges, +/- buttons. Real tiers
     first (registration order), then virtual tiers below. */
  const mixCountersEl = document.getElementById('mix-counters');
  for (const ai of aiList.concat(VIRTUAL_TIERS)){
    const row = document.createElement('div'); row.className = 'mix-row'; row.dataset.tier = ai.key;
    const lab = document.createElement('span'); lab.className = 'mix-label'; lab.textContent = ai.label;
    row.appendChild(lab);
    if (typeof ai.iq === 'number'){
      const iq = document.createElement('span'); iq.className = 'mix-iq'; iq.textContent = 'IQ ' + ai.iq;
      iq.title = 'IQ = 100 + (winRate − 1/numPlayers) × 250. Calibrated from headless tournaments.';
      row.appendChild(iq);
    } else if (ai.iq === 'random'){
      const iq = document.createElement('span'); iq.className = 'mix-iq'; iq.textContent = 'IQ 111–131';
      iq.title = 'Each seat is randomly assigned to Beta-Gamma (IQ 111) or Beta-Delta (IQ 131) at game start.';
      row.appendChild(iq);
    }
    const stp = document.createElement('span'); stp.className = 'mix-stepper';
    const minus = document.createElement('button'); minus.textContent = '−';
    minus.addEventListener('click', () => adjustMix(ai.key, -1));
    const count = document.createElement('span'); count.className = 'mix-count'; count.dataset.count = ai.key;
    const plus  = document.createElement('button'); plus.textContent = '+';
    plus.addEventListener('click', () => adjustMix(ai.key, +1));
    stp.appendChild(minus); stp.appendChild(count); stp.appendChild(plus);
    row.appendChild(stp);
    mixCountersEl.appendChild(row);
  }

  /** Update visible counters, presets-row highlight, and status line. */
  function renderMixUI(){
    /* Counters */
    for (const k of aiKeys){
      const el = mixCountersEl.querySelector('[data-count="' + k + '"]');
      if (el) el.textContent = chosenMix[k];
      /* Disable +/− at bounds */
      const row = mixCountersEl.querySelector('[data-tier="' + k + '"]');
      if (!row) continue;
      const steppers = row.querySelectorAll('.mix-stepper > *');
      if (steppers.length < 3) continue;
      const minus = steppers[0], plus = steppers[2];
      minus.disabled = chosenMix[k] <= 0;
      plus.disabled  = mixTotal() >= numOpponents();
    }
    /* Presets highlight */
    [...presetsRow.children].forEach(b => {
      b.classList.toggle('selected', b.dataset.preset === selectedPreset);
    });
    /* Status line */
    const st = document.getElementById('mix-status');
    const total = mixTotal(), need = numOpponents();
    if (chosenCount == null){
      st.textContent = 'Pick the number of players first.';
      st.className = 'mix-status';
    } else if (total === need){
      st.textContent = '✓ ' + total + ' opponent' + (total === 1 ? '' : 's') + ' configured — ready to deal.';
      st.className = 'mix-status ok';
    } else {
      const diff = need - total;
      st.textContent = (diff > 0 ? '+' + diff + ' more to assign' : Math.abs(diff) + ' too many')
                     + ' — need exactly ' + need + ' opponent' + (need === 1 ? '' : 's') + ', currently ' + total + '.';
      st.className = 'mix-status bad';
    }
  }

  function updateStartButton(){
    const need = numOpponents();
    const total = mixTotal();
    document.getElementById('btn-start').disabled = !(chosenCount && total === need);
  }

  applyPreset('officers');  // initial render with all-Gamma default

  document.getElementById('btn-start').addEventListener('click', startGameSetup);
  document.getElementById('btn-history').addEventListener('click', UI.showHistoryModal);
  UI.attachUiHandlers();

  /** Build the per-seat AI tier list from chosenMix, then shuffle so seat
   *  order doesn't always run Δ Δ Γ Γ ΒΔ ΒΓ left-to-right. Virtual tiers
   *  like 'beta-random' get expanded here — each instance independently
   *  resolved to one of its real targets at game-start time. */
  function buildAiTierList(){
    const tiers = [];
    for (const k of aiKeys){
      const virt = VIRTUAL_TIERS.find(v => v.key === k);
      for (let i = 0; i < chosenMix[k]; i++){
        if (virt){
          /* Independent 50/50 (or even split across resolveTo) per seat. */
          const pick = virt.resolveTo[Math.floor(Math.random() * virt.resolveTo.length)];
          tiers.push(pick);
        } else {
          tiers.push(k);
        }
      }
    }
    /* Fisher-Yates */
    for (let i = tiers.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [tiers[i], tiers[j]] = [tiers[j], tiers[i]];
    }
    return tiers;
  }

  /** Human-readable summary of the mix for G.difficulty and the header chip. */
  function describeMix(){
    const used = aiKeys.filter(k => chosenMix[k] > 0);
    if (used.length === 1) return used[0];      // uniform — return tier key
    /* Mixed — compact label like "Δ2 Γ2 Β2" using each tier's label first-char */
    function tierGlyph(key){
      const ai = R.ai.get(key);
      if (!ai || !ai.label) return key;
      const first = ai.label.split(/\s+/)[0];
      return /^[A-Za-z0-9]/.test(first) ? key : first;
    }
    return used.map(k => tierGlyph(k) + chosenMix[k]).join(' ');
  }

  async function startGameSetup(){
    document.getElementById('btn-start').disabled = true;
    /* Switch the setup-card to its "dealer" stage — player count and AI
       difficulty are now locked in, so we hide those sections and the
       instructional blurb to give the dealer-draw its own clean dialog. */
    document.querySelector('.setup-card').classList.add('dealer-mode');
    const n = chosenCount;
    const personaPool = R.personas.pickN(n - 1);
    const aiTiers = buildAiTierList();
    const players = [];
    players.push(S.newPlayer(0, true, null, null));
    for (let i = 1; i < n; i++) players.push(S.newPlayer(i, false, personaPool[i-1], aiTiers[i-1]));

    S.G = {
      numPlayers: n,
      players,
      missionIndex: 0,
      totals: new Array(n).fill(0),
      missionLog: [],
      startDealer: 0,
      difficulty: describeMix(),
      mix:        Object.assign({}, chosenMix),  // structured mix for export/replay
      systemName: generateSystemName(),   // Saurian Major, Cygnus Alpha, Centero IV...
      gameStartedAt: null   // stamped on first runMission, drives the GAME header timer
    };

    /* ---- Dealer draw (lowest-card-deals-first) ---- */
    document.getElementById('dealer-draw-section').style.display = 'block';
    const drawRow = document.getElementById('dealer-draw-row');
    const msg = document.getElementById('dealer-draw-msg');
    drawRow.innerHTML = '';
    msg.textContent = 'Each player draws a card. Lowest value deals first.';
    await E.sleep(400);

    let attempt = 0, dealerIdx = -1;
    while (dealerIdx === -1 && attempt < 4){
      attempt++;
      const deck = C.shuffle(C.buildDeck());
      const draws = players.map((p, i) => ({
        p, card: deck[i],
        val: C.isJoker(deck[i]) ? 10 : C.basePoints(deck[i])
      }));
      /* Sort ascending so the leftmost card is the lowest (= dealer).
         No elevation on the winning cell — the order itself is the cue. */
      draws.sort((a, b) => a.val - b.val);
      drawRow.innerHTML = '';
      for (const d of draws){
        const wrap = document.createElement('div');
        wrap.className = 'dealer-draw-cell';
        wrap.dataset.pidx = d.p.idx;
        wrap.appendChild(UI.renderCardEl(d.card, false));
        const lbl = document.createElement('div');
        lbl.style.fontSize = '11px'; lbl.style.marginTop = '6px';
        lbl.innerHTML = UI.playerChip(d.p) + ' <span style="font-family:monospace;color:var(--muted);">(' + d.val + ')</span>';
        wrap.appendChild(lbl);
        drawRow.appendChild(wrap);
        await E.sleep(180);
      }
      const minVal = Math.min(...draws.map(d => d.val));
      const lowest = draws.filter(d => d.val === minVal);
      if (lowest.length === 1){
        dealerIdx = lowest[0].p.idx;
        msg.textContent = E.subj(lowest[0].p.name, 'draws') + ' lowest and ' + E.verbFor(lowest[0].p.name, 'deals') + ' first.';
      } else {
        msg.textContent = 'Tie for lowest — redrawing...';
        await E.sleep(900);
      }
    }
    if (dealerIdx === -1) dealerIdx = Math.floor(Math.random() * n);
    S.G.startDealer = dealerIdx;

    /* Wait for the user to click before transitioning to the game screen,
       so they can read who's dealing first. */
    await new Promise(resolve => {
      const drawSection = document.getElementById('dealer-draw-section');
      const proceedBtn = document.createElement('button');
      proceedBtn.className = 'primary';
      proceedBtn.textContent = 'Begin First Mission';
      proceedBtn.style.marginTop = '14px';
      drawSection.appendChild(proceedBtn);
      proceedBtn.addEventListener('click', () => {
        proceedBtn.remove();
        resolve();
      }, { once:true });
    });

    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('game-screen').classList.add('active');
    R.flow.runGame();
  }

  /* dev hook */
  window.__DEBUG_STATE = () => ({ G: S.G, M: S.M });
})();
