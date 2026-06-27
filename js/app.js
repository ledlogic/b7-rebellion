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

  /* ---- Build player count buttons (3..7) ---- */
  const countRow = document.getElementById('count-row');
  let chosenCount = null;
  for (let n = 2; n <= 7; n++){
    const b = document.createElement('button');
    b.textContent = n; b.dataset.n = n;
    b.addEventListener('click', () => {
      chosenCount = n;
      [...countRow.children].forEach(c => c.classList.remove('selected'));
      b.classList.add('selected');
      document.getElementById('blurb-missions').textContent = (n === 1 ? 'one Mission' : n + ' Missions');
      document.getElementById('btn-start').disabled = false;
    });
    countRow.appendChild(b);
  }

  /* ---- Build difficulty buttons from the AI registry ---- */
  const diffRow = document.getElementById('difficulty-row');
  let chosenDifficulty = 'gamma';
  for (const ai of R.ai.list()){
    const b = document.createElement('button');
    b.dataset.d = ai.key;
    b.textContent = ai.label;
    if (ai.key === chosenDifficulty) b.classList.add('selected');
    b.addEventListener('click', () => {
      chosenDifficulty = ai.key;
      [...diffRow.children].forEach(c => c.classList.remove('selected'));
      b.classList.add('selected');
    });
    diffRow.appendChild(b);
  }

  document.getElementById('btn-start').addEventListener('click', startGameSetup);
  document.getElementById('btn-history').addEventListener('click', UI.showHistoryModal);
  UI.attachUiHandlers();

  async function startGameSetup(){
    document.getElementById('btn-start').disabled = true;
    /* Switch the setup-card to its "dealer" stage — player count and AI
       difficulty are now locked in, so we hide those sections and the
       instructional blurb to give the dealer-draw its own clean dialog. */
    document.querySelector('.setup-card').classList.add('dealer-mode');
    const n = chosenCount;
    const personaPool = R.personas.pickN(n - 1);
    const players = [];
    players.push(S.newPlayer(0, true, null, null));
    for (let i = 1; i < n; i++) players.push(S.newPlayer(i, false, personaPool[i-1], chosenDifficulty));

    S.G = {
      numPlayers: n,
      players,
      missionIndex: 0,
      totals: new Array(n).fill(0),
      missionLog: [],
      startDealer: 0,
      difficulty: chosenDifficulty,
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
