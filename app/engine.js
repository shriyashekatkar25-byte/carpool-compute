// Carpool Compute simulation engine (pure ES module: runs in a Web Worker, the main thread, and Node tests).
// Model, assumptions and constants are documented in docs/architecture.md and mirrored in backend/carpool/engine.py.

export const DEFAULTS = Object.freeze({
  tasks: 8,          // tasks per bundle (T)
  capK: 4,           // max tasks per shared environment (k); 1 = isolated (today)
  pPair: 0.005,      // probability a pair of tasks has a dependency conflict
  qCatch: 0.70,      // share of conflicts caught by the deploy-time check
  coldShare: 0.30,   // share of setups that are cold installs (mixture weight)
  mu: 70,            // envelope (exponential) mean, seconds
  nRuns: 20000,      // simulated job runs (enough power to certify the 0.3% hard-failure guardrail)
  seed: 102,
  unionOverhead: 0.12, // extra setup per additional task sharing an env (bigger dependency union)
  attachSec: 3,        // warm attach per extra task
  fallbackSec: 240,    // rerun penalty when a shared env conflicts and falls back to isolated
  hardFrac: 0.10,      // share of conflicts auto-fallback cannot fix
  sMax: 600,
});

export const GUARDRAILS = Object.freeze({
  minSavings: 0.30,   // lower 95% bound must clear
  maxConflict: 0.02,  // upper 95% Wilson bound must stay under
  maxHard: 0.003,     // upper 95% Wilson bound must stay under
  maxRerunPer100: 8,
});

// ---------- RNG ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- target density and envelope ----------
const gammaPdf = (s, k, th, gk) => Math.pow(s, k - 1) * Math.exp(-s / th) / (gk * Math.pow(th, k));
/** Setup-time density: mixture of a fast cached resolve (Gamma(2,18)) and a slow cold install (Gamma(4,30)). */
export function targetPdf(s, coldShare) {
  if (s <= 0) return 0;
  return (1 - coldShare) * gammaPdf(s, 2, 18, 1) + coldShare * gammaPdf(s, 4, 30, 6);
}
export function targetCdf(s, coldShare) {
  // closed form for integer-shape Gammas (Erlang)
  const erlang = (x, k, th) => { let sum = 0, term = 1; for (let i = 0; i < k; i++) { if (i) term *= (x / th) / i; sum += term; } return 1 - Math.exp(-x / th) * sum; };
  return s <= 0 ? 0 : (1 - coldShare) * erlang(s, 2, 18) + coldShare * erlang(s, 4, 30);
}
export const envelopePdf = (s, mu) => Math.exp(-s / mu) / mu;
export function envelopeM(coldShare, mu, sMax = 600) {
  let m = 0;
  for (let i = 1; i <= 6000; i++) { const s = (i * sMax) / 6000; m = Math.max(m, targetPdf(s, coldShare) / envelopePdf(s, mu)); }
  return m * 1.01; // safety margin: grid max can undershoot the true sup slightly
}

/** Rejection sampler (Ch4): proposals s = -mu ln(1-U) (Ch3 inverse CDF), keep if V <= f(s)/(M g(s)). */
export function rejectionSample(n, { coldShare, mu, sMax = 600 }, rng, keepTrace = 0) {
  const M = envelopeM(coldShare, mu, sMax);
  const out = new Float64Array(n); const trace = [];
  let kept = 0, proposals = 0;
  while (kept < n) {
    const s = -mu * Math.log(1 - rng());
    const v = rng();
    proposals++;
    if (s > sMax) { if (trace.length < keepTrace) trace.push([s, v * M * envelopePdf(s, mu), 0]); continue; }
    const ok = v <= targetPdf(s, coldShare) / (M * envelopePdf(s, mu));
    if (trace.length < keepTrace) trace.push([s, v * M * envelopePdf(s, mu), ok ? 1 : 0]);
    if (ok) out[kept++] = s;
  }
  return { draws: out, proposals, M, acceptance: n / proposals, trace };
}

// ---------- statistics helpers ----------
export function wilson(x, n, z = 1.96) {
  if (n === 0) return [0, 1];
  const p = x / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}
export function quantile(arr, q) {
  const b = Float64Array.from(arr).sort();
  const pos = (b.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return b[lo] + (b[hi] - b[lo]) * (pos - lo);
}
const T_975 = { 19: 2.093 };
/** Batch-means 95% CI for a ratio statistic 1 - sum(a)/sum(b) over B equal batches. */
function batchRatioCI(a, b, B = 20) {
  const n = a.length, size = Math.floor(n / B), vals = [];
  for (let j = 0; j < B; j++) { let sa = 0, sb = 0; for (let i = j * size; i < (j + 1) * size; i++) { sa += a[i]; sb += b[i]; } vals.push(1 - sa / sb); }
  const mean = vals.reduce((x, y) => x + y, 0) / B;
  const sd = Math.sqrt(vals.reduce((x, y) => x + (y - mean) ** 2, 0) / (B - 1));
  const half = T_975[B - 1] * sd / Math.sqrt(B);
  return [half, sd / Math.sqrt(B)];
}

// ---------- policy simulation ----------
/** Common random numbers: the same setup draws and uniforms are replayed for every cap k. */
export function makeWorld(params) {
  const P = { ...DEFAULTS, ...params };
  const rng = mulberry32(P.seed * 7919 + P.tasks);
  const need = P.nRuns * P.tasks;
  const sample = rejectionSample(need, P, rng, 900);
  const uConf = new Float64Array(need), uHard = new Float64Array(need);
  for (let i = 0; i < need; i++) { uConf[i] = rng(); uHard[i] = rng(); }
  return { P, ...sample, uConf, uHard };
}

export function simulateK(world, k, nRuns = world.P.nRuns, pPair = world.P.pPair) {
  const P = world.P, T = P.tasks, D = Math.ceil(T / 2), pe = pPair * (1 - P.qCatch);
  const costIso = new Float64Array(nRuns), costSh = new Float64Array(nRuns), dIso = new Float64Array(nRuns), dSh = new Float64Array(nRuns);
  let conflictRuns = 0, hardRuns = 0, reruns = 0;
  for (let r = 0; r < nRuns; r++) {
    const b = r * T; let iso = 0, isoD = 0, sh = 0, shD = 0, any = false, hard = false;
    for (let i = 0; i < T; i++) { const s = world.draws[b + i]; iso += s; if (i < D) isoD += s; }
    if (k === 1) { costIso[r] = costSh[r] = iso; dIso[r] = dSh[r] = isoD; continue; }
    for (let g0 = 0; g0 < T; g0 += k) {
      const m = Math.min(k, T - g0), pairs = m * (m - 1) / 2, pc = 1 - Math.pow(1 - pe, pairs);
      const base = world.draws[b + g0] * (1 + P.unionOverhead * (m - 1));
      let setup = base + P.attachSec * (m - 1);
      const onPath = g0 < D, pathTasks = Math.max(0, Math.min(D, g0 + m) - g0);
      let delay = base + P.attachSec * Math.max(0, pathTasks - 1);
      if (m > 1 && world.uConf[b + g0] < pc) {
        any = true; reruns += m;
        let fb = P.fallbackSec, fbD = P.fallbackSec;
        for (let i = g0; i < g0 + m; i++) { fb += world.draws[b + i]; if (i < D) fbD += world.draws[b + i]; }
        setup += fb; if (onPath) delay += fbD;
        if (world.uHard[b + g0] < P.hardFrac) hard = true;
      }
      sh += setup; if (onPath) shD += delay;
    }
    costIso[r] = iso; costSh[r] = sh; dIso[r] = isoD; dSh[r] = shD;
    if (any) conflictRuns++; if (hard) hardRuns++;
  }
  let sI = 0, sS = 0; for (let r = 0; r < nRuns; r++) { sI += costIso[r]; sS += costSh[r]; }
  const savings = 1 - sS / sI;
  const [half, se] = k === 1 ? [0, 0] : batchRatioCI(costSh, costIso);
  const [cLo, cHi] = wilson(conflictRuns, nRuns), [, hHi] = wilson(hardRuns, nRuns);
  const res = {
    k, nRuns, savings, savingsSE: se, savingsLo: savings - half, savingsHi: savings + half,
    conflict: conflictRuns / nRuns, conflictLo: cLo, conflictHi: cHi,
    hard: hardRuns / nRuns, hardHi: hHi, rerunPer100: reruns / nRuns * 100,
    p90Iso: quantile(dIso, 0.9), p90Shared: quantile(dSh, 0.9),
    minutesIso: sI / nRuns / 60, minutesShared: sS / nRuns / 60,
  };
  res.passes = passes(res, true);
  res.passesPoint = passes(res, false);
  return res;
}

export function passes(r, conservative = true) {
  if (r.k < 2) return false;
  const G = GUARDRAILS;
  const sav = conservative ? r.savingsLo : r.savings, conf = conservative ? r.conflictHi : r.conflict, hard = conservative ? r.hardHi : r.hard;
  return sav >= G.minSavings && conf <= G.maxConflict && hard <= G.maxHard && r.rerunPer100 <= G.maxRerunPer100 && r.p90Shared <= r.p90Iso + 1e-9;
}

export function failingGuardrails(r) {
  const G = GUARDRAILS, out = [];
  if (r.savingsLo < G.minSavings) out.push('savings');
  if (r.conflictHi > G.maxConflict) out.push('conflict');
  if (r.hardHi > G.maxHard) out.push('hard failures');
  if (r.rerunPer100 > G.maxRerunPer100) out.push('re-runs');
  if (r.p90Shared > r.p90Iso + 1e-9) out.push('P90 delay');
  return out;
}

/** Full evaluation: sweep every k, choose the largest k that passes (conservative and point rules). */
export function evaluate(params) {
  const world = makeWorld(params);
  const sweep = [];
  for (let k = 1; k <= world.P.tasks; k++) sweep.push(simulateK(world, k));
  const kstar = sweep.filter(r => r.passes).reduce((m, r) => Math.max(m, r.k), 0);
  const kstarPoint = sweep.filter(r => r.passesPoint).reduce((m, r) => Math.max(m, r.k), 0);
  return { params: world.P, sweep, kstar, kstarPoint, M: world.M, acceptance: world.acceptance, proposals: world.proposals, trace: world.trace, draws: world.draws.subarray(0, 4000) };
}

/** Decision landscape: savings and conflict over (k, pPair) with point estimates on a subsample (for the 3D surface). */
export function surface(params, pGrid, nRuns = 1200) {
  const world = makeWorld({ ...params, nRuns: Math.max(nRuns, 1) });
  const rows = [];
  for (const p of pGrid) {
    const row = [];
    for (let k = 1; k <= world.P.tasks; k++) {
      const r = simulateK(world, k, nRuns, p);
      row.push({ k, p, savings: r.savings, conflict: r.conflict, pass: r.passesPoint ? 1 : 0 });
    }
    rows.push(row);
  }
  return { tasks: world.P.tasks, pGrid, rows };
}
