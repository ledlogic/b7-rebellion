/**
 * @file Rebellion game-log replay viewer.
 *
 * Loads a `b7-rebellion-YYYYMMDD.json` file (schema `b7-rebellion-game-log`
 * v1, produced by ui.js#buildGameLogJson) and lets the user step through
 * the game one trick at a time. Pure read-only — no game logic is executed,
 * no AI choices are made. This is a viewer over a serialized record.
 *
 * Architecture:
 *   - parseLog(jsonString) → validates + returns the parsed object
 *   - buildEventStream(log) → flattens missions into a linear array of
 *     `{type, ...}` events: game-start, mission-start, trick, mission-end,
 *     game-end. The stepper walks this array; each event has enough info
 *     to render a complete frame without back-references.
 *   - renderEvent(i) → updates the DOM for event index i.
 *
 * The viewer is intentionally self-contained: it depends only on
 * `Rebellion.card` (loaded via card.js) for card label/name/points
 * formatting. It does NOT load flow.js, powers.js, state.js, or any
 * AI module — those would pull in the game's state machine and we
 * don't want to risk accidentally mutating anything.
 */
(function () {
  'use strict';

  const C = window.Rebellion && window.Rebellion.card;
  if (!C){
    document.body.innerHTML = '<div style="padding:40px;color:#e5564f;font-family:monospace;">FATAL: Rebellion.card not loaded. Make sure js/card.js is included before js/replay.js.</div>';
    return;
  }

  /* ============================================================
   * State (one global because this is a single-page viewer)
   * ============================================================ */
  const state = {
    log:    null,        // the parsed JSON object
    events: [],          // flattened event stream
    cursor: 0,           // current event index
    autoplay: null,      // setInterval id when auto-playing
    speedMs: 1500        // delay between auto-advances
  };

  /* ============================================================
   * Loading: file picker, paste box, drag-and-drop
   * ============================================================ */
  document.getElementById('file-input').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => tryLoad(String(reader.result), 'file: ' + f.name);
    reader.onerror = () => showError('Could not read file: ' + (reader.error ? reader.error.message : 'unknown error'));
    reader.readAsText(f);
  });

  document.getElementById('btn-paste-load').addEventListener('click', () => {
    const t = document.getElementById('paste-input').value;
    if (!t || !t.trim()){ showError('Paste box is empty. Paste the contents of your game-log JSON file first.'); return; }
    tryLoad(t, 'pasted JSON');
  });

  document.getElementById('btn-load-new').addEventListener('click', () => {
    document.getElementById('replay-view').setAttribute('hidden', '');
    document.getElementById('loader-panel').removeAttribute('hidden');
    document.getElementById('paste-input').value = '';
    document.getElementById('file-input').value = '';
    stopAutoplay();
  });

  /* Drag-and-drop anywhere on the page */
  const dropOverlay = document.getElementById('drop-overlay');
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')){
      dragDepth++; dropOverlay.removeAttribute('hidden');
    }
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropOverlay.setAttribute('hidden', '');
  });
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.setAttribute('hidden', '');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => tryLoad(String(reader.result), 'drop: ' + f.name);
    reader.readAsText(f);
  });

  function tryLoad(jsonText, source){
    hideError();
    let parsed;
    try { parsed = JSON.parse(jsonText); }
    catch (e){ showError('Invalid JSON (' + source + '): ' + e.message); return; }

    const validation = validateLog(parsed);
    if (validation !== true){ showError('Invalid game log (' + source + '): ' + validation); return; }

    state.log = parsed;
    state.events = buildEventStream(parsed);
    state.cursor = 0;

    document.getElementById('loader-panel').setAttribute('hidden', '');
    document.getElementById('replay-view').removeAttribute('hidden');
    renderGameHeader();
    renderEvent();
    bindControls();
  }

  /** Validate that the parsed object looks like our schema. */
  function validateLog(obj){
    if (!obj || typeof obj !== 'object') return 'not an object';
    if (obj.schema !== 'b7-rebellion-game-log') return 'wrong schema (got: ' + obj.schema + ')';
    if (typeof obj.schemaVersion !== 'number') return 'missing schemaVersion';
    if (obj.schemaVersion > 1) return 'schema version ' + obj.schemaVersion + ' is newer than this viewer supports (max 1)';
    if (!obj.game) return 'missing `game` block';
    if (!Array.isArray(obj.game.players)) return 'missing `game.players`';
    if (!Array.isArray(obj.missions)) return 'missing `missions[]` (even an empty array is required)';
    return true;
  }

  function showError(msg){
    const el = document.getElementById('loader-error');
    el.textContent = msg;
    el.removeAttribute('hidden');
  }
  function hideError(){
    const el = document.getElementById('loader-error');
    el.textContent = '';
    el.setAttribute('hidden', '');
  }

  /* ============================================================
   * Event-stream flattening
   *
   * One linear array of frames. Each frame is self-contained — it
   * carries snapshots of running totals, capture piles, etc., so
   * navigation can jump to any index without replaying state.
   * ============================================================ */
  function buildEventStream(log){
    const events = [];
    const players = log.game.players;
    const n = players.length;
    const runningTotals = new Array(n).fill(0);
    const runningPiles  = players.map(() => []);  // accumulated cards per player

    events.push({
      type: 'game-start',
      label: 'GAME START — ' + (log.game.systemName || 'unknown system'),
      info: log.game,
      totals: runningTotals.slice(),
      piles:  runningPiles.map(p => p.slice())
    });

    /* Missions are completed; for in-progress games, currentMission carries
       tricksSoFar that we include as a final "in-progress" mission slot. */
    const allMissions = log.missions.slice();
    if (log.currentMission){
      allMissions.push({
        missionIndex: log.currentMission.missionIndex,
        systemName:   log.game.systemName || null,
        dealerIdx:    log.currentMission.dealerIdx,
        result:       'inProgress',
        starOneBattleOccurred: log.currentMission.starOneBattleOccurred,
        fullCrewClaimed:       log.currentMission.fullCrewClaimed,
        tricks:                log.currentMission.tricksSoFar || [],
        capturePiles:          (log.currentMission.pilesSoFar || []).map((cards, i) => ({
          playerIdx: i, name: players[i].name, cards
        })),
        missionScores: null,
        missionNotes:  [],
        totalsAfter:   log.game.totals.slice(),
        endedAt: null
      });
    }

    for (const mission of allMissions){
      events.push({
        type: 'mission-start',
        label: 'MISSION ' + (mission.missionIndex + 1) + ' BEGINS',
        missionIndex: mission.missionIndex,
        dealer: players[mission.dealerIdx] ? players[mission.dealerIdx].name : '?',
        system: mission.systemName || null,
        reserveSize: mission.tricks && mission.tricks.length > 0 ? null : null,
        totals: runningTotals.slice(),
        piles:  runningPiles.map(p => p.slice())
      });

      const tricks = mission.tricks || [];
      for (let t = 0; t < tricks.length; t++){
        const trick = tricks[t];
        /* Update per-player pile snapshots — the winner takes all cards in
           the trick. We do this AFTER pushing the event so the snapshot
           shows piles AS OF the end of this trick. */
        if (trick.winnerIdx !== 'ANDROMEDAN' && typeof trick.winnerIdx === 'number'){
          for (const play of trick.plays){
            runningPiles[trick.winnerIdx].push(play.card);
          }
        }
        events.push({
          type: 'trick',
          label: (trick.type === 'invasion' ? 'INVASION WAVE ' : 'TRICK ') + (t + 1),
          missionIndex: mission.missionIndex,
          trickIndex:   t,
          trickType:    trick.type,
          ledSuit:      trick.ledSuit,
          plays:        trick.plays,
          winnerIdx:    trick.winnerIdx,
          totals:       runningTotals.slice(),
          piles:        runningPiles.map(p => p.slice())
        });
      }

      /* Apply mission scoring to running totals */
      if (mission.missionScores && typeof mission.missionScores === 'object'){
        for (const k of Object.keys(mission.missionScores)){
          const idx = parseInt(k, 10);
          if (!Number.isNaN(idx) && idx >= 0 && idx < n) runningTotals[idx] += mission.missionScores[k];
        }
      } else if (Array.isArray(mission.totalsAfter)){
        /* Fallback: snap totals to what the log recorded */
        for (let i = 0; i < n; i++) runningTotals[i] = mission.totalsAfter[i];
      }

      events.push({
        type: 'mission-end',
        label: 'MISSION ' + (mission.missionIndex + 1) + ' ENDS' +
               (mission.result === 'starOne'    ? ' — STAR ONE CAPTURED' :
                mission.result === 'andromedan' ? ' — ANDROMEDAN BREAKTHROUGH' :
                mission.result === 'vilaBluff'  ? " — VILA'S GALACTIC BLUFF" :
                mission.result === 'inProgress' ? ' — (IN PROGRESS — game was exported mid-mission)' :
                ''),
        missionIndex: mission.missionIndex,
        result:       mission.result,
        scores:       mission.missionScores,
        notes:        mission.missionNotes || [],
        totals:       runningTotals.slice(),
        piles:        runningPiles.map(p => p.slice())
      });

      /* After a mission ends, captured piles reset for the next mission */
      for (let i = 0; i < n; i++) runningPiles[i] = [];
    }

    /* Winner */
    let winIdx = 0;
    for (let i = 1; i < n; i++) if (runningTotals[i] > runningTotals[winIdx]) winIdx = i;
    events.push({
      type: 'game-end',
      label: 'GAME COMPLETE — ' + (players[winIdx] ? players[winIdx].name : '?') + ' wins',
      winnerIdx: winIdx,
      totals: runningTotals.slice(),
      piles:  runningPiles.map(p => p.slice())
    });

    return events;
  }

  /* ============================================================
   * Rendering
   * ============================================================ */
  function renderGameHeader(){
    const G = state.log.game;
    const el = document.getElementById('replay-game-info');
    const date = G.startedAt ? new Date(G.startedAt).toLocaleString() : '(no start time)';
    const dur  = G.durationMs ? fmtDuration(G.durationMs) : '—';
    const sys  = G.systemName ? '<span class="system">' + esc(G.systemName) + '</span>' : '<span class="system">—</span>';
    el.innerHTML =
      '<span class="field">System:</span>' + sys +
      '<span class="field">Players: <b>' + G.numPlayers + '</b></span>' +
      '<span class="field">Difficulty: <b>' + esc(G.difficulty || '—') + '</b></span>' +
      '<span class="field">Date: <b>' + esc(date) + '</b></span>' +
      '<span class="field">Duration: <b>' + esc(dur) + '</b></span>' +
      '<span class="field">Build: <b>' + esc(state.log.buildVersion || '—') + '</b></span>';
  }

  function renderEvent(){
    if (state.cursor < 0) state.cursor = 0;
    if (state.cursor >= state.events.length) state.cursor = state.events.length - 1;
    const e = state.events[state.cursor];
    const players = state.log.game.players;

    /* Banner */
    const banner = document.getElementById('replay-event-banner');
    banner.className = 'replay-event-banner';
    if (e.type === 'mission-start') banner.classList.add('mission-start');
    else if (e.type === 'mission-end') banner.classList.add('mission-end');
    else if (e.type === 'game-end') banner.classList.add('game-end');
    else if (e.type === 'trick' && e.winnerIdx === 'ANDROMEDAN') banner.classList.add('andromedan');
    banner.textContent = e.label;

    /* Trick visualization */
    const trickEl = document.getElementById('replay-trick');
    trickEl.innerHTML = '';
    if (e.type === 'trick'){
      for (const play of e.plays){
        const slot = document.createElement('div'); slot.className = 'trick-slot';
        if ((e.winnerIdx === 'ANDROMEDAN' && play.who === 'ANDROMEDAN') ||
            (typeof e.winnerIdx === 'number' && play.playerIdx === e.winnerIdx)){
          slot.classList.add('winner');
        }
        const who = document.createElement('div'); who.className = 'trick-who';
        if (play.who === 'ANDROMEDAN'){
          who.classList.add('andromedan');
          who.textContent = 'ANDROMEDAN';
        } else {
          const p = players[play.playerIdx];
          who.textContent = p ? p.name : ('seat ' + play.playerIdx);
          if (p) who.style.background = p.color, who.style.color = '#000';
        }
        slot.appendChild(who);
        slot.appendChild(renderCard(play.card));
        trickEl.appendChild(slot);
      }
    }

    /* Trick meta line */
    const meta = document.getElementById('replay-trick-meta');
    if (e.type === 'trick'){
      const ledLabel = e.ledSuit ? suitGlyph(e.ledSuit) + ' led' : 'no led suit';
      const winnerLabel = (e.winnerIdx === 'ANDROMEDAN') ? 'ANDROMEDAN won the wave'
                       : (typeof e.winnerIdx === 'number' ? (players[e.winnerIdx] ? players[e.winnerIdx].name : 'seat ' + e.winnerIdx) + ' captures' : '');
      meta.innerHTML = '<b>' + esc(ledLabel) + '</b> · ' + esc(winnerLabel);
    } else if (e.type === 'mission-start'){
      meta.innerHTML = 'Dealer: <b>' + esc(e.dealer) + '</b>' + (e.system ? ' · System: <b>' + esc(e.system) + '</b>' : '');
    } else if (e.type === 'mission-end'){
      const noteLines = (e.notes || []).slice(0, 8).map(n => '· ' + esc(n)).join('<br>');
      meta.innerHTML = noteLines || '<i>(no scoring notes)</i>';
    } else if (e.type === 'game-end'){
      meta.innerHTML = 'Final totals shown to the right →';
    } else {
      meta.innerHTML = '';
    }

    /* Scoreboard (cumulative totals as of this event) */
    renderScoreboard(e.totals, e.type === 'game-end' ? e.winnerIdx : null);

    /* Capture piles snapshot */
    renderPiles(e.piles);

    /* Comms (filter to entries up to this event's logical position) */
    renderCommsUpTo(e);

    /* Position indicator + button states */
    const pos = (state.cursor + 1) + ' / ' + state.events.length;
    document.getElementById('replay-pos').textContent = pos;
    document.getElementById('btn-prev').disabled  = state.cursor <= 0;
    document.getElementById('btn-first').disabled = state.cursor <= 0;
    document.getElementById('btn-next').disabled  = state.cursor >= state.events.length - 1;
    document.getElementById('btn-last').disabled  = state.cursor >= state.events.length - 1;
  }

  function renderScoreboard(totals, winnerIdx){
    const players = state.log.game.players;
    const tbody = totals.map((t, i) => {
      const cls = t >= 0 ? 'pos' : 'neg';
      const mark = (winnerIdx === i) ? '<span class="leader-mark">👑</span> ' : '';
      return '<tr' + (winnerIdx === i ? ' class="leader"' : '') + '>' +
             '<td>' + mark + esc(players[i].name) + '</td>' +
             '<td class="score ' + cls + '">' + t + '</td></tr>';
    }).join('');
    document.getElementById('replay-scoreboard').innerHTML =
      '<h3>CUMULATIVE TOTALS</h3><table>' + tbody + '</table>';
  }

  function renderPiles(piles){
    const players = state.log.game.players;
    const rows = piles.map((cards, i) => {
      const cardEls = cards.map(c => {
        const suit = c.suit;
        const lab = (c.label != null) ? c.label : (c.rank + (suit || ''));
        const cls = 'replay-pile-mini suit-' + (suit || 'JK') + (c.cancelled || c.assassinated ? ' cancelled' : '');
        return '<span class="' + cls + '">' + esc(lab) + '</span>';
      }).join('');
      return '<div class="replay-pile-row">' +
             '<span class="replay-pile-name">' + esc(players[i].name) + ':</span>' +
             '<span class="replay-pile-cards">' + (cardEls || '<i style="color:#5c6672;font-size:11px;">(empty)</i>') + '</span>' +
             '</div>';
    }).join('');
    document.getElementById('replay-piles').innerHTML =
      '<h3>CAPTURED CARDS — THIS MISSION</h3>' + rows;
  }

  function renderCommsUpTo(currentEvent){
    const feed = document.getElementById('replay-comms-feed');
    if (!state.log.commsLog || state.log.commsLog.length === 0){
      feed.innerHTML = '<div style="color:var(--dim);font-style:italic;">(no comms recorded for this log)</div>';
      document.getElementById('replay-comms-pos').textContent = '';
      return;
    }
    /* Estimate cutoff by (missionIndex, trickNumber). Comms entries with
       a missionIndex past `currentEvent.missionIndex`, or in the same
       mission past `currentEvent.trickIndex+1` (1-indexed in flow.js),
       are hidden. */
    const targetMi = (currentEvent.type === 'game-start') ? -1 :
                     (currentEvent.type === 'game-end')   ? Infinity :
                     currentEvent.missionIndex;
    const targetTn = (currentEvent.type === 'trick')      ? currentEvent.trickIndex + 1 :
                     (currentEvent.type === 'mission-end') ? Infinity :
                     (currentEvent.type === 'mission-start') ? 0 :
                     Infinity;
    const visible = state.log.commsLog.filter(c => {
      const mi = (typeof c.missionIndex === 'number') ? c.missionIndex : 0;
      const tn = (typeof c.trickNumber  === 'number') ? c.trickNumber  : 0;
      if (mi < targetMi) return true;
      if (mi > targetMi) return false;
      return tn <= targetTn;
    });
    feed.innerHTML = visible.map(c => {
      if (c.type === 'chat'){
        return '<div class="log-line chat"><span class="speaker">' + esc(c.speaker || '?') + ':</span>' + esc(c.text) + '</div>';
      }
      return '<div class="log-line ' + esc(c.type) + '">▸ ' + esc(c.text) + '</div>';
    }).join('');
    feed.scrollTop = feed.scrollHeight;
    document.getElementById('replay-comms-pos').textContent = visible.length + ' / ' + state.log.commsLog.length;
  }

  /* ============================================================
   * Card rendering — reuses card.js's cardLabel for display
   * ============================================================ */
  function renderCard(c){
    const el = document.createElement('div');
    const isJoker = !c.suit || c.suit === 'JK';
    el.className = 'card suit-' + (isJoker ? 'JK' : c.suit);
    const label = (typeof c.label === 'string') ? c.label :
                  (c.rank + (isJoker ? '' : suitGlyph(c.suit)));
    /* Split into rank + suit for top/middle/bottom layout matching the game */
    const rank = c.rank;
    const suit = isJoker ? '★' : suitGlyph(c.suit);
    el.innerHTML =
      '<div class="rank-top">' + esc(rank) + '<br>' + esc(suit) + '</div>' +
      '<div class="suit-mid">' + esc(suit) + '</div>' +
      '<div class="rank-bot">' + esc(rank) + '<br>' + esc(suit) + '</div>';
    el.title = (c.name ? c.name + ' — ' : '') + label + (c.points != null ? ' (' + (c.points >= 0 ? '+' : '') + c.points + ')' : '');
    return el;
  }

  function suitGlyph(s){
    return s === 'H' ? '♥' : s === 'D' ? '♦' : s === 'C' ? '♣' : s === 'S' ? '♠' : s === 'JK' ? '★' : s;
  }

  /* ============================================================
   * Controls
   * ============================================================ */
  function bindControls(){
    document.getElementById('btn-first').onclick = () => { stopAutoplay(); state.cursor = 0; renderEvent(); };
    document.getElementById('btn-prev').onclick  = () => { stopAutoplay(); state.cursor--; renderEvent(); };
    document.getElementById('btn-next').onclick  = () => { stopAutoplay(); state.cursor++; renderEvent(); };
    document.getElementById('btn-last').onclick  = () => { stopAutoplay(); state.cursor = state.events.length - 1; renderEvent(); };
    document.getElementById('btn-play').onclick  = toggleAutoplay;
    document.getElementById('speed-select').onchange = (e) => {
      state.speedMs = parseInt(e.target.value, 10) || 1500;
      if (state.autoplay){ stopAutoplay(); startAutoplay(); }
    };
    document.removeEventListener('keydown', onKeydown);
    document.addEventListener('keydown', onKeydown);
  }

  function onKeydown(ev){
    /* Ignore keyboard shortcuts when typing in the paste box etc. */
    const tag = (ev.target && ev.target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (ev.key === 'ArrowRight'){ stopAutoplay(); state.cursor++; renderEvent(); ev.preventDefault(); }
    else if (ev.key === 'ArrowLeft'){ stopAutoplay(); state.cursor--; renderEvent(); ev.preventDefault(); }
    else if (ev.key === ' '){ toggleAutoplay(); ev.preventDefault(); }
    else if (ev.key === 'Home'){ stopAutoplay(); state.cursor = 0; renderEvent(); ev.preventDefault(); }
    else if (ev.key === 'End'){ stopAutoplay(); state.cursor = state.events.length - 1; renderEvent(); ev.preventDefault(); }
  }

  function toggleAutoplay(){
    if (state.autoplay) stopAutoplay();
    else startAutoplay();
  }
  function startAutoplay(){
    if (state.cursor >= state.events.length - 1) state.cursor = 0;
    document.getElementById('btn-play').textContent = '⏸ Pause';
    state.autoplay = setInterval(() => {
      state.cursor++;
      if (state.cursor >= state.events.length - 1){
        renderEvent();
        stopAutoplay();
        return;
      }
      renderEvent();
    }, state.speedMs);
  }
  function stopAutoplay(){
    if (state.autoplay){ clearInterval(state.autoplay); state.autoplay = null; }
    const btn = document.getElementById('btn-play');
    if (btn) btn.textContent = '▶ Play';
  }

  /* ============================================================
   * Utilities
   * ============================================================ */
  function esc(s){
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function fmtDuration(ms){
    const total = Math.round(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
    if (m > 0) return m + 'm ' + s + 's';
    return s + 's';
  }
})();
