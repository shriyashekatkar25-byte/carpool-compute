import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Store } from '../../app/store.js';
import { evaluate } from '../../app/engine.js';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const root = new URL('../../', import.meta.url);
const MIG = readFileSync(new URL('migrations/001_init.sql', root), 'utf8');
const ANALYTICS = JSON.parse(readFileSync(new URL('sql/analytics.json', root), 'utf8'));

async function fresh() { const SQL = await initSqlJs(); return new Store().open(SQL, MIG); }

test('migration is idempotent and records version 1', async () => {
  const s = await fresh(); s.db.exec(MIG); s.db.exec(MIG);
  assert.deepEqual(s.db.exec('SELECT version FROM schema_migrations')[0].values, [[1]]);
});

test('saving a scenario writes scenario, one result per k, and a decision', async () => {
  const s = await fresh(); const ev = evaluate({ nRuns: 2000 });
  const id = s.saveScenario('base', ev);
  assert.equal(s.db.exec('SELECT COUNT(*) FROM results WHERE scenario_id=' + id)[0].values[0][0], 8);
  assert.equal(s.listScenarios()[0].kstar, ev.kstar);
});

test('every shared analytics query runs', async () => {
  const s = await fresh();
  for (const q of [0.4, 0.7, 0.9]) s.saveScenario('q' + q, evaluate({ nRuns: 2000, qCatch: q }));
  for (const a of ANALYTICS) assert.ok(s.query(a.sql).columns.length > 0, a.id);
});

test('console blocks writes and multi-statements, and never mutates', async () => {
  const s = await fresh(); s.saveScenario('keep me', evaluate({ nRuns: 1000 }));
  for (const bad of ['DELETE FROM scenarios', 'DROP TABLE results', 'SELECT 1; DELETE FROM scenarios', 'WITH x AS (SELECT 1) DELETE FROM scenarios', 'PRAGMA foreign_keys=OFF'])
    assert.throws(() => s.query(bad));
  assert.equal(s.query('SELECT COUNT(*) AS n FROM scenarios').values[0][0], 1);
});

test('cascade delete removes results and decisions', async () => {
  const s = await fresh(); const id = s.saveScenario('x', evaluate({ nRuns: 1000 }));
  s.deleteScenario(id);
  assert.equal(s.db.exec('SELECT COUNT(*) FROM results')[0].values[0][0], 0);
  assert.equal(s.db.exec('SELECT COUNT(*) FROM decisions')[0].values[0][0], 0);
});
