/* Rebellion — app.js
 * Entry point. Wires the setup screen (player count + AI difficulty buttons,
 * auto-populated from registered AIs), runs the dealer-draw, builds the game,
 * and kicks off the mission loop.
 */
(function () {
  'use strict';
  const R = (window.Rebellion = window.Rebellion || {});
  const E = R.engine;
  const S = R.state;
  const UI = R.ui;

  /* ---- Build player count buttons (3..7) ---- */
  const countRow = document.getElementById('count-row');
  let chosenCount = null;
  for (let n = 3; n <= 7; n++){
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
  UI.attachUiHandlers();

  async function startGameSetup(){
    document.getElementById('btn-start').disabled = true;
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
      difficulty: chosenDifficulty
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
      const deck = E.shuffle(E.buildDeck());
      const draws = players.map((p, i) => ({
        p, card: deck[i],
        val: E.isJoker(deck[i]) ? 10 : E.basePoints(deck[i])
      }));
      drawRow.innerHTML = '';
      for (const d of draws){
        const wrap = document.createElement('div'); wrap.style.textAlign = 'center';
        wrap.appendChild(UI.renderCardEl(d.card, false));
        const lbl = document.createElement('div');
        lbl.style.fontSize = '11px'; lbl.style.marginTop = '4px'; lbl.style.color = 'var(--muted)';
        lbl.textContent = d.p.name + ' (' + d.val + ')';
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
      proceedBtn.textContent = 'Begin Mission';
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
