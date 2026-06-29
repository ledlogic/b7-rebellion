/* Rebellion — powers.js
 * Capture-triggered card powers. Each power is an async function the flow
 * dispatches when its card is captured. AI-targeted choices (Vila, Zen) ask
 * the registered AI definition for a target, falling back to a random pick.
 */
(function () {
  'use strict';
  const R = (window.Rebellion = window.Rebellion || {});
  const C = R.card;
  const E = R.engine;
  const S = R.state;
  const UI = R.ui;

  async function resolveCardPower(card, winner){
    const meta = C.cardMeta(card);
    if (!meta.power) return;
    switch (meta.power){
      case 'teleport':       await powerTeleport(winner); break;
      case 'destroyReserve': await powerDestroyReserve(winner); break;
      case 'zenLook':        await powerZenLook(winner); break;
      case 'oracPeek':       await powerOracPeek(winner); break;
      case 'pickLock':       await powerPickLock(winner); break;
      case 'seizeReserve':   await powerSeizeReserve(winner); break;
      case 'revealHand':     await powerRevealHand(winner); break;
      case 'starOneEnd':     break; // handled in flow.resolveTrickEnd
    }
  }

  async function powerTeleport(winner){
    // Valid targets for teleport: Hearts, Spades, Dayna (10♣), or Vila (Joker) — living matter only
    const pileTargets = winner.pile.filter(C.isPersonCard);
    if (winner.hand.length === 0 || pileTargets.length === 0) return;
    if (winner.isHuman){
      UI.setCenterMsg('Teleport Bracelet: swap a person card (Hearts, Spades, Dayna, Vila) from your captured cards back to hand.');
      const picks = await UI.askPairOfCards('Teleport Bracelet',
        'Pick one card from your HAND to send into your captured cards, and one person card (Hearts, Spades, Dayna Mellanby, or Vila) from your captured cards to take back into your hand.',
        { label: 'From your HAND → pile', cards: winner.hand },
        { label: 'From your PILE → hand (living matter only)', cards: pileTargets },
        { allowSkip: true, skipLabel: 'Skip Swap', confirmLabel: 'Swap' });
      if (picks.length === 0) return;
      const hc = picks[0], pc = picks[1];
      winner.hand = winner.hand.filter(c => c.id !== hc.id).concat([pc]);
      winner.pile = winner.pile.filter(c => c.id !== pc.id).concat([hc]);
      UI.logSystem('Teleport Bracelet: ' + E.subj(winner.name, 'swaps') + ' ' + C.cardLabel(hc) + ' (hand) with ' + C.cardLabel(pc) + ' (pile).');
    } else {
      const worstInPile = pileTargets.slice().sort((a, b) => C.basePoints(a) - C.basePoints(b))[0];
      const bestInHand  = winner.hand.slice().sort((a, b) => C.basePoints(b) - C.basePoints(a))[0];
      if (worstInPile && bestInHand && C.basePoints(bestInHand) > C.basePoints(worstInPile)){
        winner.hand = winner.hand.filter(c => c.id !== bestInHand.id).concat([worstInPile]);
        winner.pile = winner.pile.filter(c => c.id !== worstInPile.id).concat([bestInHand]);
        UI.logSystem('Teleport Bracelet: ' + E.subj(winner.name, 'swaps') + ' ' + C.cardLabel(bestInHand) + ' (hand) with ' + C.cardLabel(worstInPile) + ' (pile).');
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
      doDestroy = G.totals[winner.idx] + winner.pile.reduce((s, c) => s + C.basePoints(c), 0) >= 0;
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
      UI.logSystem('Zen: ' + winner.name + ' quietly studies ' + E.possessiveOf(target.name) + ' hand.');
      UI.say(winner, 'power');
    }
  }

  /** Orac on-capture power: look through one opponent's hand (information only). */
  async function powerOracPeek(winner){
    const G = S.G;
    const others = G.players.filter(p => p.idx !== winner.idx && p.hand.length > 0);
    if (others.length === 0) return;
    let target;
    if (winner.isHuman){
      const choice = await UI.askButtons('Orac — Scan Opponent Hand',
        'Orac accesses any data system in the galaxy. Choose an opponent to peek at their hand.',
        others.map(p => ({ label:p.name + ' (' + p.hand.length + ' cards)', value:p.idx })));
      target = G.players[choice];
      await UI.askInfo(target.name + "'s Hand", "Orac reveals their current hand to you (information only — you take nothing).", target.hand);
      UI.logSystem('Orac: ' + E.subj(winner.name, 'scans') + ' ' + E.possessiveOf(target.name) + ' hand.');
    } else {
      target = others[Math.floor(Math.random() * others.length)];
      UI.logSystem('Orac: ' + winner.name + ' quietly scans ' + E.possessiveOf(target.name) + ' hand.');
      UI.say(winner, 'power');
    }
    UI.renderAll(); await E.sleep(250);
  }

  /** Orac scoring power: called from scoreMission (Step 1) if the holder wants to cancel a person card.
   *  Per v2.44 rulebook: target is any person card (Hearts, Spades, Dayna 10♣, or Vila) from ANY
   *  player's Capture Pile, including the holder's own. */
  async function powerOracCancel(winner){
    if (winner.oracUsed) return;
    const G = S.G;
    /* Pool: every eligible card across ALL players' captured piles, with owner. */
    const pool = [];
    for (const p of G.players){
      for (const c of p.pile){
        if (!c._cancelled && !c._assassinated && C.isPersonCard(c)){
          pool.push({ card: c, owner: p });
        }
      }
    }
    if (pool.length === 0) return;

    let pick;
    if (winner.isHuman){
      const labels = pool.map(({owner}) => ({
        text: (owner.idx === winner.idx) ? 'YOUR pile' : owner.name + "'s pile",
        own:  (owner.idx === winner.idx)
      }));
      const cards = pool.map(p => p.card);
      const sel = await UI.askCards('Orac — Cancel a Card Value',
        "Orac wins an argument nobody in the galaxy can defeat. Cancel the point value of one person card (Hearts, Spades, Dayna, or Vila) from any player's captured cards. Choose one, or skip.",
        cards, { allowSkip:true, skipLabel:'Skip — do not use Orac', ownerLabels: labels });
      if (sel.length){
        const cardChosen = sel[0];
        pick = pool.find(p => p.card === cardChosen) || pool.find(p => p.card.id === cardChosen.id);
      }
    } else {
      /* AI: maximize swing in the winner's favor.
         - Cancelling a card in own pile gives swing = -basePoints (cancelling a -10 helps by 10)
         - Cancelling a card in opponent's pile gives swing = +basePoints (cancelling their +10 hurts them by 10)
         Skip only if no positive-swing option exists. */
      let best = null, bestSwing = 0;
      for (const opt of pool){
        const bp = C.basePoints(opt.card);
        const swing = (opt.owner.idx === winner.idx) ? -bp : bp;
        if (swing > bestSwing){ best = opt; bestSwing = swing; }
      }
      pick = best;
    }

    if (pick){
      pick.card._cancelled = true;
      winner.oracUsed = true;
      const where = (pick.owner.idx === winner.idx) ? 'their own captured cards'
                                                    : E.possessiveOf(pick.owner.name) + ' captured cards';
      UI.logSystem(winner.name + ' uses Orac (A♦) to cancel ' + C.cardLabel(pick.card) + ' (' + C.cardName(pick.card) + ') in ' + where + ' — scores 0 this Mission.');
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
      UI.logSystem('Vila: ' + E.subj(winner.name, 'takes') + ' ' + C.cardLabel(taken) + ' from ' + target.name + '.');
      if (winner.hand.length > 0){
        const giveSel = await UI.askCards('Pick the Lock', 'Now give a card back from your hand.',
          winner.hand, { allowSkip:false, confirmLabel:'Give Card' });
        const given = giveSel[0];
        winner.hand = winner.hand.filter(c => c.id !== given.id);
        target.hand.push(given);
        UI.logSystem('Vila: ' + E.subj(winner.name, 'gives') + ' ' + C.cardLabel(given) + ' to ' + target.name + ' in exchange.');
      }
    } else {
      const def = R.ai.get(winner.aiLevel);
      const ctx = R.ai.buildContext(winner);
      target = (def && def.choosePickLockTarget)
        ? def.choosePickLockTarget(winner, others, ctx)
        : others[Math.floor(Math.random() * others.length)];
      const best = target.hand.slice().sort((a, b) => C.basePoints(b) - C.basePoints(a))[0];
      target.hand = target.hand.filter(c => c.id !== best.id);
      winner.hand.push(best);
      UI.logSystem('Vila: ' + winner.name + ' picks the lock on ' + E.possessiveOf(target.name) + ' hand and takes ' + C.cardLabel(best) + '.');
      UI.say(winner, 'power');
      if (winner.hand.length > 0){
        const worst = winner.hand.slice().sort((a, b) => C.basePoints(a) - C.basePoints(b))[0];
        winner.hand = winner.hand.filter(c => c.id !== worst.id);
        target.hand.push(worst);
        UI.logSystem('Vila: in exchange, ' + E.subj(target.name, 'receives') + ' ' + C.cardLabel(worst) + '.');
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
    M.starOneBattleOccurred = true; // Travis seizing the Reserve counts for Dayna
    UI.logSystem('⚡ ' + winner.name + ' captures Travis (K♠) — Travis seizes the entire remaining Reserve (' + taken.length + ' cards) into their pile: ' + taken.map(C.cardLabel).join(' ') + '.');
    if (!winner.isHuman) UI.say(winner, 'reserve');
    else await UI.askInfo('Travis — Reserve Seized', 'You captured Travis. The entire remaining Reserve is seized into your captured cards.', taken);
    /* Per strict v2.46: A♣ entering a Capture Pile ends the Mission, full
       stop. Travis-seized Star One isn't shielded — the Liberator intercept
       requires both cards in the same trick, and A♣ pulled from Reserve
       wasn't played to the trick. */
    if (taken.some(c => c.suit === 'C' && c.rank === 'A')){
      M.missionOver = true; M.missionResult = 'starOne';
      UI.setCenterMsg('STAR ONE was in the Reserve! Mission ends immediately.');
      UI.logSystem('☢ ' + winner.name + ' seizes Star One (A♣) from the Reserve via Travis — Mission ends immediately. Cards still in hand score nothing.');
      if (!winner.isHuman) UI.say(winner, 'starOne');
    }
    UI.renderAll(); await E.sleep(300);
  }

  async function powerRevealHand(winner){
    winner.exposed = true;
    UI.logSystem('👁 SERVALAN: ' + E.possessiveOf(winner.name) + ' hand is exposed for the rest of the Mission.');
    if (!winner.isHuman) UI.say(winner, 'power');
    UI.renderAll(); await E.sleep(200);

    /* If the HUMAN's hand was just exposed, give two AI players a chance to
       taunt with Blake's 7-themed defense-tech commentary — force walls,
       detector shields, neutron flares, the whole bag. */
    if (winner.isHuman){
      const G = S.G;
      const taunters = G.players.filter(p => !p.isHuman);
      taunters.sort(() => Math.random() - 0.5);
      const pickCount = Math.min(2, taunters.length);
      for (let i = 0; i < pickCount; i++){
        UI.say(taunters[i], 'humanExposed');
        await E.sleep(700);
      }
    }
  }

  R.powers = {
    resolveCardPower,
    powerTeleport, powerDestroyReserve, powerZenLook, powerOracPeek, powerOracCancel,
    powerPickLock, powerSeizeReserve, powerRevealHand
  };
})();
