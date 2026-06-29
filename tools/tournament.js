#!/usr/bin/env node
/**
 * Rebellion headless tournament harness.
 *
 * Loads the browser game modules into a Node VM context (with a stubbed
 * `window` and a no-op `Rebellion.ui` shim), seats N AI players, and runs
 * M missions. Aggregates per-seat totals, win rates, and mission-end reasons.
 *
 * Usage:
 *   node tools/tournament.js [options]
 *
 * Options:
 *   --missions N         How many full games to run.       (default: 50)
 *   --players  P         Seats per game (2..7).            (default: 4)
 *   --seats    L,L,L,L   AI level per seat, comma-list.    (default: all gamma)
 *                        Length must equal --players.
 *                        Each L is one of: delta, gamma
 *   --weights        PATH   Path to GAMMA weights JSON.    (default: js/ai/gamma-weights.json)
 *   --beta-weights   PATH   Path to BETA weights JSON.     (default: js/ai/beta-weights.json)
 *   --seed     N         Deterministic RNG seed.           (default: time-based)
 *   --verbose            Print per-game summary lines.
 *   --json                Emit aggregate stats as JSON only (for the optimizer).
 *
 * Example:
 *   node tools/tournament.js --missions 200 --players 4 --seats gamma,delta,delta,delta
 *   node tools/tournament.js --missions 500 --seats beta,beta,gamma,gamma  # Beta vs Gamma bake-off
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

/* ---------------- CLI parsing ---------------- */
function parseArgs(argv){
  const opts = {
    missions: 50,
    players:  4,
    seats:    null,
    weights:     path.join(__dirname, '..', 'js', 'ai', 'gamma-weights.json'),
    betaWeights: path.join(__dirname, '..', 'js', 'ai', 'beta-weights.json'),
    seed:     null,
    verbose:  false,
    json:     false
  };
  for (let i = 2; i < argv.length; i++){
    const a = argv[i];
    if (a === '--missions') opts.missions = parseInt(argv[++i], 10);
    else if (a === '--players')  opts.players  = parseInt(argv[++i], 10);
    else if (a === '--seats')    opts.seats    = argv[++i].split(',').map(s => s.trim().toLowerCase());
    else if (a === '--weights')      opts.weights     = argv[++i];
    else if (a === '--beta-weights') opts.betaWeights = argv[++i];
    else if (a === '--seed')     opts.seed     = parseInt(argv[++i], 10);
    else if (a === '--verbose')  opts.verbose  = true;
    else if (a === '--json')     opts.json     = true;
    else if (a === '--help' || a === '-h'){ printHelp(); process.exit(0); }
    else throw new Error('Unknown option: ' + a);
  }
  if (opts.players < 2 || opts.players > 7) throw new Error('--players must be 2..7');
  if (!opts.seats) opts.seats = new Array(opts.players).fill('gamma');
  if (opts.seats.length !== opts.players){
    throw new Error('--seats list (' + opts.seats.length + ') must match --players (' + opts.players + ')');
  }
  for (const s of opts.seats){
    if (s !== 'delta' && s !== 'gamma' && s !== 'beta') throw new Error('Unknown AI level in --seats: ' + s);
  }
  return opts;
}

function printHelp(){
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
}

/* ---------------- Seedable RNG ---------------- */
/** Mulberry32 — small, fast, good-enough seedable PRNG. */
function makeRng(seed){
  let a = (seed | 0) || 1;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- VM context bootstrap ---------------- */
function loadGameContext(rng){
  /* A minimal browser-like sandbox. The game files use:
     - window.Rebellion namespace
     - setTimeout / setInterval (only in UI; we shim UI to no-ops, so unused)
     - Math.random (intercepted for determinism)
     - Date, JSON, Object, Array — all standard, vm context inherits
     - console — for debug; we provide a quiet version  */
  const ctx = {
    window: {},
    setTimeout: (fn) => { fn(); return 0; },     // immediate
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    console: { log: () => {}, debug: () => {}, error: console.error, warn: () => {} },
    Math: Object.assign(Object.create(Math), { random: rng })
  };
  ctx.global = ctx;
  ctx.self   = ctx;
  vm.createContext(ctx);

  const root = path.join(__dirname, '..');
  const earlyFiles = [
    'js/card.js',
    'js/engine.js',
    'js/state.js',
    'js/personas/registry.js',
    'js/personas/default.js',
    'js/ai/registry.js',
    'js/ai/delta.js',
    'js/ai/gamma.js',
    'js/ai/beta.js'
  ];
  const lateFiles = [
    'js/powers.js',
    'js/flow.js'
  ];
  const runFile = (f) => {
    const code = fs.readFileSync(path.join(root, f), 'utf8');
    try { vm.runInContext(code, ctx, { filename: f }); }
    catch (e){ throw new Error('Failed loading ' + f + ': ' + e.message); }
  };
  for (const f of earlyFiles) runFile(f);

  /* Install the UI shim BEFORE powers.js and flow.js, because both capture
     `const UI = R.ui` at load time. Same for engine.sleep — install the
     no-op now so any code that grabs `const E = R.engine` keeps reading
     through the live object (E.sleep is property access at call time). */
  ctx.window.Rebellion.ui = makeUiShim();
  ctx.window.Rebellion.engine.sleep = () => Promise.resolve();

  for (const f of lateFiles) runFile(f);

  return ctx;
}

/** No-op UI shim. Every method flow.js / powers.js calls must exist here.
 *  Returns reasonable defaults so the game logic flows without blocking. */
function makeUiShim(){
  const noop = () => {};
  const asyncNoop = async () => {};
  return {
    renderAll: noop, renderHeader: noop, renderSeats: noop, renderHumanHand: noop,
    renderCenter: noop, renderCardEl: noop, renderCardBackEl: noop,
    setCenterMsg: noop, setCenterMsgHTML: noop, playerChip: () => '',
    logSystem: noop, logAndromedan: noop, logChat: noop, say: noop, showBubble: noop,
    escapeHtml: (s) => String(s),
    logLayoutMetrics: noop, startTimers: noop, fmtElapsed: () => '',
    awaitContinue: asyncNoop,
    elevateWinnerSeat: () => null, clearWinnerElevation: noop,
    showWinScoreFlash: noop, animateTrickCapture: asyncNoop,
    /* Trick serializer for headless export — minimal object, no formatting */
    serializeTrick: (trick, ledSuit, winnerIdx, isInvasion) => ({
      type: isInvasion ? 'invasion' : 'normal',
      ledSuit: ledSuit || null,
      plays: trick.map(p => ({
        playerIdx: p.playerIdx, who: p.who,
        card: { suit: p.card.suit, rank: p.card.rank, id: p.card.id }
      })),
      winnerIdx
    }),
    /* Dialog/prompt calls: the harness only seats AI players, so the human
       branches are never reached. If any of these were ever invoked the call
       would hang waiting for user input — we throw loudly instead. */
    askButtons:    () => { throw new Error('UI.askButtons called in headless'); },
    askCards:      () => { throw new Error('UI.askCards called in headless'); },
    askPairOfCards:() => { throw new Error('UI.askPairOfCards called in headless'); },
    askInfo:       asyncNoop,
    showInfoBanner: asyncNoop,
    showScoringModal: asyncNoop,
    showFinalResults: asyncNoop,
    showHumanPileModal: asyncNoop,
    showScoreboardModal: asyncNoop,
    closeModal: noop,
    getHumanCard:  () => { throw new Error('UI.getHumanCard called in headless'); },
    /* History persistence is a no-op too. */
    saveGameToHistory: noop
  };
}

/* ---------------- Game setup + run ---------------- */
async function runOneGame(ctx, seats, rng){
  const R = ctx.window.Rebellion;
  const S = R.state, C = R.card;
  const n = seats.length;

  /* Pick personas for ALL seats (no human in the harness). */
  const pool = R.personas.pickN(n);
  const players = [];
  for (let i = 0; i < n; i++){
    const lvl = seats[i];
    const p = S.newPlayer(i, /*isHuman=*/false, pool[i], lvl);
    players.push(p);
  }

  S.G = {
    numPlayers: n,
    players,
    missionIndex: 0,
    totals: new Array(n).fill(0),
    missionLog: [],
    startDealer: Math.floor(rng() * n),
    difficulty: 'mixed',
    systemName: 'Headless',
    gameStartedAt: null
  };

  await R.flow.runGame();

  return { totals: S.G.totals.slice(), seats: seats.slice(), players: players.map(p => p.name) };
}

/* ---------------- Aggregation ---------------- */
function aggregate(games, seats){
  const n = seats.length;
  const winsBySeat   = new Array(n).fill(0);
  const winsByLevel  = {};
  const totalByLevel = {};
  const gamesByLevel = {};
  const totalBySeat  = new Array(n).fill(0);

  for (const g of games){
    let winIdx = 0;
    for (let i = 1; i < n; i++) if (g.totals[i] > g.totals[winIdx]) winIdx = i;
    winsBySeat[winIdx]++;
    for (let i = 0; i < n; i++){
      totalBySeat[i] += g.totals[i];
      const lvl = seats[i];
      winsByLevel[lvl]   = (winsByLevel[lvl]   || 0) + (i === winIdx ? 1 : 0);
      totalByLevel[lvl]  = (totalByLevel[lvl]  || 0) + g.totals[i];
      gamesByLevel[lvl]  = (gamesByLevel[lvl]  || 0) + 1;
    }
  }
  return { winsBySeat, totalBySeat, winsByLevel, totalByLevel, gamesByLevel };
}

/* ---------------- Main ---------------- */
async function main(){
  const opts = parseArgs(process.argv);
  const seed = opts.seed != null ? opts.seed : Date.now();
  const rng = makeRng(seed);

  const t0 = Date.now();
  const ctx = loadGameContext(rng);
  const R = ctx.window.Rebellion;

  /* Apply weights for any AI levels in the lineup that have a tunable
     weights file. Each level only loads its weights if at least one seat
     uses it, so a delta-only run doesn't read JSON files. */
  if (opts.seats.includes('gamma')){
    const w = JSON.parse(fs.readFileSync(opts.weights, 'utf8'));
    R.ai.get('gamma').setWeights(w);
    if (!opts.json) console.log('[gamma weights] loaded ' + Object.keys(w).length + ' values from ' + path.relative(process.cwd(), opts.weights));
  }
  if (opts.seats.includes('beta')){
    const w = JSON.parse(fs.readFileSync(opts.betaWeights, 'utf8'));
    R.ai.get('beta').setWeights(w);
    if (!opts.json) console.log('[beta weights]  loaded ' + Object.keys(w).length + ' values from ' + path.relative(process.cwd(), opts.betaWeights));
  }

  if (!opts.json){
    console.log('[tournament] ' + opts.missions + ' games × ' + opts.players + ' players');
    console.log('[seats] ' + opts.seats.join(', '));
    console.log('[seed] ' + seed);
  }

  const games = [];
  for (let g = 0; g < opts.missions; g++){
    const res = await runOneGame(ctx, opts.seats, rng);
    games.push(res);
    if (opts.verbose){
      let winIdx = 0;
      for (let i = 1; i < res.totals.length; i++) if (res.totals[i] > res.totals[winIdx]) winIdx = i;
      console.log('[' + (g+1).toString().padStart(4) + '] totals=' + res.totals.map(t => t.toString().padStart(4)).join(' ') +
                  '  winner=seat' + winIdx + '(' + opts.seats[winIdx] + ')');
    }
  }
  const tElapsed = (Date.now() - t0) / 1000;
  const agg = aggregate(games, opts.seats);

  if (opts.json){
    console.log(JSON.stringify({
      missions: opts.missions, players: opts.players, seats: opts.seats,
      seed, elapsedSec: tElapsed,
      winsBySeat: agg.winsBySeat,
      avgScoreBySeat: agg.totalBySeat.map(t => t / opts.missions),
      winsByLevel: agg.winsByLevel,
      avgScoreByLevel: Object.fromEntries(Object.entries(agg.totalByLevel).map(([k,v]) => [k, v/agg.gamesByLevel[k]])),
      winRateByLevel: Object.fromEntries(Object.entries(agg.winsByLevel).map(([k,v]) => [k, v/agg.gamesByLevel[k]]))
    }));
  } else {
    console.log('\n[done] ' + opts.missions + ' games in ' + tElapsed.toFixed(1) + 's (' +
                (opts.missions / tElapsed).toFixed(1) + ' games/sec)');
    console.log('\nPer-seat results:');
    for (let i = 0; i < opts.players; i++){
      console.log('  seat ' + i + ' (' + opts.seats[i] + '): ' +
                  agg.winsBySeat[i].toString().padStart(4) + ' wins  (' +
                  (100*agg.winsBySeat[i]/opts.missions).toFixed(1).padStart(5) + '%)' +
                  '   avg score: ' + (agg.totalBySeat[i]/opts.missions).toFixed(1).padStart(7));
    }
    console.log('\nPer-AI-level:');
    for (const lvl of Object.keys(agg.winsByLevel)){
      const w = agg.winsByLevel[lvl], gs = agg.gamesByLevel[lvl];
      console.log('  ' + lvl + ':  ' + w + '/' + gs + ' seat-wins  (' +
                  (100*w/gs).toFixed(1) + '% win rate)' +
                  '   avg score: ' + (agg.totalByLevel[lvl]/gs).toFixed(1));
    }
  }
}

main().catch(err => { console.error(err.stack || err); process.exit(1); });
