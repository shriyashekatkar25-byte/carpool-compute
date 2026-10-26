import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, rejectionSample, mulberry32, targetCdf, targetPdf, envelopeM, envelopePdf, wilson, surface, failingGuardrails } from '../../app/engine.js';

test('envelope dominates target everywhere on [0, 600]', () => {
  const M = envelopeM(0.3, 70);
  for (let s = 0.05; s <= 600; s += 0.05) assert.ok(targetPdf(s, 0.3) <= M * envelopePdf(s, 70) + 1e-12, `s=${s}`);
});

test('rejection sampler: KS distance vs exact CDF is small, keep rate ~ 1/M', () => {
  const { draws, acceptance, M, proposals } = rejectionSample(50000, { coldShare: 0.3, mu: 70 }, mulberry32(5));
  const sorted = Float64Array.from(draws).sort(); let D = 0;
  for (let i = 0; i < sorted.length; i++) { const F = targetCdf(sorted[i], 0.3); D = Math.max(D, Math.abs(F - i / sorted.length), Math.abs(F - (i + 1) / sorted.length)); }
  assert.ok(D < 1.63 / Math.sqrt(sorted.length), `KS D=${D}`); // 1% critical value
  const se = Math.sqrt((1 / M) * (1 - 1 / M) / proposals);
  assert.ok(Math.abs(acceptance - 1 / M) < 4.5 * se);
});

test('seeded runs are reproducible; different seeds differ', () => {
  const a = evaluate({ nRuns: 2000 }), b = evaluate({ nRuns: 2000 }), c = evaluate({ nRuns: 2000, seed: 9 });
  assert.deepEqual(a.sweep.map(r => r.savings), b.sweep.map(r => r.savings));
  assert.notDeepEqual(a.sweep.map(r => r.savings), c.sweep.map(r => r.savings));
});

test('k = 1 is the isolated baseline and never passes', () => {
  const r = evaluate({ nRuns: 2000 }).sweep[0];
  assert.equal(r.savings, 0); assert.equal(r.conflict, 0); assert.equal(r.passes, false);
});

test('CI rule never ships a larger cap than the point rule', () => {
  for (const seed of [101, 102, 103, 104]) { const e = evaluate({ nRuns: 5000, seed }); assert.ok(e.kstar <= e.kstarPoint); }
});

test('perfect deploy check removes conflicts; failing guardrails are reported', () => {
  const e = evaluate({ nRuns: 3000, qCatch: 1 });
  e.sweep.forEach(r => assert.equal(r.conflict, 0));
  const bad = evaluate({ nRuns: 3000, pPair: 0.03, qCatch: 0 }).sweep[7];
  assert.ok(failingGuardrails(bad).includes('conflict'));
});

test('wilson interval brackets the estimate', () => {
  const [lo, hi] = wilson(37, 2000); assert.ok(lo < 37 / 2000 && 37 / 2000 < hi);
});

test('surface grid has the right shape and bounded values', () => {
  const s = surface({ tasks: 6 }, [0, 0.01, 0.02], 500);
  assert.equal(s.rows.length, 3); assert.equal(s.rows[0].length, 6);
  for (const row of s.rows) for (const c of row) { assert.ok(c.conflict >= 0 && c.conflict <= 1); assert.ok(c.savings <= 1); }
});

test('performance budget: 20k runs x 8 caps under 1.5 s', () => {
  const t = performance.now(); evaluate({}); const ms = performance.now() - t;
  assert.ok(ms < 1500, `${ms} ms`);
});
