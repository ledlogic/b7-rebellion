/* Rebellion — powers.js
 * Capture-triggered card powers. Each power is an async function the flow
 * dispatches when its card is captured. AI-targeted choices (Vila, Zen) ask
 * the registered AI definition for a target, falling back to a random pick.
 */
(function () {
  'use strict';
  const R = (window.Rebellion = window.Rebellion || {});
  const E = R.engine;
  const S = R.state;
  const UI = R.ui;

  async function resolveCardPower(card, winner){
    const meta = E.cardMeta(card);
    if (!meta.power) return;
    switch (meta.power){
      case 'teleport':       await powerTeleport(winner); break;
      case 'destroyReserve': await powerDestroyReserve(winner); break;
      case 'zenLook':        await powerZenLook(winner); break;
      case 'oracCancel':     await powerOracCancel(winner); break;
      case 'pickLock':       await powerPickLock(winner); break;
      case 'seizeReserve':   await powerSeizeReserve(winner); break;
      case 'revealHand':     await powerRevealHand(winner); break;
      case 'starOneEnd':     break; // handled in flow.resolveTrickEnd
    }
  }

  async function powerTeleport(winner){
    if (winner.hand.length === 0 || winner.pile.length === 0) return;
    if (winner.isHuman){
      UI.setCenterMsg('Teleport Bracelet: choose a card from your hand and one from your pile to swap.');
      const handPick = await UI.askCards('Teleport Bracelet',
        'Choose ONE card from your HAND to send to your capture pile (or skip).',
        winner.hand, { allowSkip:true, skipLabel:'Skip Swap' });
      if (handPick.length === 0) return;
      const pilePick = await UI.askCards('Teleport Bracelet',
        'Now choose ONE card from your CAPTURE PILE to take into your hand instead.',
        winner.pile, { allowSkip:false, confirmLabel:'Swap' });
      if (pilePick.length === 0) return;
      const hc = handPick[0], pc = pilePick[0];
      winner.hand = winner.hand.filter(c => c.id !== hc.id).concat([pc]);
      winner.pile = winner.pile.filter(c => c.id !== pc.id).concat([hc]);
      UI.logSystem('Teleport Bracelet: ' + E.subj(winner.name, 'swaps') + ' ' + E.cardLabel(hc) + ' (hand) with ' + E.cardLabel(pc) + ' (pile).');
    } else {
      const worstInPile = winner.pile.slice().sort((a, b) => E.basePoints(a) - E.basePoints(b))[0];
      const bestInHand  = winner.hand.slice().sort((a, b) => E.basePoints(b) - E.basePoints(a))[0];
      if (worstInPile && bestInHand && E.basePoints(bestInHand) > E.basePoints(worstInPile)){
        winner.hand = winner.hand.filter(c => c.id !== bestInHand.id).concat([worstInPile]);
        winner.pile = winner.pile.filter(c => c.id !== worstInPile.id).concat([bestInHand]);
        UI.logSystem('Teleport Bracelet: ' + E.subj(winner.name, 'swaps') + ' ' + E.cardLabel(bestInHand) + ' (hand) with ' + E.cardLabel(worstInPile) + ' (pile).');
        UI.say(winner, 'power');
      }
    }
    UI.renderAll(); await E.sleep(300);
  }

  async function powerDestroyReserve(winner){
    const M = S.M, G = S.G;
    if (M.reserveDestroyed || M.reserve.length === 0) return;
    let doDestroy;
    if (winner.isHuman){
      doDestroy = await UI.askButtons('The Liberator',
        'You captured the Liberator. Destroy the Reserve outright? It will be locked away for the rest of the Mission — no one (including you) can claim it.',
        [{ label:'Destroy the Reserve', value:true }, { label:'Leave it be', value:false }]);
    } else {
      doDestroy = G.totals[winner.idx] + winner.pile.reduce((s, c) => s + E.basePoints(c), 0) >= 0;
    }
    if (doDestroy){
      M.reserveDestroyed = true;
      M.reserve = [];
      M.invasionActive = false;
      UI.logSystem('💥 ' + E.subj(winner.name, 'destroys') + ' the Reserve. It is locked away for the rest of the Mission.');
      if (!winner.isHuman) UI.say(winner, 'power');
    }
    UI.renderAll(); await E.sleep(300);
  }

  async function powerZenLook(winner){
    const G = S.G;
    const others = G.players.filter(p => p.idx !== winner.idx);
    if (others.length === 0) return;
    let target;
    if (winner.isHuman){
      const choice = await UI.askButtons('Zen', 'Choose an opponent to peek at their hand.',
        others.map(p => ({ label:p.name, value:p.idx })));
      target = G.players[choice];
      await UI.askInfo(target.name + "'s Hand", 'Zen reveals their current hand to you.', target.hand);
    } else {
      const def = R.ai.get(winner.aiLevel);
      const ctx = R.ai.buildContext(winner);
      target = (def && def.chooseZenTarget)
        ? def.chooseZenTarget(winner, others, ctx)
        : others[Math.floor(Math.random() * others.length)];
      UI.logSystem('Zen: ' + winner.name + ' quietly studies ' + target.name + "'s hand.");
      UI.say(winner, 'power');
    }
  }

  async function powerOracCancel(winner){
    if (winner.oracUsed) return;
    const eligible = winner.pile.filter(c => (c.suit === 'S' || c.suit === 'C') && !c._cancelled);
    if (eligible.length === 0) return;
    let pick;
    if (winner.isHuman){
      const sel = await UI.askCards('Orac',
        'Orac can cancel the point value of one Spade or Club already in your capture pile. Choose one, or skip.',
        eligible, { allowSkip:true, skipLabel:'Skip' });
      pick = sel[0];
    } else {
      pick = eligible.slice().sort((a, b) => E.basePoints(a) - E.basePoints(b))[0];
    }
    if (pick){
      pick._cancelled = true;
      winner.oracUsed = true;
      UI.logSystem('Orac: ' + E.subj(winner.name, 'cancels') + ' the value of ' + E.cardLabel(pick) + ' (' + E.cardName(pick) + ') in their pile.');
      if (!winner.isHuman) UI.say(winner, 'power');
    }
    UI.renderAll(); await E.sleep(250);
  }

  async function powerPickLock(winner){
    const G = S.G;
    const others = G.players.filter(p => p.idx !== winner.idx && p.hand.length > 0);
    if (others.length === 0) return;
    let target;
    if (winner.isHuman){
      const choice = await UI.askButtons('Vila — Pick the Lock', 'Choose an opponent to pick a card from.',
        others.map(p => ({ label:p.name + ' (' + p.hand.length + ' cards)', value:p.idx })));
      target = G.players[choice];
      const takeSel = await UI.askCards('Pick the Lock',
        "Choose a card to take from " + target.name + "'s hand.",
        target.hand, { allowSkip:false, confirmLabel:'Take Card' });
      const taken = takeSel[0];
      target.hand = target.hand.filter(c => c.id !== taken.id);
      winner.hand.push(taken);
      UI.logSystem('Vila: ' + E.subj(winner.name, 'takes') + ' ' + E.cardLabel(taken) + ' from ' + target.name + '.');
      if (winner.hand.length > 0){
        const giveSel = await UI.askCards('Pick the Lock', 'Now give a card back from your hand.',
          winner.hand, { allowSkip:false, confirmLabel:'Give Card' });
        const given = giveSel[0];
        winner.hand = winner.hand.filter(c => c.id !== given.id);
        target.hand.push(given);
        UI.logSystem('Vila: ' + E.subj(winner.name, 'gives') + ' ' + E.cardLabel(given) + ' to ' + target.name + ' in exchange.');
      }
    } else {
      const def = R.ai.get(winner.aiLevel);
      const ctx = R.ai.buildContext(winner);
      target = (def && def.choosePickLockTarget)
        ? def.choosePickLockTarget(winner, others, ctx)
        : others[Math.floor(Math.random() * others.length)];
      const best = target.hand.slice().sort((a, b) => E.basePoints(b) - E.basePoints(a))[0];
      target.hand = target.hand.filter(c => c.id !== best.id);
      winner.hand.push(best);
      UI.logSystem('Vila: ' + winner.name + ' picks the lock on ' + E.possessiveOf(target.name) + ' hand and takes ' + E.cardLabel(best) + '.');
      UI.say(winner, 'power');
      if (winner.hand.length > 0){
        const worst = winner.hand.slice().sort((a, b) => E.basePoints(a) - E.basePoints(b))[0];
        winner.hand = winner.hand.filter(c => c.id !== worst.id);
        target.hand.push(worst);
        UI.logSystem('Vila: in exchange, ' + E.subj(target.name, 'receives') + ' ' + E.cardLabel(worst) + '.');
      }
    }
    UI.renderAll(); await E.sleep(300);
  }

  async function powerSeizeReserve(winner){
    const M = S.M;
    if (M.reserve.length === 0 || M.reserveDestroyed) return;
    const taken = M.reserve.splice(0, M.reserve.length);
    winner.pile.push(...taken);
    M.invasionActive = false;
    UI.logSystem('⚡ TRAVIS: ' + E.subj(winner.name, 'seizes') + ' the entire remaining Reserve (' + taken.length + ' cards): ' + taken.map(E.cardLabel).join(' ') + '.');
    if (!winner.isHuman) UI.say(winner, 'reserve');
    else await UI.askInfo('Travis — Reserve Seized', 'You captured Travis. The entire remaining Reserve is seized into your pile.', taken);
    UI.renderAll(); await E.sleep(300);
  }

  async function powerRevealHand(winner){
    winner.exposed = true;
    UI.logSystem('👁 SERVALAN: ' + E.possessiveOf(winner.name) + ' hand is exposed for the rest of the Mission.');
    if (!winner.isHuman) UI.say(winner, 'power');
    UI.renderAll(); await E.sleep(200);
  }

  R.powers = {
    resolveCardPower,
    powerTeleport, powerDestroyReserve, powerZenLook, powerOracCancel,
    powerPickLock, powerSeizeReserve, powerRevealHand
  };
})();
