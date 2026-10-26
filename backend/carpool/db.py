"""SQLite persistence: applies the shared migrations and runs the shared analytics queries."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from .engine import Evaluation

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = sorted((ROOT / "migrations").glob("*.sql"))
ANALYTICS = json.loads((ROOT / "sql" / "analytics.json").read_text())


def connect(path: str | Path = ":memory:") -> sqlite3.Connection:
    con = sqlite3.connect(str(path), check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    migrate(con)
    return con


def migrate(con: sqlite3.Connection) -> list[int]:
    """Apply every migration file; each is idempotent and records its version."""
    for f in MIGRATIONS:
        con.executescript(f.read_text())
    con.commit()
    return [r[0] for r in con.execute("SELECT version FROM schema_migrations ORDER BY version")]


def save(con: sqlite3.Connection, name: str, ev: Evaluation, source: str = "api") -> int:
    p = ev.params
    with con:  # transaction: all rows or none
        cur = con.execute(
            "INSERT INTO scenarios(name,source,tasks,cap_k,p_pair,q_catch,cold_share,n_runs,seed) VALUES (?,?,?,?,?,?,?,?,?)",
            (name[:80] or "untitled", source, p.tasks, p.cap_k, p.p_pair, p.q_catch, p.cold_share, p.n_runs, p.seed))
        sid = cur.lastrowid
        con.executemany("INSERT INTO results VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
            (sid, r.k, r.savings, r.savings_lo, r.savings_hi, r.conflict, r.conflict_lo, r.conflict_hi, r.hard, r.hard_hi,
             r.rerun_per100, r.p90_iso, r.p90_shared, int(r.passes)) for r in ev.sweep])
        con.execute("INSERT INTO decisions VALUES (?,?,?,?,?)",
                    (sid, ev.kstar, ev.kstar_point, "go" if ev.kstar else "hold", ev.acceptance))
    return int(sid)


def list_scenarios(con: sqlite3.Connection) -> list[dict]:
    rows = con.execute("""SELECT s.id, s.name, s.created_at, s.source, s.tasks, s.cap_k, s.p_pair, s.q_catch,
                                 d.verdict, d.kstar, d.kstar_point
                          FROM scenarios s JOIN decisions d ON d.scenario_id = s.id ORDER BY s.id DESC""")
    return [dict(r) for r in rows]


def run_analytics(con: sqlite3.Connection, query_id: str) -> dict:
    q = next((a for a in ANALYTICS if a["id"] == query_id), None)
    if q is None:
        raise KeyError(query_id)
    cur = con.execute(q["sql"])
    cols = [c[0] for c in cur.description]
    return {"id": q["id"], "title": q["title"], "columns": cols, "rows": [list(r) for r in cur.fetchall()]}
