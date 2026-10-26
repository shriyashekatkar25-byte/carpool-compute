from fastapi.testclient import TestClient

from carpool import db
from carpool.api import app
from carpool.engine import Params, evaluate


def test_migrations_idempotent():
    con = db.connect()
    assert db.migrate(con) == [1]
    assert db.migrate(con) == [1]


def test_save_and_all_shared_analytics_queries_run():
    con = db.connect()
    for q in (0.4, 0.7, 0.9):
        db.save(con, f"check {q}", evaluate(Params(n_runs=2_000, q_catch=q)))
    assert len(db.list_scenarios(con)) == 3
    for a in db.ANALYTICS:
        out = db.run_analytics(con, a["id"])
        assert out["columns"], a["id"]
    stab = db.run_analytics(con, "stability")
    assert sum(r[2] for r in stab["rows"]) == 3


def test_cascade_delete():
    con = db.connect()
    sid = db.save(con, "x", evaluate(Params(n_runs=1_000)))
    con.execute("DELETE FROM scenarios WHERE id = ?", (sid,))
    assert con.execute("SELECT COUNT(*) FROM results").fetchone()[0] == 0


client = TestClient(app)


def test_api_end_to_end():
    assert client.get("/health").json()["ok"]
    r = client.post("/simulate", json={"n_runs": 2000})
    assert r.status_code == 200 and r.json()["sweep"][0]["k"] == 1
    r = client.post("/scenarios", json={"name": "api test", "n_runs": 2000, "q_catch": 0.9})
    assert r.status_code == 201
    assert any(s["name"] == "api test" for s in client.get("/scenarios").json())
    assert client.get("/analytics/stability").status_code == 200
    assert client.get("/analytics/nope").status_code == 404


def test_api_validation():
    assert client.post("/simulate", json={"tasks": 99}).status_code == 422
    assert client.post("/scenarios", json={"name": ""}).status_code == 422
    assert client.get("/sensitivity?n_runs=10").status_code == 422
