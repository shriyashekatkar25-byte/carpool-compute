// Accessible SVG charts. Every mark has a <title>; every chart has a text alternative and the table view.
import { targetPdf, envelopePdf, GUARDRAILS } from './engine.js';

const NS = 'http://www.w3.org/2000/svg';
const C = { ink: 'var(--fg)', muted: 'var(--fg-muted)', line: 'var(--rule)', pass: 'var(--blush)', fail: 'var(--graphite)', accent: 'var(--violet)' };
const fmtPct = (v, d = 1) => (v * 100).toFixed(d) + '%';

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
function frame(host, label, h = 240) {
  host.innerHTML = '';
  const w = Math.max(280, host.clientWidth || 600);
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', height: h, role: 'img', 'aria-label': label });
  el('title', {}, svg).textContent = label;
  host.appendChild(svg);
  return { svg, w, h };
}
function tip(node, text) { el('title', {}, node).textContent = text; return node; }
function axisY(svg, x0, y, ticks, fmt, w) {
  ticks.forEach(v => {
    el('line', { x1: x0, x2: w - 12, y1: y(v), y2: y(v), stroke: C.line, 'stroke-width': 1 }, svg);
    el('text', { x: x0 - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, svg).textContent = fmt(v);
  });
}

export function savingsChart(host, ev) {
  const { svg, w, h } = frame(host, `Setup minutes saved by cap k with 95% confidence intervals. CI rule picks k=${ev.kstar || 'none'}.`);
  const L = 48, B = 34, T = 18, n = ev.sweep.length;
  const x = k => L + (k - 1) / Math.max(1, n - 1) * (w - L - 24), y = v => h - B - v / 0.8 * (h - B - T);
  axisY(svg, L, y, [0, 0.2, 0.4, 0.6, 0.8], v => Math.round(v * 100) + '%', w);
  el('line', { x1: L, x2: w - 12, y1: y(GUARDRAILS.minSavings), y2: y(GUARDRAILS.minSavings), stroke: C.ink, 'stroke-dasharray': '4 4' }, svg);
  el('text', { x: w - 14, y: y(GUARDRAILS.minSavings) - 6, 'text-anchor': 'end', class: 'tick strong' }, svg).textContent = 'target ≥ 30% (lower bound)';
  const pts = ev.sweep.map(r => `${x(r.k)},${y(Math.max(0, r.savings))}`).join(' ');
  el('polyline', { points: pts, fill: 'none', stroke: C.accent, 'stroke-width': 2 }, svg);
  ev.sweep.forEach(r => {
    el('line', { x1: x(r.k), x2: x(r.k), y1: y(Math.max(0, r.savingsLo)), y2: y(Math.max(0, r.savingsHi)), stroke: C.ink, 'stroke-width': 2 }, svg);
    tip(el('circle', { cx: x(r.k), cy: y(Math.max(0, r.savings)), r: r.k === ev.kstar ? 7 : 4.5, fill: r.passes ? C.pass : C.fail, stroke: C.ink, 'stroke-width': 1.5, class: 'mark' }, svg),
      `k=${r.k}: ${fmtPct(r.savings)} saved (95% CI ${fmtPct(r.savingsLo)}–${fmtPct(r.savingsHi)})${r.passes ? ', passes all guardrails' : ''}`);
    el('text', { x: x(r.k), y: h - 12, 'text-anchor': 'middle', class: 'tick' }, svg).textContent = r.k;
  });
  el('text', { x: L, y: 12, class: 'tick' }, svg).textContent = 'setup minutes saved';
}

export function conflictChart(host, ev) {
  const maxV = Math.max(0.05, ...ev.sweep.map(r => r.conflictHi)) * 1.05;
  const { svg, w, h } = frame(host, `Share of runs with a dependency conflict by cap k, with Wilson 95% intervals, against the 2% limit.`);
  const L = 48, B = 34, T = 18, n = ev.sweep.length, bw = Math.min(34, (w - L - 24) / n * 0.55);
  const x = k => L + (k - 0.5) / n * (w - L - 24), y = v => h - B - v / maxV * (h - B - T);
  const ticks = [0, 0.01, 0.02, 0.03, 0.04, 0.05].filter(v => v <= maxV);
  axisY(svg, L, y, ticks, v => (v * 100).toFixed(0) + '%', w);
  ev.sweep.forEach(r => {
    tip(el('rect', { x: x(r.k) - bw / 2, y: y(r.conflict), width: bw, height: Math.max(0, y(0) - y(r.conflict)), fill: r.conflictHi <= GUARDRAILS.maxConflict ? C.pass : C.fail, rx: 2, class: 'mark' }, svg),
      `k=${r.k}: ${fmtPct(r.conflict, 2)} of runs conflict (95% CI ${fmtPct(r.conflictLo, 2)}–${fmtPct(r.conflictHi, 2)})`);
    el('line', { x1: x(r.k), x2: x(r.k), y1: y(r.conflictLo), y2: y(r.conflictHi), stroke: C.ink, 'stroke-width': 2 }, svg);
    el('text', { x: x(r.k), y: h - 12, 'text-anchor': 'middle', class: 'tick' }, svg).textContent = r.k;
  });
  el('line', { x1: L, x2: w - 12, y1: y(GUARDRAILS.maxConflict), y2: y(GUARDRAILS.maxConflict), stroke: C.ink, 'stroke-dasharray': '4 4' }, svg);
  el('text', { x: w - 14, y: y(GUARDRAILS.maxConflict) - 6, 'text-anchor': 'end', class: 'tick strong' }, svg).textContent = 'limit 2% (upper bound)';
  el('text', { x: L, y: 12, class: 'tick' }, svg).textContent = 'runs with a conflict';
}

export function samplerChart(host, ev) {
  const P = ev.params, M = ev.M;
  const { svg, w, h } = frame(host, `Rejection sampler: ${ev.trace.length} proposals under the envelope M·g; kept share ${fmtPct(ev.acceptance)} ≈ 1/M = ${fmtPct(1 / M)}.`, 220);
  const L = 14, B = 26, T = 12, ym = M * envelopePdf(0, P.mu) * 1.04;
  const x = s => L + s / 300 * (w - L - 12), y = v => h - B - Math.min(v, ym) / ym * (h - B - T);
  ev.trace.forEach(([s, v, ok]) => { if (s <= 300) el('circle', { cx: x(s), cy: y(v), r: 1.9, fill: ok ? C.accent : C.fail, opacity: ok ? 0.9 : 0.55 }, svg); });
  const path = fn => { let d = ''; for (let s = 0; s <= 300; s += 2) d += (s ? 'L' : 'M') + x(s).toFixed(1) + ' ' + y(fn(s)).toFixed(1); return d; };
  el('path', { d: path(s => targetPdf(s, P.coldShare)), fill: 'none', stroke: C.ink, 'stroke-width': 2 }, svg);
  el('path', { d: path(s => M * envelopePdf(s, P.mu)), fill: 'none', stroke: C.ink, 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }, svg);
  [0, 60, 120, 180, 240, 300].forEach(s => { el('text', { x: x(s), y: h - 8, 'text-anchor': 'middle', class: 'tick' }, svg).textContent = s + 's'; });
}

export function histogramChart(host, ev) {
  const P = ev.params, draws = ev.draws, bins = 40, max = 300, bw = max / bins, counts = new Array(bins).fill(0);
  let n = 0; for (const s of draws) { if (s < max) counts[Math.floor(s / bw)]++; n++; }
  const dens = counts.map(c => c / (n * bw));
  const { svg, w, h } = frame(host, `Validation: histogram of ${n.toLocaleString()} accepted draws versus the target density.`, 220);
  const L = 14, B = 26, T = 12, ym = Math.max(...dens, targetPdf(18, P.coldShare)) * 1.1;
  const x = s => L + s / max * (w - L - 12), y = v => h - B - v / ym * (h - B - T);
  dens.forEach((d, i) => el('rect', { x: x(i * bw) + 0.5, y: y(d), width: Math.max(0.5, x(bw) - x(0) - 1), height: y(0) - y(d), fill: C.accent, opacity: 0.55 }, svg));
  let p = ''; for (let s = 0; s <= max; s += 2) p += (s ? 'L' : 'M') + x(s).toFixed(1) + ' ' + y(targetPdf(s, P.coldShare)).toFixed(1);
  el('path', { d: p, fill: 'none', stroke: C.ink, 'stroke-width': 2 }, svg);
  [0, 60, 120, 180, 240, 300].forEach(s => { el('text', { x: x(s), y: h - 8, 'text-anchor': 'middle', class: 'tick' }, svg).textContent = s + 's'; });
}

export function tornadoChart(host, sens) {
  const rows = sens.rows, h = 40 + rows.length * 38;
  const { svg, w } = frame(host, `Sensitivity: how the recommended cap changes when each assumption moves to its low or high value. Base cap k=${sens.base_kstar}.`, h);
  const L = Math.min(210, w * 0.42), R = w - 52, maxK = Math.max(...rows.flatMap(r => [r.kstar_low, r.kstar_high]), sens.base_kstar, 4);
  const x = k => L + k / maxK * (R - L);
  for (let k = 0; k <= maxK; k++) { el('line', { x1: x(k), x2: x(k), y1: 22, y2: h - 10, stroke: C.line }, svg); el('text', { x: x(k), y: 14, 'text-anchor': 'middle', class: 'tick' }, svg).textContent = k === 0 ? 'hold' : 'k=' + k; }
  el('line', { x1: x(sens.base_kstar), x2: x(sens.base_kstar), y1: 22, y2: h - 10, stroke: C.ink, 'stroke-width': 2 }, svg);
  rows.forEach((r, i) => {
    const yy = 30 + i * 38;
    el('text', { x: L - 10, y: yy + 14, 'text-anchor': 'end', class: 'tick strong' }, svg).textContent = r.label;
    const a = Math.min(r.kstar_low, r.kstar_high), b = Math.max(r.kstar_low, r.kstar_high);
    tip(el('rect', { x: x(a), y: yy + 2, width: Math.max(3, x(b) - x(a)), height: 18, fill: a === b ? C.fail : C.pass, rx: 3, class: 'mark' }, svg),
      `${r.label}: ${r.low_label} → cap ${r.kstar_low || 'hold'}; ${r.high_label} → cap ${r.kstar_high || 'hold'}`);
    const lowLeft = r.kstar_low <= r.kstar_high;
    el('text', { x: x(r.kstar_low) + (lowLeft ? -4 : 4), y: yy + 33, 'text-anchor': lowLeft ? 'end' : 'start', class: 'tick' }, svg).textContent = r.low_label;
    if (r.kstar_low !== r.kstar_high) el('text', { x: x(r.kstar_high) + (lowLeft ? 4 : -4), y: yy + 33, 'text-anchor': lowLeft ? 'start' : 'end', class: 'tick' }, svg).textContent = r.high_label;
    else el('text', { x: x(b) + 4, y: yy + 33, class: 'tick' }, svg).textContent = `(${r.high_label}: no change)`;
  });
}
