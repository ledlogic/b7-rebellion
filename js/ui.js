/* Rebellion — ui.js
 * All DOM-touching code lives here: rendering the table, the modal system,
 * the comms log + persona chat bubbles, the human card-click bridge, and the
 * scoring/final-results dialogs.
 *
 * Exposes Rebellion.ui.{ renderAll, askButtons, askCards, askInfo, logSystem,
 * say, getHumanCard, showScoreboardModal, showScoringModal, showInfoBanner,
 * showFinalResults, setCenterMsg, renderCardEl, ... }.
 */
(function () {
  'use strict';
  const R = (window.Rebellion = window.Rebellion || {});
  const E = R.engine;
  const S = R.state;

  /* ============================================================ Card rendering ============================================================ */
  function renderCardEl(card, clickable, tiny){
    const el = document.createElement('div');
    el.className = 'card suit-' + card.suit + (clickable ? ' clickable' : '') + (tiny ? ' tiny' : '');
    el.dataset.id = card.id;
    const sym = E.SUIT_SYMBOL[card.suit];
    el.innerHTML = '<div class="rank-top">' + (E.isJoker(card) ? '★' : card.rank) + (E.isJoker(card) ? '' : sym) + '</div>' +
                   '<div class="suit-mid">' + (E.isJoker(card) ? '★' : sym) + '</div>' +
                   '<div class="rank-bot">' + (E.isJoker(card) ? '★' : card.rank) + (E.isJoker(card) ? '' : sym) + '</div>';
    el.title = E.cardName(card) + ' (' + (E.basePoints(card) >= 0 ? '+' : '') + E.basePoints(card) + ')';
    return el;
  }
  function renderCardBackEl(tiny){
    const el = document.createElement('div');
    el.className = 'card-back' + (tiny ? ' tiny' : '');
    return el;
  }

  /* ============================================================ Logging ============================================================ */
  function logSystem(text){
    const feed = document.getElementById('comms-feed');
    if (!feed) return;
    const div = document.createElement('div');
    div.className = 'log-line system';
    div.innerHTML = '<span class="marker">▸</span> ' + text;
    feed.appendChild(div);
    feed.scrollTop = feed.scrollHeight;
  }
  function logChat(player, text){
    const feed = document.getElementById('comms-feed');
    if (!feed) return;
    const div = document.createElement('div');
    div.className = 'log-line';
    const c = player.color;
    div.innerHTML = '<span class="tag" style="background:' + c + '22;color:' + c + ';border:1px solid ' + c + '55;">' +
                    (player.isHuman ? 'YOU' : player.persona.tag) + '</span>' + escapeHtml(text);
    feed.appendChild(div);
    feed.scrollTop = feed.scrollHeight;
  }
  function escapeHtml(s){ const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function say(player, category){
    if (player.isHuman) return;
    const line = R.personas.pickLine(player.persona, category);
    if (!line) return;
    logChat(player, line);
    showBubble(player.idx, line);
  }
  function showBubble(playerIdx, text){
    const seatEl = document.querySelector('.seat[data-idx="' + playerIdx + '"]');
    if (!seatEl) return;
    const old = seatEl.querySelector('.bubble');
    if (old) old.remove();
    const b = document.createElement('div');
    b.className = 'bubble';
    b.textContent = text;
    seatEl.appendChild(b);
    setTimeout(() => { if (b.parentNode) b.remove(); }, 3600);
  }

  /* ============================================================ Modal system ============================================================ */
  let modalRoot, modalBox;
  function ensureModalRefs(){
    if (!modalRoot) modalRoot = document.getElementById('modal-root');
    if (!modalBox)  modalBox  = document.getElementById('modal-box');
  }
  function closeModal(){
    ensureModalRefs();
    modalRoot.classList.remove('open');
    modalBox.innerHTML = '';
  }

  function askButtons(title, sub, options){
    ensureModalRefs();
    return new Promise(resolve => {
      modalBox.innerHTML = '';
      const h = document.createElement('h3'); h.textContent = title; modalBox.appendChild(h);
      if (sub){ const p = document.createElement('div'); p.className = 'sub'; p.textContent = sub; modalBox.appendChild(p); }
      const optsWrap = document.createElement('div'); optsWrap.className = 'modal-options';
      options.forEach(opt => {
        const b = document.createElement('button'); b.className = 'modal-btn-opt'; b.textContent = opt.label;
        b.addEventListener('click', () => { closeModal(); resolve(opt.value); });
        optsWrap.appendChild(b);
      });
      modalBox.appendChild(optsWrap);
      modalRoot.classList.add('open');
    });
  }

  function askCards(title, sub, cards, opts){
    ensureModalRefs();
    opts = opts || {};
    const multi = !!opts.multi;
    const minSelect = opts.min || 0;
    const maxSelect = opts.max || (multi ? cards.length : 1);
    const allowSkip = opts.allowSkip !== false;
    const skipLabel = opts.skipLabel || 'Skip';
    const confirmLabel = opts.confirmLabel || 'Confirm';
    return new Promise(resolve => {
      modalBox.innerHTML = '';
      const h = document.createElement('h3'); h.textContent = title; modalBox.appendChild(h);
      if (sub){ const p = document.createElement('div'); p.className = 'sub'; p.textContent = sub; modalBox.appendChild(p); }
      const optsWrap = document.createElement('div'); optsWrap.className = 'modal-options';
      const selected = new Set();
      cards.forEach((c, i) => {
        const wrap = document.createElement('div'); wrap.className = 'modal-card-opt';
        wrap.appendChild(renderCardEl(c, true));
        const lbl = document.createElement('div'); lbl.className = 'lbl';
        lbl.textContent = E.cardName(c) + ' (' + (E.basePoints(c) >= 0 ? '+' : '') + E.basePoints(c) + ')';
        wrap.appendChild(lbl);
        wrap.addEventListener('click', () => {
          if (multi){
            if (selected.has(i)) { selected.delete(i); wrap.classList.remove('selected'); }
            else if (selected.size < maxSelect) { selected.add(i); wrap.classList.add('selected'); }
          } else {
            [...optsWrap.children].forEach(ch => ch.classList.remove('selected'));
            selected.clear(); selected.add(i); wrap.classList.add('selected');
          }
          confirmBtn.disabled = selected.size < minSelect;
        });
        optsWrap.appendChild(wrap);
      });
      modalBox.appendChild(optsWrap);
      const foot = document.createElement('div'); foot.className = 'modal-foot';
      if (allowSkip){
        const skipBtn = document.createElement('button'); skipBtn.textContent = skipLabel;
        skipBtn.addEventListener('click', () => { closeModal(); resolve([]); });
        foot.appendChild(skipBtn);
      }
      const confirmBtn = document.createElement('button'); confirmBtn.className = 'primary';
      confirmBtn.textContent = confirmLabel;
      confirmBtn.disabled = minSelect > 0;
      confirmBtn.addEventListener('click', () => {
        const arr = [...selected].sort((a, b) => a - b).map(i => cards[i]);
        closeModal(); resolve(arr);
      });
      foot.appendChild(confirmBtn);
      modalBox.appendChild(foot);
      modalRoot.classList.add('open');
    });
  }

  function askInfo(title, sub, cards){
    ensureModalRefs();
    return new Promise(resolve => {
      modalBox.innerHTML = '';
      const h = document.createElement('h3'); h.textContent = title; modalBox.appendChild(h);
      if (sub){ const p = document.createElement('div'); p.className = 'sub'; p.textContent = sub; modalBox.appendChild(p); }
      if (cards && cards.length){
        const optsWrap = document.createElement('div'); optsWrap.className = 'modal-options';
        cards.forEach(c => {
          const wrap = document.createElement('div'); wrap.className = 'modal-card-opt';
          wrap.appendChild(renderCardEl(c, false));
          const lbl = document.createElement('div'); lbl.className = 'lbl'; lbl.textContent = E.cardName(c);
          wrap.appendChild(lbl);
          optsWrap.appendChild(wrap);
        });
        modalBox.appendChild(optsWrap);
      }
      const foot = document.createElement('div'); foot.className = 'modal-foot';
      const okBtn = document.createElement('button'); okBtn.className = 'primary'; okBtn.textContent = 'Understood';
      okBtn.addEventListener('click', () => { closeModal(); resolve(); });
      foot.appendChild(okBtn);
      modalBox.appendChild(foot);
      modalRoot.classList.add('open');
    });
  }

  function showInfoBanner(title, sub){ return askInfo(title, sub, null); }

  /* ============================================================ Table rendering ============================================================ */
  function renderAll(){
    renderHeader();
    renderSeats();
    renderHumanHand();
    renderCenter();
  }
  function renderHeader(){
    const G = S.G, M = S.M;
    if (!G || !M) return;
    document.getElementById('hdr-title').textContent = 'Mission ' + (G.missionIndex+1) + ' of ' + G.numPlayers;
    document.getElementById('hdr-dealer').textContent = G.players[M.dealerIdx].name;
    document.getElementById('hdr-trick').textContent = M.trickNumber;
    document.getElementById('hdr-reserve').textContent = M.reserve.length;
    const def = R.ai.get(G.difficulty);
    document.getElementById('hdr-ai').textContent = def ? def.label.split(' — ')[0] : G.difficulty;
    document.getElementById('comms-mission-tag').textContent = 'M' + (G.missionIndex+1);
  }
  function renderSeats(){
    const G = S.G, M = S.M;
    const row = document.getElementById('opponents-row');
    row.innerHTML = '';
    for (const p of G.players){
      if (p.isHuman) continue;
      const seat = document.createElement('div');
      seat.className = 'seat' + (M && M.currentTurn === p.idx && !M.missionOver ? ' active-turn' : '');
      seat.dataset.idx = p.idx;
      if (p.exposed){
        const tag = document.createElement('div'); tag.className = 'exposed-tag'; tag.textContent = 'HAND EXPOSED';
        seat.appendChild(tag);
      }
      const head = document.createElement('div'); head.className = 'seat-head';
      const av = document.createElement('div'); av.className = 'avatar';
      av.style.background = p.color; av.textContent = p.persona.tag;
      head.appendChild(av);
      const nameWrap = document.createElement('div');
      nameWrap.innerHTML = '<div class="name">' + p.name + '</div><div class="role">' + p.persona.role + '</div>';
      head.appendChild(nameWrap);
      seat.appendChild(head);
      const stats = document.createElement('div'); stats.className = 'stats';
      stats.innerHTML = '<span>HAND <b>' + p.hand.length + '</b></span><span>PILE <b>' + p.pile.length + '</b></span><span>TOTAL <b>' + G.totals[p.idx] + '</b></span>';
      seat.appendChild(stats);
      if (p.exposed){
        const exposedRow = document.createElement('div'); exposedRow.className = 'hand-row'; exposedRow.style.marginTop = '8px';
        p.hand.forEach(c => exposedRow.appendChild(renderCardEl(c, false, true)));
        seat.appendChild(exposedRow);
      }
      row.appendChild(seat);
    }
  }
  function cardSort(a, b){
    const order = { H:0, D:1, C:2, S:3, JK:4 };
    if (order[a.suit] !== order[b.suit]) return order[a.suit] - order[b.suit];
    return E.rankValue(a.rank || '2') - E.rankValue(b.rank || '2');
  }
  function renderHumanHand(){
    const G = S.G, M = S.M;
    const human = G.players[0];
    document.getElementById('human-stats').textContent = 'HAND: ' + human.hand.length + ' · PILE: ' + human.pile.length + ' · TOTAL: ' + G.totals[0];
    const handRow = document.getElementById('human-hand');
    handRow.innerHTML = '';
    const legal = (M && !M.missionOver && M.currentTurn === 0 && M.awaitingHumanCard)
      ? E.legalPlays(human.hand, M.ledSuit) : null;
    human.hand.slice().sort(cardSort).forEach(c => {
      const isLegal = !legal || legal.some(lc => lc.id === c.id);
      const el = renderCardEl(c, !!legal && isLegal);
      if (legal && !isLegal) el.classList.add('disabled');
      if (legal && isLegal){
        el.addEventListener('click', () => {
          if (M._humanResolve){
            const r = M._humanResolve;
            M._humanResolve = null;
            M.awaitingHumanCard = false;
            r(c);
          }
        });
      }
      handRow.appendChild(el);
    });
  }
  function renderCenter(){
    const G = S.G, M = S.M;
    document.getElementById('reserve-text').textContent = 'RESERVE: ' + M.reserve.length;
    document.getElementById('invasion-banner').classList.toggle('hidden', !M.invasionActive);
    document.getElementById('led-suit-tag').textContent = M.ledSuit
      ? ('Led suit: ' + E.SUIT_SYMBOL[M.ledSuit] + ' ' + E.SUIT_FACTION[M.ledSuit]) : '';
    const slots = document.getElementById('trick-slots');
    slots.innerHTML = '';
    for (const play of M.currentTrick){
      const slot = document.createElement('div'); slot.className = 'trick-slot';
      const who = document.createElement('div'); who.className = 'who';
      who.textContent = play.who === 'ANDROMEDAN' ? 'ANDROMEDAN' : G.players[play.playerIdx].name;
      slot.appendChild(who);
      slot.appendChild(renderCardEl(play.card, false));
      slots.appendChild(slot);
    }
  }
  function setCenterMsg(text){ document.getElementById('center-msg').textContent = text; }

  /* ============================================================ Human card bridge ============================================================ */
  function getHumanCard(legal){
    const M = S.M;
    return new Promise(resolve => {
      M.awaitingHumanCard = true;
      M._humanResolve = resolve;
      renderAll();
    });
  }

  /* ============================================================ Scoreboards ============================================================ */
  function showScoreboardModal(){
    ensureModalRefs();
    const G = S.G;
    modalBox.innerHTML = '';
    const h = document.createElement('h3'); h.textContent = 'Scoreboard'; modalBox.appendChild(h);
    const table = document.createElement('table'); table.className = 'score-table';
    table.innerHTML = '<tr><th>Player</th><th>Total</th></tr>' +
      G.players.slice().sort((a, b) => G.totals[b.idx] - G.totals[a.idx]).map(p =>
        '<tr><td>' + p.name + (p.isHuman ? '' : ' <span style="color:var(--muted);font-size:11px;">(' + p.persona.role + ')</span>') +
        '</td><td class="num ' + (G.totals[p.idx] >= 0 ? 'pos' : 'neg') + '">' + G.totals[p.idx] + '</td></tr>'
      ).join('');
    modalBox.appendChild(table);
    const foot = document.createElement('div'); foot.className = 'modal-foot';
    const okBtn = document.createElement('button'); okBtn.className = 'primary'; okBtn.textContent = 'Close';
    okBtn.addEventListener('click', closeModal);
    foot.appendChild(okBtn);
    modalBox.appendChild(foot);
    modalRoot.classList.add('open');
  }

  async function showScoringModal(breakdown){
    ensureModalRefs();
    const G = S.G;
    modalBox.innerHTML = '';
    const h = document.createElement('h3'); h.textContent = 'Mission ' + (G.missionIndex+1) + ' — Scoring'; modalBox.appendChild(h);
    if (breakdown.notes.length){
      const ul = document.createElement('ul'); ul.className = 'note-list';
      breakdown.notes.forEach(n => { const li = document.createElement('li'); li.textContent = n; ul.appendChild(li); });
      modalBox.appendChild(ul);
    }
    const table = document.createElement('table'); table.className = 'score-table';
    let rows = '<tr><th>Player</th><th>Pile</th><th>This Mission</th><th>Total</th></tr>';
    for (const p of G.players.slice().sort((a, b) => breakdown.missionTotals[b.idx] - breakdown.missionTotals[a.idx])){
      rows += '<tr><td>' + p.name + '</td><td>' + p.pile.length + ' cards</td><td class="num ' +
              (breakdown.missionTotals[p.idx] >= 0 ? 'pos' : 'neg') + '">' + breakdown.missionTotals[p.idx] +
              '</td><td class="num">' + G.totals[p.idx] + '</td></tr>';
    }
    table.innerHTML = rows;
    modalBox.appendChild(table);
    const foot = document.createElement('div'); foot.className = 'modal-foot';
    const okBtn = document.createElement('button'); okBtn.className = 'primary'; okBtn.textContent = 'Continue';
    foot.appendChild(okBtn);
    modalBox.appendChild(foot);
    modalRoot.classList.add('open');
    await new Promise(res => okBtn.addEventListener('click', () => { closeModal(); res(); }));
  }

  async function showFinalResults(runMissionFn){
    ensureModalRefs();
    const G = S.G;
    let attempts = 0;
    while (attempts < 3){
      const sorted = G.players.slice().sort((a, b) => G.totals[b.idx] - G.totals[a.idx]);
      const top = G.totals[sorted[0].idx];
      const tied = sorted.filter(p => G.totals[p.idx] === top);
      modalBox.innerHTML = '';
      const crown = document.createElement('div'); crown.className = 'crown';
      crown.textContent = tied.length > 1 ? '⚖' : '👑';
      modalBox.appendChild(crown);
      const h = document.createElement('h3'); h.style.textAlign = 'center';
      h.textContent = tied.length > 1 ? 'Tied for Commander of the Liberator'
                                      : sorted[0].name + ' is Commander of the Liberator!';
      modalBox.appendChild(h);
      const table = document.createElement('table'); table.className = 'score-table'; table.style.marginTop = '16px';
      table.innerHTML = '<tr><th>Player</th><th>Final Total</th></tr>' +
        sorted.map(p => '<tr><td>' + p.name + '</td><td class="num ' +
                        (G.totals[p.idx] >= 0 ? 'pos' : 'neg') + '">' + G.totals[p.idx] + '</td></tr>').join('');
      modalBox.appendChild(table);
      const foot = document.createElement('div'); foot.className = 'modal-foot';
      if (tied.length > 1 && attempts < 2){
        const tb = document.createElement('button'); tb.className = 'primary'; tb.textContent = 'Play Final Run (Tie-Break)';
        foot.appendChild(tb);
        modalBox.appendChild(foot);
        modalRoot.classList.add('open');
        await new Promise(res => tb.addEventListener('click', () => { closeModal(); res(); }));
        logSystem('— FINAL RUN: Sudden-death tie-break Mission —');
        const dealerIdx = (G.startDealer + G.numPlayers + attempts) % G.numPlayers;
        await runMissionFn(dealerIdx);
        attempts++;
        continue;
      } else {
        const rb = document.createElement('button'); rb.className = 'primary'; rb.textContent = 'New Game';
        rb.addEventListener('click', () => { location.reload(); });
        foot.appendChild(rb);
        modalBox.appendChild(foot);
        modalRoot.classList.add('open');
        return;
      }
    }
  }

  /* Wire small UI affordances once. */
  function attachUiHandlers(){
    const tg = document.getElementById('btn-comms-toggle');
    if (tg) tg.addEventListener('click', () => document.getElementById('comms-panel').classList.toggle('open'));
    const sb = document.getElementById('btn-scores');
    if (sb) sb.addEventListener('click', showScoreboardModal);
  }

  R.ui = {
    renderAll, renderHeader, renderSeats, renderHumanHand, renderCenter,
    renderCardEl, renderCardBackEl,
    askButtons, askCards, askInfo, closeModal, showInfoBanner,
    logSystem, logChat, say, showBubble, escapeHtml,
    getHumanCard, setCenterMsg,
    showScoreboardModal, showScoringModal, showFinalResults,
    cardSort, attachUiHandlers
  };
})();
