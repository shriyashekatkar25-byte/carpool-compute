// App controller: UI state <-> Web Worker compute <-> WebGL terrain, SVG charts, SQLite ledger.
import { DEFAULTS, GUARDRAILS, failingGuardrails, evaluate as evaluateSync, surface as surfaceSync } from './engine.js';
import { savingsChart, conflictChart, samplerChart, histogramChart, tornadoChart } from './charts.js';
import { Store, loadAnalytics } from './store.js';
let ANALYTICS = [];

const $ = (id) => document.getElementById(id);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const pct = (v, d = 1) => (v * 100).toFixed(d) + '%';
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
window.__app = { ready: false, errors: [] };

// ---------- headline: kinetic word reveal ----------
(function splitHeadline() {
  const h = $('headline'); const words = h.textContent.trim().split(/\s+/);
  h.innerHTML = words.map((w, i) => `<span class="w" aria-hidden="true"><span style="animation-delay:${80 + i * 70}ms">${esc(w)}</span></span>`).join(' ');
})();
if (!REDUCED && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal').forEach(n => io.observe(n));
} else document.querySelectorAll('.reveal').forEach(n => n.classList.add('in'));

// ---------- state ----------
const CTRL = {
  tasks: { to: v => +v, from: v => v, fmt: v => v },
  capK: { to: v => +v, from: v => v, fmt: v => v },
  pPair: { to: v => +v / 1000, from: v => Math.round(v * 1000), fmt: v => (v * 100).toFixed(2) + '%' },
  qCatch: { to: v => +v / 100, from: v => Math.round(v * 100), fmt: v => Math.round(v * 100) + '%' },
  coldShare: { to: v => +v / 100, from: v => Math.round(v * 100), fmt: v => Math.round(v * 100) + '%' },
  seed: { to: v => +v, from: v => v, fmt: v => v },
};
function readParams() {
  const P = {}; for (const [k, c] of Object.entries(CTRL)) P[k] = c.to($(k).value);
  $('capK').max = P.tasks; if (P.capK > P.tasks) { P.capK = P.tasks; $('capK').value = P.tasks; }
  return P;
}
function paint() {
  const P = readParams();
  for (const [k, c] of Object.entries(CTRL)) {
    $('o-' + k).textContent = c.fmt(P[k]);
    const el = $(k); el.style.setProperty('--fill', ((el.value - el.min) / (el.max - el.min) * 100) + '%');
  }
  return P;
}
function loadHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  for (const [k, c] of Object.entries(CTRL)) if (q.has(k)) { const v = Number(q.get(k)); if (Number.isFinite(v)) $(k).value = c.from(v); }
}
function saveHash(P) { const q = new URLSearchParams(); for (const k of Object.keys(CTRL)) q.set(k, P[k]); history.replaceState(null, '', '#' + q.toString()); }

// ---------- compute: worker with sync fallback ----------
let worker = null, seq = 0; const pending = new Map();
try {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.res(e.data) : p.rej(new Error(e.data.error)); };
  worker.onerror = (e) => { console.warn('worker failed, falling back to main thread', e.message); worker = null; };
} catch (e) { worker = null; }
function job(type, params) {
  if (worker) return new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); worker.postMessage({ id, type, params }); });
  const t0 = performance.now();
  const result = type === 'evaluate' ? evaluateSync(params) : surfaceSync(params, Array.from({ length: 13 }, (_, i) => +(i * 0.0025).toFixed(4)), 1500);
  return Promise.resolve({ ok: true, result, ms: performance.now() - t0 });
}

// ---------- 3D terrain (lazy, with fallback) ----------
let terrain = null, surfaceData = null, surfaceKey = '';
async function initTerrain() {
  try {
    // probe first: devices without WebGL2 never download the 650 KB three.js bundle
    const probe = document.createElement('canvas').getContext('webgl2');
    if (!probe) throw new Error('WebGL2 not supported');
    probe.getExtension('WEBGL_lose_context')?.loseContext();
    const { DecisionTerrain } = await import('./scene.js');
    terrain = new DecisionTerrain($('terrain3d'), {
      reducedMotion: REDUCED,
      onHover: (s, e) => {
        const tip = $('tip');
        if (!s || !e) { tip.classList.remove('on'); return; }
        const r = $('stage').getBoundingClientRect();
        tip.style.left = (e.clientX - r.left) + 'px'; tip.style.top = (e.clientY - r.top) + 'px';
        tip.innerHTML = `k = ${s.k} · pair conflict ${(s.p * 100).toFixed(2)}%<br>saved ${pct(s.savings)} · conflict ${pct(s.conflict, 2)}<br>${s.pass ? 'passes guardrails' : 'fails a guardrail'}`;
        tip.classList.add('on');
      },
      onPick: (s) => { $('capK').value = s.k; $('pPair').value = Math.round(s.p * 1000); schedule(); },
    });
  } catch (e) {
    console.warn('3D unavailable:', e.message);
    $('terrain3d').hidden = true;
    const fb = document.createElement('div'); fb.className = 'fallback'; fb.id = 'fallback2d';
    fb.innerHTML = '<p class="micro">3D view unavailable on this device. Showing the same data as a table.</p>';
    $('stage').appendChild(fb);
  }
}
function selFromParams(P) { return { i: P.capK - 1, j: Math.max(0, Math.min(12, Math.round(P.pPair / 0.0025))) }; }
function surfaceTable(data, host) {
  let h = '<table><caption class="micro" style="text-align:left;padding:8px 0">Setup minutes saved by cap k (columns) and pair conflict (rows). ✓ = passes all guardrails (point estimates).</caption><thead><tr><th>pair conflict</th>';
  data.rows[0].forEach(c => { h += `<th class="num">k=${c.k}</th>`; }); h += '</tr></thead><tbody>';
  data.rows.forEach(row => { h += `<tr><th>${(row[0].p * 100).toFixed(2)}%</th>` + row.map(c => `<td class="num">${pct(c.savings, 0)}${c.pass ? ' ✓' : ''}</td>`).join('') + '</tr>'; });
  host.innerHTML = h + '</tbody></table>';
}

// ---------- rendering ----------
let last = null, sens = null;
function countUp(node, to, fmt) {
  const from = parseFloat(node.dataset.v || '0'); node.dataset.v = to;
  if (REDUCED || !Number.isFinite(from)) { node.textContent = fmt(to); return; }
  const t0 = performance.now(), d = 520;
  const step = (t) => { const e = Math.min(1, (t - t0) / d), k = 1 - Math.pow(1 - e, 3); node.textContent = fmt(from + (to - from) * k); if (e < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function renderKPIs(ev, P) {
  const sel = ev.sweep[P.capK - 1], best = ev.kstar ? ev.sweep[ev.kstar - 1] : null;
  const host = $('kpis');
  if (!host.children.length) host.innerHTML = ['rec', 'sav', 'conf', 'p90'].map(id => `<div class="kpi" id="kpi-${id}"><span class="micro"></span><div class="v chrome-text">–</div><div class="ci"></div><span class="badge"></span></div>`).join('');
  const set = (id, label, val, fmt, ci, ok, badge) => {
    const n = $('kpi-' + id); n.querySelector('.micro').textContent = label; countUp(n.querySelector('.v'), val, fmt);
    n.querySelector('.ci').textContent = ci; const b = n.querySelector('.badge'); b.className = 'badge ' + (ok ? 'pass' : 'fail'); b.textContent = badge;
  };
  set('rec', 'Recommended cap (CI rule)', ev.kstar, v => (Math.round(v) || 'hold') + '', ev.kstarPoint !== ev.kstar ? `point rule would pick ${ev.kstarPoint || 'hold'}` : 'point rule agrees', !!ev.kstar, ev.kstar ? 'go' : 'hold');
  set('sav', `Saved at your k = ${sel.k}`, sel.savings * 100, v => v.toFixed(1) + '%', `95% CI ${pct(sel.savingsLo)}–${pct(sel.savingsHi)}`, sel.savingsLo >= GUARDRAILS.minSavings, sel.savingsLo >= GUARDRAILS.minSavings ? 'meets 30%' : 'below 30%');
  set('conf', 'Runs with a conflict', sel.conflict * 100, v => v.toFixed(2) + '%', `upper bound ${pct(sel.conflictHi, 2)}`, sel.conflictHi <= GUARDRAILS.maxConflict, sel.conflictHi <= GUARDRAILS.maxConflict ? 'within 2%' : 'over 2%');
  set('p90', 'P90 setup delay', sel.p90Shared / 60, v => v.toFixed(1) + 'm', `isolated ${(sel.p90Iso / 60).toFixed(1)}m`, sel.p90Shared <= sel.p90Iso + 1e-9, sel.p90Shared <= sel.p90Iso + 1e-9 ? 'faster' : 'slower');
  $('liveRec').textContent = ev.kstar ? `Recommendation: cap k = ${ev.kstar}` : 'Recommendation: hold';
}
function renderSweepTable(ev) {
  let h = '<table><thead><tr><th>k</th><th class="num">saved</th><th class="num">95% CI</th><th class="num">conflict</th><th class="num">upper</th><th class="num">hard (upper)</th><th class="num">re-runs/100</th><th class="num">P90 min</th><th>verdict</th></tr></thead><tbody>';
  for (const r of ev.sweep) {
    const f = failingGuardrails(r);
    h += `<tr${r.k === ev.kstar ? ' style="color:var(--blush)"' : ''}><td class="num">${r.k}</td><td class="num">${pct(r.savings)}</td><td class="num">${pct(r.savingsLo)}–${pct(r.savingsHi)}</td><td class="num">${pct(r.conflict, 2)}</td><td class="num">${pct(r.conflictHi, 2)}</td><td class="num">${pct(r.hardHi, 2)}</td><td class="num">${r.rerunPer100.toFixed(1)}</td><td class="num">${(r.p90Shared / 60).toFixed(2)}</td><td>${r.k === 1 ? 'baseline (isolated)' : r.passes ? 'pass' : 'fails: ' + f.join(', ')}</td></tr>`;
  }
  $('sweepTable').innerHTML = h + '</tbody></table>';
}
function renderRuleBox(ev) {
  const b = $('ruleBox');
  const pk = ev.kstarPoint, ck = ev.kstar, r = pk ? ev.sweep[pk - 1] : null;
  b.innerHTML = pk !== ck && r
    ? `<span class="micro">Why the CI rule matters</span><h3>Point rule: k = ${pk}. CI rule: k = ${ck || 'hold'}.</h3><p class="muted">At k = ${pk} the conflict estimate is ${pct(r.conflict, 2)}, under the 2% limit, but its 95% upper bound is ${pct(r.conflictHi, 2)}. Shipping on the estimate would mean betting the guardrail on noise.</p>`
    : `<span class="micro">Decision rule</span><h3>Both rules agree: k = ${ck || 'hold'}.</h3><p class="muted">The estimates and their pessimistic bounds lead to the same cap for this scenario.</p>`;
}
function renderMemo(ev, P) {
  const b = ev.kstar ? ev.sweep[ev.kstar - 1] : null, sel = ev.sweep[P.capK - 1], fails = failingGuardrails(sel);
  const qLo = sens && sens.rows.find(r => r.param === 'qCatch');
  $('memoBody').innerHTML = `<span class="verdict ${b ? '' : 'hold'}">${b ? `Go · default on · cap k = ${ev.kstar}` : 'Hold · keep sharing opt-in'}</span>
  <h3>Decision</h3><p>${b ? `Make shared environments the default for bundles, capped at ${ev.kstar} tasks per environment, with the deploy-time dependency check required.` : `Do not change the default. No cap clears every guardrail with 95% confidence under these assumptions; invest in the dependency check first.`}</p>
  <h3>Evidence</h3><p>${b ? `Across ${P.nRuns.toLocaleString()} simulated runs of a bundle with ${P.tasks} tasks (seed ${P.seed}), k = ${ev.kstar} cuts setup minutes by ${pct(b.savings)} (95% CI ${pct(b.savingsLo)}–${pct(b.savingsHi)}), from ${b.minutesIso.toFixed(1)} to ${b.minutesShared.toFixed(1)} env-minutes per run. Conflicts hit ${pct(b.conflict, 2)} of runs (upper bound ${pct(b.conflictHi, 2)}), and P90 setup delay falls from ${(b.p90Iso / 60).toFixed(1)} to ${(b.p90Shared / 60).toFixed(1)} minutes.` : `The best candidate still fails on ${failingGuardrails(ev.sweep.reduce((a, r) => (r.k > 1 && r.savings > a.savings ? r : a), ev.sweep[1])).join(', ')}.`} ${ev.kstarPoint !== ev.kstar ? `A point-estimate rule would have picked k = ${ev.kstarPoint || 'hold'}; I'm not willing to bet a guardrail on noise.` : ''} Your selected k = ${sel.k} ${sel.k === 1 ? 'is the isolated baseline.' : fails.length ? 'fails: ' + fails.join(', ') + '.' : 'clears every guardrail.'}</p>
  <h3>Risks</h3><p>The model assumes conflicts are independent across task pairs and that the deploy-time check catches ${pct(P.qCatch, 0)} of them.${qLo ? ` Sensitivity analysis shows the check's catch rate moves the cap from ${qLo.kstar_low || 'hold'} to ${qLo.kstar_high || 'hold'} across its plausible range, so it's the assumption to measure first.` : ''} One bad package upgrade now reaches every task in a shared environment.</p>
  <h3>Rollout</h3><p>Default-on for new bundles in 5% of workspaces with a holdout, then 25%, then 100%. Each step is gated on the same CI-bounded guardrails holding for two weeks. A workspace-level flag is the kill switch.</p>
  <h3>Next step</h3><p>Replace the assumed ${(P.pPair * 100).toFixed(2)}% per-pair conflict rate and the ${pct(P.qCatch, 0)} catch rate with beta telemetry, then rerun this exact analysis (seeded, reproducible).</p>
  <p class="vp">To the VP: ${b ? `Sharing environments cuts bundle setup time by about ${Math.round(b.savings * 100)}% if we cap it at ${ev.kstar} tasks, and we can show conflicts stay under 2% with 95% confidence.` : `Sharing saves real time, but today we can't prove it stays under our conflict limit, so we fix detection before flipping the default.`}</p>`;
}
function renderMethod(ev) {
  samplerChart($('chSampler'), ev); histogramChart($('chHist'), ev);
  $('samplerCap').textContent = `Envelope constant M = ${ev.M.toFixed(3)} → theoretical keep rate 1/M = ${pct(1 / ev.M)}; observed ${pct(ev.acceptance)} over ${ev.proposals.toLocaleString()} proposals.`;
}

// ---------- SQL ledger ----------
const store = new Store(); let activeQ = 'stability';
function table(res) {
  if (!res || !res.columns.length) return '<p class="muted">No rows yet. Save a few scenarios first.</p>';
  return `<table><thead><tr>${res.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${res.values.map(r => `<tr>${r.map(v => `<td${typeof v === 'number' ? ' class="num"' : ''}>${esc(v === null ? '—' : v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function renderLedger() {
  if (!store.db) return;
  const rows = store.listScenarios();
  $('ledgerList').innerHTML = rows.length ? rows.map(r => `<li><span><b>${esc(r.name)}</b><br><span class="micro">${r.tasks} tasks · ${(r.p * 100).toFixed(2)}% · check ${Math.round(r.q * 100)}%</span></span><span style="display:flex;gap:6px;align-items:center"><span class="tag ${r.verdict}">${r.verdict === 'go' ? 'k=' + r.kstar : 'hold'}</span><button class="btn" data-load="${r.id}" aria-label="Load ${esc(r.name)}">Load</button><button class="btn" data-del="${r.id}" aria-label="Delete ${esc(r.name)}">✕</button></span></li>`).join('') : '<li class="muted">No saved scenarios yet.</li>';
  const q = ANALYTICS.find(a => a.id === activeQ);
  $('qTabs').innerHTML = ANALYTICS.map(a => `<button class="btn" aria-pressed="${a.id === activeQ}" data-q="${a.id}">${esc(a.title)}</button>`).join('');
  $('qSql').textContent = q.sql;
  try { $('qOut').innerHTML = table(store.query(q.sql)); } catch (e) { $('qOut').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
async function initStore() {
  try {
    if (!window.initSqlJs) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/sql-wasm.js'; s.onload = res; s.onerror = () => rej(new Error('sql.js failed to load')); document.head.appendChild(s); });
    const SQL = await window.initSqlJs({ locateFile: f => 'vendor/' + f });
    const mig = await (await fetch('migrations/001_init.sql')).text();
    ANALYTICS = await loadAnalytics();
    await store.open(SQL, mig);
    const n = store.db.exec('SELECT COUNT(*) FROM scenarios')[0].values[0][0];
    $('dbState').textContent = `SQLite ${store.db.exec('select sqlite_version()')[0].values[0][0]} in WASM · ${n} saved scenario${n === 1 ? '' : 's'} · ${store.persistent ? 'persisted to IndexedDB' : 'in-memory (storage blocked)'}`;
    if (n === 0) await seedDemo();
    renderLedger();
  } catch (e) {
    store.error = e; $('dbState').textContent = 'Database unavailable: ' + e.message; window.__app.errors.push(String(e));
  }
}
/** First visit: write clearly labelled demo scenarios so the analytics have rows to query. */
async function seedDemo() {
  const demos = [['Demo · weak check (40%)', { qCatch: 0.4 }], ['Demo · base case', {}], ['Demo · strong check (90%)', { qCatch: 0.9 }], ['Demo · risky deps (1% per pair)', { pPair: 0.01 }]];
  for (const [name, over] of demos) {
    const params = { ...DEFAULTS, ...over };
    const r = (await job('evaluate', params)).result; r.params = params;
    store.saveScenario(name, r);
  }
  store.db.run("UPDATE scenarios SET source = 'seed' WHERE name LIKE 'Demo · %'");
  await store.flush();
  const n = store.db.exec('SELECT COUNT(*) FROM scenarios')[0].values[0][0];
  $('dbState').textContent = $('dbState').textContent.replace(/\d+ saved scenarios?/, `${n} saved scenarios (4 labelled demo)`);
}
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.q) { activeQ = t.dataset.q; renderLedger(); }
  if (t.dataset.del) { store.deleteScenario(+t.dataset.del); await store.flush(); renderLedger(); }
  if (t.dataset.load) {
    const r = store.db.exec('SELECT tasks, cap_k, p_pair, q_catch, cold_share, seed FROM scenarios WHERE id = ?', [+t.dataset.load])[0].values[0];
    ['tasks', 'capK', 'pPair', 'qCatch', 'coldShare', 'seed'].forEach((k, i) => { $(k).value = CTRL[k].from(r[i]); });
    schedule(); location.hash = location.hash; document.getElementById('terrain').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' });
  }
});
$('saveForm').addEventListener('submit', async (e) => {
  e.preventDefault(); if (!last || !store.db) return;
  try { store.saveScenario($('scName').value.trim(), last); await store.flush(); $('scName').value = ''; renderLedger(); $('dbState').textContent = $('dbState').textContent.replace(/\d+ saved scenarios?/, `${store.listScenarios().length} saved scenarios`); }
  catch (err) { $('dbState').textContent = 'Save failed: ' + err.message; }
});
$('runSql').addEventListener('click', () => { try { $('consoleOut').innerHTML = table(store.query($('console').value)); } catch (e) { $('consoleOut').innerHTML = `<p class="err">${esc(e.message)}</p>`; } });

// ---------- orchestration ----------
let timer = null, token = 0;
function schedule() { const P = paint(); clearTimeout(timer); timer = setTimeout(() => run(P), 110); }
async function run(P) {
  const my = ++token; saveHash(P);
  const params = { ...DEFAULTS, ...P };
  $('status').textContent = 'Simulating…';
  const key = [P.tasks, P.qCatch, P.coldShare, P.seed].join('|');
  try {
    const [ev, sf] = await Promise.all([job('evaluate', params), key !== surfaceKey ? job('surface', params) : Promise.resolve(null)]);
    if (my !== token) return; // a newer request superseded this one
    last = ev.result; last.params = params;
    if (sf) { surfaceData = sf.result; surfaceKey = key; if (terrain) terrain.setData(surfaceData, selFromParams(P)); if ($('fallback2d')) surfaceTable(surfaceData, $('fallback2d')); if (!$('surfaceTable').hidden) surfaceTable(surfaceData, $('surfaceTable')); }
    else if (terrain) { const s = selFromParams(P); terrain.select(s.i, s.j); }
    renderKPIs(last, P); savingsChart($('chSavings'), last); conflictChart($('chConflict'), last); renderSweepTable(last); renderRuleBox(last); renderMemo(last, params); renderMethod(last);
    $('status').textContent = `${params.nRuns.toLocaleString()} runs × ${P.tasks} caps in ${ev.ms.toFixed(0)} ms ${worker ? '(Web Worker)' : '(main thread)'}${sf ? ` · terrain ${sf.result.rows.length}×${P.tasks} cells in ${sf.ms.toFixed(0)} ms` : ''} · sampler keep rate ${pct(last.acceptance)}`;
    window.__app.ready = true; window.__app.last = { kstar: last.kstar, kstarPoint: last.kstarPoint, params: P };
  } catch (e) { $('status').textContent = 'Simulation failed: ' + e.message; window.__app.errors.push(String(e)); }
}
['tasks', 'capK', 'pPair', 'qCatch', 'coldShare', 'seed'].forEach(id => $(id).addEventListener('input', schedule));
$('reroll').addEventListener('click', () => { $('seed').value = 1 + Math.floor(Math.random() * 999); schedule(); });
$('share').addEventListener('click', async () => { try { await navigator.clipboard.writeText(location.href); $('share').textContent = 'Copied'; } catch { $('share').textContent = 'Link in address bar'; } setTimeout(() => { $('share').textContent = 'Copy link'; }, 1600); });
$('tableToggle').addEventListener('click', () => { const t = $('surfaceTable'), on = t.hidden; t.hidden = !on; $('tableToggle').setAttribute('aria-pressed', on); if (on && surfaceData) surfaceTable(surfaceData, t); });
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (last) { savingsChart($('chSavings'), last); conflictChart($('chConflict'), last); renderMethod(last); if (sens) tornadoChart($('chTornado'), sens); } }, 180); });

async function initSensitivity() {
  try {
    sens = await (await fetch('data/sensitivity.json')).json();
    tornadoChart($('chTornado'), sens);
    $('sensCap').textContent = `Base case cap k = ${sens.base_kstar}. Each bar moves one assumption to its low/high value with everything else fixed (${sens.n_runs.toLocaleString()} runs, seed ${sens.seed}, generated ${sens.generated}). Bars of zero width mean the call is robust to that assumption.`;
    if (last) renderMemo(last, last.params);
  } catch (e) { $('sensCap').textContent = 'Sensitivity data unavailable: ' + e.message; }
}

loadHash(); paint();
initTerrain().then(() => { schedule(); });
initStore(); initSensitivity();
