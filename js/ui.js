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
  const C = R.card;
  const E = R.engine;
  const S = R.state;

  /* ============================================================ Card rendering ============================================================ */

  /** Look up the AI-tier symbol for a player ('Δ', 'Γ', 'Β', etc.) by reading
   *  the first character of the registered AI label. Returns empty string for
   *  humans or unregistered tiers. Used to prefix AI ranks on the table so the
   *  player can tell which opponent is at which tier when mixing them. */
  function tierGlyph(player){
    if (!player || player.isHuman || !player.difficulty) return '';
    const ai = R.ai && R.ai.get(player.difficulty);
    if (!ai || !ai.label) return '';
    /* Labels are formatted as "Δ Delta — Conscript" — first char is the glyph. */
    const first = ai.label.charAt(0);
    return /[A-Za-z0-9]/.test(first) ? '' : first;
  }

  function renderCardEl(card, clickable, tiny){
    const el = document.createElement('div');
    el.className = 'card suit-' + card.suit + (clickable ? ' clickable' : '') + (tiny ? ' tiny' : '');
    el.dataset.id = card.id;
    const sym = C.SUIT_SYMBOL[card.suit];
    el.innerHTML = '<div class="rank-top">' + (C.isJoker(card) ? '★' : card.rank) + (C.isJoker(card) ? '' : sym) + '</div>' +
                   '<div class="suit-mid">' + (C.isJoker(card) ? '★' : sym) + '</div>' +
                   '<div class="rank-bot">' + (C.isJoker(card) ? '★' : card.rank) + (C.isJoker(card) ? '' : sym) + '</div>';
    el.title = C.cardName(card) + ' (' + (C.basePoints(card) >= 0 ? '+' : '') + C.basePoints(card) + ')';
    return el;
  }
  function renderCardBackEl(tiny){
    const el = document.createElement('div');
    el.className = 'card-back' + (tiny ? ' tiny' : '');
    return el;
  }

  /* ============================================================ Logging ============================================================ */
  /** Push a structured comms entry into G.commsLog so the export can replay
   *  the conversation without DOM-scraping. Safe to call before G exists. */
  function recordComms(type, text, speaker){
    try {
      const G = R.state && R.state.G;
      if (!G) return;
      if (!G.commsLog) G.commsLog = [];
      const M = R.state.M;
      G.commsLog.push({
        type,
        text,
        speaker: speaker || null,
        missionIndex: G.missionIndex,
        trickNumber: M ? M.trickNumber : null,
        ts: new Date().toISOString()
      });
    } catch (e){ /* never throw out of a logger */ }
  }

  function logSystem(text){
    const feed = document.getElementById('comms-feed');
    if (feed){
      const div = document.createElement('div');
      div.className = 'log-line system';
      div.innerHTML = '<span class="marker">▸</span> ' + text;
      feed.appendChild(div);
      feed.scrollTop = feed.scrollHeight;
    }
    recordComms('system', text, null);
  }

  /** Log an Andromedan invasion event in green. */
  function logAndromedan(text){
    const feed = document.getElementById('comms-feed');
    if (feed){
      const div = document.createElement('div');
      div.className = 'log-line andromedan';
      div.innerHTML = '<span class="marker">▸</span> ' + text;
      feed.appendChild(div);
      feed.scrollTop = feed.scrollHeight;
    }
    recordComms('andromedan', text, null);
  }
  function logChat(player, text){
    const feed = document.getElementById('comms-feed');
    if (feed){
      const div = document.createElement('div');
      div.className = 'log-line';
      const c = player.color;
      const tagText = player.isHuman ? 'YOU' : player.persona.tag;
      const glyph   = player.isHuman ? '' : tierGlyph(player);
      const tooltip = player.isHuman ? 'You'
                    : (player.persona.name + ' — ' + (glyph ? glyph + ' ' : '') + player.persona.role);
      div.innerHTML = '<span class="tag" title="' + escapeAttr(tooltip) + '" style="background:' + c + '22;color:' + c + ';border:1px solid ' + c + '55;cursor:help;">' +
                      tagText + '</span>' + escapeHtml(text);
      feed.appendChild(div);
      feed.scrollTop = feed.scrollHeight;
    }
    recordComms('chat', text, player.isHuman ? 'YOU' : (player.persona ? player.persona.name : player.name));
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

  /* Lift the winner's seat (or human-area) 20px so it's visually marked.
     Returns the element so the caller can pass it back to clearWinnerElevation. */
  function elevateWinnerSeat(winnerIdx){
    if (winnerIdx === 'ANDROMEDAN') return null;
    const el = (winnerIdx === 0)
      ? document.querySelector('.human-area')
      : document.querySelector('.seat[data-idx="' + winnerIdx + '"]');
    if (el) el.classList.add('winning-seat');
    return el;
  }
  function clearWinnerElevation(el){
    if (el) el.classList.remove('winning-seat');
  }

  /* Big centered score readout. Fires concurrently with animateTrickCapture
     so the score fades out as the cards arrive at the winner. */
  function showWinScoreFlash(score, hasPower){
    const centerArea = document.getElementById('center-area');
    if (!centerArea) return;
    const cls = score > 0 ? 'pos' : (score < 0 ? 'neg' : 'zero');
    const el = document.createElement('div');
    el.className = 'win-score ' + cls;
    el.textContent = (score >= 0 ? '+' : '') + score + (hasPower ? '*' : '');
    centerArea.appendChild(el);
    /* Two rAFs so the initial state is painted before the transition class
       is added — otherwise the browser may collapse to the final state. */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { el.classList.add('fade-out'); });
    });
    setTimeout(() => { if (el.parentNode) el.remove(); }, 720);
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
    /* Optional per-card prefix labels (e.g. "Korben's pile") rendered above
       each card chip. Used by Orac to disambiguate which pile a card sits in. */
    const ownerLabels = Array.isArray(opts.ownerLabels) ? opts.ownerLabels : null;
    return new Promise(resolve => {
      modalBox.innerHTML = '';
      const h = document.createElement('h3'); h.textContent = title; modalBox.appendChild(h);
      if (sub){ const p = document.createElement('div'); p.className = 'sub'; p.textContent = sub; modalBox.appendChild(p); }
      const optsWrap = document.createElement('div'); optsWrap.className = 'modal-options';
      const selected = new Set();
      cards.forEach((c, i) => {
        const wrap = document.createElement('div'); wrap.className = 'modal-card-opt';
        if (ownerLabels && ownerLabels[i]){
          const ol = document.createElement('div'); ol.className = 'owner-lbl';
          const entry = ownerLabels[i];
          if (typeof entry === 'object' && entry !== null){
            ol.textContent = entry.text || '';
            if (entry.own) ol.classList.add('own');
          } else {
            ol.textContent = String(entry);
          }
          wrap.appendChild(ol);
        }
        wrap.appendChild(renderCardEl(c, true));
        const lbl = document.createElement('div'); lbl.className = 'lbl';
        lbl.textContent = C.cardName(c) + ' (' + (C.basePoints(c) >= 0 ? '+' : '') + C.basePoints(c) + ')';
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
          lbl.textContent = C.cardName(c) + ' (' + (C.basePoints(c) >= 0 ? '+' : '') + C.basePoints(c) + ')';
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
          const lbl = document.createElement('div'); lbl.className = 'lbl'; lbl.textContent = C.cardName(c);
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
    /* Header AI tag: if G.difficulty matches a single registered tier,
       show its label (e.g. "Γ Gamma"); otherwise it's a mix string like
       "Δ2 Γ2 Β2" — show it verbatim. */
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
      const glyph = tierGlyph(p);
      const roleText = glyph ? (glyph + ' ' + p.persona.role) : p.persona.role;
      nameWrap.innerHTML = '<div class="name">' + p.name + '</div><div class="role">' + roleText + '</div>';
      head.appendChild(nameWrap);
      seat.appendChild(head);
      const stats = document.createElement('div'); stats.className = 'stats';
      stats.innerHTML = '<span>HAND <b>' + p.hand.length + '</b></span><span>CAPTURED <b>' + p.pile.length + '</b></span><span>TOTAL <b>' + G.totals[p.idx] + '</b></span>';
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
    return C.rankValue(a.rank || '2') - C.rankValue(b.rank || '2');
  }
  function renderHumanHand(){
    const G = S.G, M = S.M;
    const human = G.players[0];

    /* Hand-exposed indicator. Servalan's effect (revealHand power) sets
       human.exposed = true for the rest of the mission. We toggle a
       dedicated full-width banner element so it's unmissable. */
    const banner = document.getElementById('human-exposed-banner');
    if (banner){
      if (human.exposed) banner.removeAttribute('hidden');
      else               banner.setAttribute('hidden', '');
    }

    const statsEl = document.getElementById('human-stats');
    statsEl.innerHTML = '';
    statsEl.appendChild(document.createTextNode('HAND: ' + human.hand.length + ' · CAPTURED: '));
    if (human.pile.length > 0){
      const link = document.createElement('span');
      link.className = 'pile-link';
      link.textContent = human.pile.length;
      link.title = 'Click to review your captured cards';
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
      ? ('Led suit: ' + C.SUIT_SYMBOL[M.ledSuit] + ' ' + C.SUIT_FACTION[M.ledSuit]) : '';
    const slots = document.getElementById('trick-slots');
    slots.innerHTML = '';
    for (const play of M.currentTrick){
      const slot = document.createElement('div'); slot.className = 'trick-slot';
      const who = document.createElement('div'); who.className = 'who player-chip';
      if (play.who === 'ANDROMEDAN'){
        who.textContent = 'ANDROMEDAN';
        who.style.background = 'var(--andromedan)';
        who.style.color = '#000';
        who.style.textShadow = 'none';
        who.style.boxShadow = '0 0 8px var(--andromedan)';
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
  function setCenterMsgHTML(html){ document.getElementById('center-msg').innerHTML = html; }

  /* Build a colored player-chip HTML span for inline use in center messages.
     Pass a player object, or the string 'ANDROMEDAN' for the invader. */
  function playerChip(playerOrSpecial){
    if (playerOrSpecial === 'ANDROMEDAN'){
      return '<span class="player-chip" style="background:var(--andromedan);color:#000;box-shadow:0 0 8px var(--andromedan);">ANDROMEDAN</span>';
    }
    const p = playerOrSpecial;
    return '<span class="player-chip" style="background:' + escapeAttr(p.color) + ';color:#000;">' +
           escapeHtml(p.name) + '</span>';
  }

  /* ============================================================ Human card bridge ============================================================ */
  function getHumanCard(legal){
    const M = S.M;
    return new Promise(resolve => {
      M.awaitingHumanCard = true;
      M._humanResolve = (card) => {
        setCenterMsg('');   // wipe any "Your move" / "respond to wave" prompt immediately
        resolve(card);
      };
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
    const livePts = human.pile.reduce((s, c) => s + ((c._cancelled || c._assassinated) ? 0 : C.basePoints(c)), 0);

    modalBox.innerHTML = '';
    const h = document.createElement('h3'); h.textContent = 'Your Captured Cards'; modalBox.appendChild(h);
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
        const valTxt = (C.basePoints(c) >= 0 ? '+' : '') + C.basePoints(c);
        lbl.innerHTML = C.cardName(c) + '<br>' +
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
    const h = document.createElement('h3');
    h.textContent = 'Current Game' + (G.systemName ? ' — ' + G.systemName : '');
    modalBox.appendChild(h);
    const sub = document.createElement('div'); sub.className = 'sub';
    sub.textContent = 'Running totals after ' + G.missionIndex + ' of ' + G.numPlayers + ' Missions';
    modalBox.appendChild(sub);
    const table = document.createElement('table'); table.className = 'score-table';
    table.innerHTML = '<tr><th>Player</th><th>Total</th></tr>' +
      G.players.slice().sort((a, b) => G.totals[b.idx] - G.totals[a.idx]).map(p => {
        const glyph = tierGlyph(p);
        const roleText = p.isHuman ? '' :
          ' <span style="color:var(--muted);font-size:11px;">(' + (glyph ? glyph + ' ' : '') + p.persona.role + ')</span>';
        return '<tr><td>' + p.name + roleText +
               '</td><td class="num ' + (G.totals[p.idx] >= 0 ? 'pos' : 'neg') + '">' + G.totals[p.idx] + '</td></tr>';
      }).join('');
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
    let rows = '<tr><th>Player</th><th>Captured</th><th>This Mission</th><th>Total</th></tr>';
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
        const hb = document.createElement('button'); hb.textContent = 'View Score History';
        hb.addEventListener('click', showHistoryModal);
        foot.appendChild(hb);
        const eb = document.createElement('button'); eb.textContent = '⇩ Export Game Log';
        eb.title = 'Download a complete JSON record of this game for later analysis. This is your last chance — starting a new game wipes the in-memory state.';
        eb.addEventListener('click', downloadGameLog);
        foot.appendChild(eb);
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
    const ex = document.getElementById('btn-export-log');
    if (ex) ex.addEventListener('click', downloadGameLog);
  }

  /* ============================================================ Score history (localStorage) ============================================================
     Persists every completed game as a row in localStorage under a single
     key. Capped at 100 entries (FIFO). All access wrapped in try/catch so a
     disabled/blocked localStorage (private browsing, locked-down browsers)
     degrades silently — the game still plays, the history just doesn't
     remember anything. */
  const HISTORY_KEY = 'rebellion.scoreHistory.v1';
  const HISTORY_MAX = 100;

  /**
   * Load saved history rows, most-recent first.
   * @returns {Object[]}
   */
  /* ============================================================
   * Game-log export — structured JSON, downloadable as a file.
   * ============================================================ */

  /** Format Date as YYYYMMDD-HHMMSS (local time). Used in export filenames so
   *  multiple exports on the same day don't collide on disk. */
  function formatTimestamp(d){
    const y  = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return '' + y + mo + da + '-' + hh + mm + ss;
  }

  /** Read the build-version label from the DOM (single source of truth). */
  function readBuildVersion(){
    const el = document.querySelector('.version');
    if (!el) return null;
    const m = (el.textContent || '').match(/VERSION\s+([\d.]+)/i);
    return m ? m[1] : null;
  }

  /** Plain serializable card representation. */
  function serializeCard(c){
    if (!c) return null;
    return {
      suit: c.suit,
      rank: c.rank,
      id:   c.id,
      label: R.card ? R.card.cardLabel(c) : (c.rank + (c.suit || '')),
      name:  R.card ? R.card.cardName(c)  : null,
      points: R.card ? R.card.basePoints(c) : null
    };
  }

  /** Serialize a play (one card put into a trick) for export. */
  function serializePlay(play){
    return {
      playerIdx: play.playerIdx,
      who:       play.who,
      card:      serializeCard(play.card),
      ts:        play.timestamp ? play.timestamp.toISOString() : null
    };
  }

  /** Serialize a completed trick. Called from flow.js when a trick closes. */
  function serializeTrick(trick, ledSuit, winnerIdx, isInvasion){
    return {
      type:      isInvasion ? 'invasion' : 'normal',
      ledSuit:   ledSuit || null,
      plays:     trick.map(serializePlay),
      winnerIdx: winnerIdx,
      capturedCards: trick.map(p => serializeCard(p.card))
    };
  }

  /**
   * Build the full game-log object for export. Safe to call at any point
   * during the game — incomplete missions are flagged `inProgress: true`.
   * @returns {Object} the serializable export object.
   */
  function buildGameLogJson(){
    const G = R.state ? R.state.G : null;
    const M = R.state ? R.state.M : null;
    const now = new Date();

    const exportObj = {
      schema: 'b7-rebellion-game-log',
      schemaVersion: 1,
      exportedAt: now.toISOString(),
      exportedAtLocal: now.toString(),
      buildVersion: readBuildVersion(),
      game: null,
      missions: [],
      currentMission: null,
      commsLog: []
    };

    if (!G){
      exportObj.note = 'No active game state at export time.';
      return exportObj;
    }

    /* High-level game info */
    exportObj.game = {
      startedAt:     G.gameStartedAt ? new Date(G.gameStartedAt).toISOString() : null,
      durationMs:    G.gameStartedAt ? (Date.now() - G.gameStartedAt) : null,
      numPlayers:    G.numPlayers,
      totalMissions: G.numPlayers,
      missionIndex:  G.missionIndex,
      difficulty:    G.difficulty,
      systemName:    G.systemName || null,
      startDealer:   G.startDealer,
      totals:        Array.isArray(G.totals) ? G.totals.slice() : [],
      players: (G.players || []).map(p => ({
        idx:         p.idx,
        name:        p.name,
        isHuman:     p.isHuman,
        color:       p.color,
        aiLevel:     p.isHuman ? null : (p.difficulty || null),
        personaTag:  p.persona ? p.persona.tag  : null,
        personaName: p.persona ? p.persona.name : null,
        personaRole: p.persona ? p.persona.role : null
      }))
    };

    /* Completed missions */
    exportObj.missions = Array.isArray(G.missionLog) ? G.missionLog.slice() : [];

    /* Current mission (if mid-game) */
    if (M && !M.missionOver){
      exportObj.currentMission = {
        missionIndex:    G.missionIndex,
        dealerIdx:       M.dealerIdx,
        reserveSize:     Array.isArray(M.reserve) ? M.reserve.length : 0,
        invasionActive:  M.invasionActive,
        fullCrewClaimed: M.fullCrewClaimed,
        starOneBattleOccurred: !!M.starOneBattleOccurred,
        tricksSoFar:     Array.isArray(M.tricks) ? M.tricks.slice() : [],
        currentTrick:    Array.isArray(M.currentTrick) ? M.currentTrick.map(serializePlay) : [],
        ledSuit:         M.ledSuit || null,
        handsRemaining:  (G.players || []).map(p => p.hand.length),
        pilesSoFar:      (G.players || []).map(p => p.pile.map(serializeCard))
      };
    }

    /* Comms transcript */
    exportObj.commsLog = Array.isArray(G.commsLog) ? G.commsLog.slice() : [];

    return exportObj;
  }

  /**
   * Trigger a browser download of the current game log as a JSON file.
   * Filename: b7-rebellion-YYYYMMDD.json (per the user's spec).
   * Uses Blob + temporary <a download> click — standard pattern that
   * works in all modern browsers including iOS Safari.
   */
  function downloadGameLog(){
    const data = buildGameLogJson();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const filename = 'b7-rebellion-' + formatTimestamp(new Date()) + '.json';

    const a = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);

    logSystem('💾 Game log exported to <code>' + escapeHtml(filename) + '</code> (' +
              (Math.round(json.length / 1024)) + ' KB).');
    return filename;
  }


  function loadGameHistory(){
    try {
      const raw = window.localStorage && localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch (e){ return []; }
  }

  /**
   * Persist a completed-game entry. New entries push to the front; the list
   * is capped to HISTORY_MAX rows.
   * @param {Object} entry
   */
  function saveGameToHistory(entry){
    try {
      if (!window.localStorage) return;
      const list = loadGameHistory();
      list.unshift(entry);
      while (list.length > HISTORY_MAX) list.pop();
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    } catch (e){ /* quota or disabled storage — silent */ }
  }

  /**
   * Erase all saved history. No confirmation here — the caller is expected
   * to confirm with the user first.
   */
  function clearGameHistory(){
    try { if (window.localStorage) localStorage.removeItem(HISTORY_KEY); } catch (e){}
  }

  /**
   * Render the saved history into the modal as a scrollable list of cards.
   * Each row shows date, player count, AI level, duration, full leaderboard
   * (highlighting the winner and the human), and a "Replay this matchup"
   * note. Closes back to wherever the modal was invoked from.
   */
  function showHistoryModal(){
    ensureModalRefs();
    const list = loadGameHistory();
    modalBox.innerHTML = '';
    const h = document.createElement('h3'); h.textContent = 'Score History'; modalBox.appendChild(h);
    const sub = document.createElement('div'); sub.className = 'sub';
    sub.textContent = list.length
      ? (list.length + ' saved game' + (list.length===1?'':'s') + ' (most recent first, up to ' + HISTORY_MAX + ' kept)')
      : 'No completed games saved yet. Play one through to start tracking.';
    modalBox.appendChild(sub);

    if (list.length){
      const wrap = document.createElement('div'); wrap.className = 'history-list';
      list.forEach(e => wrap.appendChild(renderHistoryEntry(e)));
      modalBox.appendChild(wrap);
    }

    const foot = document.createElement('div'); foot.className = 'modal-foot';
    if (list.length){
      const clearBtn = document.createElement('button'); clearBtn.className = 'danger'; clearBtn.textContent = 'Clear History';
      clearBtn.addEventListener('click', () => {
        if (confirm('Erase all ' + list.length + ' saved games? This cannot be undone.')){
          clearGameHistory();
          showHistoryModal();      // re-render empty
        }
      });
      foot.appendChild(clearBtn);
    }
    const okBtn = document.createElement('button'); okBtn.className = 'primary'; okBtn.textContent = 'Close';
    okBtn.addEventListener('click', closeModal);
    foot.appendChild(okBtn);
    modalBox.appendChild(foot);
    modalRoot.classList.add('open');
  }

  /* Render one history row as a self-contained card element. */
  function renderHistoryEntry(e){
    const card = document.createElement('div'); card.className = 'history-row';

    const head = document.createElement('div'); head.className = 'h-head';
    const when = new Date(e.endedAt);
    const whenStr = when.toLocaleString(undefined, {
      year:'numeric', month:'short', day:'numeric',
      hour:'2-digit', minute:'2-digit'
    });
    const durStr = e.durationMs != null ? fmtElapsed(e.durationMs) : '—';
    /* System name leads the row when present (added in 2.26); falls back to
       just the date+time for pre-2.26 history entries. */
    const systemBit = e.systemName ? '<span class="h-system">' + escapeHtml(e.systemName) + '</span> · ' : '';
    head.innerHTML =
      '<span class="h-when">' + systemBit + escapeHtml(whenStr) + '</span>' +
      '<span class="h-meta">' + e.numPlayers + 'p · ' + escapeHtml(e.difficulty || '?') + ' · ' + durStr + '</span>';
    card.appendChild(head);

    // Sort players by total descending
    const sorted = e.players.slice().sort((a, b) => b.total - a.total);
    const table = document.createElement('table'); table.className = 'history-table';
    let rows = '';
    sorted.forEach((p, rank) => {
      const isWinner = p.idx === e.winner.idx;
      const cls = (isWinner ? ' is-winner' : '') + (p.isHuman ? ' is-human' : '');
      const chip = '<span class="h-chip" style="background:' + escapeHtml(p.color || '#888') + '">' +
                   escapeHtml(p.personaTag || (p.isHuman ? 'YOU' : '??')) + '</span>';
      rows += '<tr class="' + cls.trim() + '">' +
              '<td class="h-rank">' + (rank+1) + '</td>' +
              '<td class="h-name">' + chip + ' ' + escapeHtml(p.name) +
                (isWinner ? ' <span class="h-tag">★ winner</span>' : '') +
                (p.isHuman && !isWinner ? ' <span class="h-tag h-tag-you">you</span>' : '') +
              '</td>' +
              '<td class="h-total num ' + (p.total >= 0 ? 'pos' : 'neg') + '">' + p.total + '</td>' +
              '</tr>';
    });
    table.innerHTML = rows;
    card.appendChild(table);
    return card;
  }

  /* ============================================================ Timers ============================================================ */
  /* GAME timer: counts from G.gameStartedAt (stamped at the top of the first
     runMission). MISSION timer: counts from M.startedAt (stamped each time
     initMissionState builds a new M). Both update once a second from a single
     setInterval. We never stop it — the page lifetime is the game lifetime. */
  let timerHandle = null;
  function fmtElapsed(ms){
    if (ms == null || ms < 0) return '--:--';
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? (h + ':' + pad(m) + ':' + pad(sec)) : (pad(m) + ':' + pad(sec));
  }
  function tickTimers(){
    const G = S.G, M = S.M, now = Date.now();
    const gEl = document.getElementById('t-game');
    const mEl = document.getElementById('t-mission');
    if (gEl) gEl.textContent = fmtElapsed(G && G.gameStartedAt ? (now - G.gameStartedAt) : null);
    if (mEl) mEl.textContent = fmtElapsed(M && M.startedAt    ? (now - M.startedAt)    : null);
  }
  function startTimers(){
    if (timerHandle != null) return;
    tickTimers();                          // immediate paint
    timerHandle = setInterval(tickTimers, 1000);
  }

  /* ============================================================ Layout diagnostics ============================================================
     Console-only. Logs the top/height/bottom of the play-area anchors so the
     user can see if anything drifts across tricks/missions. Call from flow.js
     at key beats. Also exposed on window for ad-hoc inspection from devtools.
     Format is a single console.debug line so right-click → "Copy object" gives
     a clean JSON blob to paste back. */
  function logLayoutMetrics(label){
    const anchors = {
      topbar:        '.topbar',
      opponentsRow:  '#opponents-row',
      centerArea:    '#center-area',
      reserveInd:    '#reserve-indicator',
      trickSlots:    '#trick-slots',
      centerMsg:     '#center-msg',
      humanArea:     '.human-area',
      humanHand:     '#human-hand',
      firstHandCard: '#human-hand .card:first-child',
      lastHandCard:  '#human-hand .card:last-child'
    };
    const data = { _at: new Date().toISOString().slice(11, 19) };
    for (const [k, sel] of Object.entries(anchors)){
      const el = document.querySelector(sel);
      if (!el){ data[k] = null; continue; }
      const r = el.getBoundingClientRect();
      data[k] = { top: +r.top.toFixed(1), h: +r.height.toFixed(1), bot: +r.bottom.toFixed(1) };
    }
    data._window  = { innerH: window.innerHeight, scrollY: window.scrollY };
    data._docBody = { scrollH: document.body.scrollHeight, offsetH: document.body.offsetHeight };
    console.debug('[layout] ' + label, data);
  }
  // Expose for ad-hoc devtools calls: __LAYOUT('any label')
  if (typeof window !== 'undefined') window.__LAYOUT = logLayoutMetrics;

  R.ui = {
    renderAll, renderHeader, renderSeats, renderHumanHand, renderCenter,
    renderCardEl, renderCardBackEl,
    askButtons, askCards, askPairOfCards, askInfo, closeModal, showInfoBanner,
    logSystem, logAndromedan, logChat, say, showBubble, escapeHtml,
    getHumanCard, setCenterMsg, setCenterMsgHTML, playerChip,
    showScoreboardModal, showScoringModal, showFinalResults, showHumanPileModal,
    cardSort, attachUiHandlers, animateTrickCapture, formatTime, awaitContinue,
    elevateWinnerSeat, clearWinnerElevation, showWinScoreFlash,
    startTimers, fmtElapsed, logLayoutMetrics,
    saveGameToHistory, loadGameHistory, clearGameHistory, showHistoryModal,
    buildGameLogJson, downloadGameLog, serializeTrick
  };
})();
