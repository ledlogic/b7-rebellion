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
    const tagText = player.isHuman ? 'YOU' : player.persona.tag;
    const tooltip = player.isHuman ? 'You' : (player.persona.name + ' — ' + player.persona.role);
    div.innerHTML = '<span class="tag" title="' + escapeAttr(tooltip) + '" style="background:' + c + '22;color:' + c + ';border:1px solid ' + c + '55;cursor:help;">' +
                    tagText + '</span>' + escapeHtml(text);
    feed.appendChild(div);
    feed.scrollTop = feed.scrollHeight;
  }
  function escapeHtml(s){ const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function escapeAttr(s){ return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  /* Pause flow until the user clicks a Continue button. The button is
     absolutely-positioned at the bottom of the center area so it doesn't
     push the trick cards around — they stay where they are, fully visible,
     until the user advances. */
  function awaitContinue(label){
    label = label || 'Continue';
    return new Promise(resolve => {
      const centerArea = document.getElementById('center-area');
      if (!centerArea){ resolve(); return; }
      const existing = centerArea.querySelector('.continue-prompt');
      if (existing) existing.remove();
      const wrap = document.createElement('div'); wrap.className = 'continue-prompt';
      const btn = document.createElement('button'); btn.className = 'primary';
      btn.textContent = label;
      wrap.appendChild(btn);
      centerArea.appendChild(wrap);
      btn.addEventListener('click', () => { wrap.remove(); resolve(); }, { once:true });
    });
  }

  function formatTime(d){
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return hh + ':' + mm + ':' + ss;
  }

  /* Animate played cards flying up to the winner's name. Cards translate
     toward the destination, shrink, and fade. Sibling labels (who, timestamp)
     fade in place so the slot is visually emptied by the end. After the
     animation completes, the caller is expected to clear M.currentTrick so
     the next render doesn't restore the cards we just animated away. */
  async function animateTrickCapture(winnerIdx){
    if (winnerIdx === 'ANDROMEDAN') return;
    const trickSlots = document.getElementById('trick-slots');
    if (!trickSlots) return;

    let targetEl;
    if (winnerIdx === 0){
      targetEl = document.querySelector('#human-name');
    } else {
      const seat = document.querySelector('.seat[data-idx="' + winnerIdx + '"]');
      targetEl = seat && seat.querySelector('.name');
    }
    if (!targetEl) return;

    const targetRect = targetEl.getBoundingClientRect();
    // jsdom returns zero rects (no layout). Skip animation in that case.
    if (targetRect.width === 0 && targetRect.height === 0) return;
    const targetCx = targetRect.left + targetRect.width/2;
    const targetCy = targetRect.top + targetRect.height/2;

    const slots = [...trickSlots.querySelectorAll('.trick-slot')];
    for (const slot of slots){
      const cardEl = slot.querySelector('.card');
      if (cardEl){
        const r = cardEl.getBoundingClientRect();
        const dx = targetCx - (r.left + r.width/2);
        const dy = targetCy - (r.top + r.height/2);
        cardEl.style.transition = 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.6s ease-in';
        cardEl.style.transform  = 'translate(' + dx + 'px, ' + dy + 'px) scale(0.18)';
        cardEl.style.opacity    = '0';
      }
      const fadeEls = [slot.querySelector('.who'), slot.querySelector('.play-timestamp')];
      for (const el of fadeEls){
        if (el){
          el.style.transition = 'opacity 0.4s ease-out';
          el.style.opacity = '0';
        }
      }
    }
    await E.sleep(620);
  }

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

  /* Two-list card picker. Shows two card sections with their own labels in
     one modal — used by Teleport Bracelet to merge what was a sequential
     hand-then-pile choice into a single dialog. Resolves with
     [leftPick, rightPick] when both selected and confirmed, or [] on skip. */
  function askPairOfCards(title, sub, leftSection, rightSection, opts){
    ensureModalRefs();
    opts = opts || {};
    const allowSkip = opts.allowSkip !== false;
    const skipLabel = opts.skipLabel || 'Skip';
    const confirmLabel = opts.confirmLabel || 'Confirm';
    return new Promise(resolve => {
      modalBox.innerHTML = '';
      const h = document.createElement('h3'); h.textContent = title; modalBox.appendChild(h);
      if (sub){ const p = document.createElement('div'); p.className = 'sub'; p.textContent = sub; modalBox.appendChild(p); }
      let leftPick = null, rightPick = null;
      let confirmBtn;
      function refreshConfirm(){ if (confirmBtn) confirmBtn.disabled = !(leftPick && rightPick); }
      function buildSection(section, setPick){
        const sectionWrap = document.createElement('div');
        sectionWrap.style.marginBottom = '14px';
        const label = document.createElement('div');
        label.style.fontSize = '11px';
        label.style.textTransform = 'uppercase';
        label.style.letterSpacing = '0.12em';
        label.style.color = 'var(--muted)';
        label.style.marginBottom = '8px';
        label.textContent = section.label;
        sectionWrap.appendChild(label);
        const optsWrap = document.createElement('div'); optsWrap.className = 'modal-options';
        section.cards.forEach(c => {
          const wrap = document.createElement('div'); wrap.className = 'modal-card-opt';
          wrap.appendChild(renderCardEl(c, true));
          const lbl = document.createElement('div'); lbl.className = 'lbl';
          lbl.textContent = E.cardName(c) + ' (' + (E.basePoints(c) >= 0 ? '+' : '') + E.basePoints(c) + ')';
          wrap.appendChild(lbl);
          wrap.addEventListener('click', () => {
            [...optsWrap.children].forEach(ch => ch.classList.remove('selected'));
            wrap.classList.add('selected');
            setPick(c);
            refreshConfirm();
          });
          optsWrap.appendChild(wrap);
        });
        sectionWrap.appendChild(optsWrap);
        modalBox.appendChild(sectionWrap);
      }
      buildSection(leftSection,  c => { leftPick  = c; });
      buildSection(rightSection, c => { rightPick = c; });
      const foot = document.createElement('div'); foot.className = 'modal-foot';
      if (allowSkip){
        const skipBtn = document.createElement('button'); skipBtn.textContent = skipLabel;
        skipBtn.addEventListener('click', () => { closeModal(); resolve([]); });
        foot.appendChild(skipBtn);
      }
      confirmBtn = document.createElement('button'); confirmBtn.className = 'primary';
      confirmBtn.textContent = confirmLabel;
      confirmBtn.disabled = true;
      confirmBtn.addEventListener('click', () => { closeModal(); resolve([leftPick, rightPick]); });
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
    const statsEl = document.getElementById('human-stats');
    statsEl.innerHTML = '';
    statsEl.appendChild(document.createTextNode('HAND: ' + human.hand.length + ' · PILE: '));
    if (human.pile.length > 0){
      const link = document.createElement('span');
      link.className = 'pile-link';
      link.textContent = human.pile.length;
      link.title = 'Click to review your capture pile';
      link.addEventListener('click', showHumanPileModal);
      statsEl.appendChild(link);
    } else {
      statsEl.appendChild(document.createTextNode('0'));
    }
    statsEl.appendChild(document.createTextNode(' · TOTAL: ' + G.totals[0]));
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
    const stack = document.getElementById('reserve-stack');
    if (stack){
      stack.innerHTML = '';
      for (let i = 0; i < M.reserve.length; i++){
        const mini = document.createElement('div');
        mini.className = 'card-mini';
        mini.title = 'Reserve card (face-down)';
        stack.appendChild(mini);
      }
    }
    document.getElementById('invasion-banner').classList.toggle('hidden', !M.invasionActive);
    document.getElementById('led-suit-tag').textContent = M.ledSuit
      ? ('Led suit: ' + E.SUIT_SYMBOL[M.ledSuit] + ' ' + E.SUIT_FACTION[M.ledSuit]) : '';
    const slots = document.getElementById('trick-slots');
    slots.innerHTML = '';
    for (const play of M.currentTrick){
      const slot = document.createElement('div'); slot.className = 'trick-slot';
      const who = document.createElement('div'); who.className = 'who';
      if (play.who === 'ANDROMEDAN'){
        who.textContent = 'ANDROMEDAN';
        who.style.background = 'var(--spade)';
        who.style.color = '#000';
      } else {
        const player = G.players[play.playerIdx];
        who.textContent = player.name;
        who.style.background = player.color;
        who.style.color = '#000';
      }
      slot.appendChild(who);
      slot.appendChild(renderCardEl(play.card, false));
      if (play.timestamp){
        const ts = document.createElement('div'); ts.className = 'play-timestamp';
        ts.textContent = formatTime(play.timestamp);
        slot.appendChild(ts);
      }
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
  /* Show the human player's capture pile in a read-only dialog. Sorts by
     suit so the contents are easy to scan. Cancelled cards (Orac) are dimmed
     and tagged with strike-through value. Closes back to play. */
  function showHumanPileModal(){
    ensureModalRefs();
    const G = S.G;
    const human = G.players[0];
    const sorted = human.pile.slice().sort(cardSort);
    const livePts = human.pile.reduce((s, c) => s + ((c._cancelled || c._assassinated) ? 0 : E.basePoints(c)), 0);

    modalBox.innerHTML = '';
    const h = document.createElement('h3'); h.textContent = 'Your Capture Pile'; modalBox.appendChild(h);
    const sub = document.createElement('div'); sub.className = 'sub';
    const cancelledCount = human.pile.filter(c => c._cancelled || c._assassinated).length;
    sub.textContent = human.pile.length + ' card' + (human.pile.length === 1 ? '' : 's') +
                      ' captured · current value ' + (livePts >= 0 ? '+' : '') + livePts +
                      (cancelledCount > 0 ? ' (' + cancelledCount + ' nullified)' : '');
    modalBox.appendChild(sub);

    if (sorted.length){
      const optsWrap = document.createElement('div'); optsWrap.className = 'modal-options';
      sorted.forEach(c => {
        const wrap = document.createElement('div'); wrap.className = 'modal-card-opt';
        const cardEl = renderCardEl(c, false);
        if (c._cancelled || c._assassinated) cardEl.classList.add('disabled');
        wrap.appendChild(cardEl);
        const lbl = document.createElement('div'); lbl.className = 'lbl';
        const valTxt = (E.basePoints(c) >= 0 ? '+' : '') + E.basePoints(c);
        lbl.innerHTML = E.cardName(c) + '<br>' +
          ((c._cancelled || c._assassinated)
            ? '<span style="text-decoration:line-through;opacity:0.6;">' + valTxt + '</span>'
            : valTxt);
        wrap.appendChild(lbl);
        optsWrap.appendChild(wrap);
      });
      modalBox.appendChild(optsWrap);
    }

    const foot = document.createElement('div'); foot.className = 'modal-foot';
    const okBtn = document.createElement('button'); okBtn.className = 'primary'; okBtn.textContent = 'Back to Play';
    okBtn.addEventListener('click', closeModal);
    foot.appendChild(okBtn);
    modalBox.appendChild(foot);
    modalRoot.classList.add('open');
  }

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
    askButtons, askCards, askPairOfCards, askInfo, closeModal, showInfoBanner,
    logSystem, logChat, say, showBubble, escapeHtml,
    getHumanCard, setCenterMsg,
    showScoreboardModal, showScoringModal, showFinalResults, showHumanPileModal,
    cardSort, attachUiHandlers, animateTrickCapture, formatTime, awaitContinue
  };
})();
