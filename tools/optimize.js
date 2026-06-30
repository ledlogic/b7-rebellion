#!/usr/bin/env node
/**
 * Rebellion Beta-weights optimizer — (1+1)-ES with 1/5 success rule and
 * Common Random Numbers for variance reduction.
 *
 * Tunes `js/ai/beta-weights.json` against the tournament harness used as a
 * fitness function: Beta plays N games against a fixed opponent lineup
 * (Gamma by default), wins per evaluation = fitness. The algorithm:
 *
 *   1. Start from current beta-weights.json.
 *   2. Each generation, generate a child by Gaussian-perturbing each weight
 *      (mean 0, σ proportional to the weight's magnitude).
 *   3. Evaluate parent and child on the SAME seed (Common Random Numbers).
 *      This pairs the comparisons — both play the same dealings — and
 *      slashes variance vs. independent evaluations.
 *   4. If child ≥ parent on this seed, child takes over.
 *   5. Every K generations, adapt σ via the 1/5 success rule: if more than
 *      1/5 of recent mutations succeeded, σ *= 1.22; else σ *= 0.82.
 *   6. After all generations, write the best-ever parent to disk and run a
 *      large clean tournament to confirm the improvement is real and not
 *      seed-overfit.
 *
 * Usage:
 *   node tools/optimize.js [options]
 *
 * Options:
 *   --tier KEY           Which Beta variant to tune.        (default: beta-vs-gamma)
 *                        beta-vs-gamma | beta-vs-delta
 *   --generations N      Generations to run.                  (default: 100)
 *   --games-per-eval N   Games per fitness evaluation.        (default: 300)
 *   --vs LEVEL           Opponent tier for Beta to fight.     (default: gamma)
 *                        For meaningful Anti-Delta tuning, use --tier beta-vs-delta --vs delta
 *   --players N          Total seats (Beta + N-1 opponents).  (default: 4)
 *   --start-weights PATH Initial parent weights.              (default: js/ai/{tier}-weights.json)
 *   --output PATH        Where to write tuned weights.        (default: js/ai/{tier}-weights.json)
 *   --sigma N            Initial step size, multiplier of |w|.(default: 0.10)
 *   --base-seed N        First generation's CRN seed.         (default: 1)
 *   --validate N         Games for final clean tournament.    (default: 2000)
 *   --no-validate        Skip the post-optimization validation tournament.
 *
 * Examples:
 *   node tools/optimize.js --tier beta-vs-gamma --vs gamma --generations 600 --games-per-eval 1200 --validate 8000
 *   node tools/optimize.js --tier beta-vs-delta --vs delta --generations 600 --games-per-eval 1200 --validate 8000
 */
'use strict';

const fs    = require('fs');
const path  = require('path');
const harn  = require('./tournament.js');   // makeRng, loadGameContext, runOneGame

/* ---------------- CLI ---------------- */
function parseArgs(argv){
  const opts = {
    tier:          'beta-vs-gamma',   // which Beta variant to tune
    generations:   100,
    gamesPerEval:  300,
    vs:            'gamma',
    players:       4,
    startWeights:  null,              // resolved from tier below if not provided
    output:        null,
    sigma:         0.10,
    baseSeed:      1,
    validate:      2000,
    noValidate:    false
  };
  for (let i = 2; i < argv.length; i++){
    const a = argv[i];
    if      (a === '--tier')           opts.tier          = argv[++i];
    else if (a === '--generations')    opts.generations   = parseInt(argv[++i], 10);
    else if (a === '--games-per-eval') opts.gamesPerEval  = parseInt(argv[++i], 10);
    else if (a === '--vs')             opts.vs            = argv[++i];
    else if (a === '--players')        opts.players       = parseInt(argv[++i], 10);
    else if (a === '--start-weights')  opts.startWeights  = argv[++i];
    else if (a === '--output')         opts.output        = argv[++i];
    else if (a === '--sigma')          opts.sigma         = parseFloat(argv[++i]);
    else if (a === '--base-seed')      opts.baseSeed      = parseInt(argv[++i], 10);
    else if (a === '--validate')       opts.validate      = parseInt(argv[++i], 10);
    else if (a === '--no-validate')    opts.noValidate    = true;
    else if (a === '--help' || a === '-h'){ printHelp(); process.exit(0); }
    else throw new Error('Unknown option: ' + a);
  }
  if (opts.tier !== 'beta-vs-delta' && opts.tier !== 'beta-vs-gamma'){
    throw new Error('--tier must be beta-vs-delta or beta-vs-gamma (got: ' + opts.tier + ')');
  }
  /* Default paths derive from tier */
  if (!opts.startWeights) opts.startWeights = path.join(__dirname, '..', 'js', 'ai', opts.tier + '-weights.json');
  if (!opts.output)       opts.output       = path.join(__dirname, '..', 'js', 'ai', opts.tier + '-weights.json');
  return opts;
}
function printHelp(){
  console.log(fs.readFileSync(__filename, 'utf8').match(/\* Usage:[\s\S]*?\*\//)[0]
    .replace(/^\s*\*\s?/gm, ''));
}

/* ---------------- Gaussian sampler (Box-Muller) ----------------
 * Standard normal samples N(0,1). One pre-cached spare per call pair
 * for free, but for simplicity we just throw it away. */
function gauss(){
  let u, v;
  do { u = Math.random(); } while (u === 0);
  v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ---------------- Per-dimension mutation ----------------
 * For each weight w, child = w + σ * max(|w|, 1.0) * N(0,1).
 * The max-1.0 floor keeps small weights from being effectively frozen
 * (e.g. lead_basepoints_tiebreak = 0.1 should still move enough to matter). */
function mutate(parent, sigma){
  const child = {};
  for (const k of Object.keys(parent)){
    const w = parent[k];
    const scale = Math.max(Math.abs(w), 1.0);
    child[k] = w + sigma * scale * gauss();
  }
  return child;
}

/* ---------------- Fitness evaluation ----------------
 * Run `nGames` games with the candidate weights loaded into Beta. The
 * opponent tier is `vs` (default gamma) filling the remaining seats.
 * Returns Beta's win rate. The same `seed` is used by both parent and
 * child evaluations in a single generation — Common Random Numbers. */
async function evaluate(candidate, opts, seed, gammaWeights){
  const rng = harn.makeRng(seed);
  const ctx = harn.loadGameContext(rng);
  const R   = ctx.window.Rebellion;
  R.ai.get(opts.tier).setWeights(candidate);
  R.ai.get('gamma').setWeights(gammaWeights);
  const seats = [opts.tier].concat(new Array(opts.players - 1).fill(opts.vs));
  let betaWins = 0;
  for (let g = 0; g < opts.gamesPerEval; g++){
    const res = await harn.runOneGame(ctx, seats, rng);
    let winIdx = 0;
    for (let i = 1; i < res.totals.length; i++) if (res.totals[i] > res.totals[winIdx]) winIdx = i;
    if (winIdx === 0) betaWins++;   // tuned variant is always seat 0
  }
  return betaWins / opts.gamesPerEval;
}

/* ---------------- Main optimizer loop ---------------- */
async function main(){
  const opts = parseArgs(process.argv);

  console.log('===========================================================');
  console.log('  Rebellion Beta-weights optimizer  —  (1+1)-ES with CRN');
  console.log('===========================================================');
  console.log('  tier:           ' + opts.tier);
  console.log('  generations:    ' + opts.generations);
  console.log('  games per eval: ' + opts.gamesPerEval);
  console.log('  vs opponent:    ' + opts.vs + ' (×' + (opts.players - 1) + ')');
  console.log('  start σ:        ' + opts.sigma);
  console.log('  base seed:      ' + opts.baseSeed);
  console.log('  start weights:  ' + path.relative(process.cwd(), opts.startWeights));
  console.log('  output:         ' + path.relative(process.cwd(), opts.output));
  console.log();

  const gammaWeightsPath = path.join(__dirname, '..', 'js', 'ai', 'gamma-weights.json');
  const gammaWeights     = JSON.parse(fs.readFileSync(gammaWeightsPath, 'utf8'));

  let parent     = JSON.parse(fs.readFileSync(opts.startWeights, 'utf8'));
  let best       = Object.assign({}, parent);
  let sigma      = opts.sigma;
  let successes  = 0;     // sliding window counter for 1/5 rule
  const adaptK   = 10;    // adapt σ every K generations

  /* Establish baseline fitness for the starting parent (on a separate seed). */
  const validatorSeed = opts.baseSeed + 9999;   // fixed seed for ALL best-tracking comparisons
  const baseFit = await evaluate(parent, opts, validatorSeed, gammaWeights);
  let bestFit = baseFit;
  console.log('[baseline] parent fitness = ' + (baseFit*100).toFixed(1) + '% (seed ' + validatorSeed + ', ' + opts.gamesPerEval + ' games)');
  console.log();

  const t0 = Date.now();
  for (let g = 1; g <= opts.generations; g++){
    const seed = opts.baseSeed + g;
    /* Same seed for parent and child — Common Random Numbers. We re-evaluate
       the parent each generation because σ-adaptation moves us through
       different regions; the parent's fitness on a fresh seed is the
       fair comparison reference for this generation's child. */
    const child = mutate(parent, sigma);
    const fitParent = await evaluate(parent, opts, seed, gammaWeights);
    const fitChild  = await evaluate(child,  opts, seed, gammaWeights);

    const accept = (fitChild >= fitParent);
    if (accept){
      parent = child;
      successes++;
      /* Track the best ever via the FIXED validator seed so bestFit values
         are commensurate across generations. Without this, two "best"
         claims on different seeds aren't comparable — we'd just be chasing
         lucky CRN seeds rather than real improvement. */
      if (fitChild > bestFit){
        const bestVerify = await evaluate(child, opts, validatorSeed, gammaWeights);
        if (bestVerify > bestFit){
          best = Object.assign({}, child);
          bestFit = bestVerify;
        }
      }
    }

    const accSym = accept ? '✓' : ' ';
    console.log('[gen ' + g.toString().padStart(3) + '] σ=' + sigma.toFixed(3) +
                '  parent=' + (fitParent*100).toFixed(1).padStart(4) +
                '%  child=' + (fitChild*100).toFixed(1).padStart(4) +
                '%  ' + accSym +
                '  best=' + (bestFit*100).toFixed(1).padStart(4) + '%');

    /* 1/5 success-rule σ adaptation. */
    if (g % adaptK === 0){
      const rate = successes / adaptK;
      if      (rate > 1/5) sigma *= 1.22;
      else if (rate < 1/5) sigma *= 0.82;
      successes = 0;
      console.log('  -- adapt: success rate ' + (rate*100).toFixed(0) + '%, σ now ' + sigma.toFixed(3));
    }
  }
  const tElapsed = (Date.now() - t0) / 1000;
  console.log();
  console.log('[done] ' + opts.generations + ' generations in ' + tElapsed.toFixed(1) + 's');
  console.log('       best fitness during search: ' + (bestFit*100).toFixed(1) + '% (vs baseline ' + (baseFit*100).toFixed(1) + '%)');

  /* ---------------- Validation: large clean tournament on fresh seeds ----- */
  if (!opts.noValidate && opts.validate > 0){
    console.log();
    console.log('[validate] running ' + opts.validate + '-game clean tournament with the best weights...');
    const valOpts = Object.assign({}, opts, { gamesPerEval: opts.validate });
    const validSeed = 7777;  // fresh seed not used during optimization
    const validFit = await evaluate(best, valOpts, validSeed, gammaWeights);
    console.log('[validate] Beta vs ' + (opts.players - 1) + ' ' + opts.vs + ': ' +
                (validFit*100).toFixed(1) + '% win rate (' + opts.validate + ' games, seed ' + validSeed + ')');
    const baselineIQ = 100 + (1/opts.players - 1/opts.players) * 250 + (baseFit - 1/opts.players) * 250;
    const newIQ      = 100 + (validFit - 1/opts.players) * 250;
    console.log('[validate] estimated IQ: ' + newIQ.toFixed(0) + ' (was ' + baselineIQ.toFixed(0) + ' at start)');
  }

  /* Pretty-print weights, preserving 2-decimal precision for readability. */
  const formatted = '{\n' +
    Object.keys(best).map(k => '  "' + k + '": ' + roundForJson(best[k])).join(',\n') +
    '\n}\n';
  fs.writeFileSync(opts.output, formatted);
  console.log();
  console.log('[wrote] ' + path.relative(process.cwd(), opts.output));
}

function roundForJson(x){
  /* Keep ~3 significant figures of precision while staying readable.
     For weights of magnitude 0.01..0.99, round to 4 decimals.
     For 1..99, 2 decimals. For >=100, 1 decimal. */
  const a = Math.abs(x);
  if (a < 1)    return Number(x.toFixed(4));
  if (a < 100)  return Number(x.toFixed(2));
  return Number(x.toFixed(1));
}

main().catch(err => { console.error(err.stack || err); process.exit(1); });
