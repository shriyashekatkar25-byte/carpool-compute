// SQL persistence in the browser: SQLite (sql.js / WASM) + IndexedDB snapshot.
// The schema is the same migrations/001_init.sql the Python API applies.
const IDB_NAME = 'carpool-compute', IDB_STORE = 'db', IDB_KEY = 'sqlite-v1';

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbGet() { try { const d = await idb(); return await new Promise((res) => { const t = d.transaction(IDB_STORE).objectStore(IDB_STORE).get(IDB_KEY); t.onsuccess = () => res(t.result || null); t.onerror = () => res(null); }); } catch { return null; } }
async function idbPut(bytes) { try { const d = await idb(); await new Promise((res, rej) => { const t = d.transaction(IDB_STORE, 'readwrite'); t.objectStore(IDB_STORE).put(bytes, IDB_KEY); t.oncomplete = res; t.onerror = () => rej(t.error); }); return true; } catch { return false; } }

// Analytics queries live in sql/analytics.json (single source of truth, also executed by the Python test suite).
export async function loadAnalytics(base = '') { return (await fetch(base + 'sql/analytics.json')).json(); }

export class Store {
  constructor() { this.db = null; this.persistent = false; this.error = null; }
  async open(SQL, migrationSql) {
    const saved = await idbGet();
    this.db = saved ? new SQL.Database(new Uint8Array(saved)) : new SQL.Database();
    this.db.run('PRAGMA foreign_keys = ON;');
    this.db.exec(migrationSql); // idempotent (IF NOT EXISTS / INSERT OR IGNORE)
    this.persistent = typeof indexedDB !== 'undefined';
    return this;
  }
  async flush() { if (this.db) this.persistent = await idbPut(this.db.export()); }
  saveScenario(name, evalResult) {
    const P = evalResult.params, db = this.db;
    db.run('BEGIN');
    try {
      db.run(`INSERT INTO scenarios(name,source,tasks,cap_k,p_pair,q_catch,cold_share,n_runs,seed) VALUES (?,?,?,?,?,?,?,?,?)`,
        [name.slice(0, 80) || 'untitled', 'browser', P.tasks, P.capK, P.pPair, P.qCatch, P.coldShare, P.nRuns, P.seed]);
      const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
      const st = db.prepare(`INSERT INTO results VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const r of evalResult.sweep) st.run([id, r.k, r.savings, r.savingsLo, r.savingsHi, r.conflict, r.conflictLo, r.conflictHi, r.hard, r.hardHi, r.rerunPer100, r.p90Iso, r.p90Shared, r.passes ? 1 : 0]);
      st.free();
      db.run(`INSERT INTO decisions VALUES (?,?,?,?,?)`, [id, evalResult.kstar, evalResult.kstarPoint, evalResult.kstar ? 'go' : 'hold', evalResult.acceptance]);
      db.run('COMMIT');
      return id;
    } catch (e) { db.run('ROLLBACK'); throw e; }
  }
  deleteScenario(id) { this.db.run('DELETE FROM scenarios WHERE id = ?', [id]); }
  listScenarios() {
    const r = this.db.exec(`SELECT s.id, s.name, s.created_at, s.tasks, s.cap_k, s.p_pair, s.q_catch, d.verdict, d.kstar
      FROM scenarios s JOIN decisions d ON d.scenario_id = s.id ORDER BY s.id DESC LIMIT 50`);
    return r[0] ? r[0].values.map(v => ({ id: v[0], name: v[1], created: v[2], tasks: v[3], k: v[4], p: v[5], q: v[6], verdict: v[7], kstar: v[8] })) : [];
  }
  /** Read-only query console: single SELECT/WITH statement, executed inside a savepoint that is always rolled back. */
  query(sql) {
    const clean = sql.trim().replace(/;\s*$/, '');
    if (!/^(select|with)\b/i.test(clean)) throw new Error('Only a single SELECT (or WITH … SELECT) statement is allowed.');
    if (/;/.test(clean)) throw new Error('One statement at a time.');
    if (/\b(insert|update|delete|drop|alter|create|attach|pragma|replace|vacuum)\b/i.test(clean)) throw new Error('Write statements are blocked in the console.');
    this.db.run('SAVEPOINT ro');
    try { const r = this.db.exec(clean); return r[0] || { columns: [], values: [] }; }
    finally { this.db.run('ROLLBACK TO ro'); this.db.run('RELEASE ro'); }
  }
}
