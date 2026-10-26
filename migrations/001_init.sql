-- Carpool Compute schema v1. Shared by the browser (sql.js) and the Python API (sqlite3).
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scenarios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  source      TEXT    NOT NULL DEFAULT 'browser' CHECK (source IN ('browser','api','seed')),
  tasks       INTEGER NOT NULL CHECK (tasks BETWEEN 2 AND 16),
  cap_k       INTEGER NOT NULL CHECK (cap_k >= 1),
  p_pair      REAL    NOT NULL CHECK (p_pair BETWEEN 0 AND 0.05),
  q_catch     REAL    NOT NULL CHECK (q_catch BETWEEN 0 AND 1),
  cold_share  REAL    NOT NULL CHECK (cold_share BETWEEN 0 AND 1),
  n_runs      INTEGER NOT NULL CHECK (n_runs > 0),
  seed        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  k           INTEGER NOT NULL,
  savings     REAL NOT NULL, savings_lo REAL NOT NULL, savings_hi REAL NOT NULL,
  conflict    REAL NOT NULL, conflict_lo REAL NOT NULL, conflict_hi REAL NOT NULL,
  hard        REAL NOT NULL, hard_hi REAL NOT NULL,
  rerun_per100 REAL NOT NULL,
  p90_iso_s   REAL NOT NULL, p90_shared_s REAL NOT NULL,
  passes      INTEGER NOT NULL CHECK (passes IN (0,1)),
  PRIMARY KEY (scenario_id, k)
);

CREATE TABLE IF NOT EXISTS decisions (
  scenario_id   INTEGER PRIMARY KEY REFERENCES scenarios(id) ON DELETE CASCADE,
  kstar         INTEGER NOT NULL,          -- 0 = hold (no cap passes)
  kstar_point   INTEGER NOT NULL,          -- what a point-estimate rule would pick
  verdict       TEXT NOT NULL CHECK (verdict IN ('go','hold')),
  sampler_accept REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_results_pass ON results(passes, k);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
