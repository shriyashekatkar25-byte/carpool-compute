"""FastAPI service: same engine and schema as the browser app, for batch analysis and integration."""
from __future__ import annotations

import logging
import os
import time
from functools import lru_cache

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from . import db
from .engine import Params, evaluate
from .analysis import sensitivity

log = logging.getLogger("carpool.api")
logging.basicConfig(level=logging.INFO, format='{"ts":"%(asctime)s","level":"%(levelname)s","msg":%(message)s}')


class SimRequest(BaseModel):
    tasks: int = Field(8, ge=2, le=16)
    cap_k: int = Field(4, ge=1, le=16)
    p_pair: float = Field(0.005, ge=0, le=0.05)
    q_catch: float = Field(0.70, ge=0, le=1)
    cold_share: float = Field(0.30, ge=0.0, le=1.0)
    n_runs: int = Field(20_000, ge=1_000, le=100_000)
    seed: int = Field(102, ge=0, le=2**31 - 1)

    def params(self) -> Params:
        fields = self.model_dump(include=set(SimRequest.model_fields))
        return Params(**{**fields, "cap_k": min(self.cap_k, self.tasks)})


class SaveRequest(SimRequest):
    name: str = Field(..., min_length=1, max_length=80)


app = FastAPI(title="Carpool Compute API", version="1.0.0")
_con = db.connect(os.environ.get("CARPOOL_DB", ":memory:"))


@lru_cache(maxsize=256)
def _cached(p: Params):  # Params is frozen/hashable: identical requests reuse the evaluation
    return evaluate(p)


@app.middleware("http")
async def timing(request: Request, call_next):
    t0 = time.perf_counter()
    resp = await call_next(request)
    log.info('"%s %s -> %s in %.1f ms"', request.method, request.url.path, resp.status_code, (time.perf_counter() - t0) * 1000)
    return resp


@app.get("/health")
def health() -> dict:
    v = [r[0] for r in _con.execute("SELECT version FROM schema_migrations")]
    return {"ok": True, "schema_versions": v}


@app.post("/simulate")
def simulate(req: SimRequest) -> dict:
    return _cached(req.params()).to_dict()


@app.post("/scenarios", status_code=201)
def create_scenario(req: SaveRequest) -> dict:
    ev = _cached(req.params())
    sid = db.save(_con, req.name, ev, source="api")
    return {"id": sid, "kstar": ev.kstar, "verdict": "go" if ev.kstar else "hold"}


@app.get("/scenarios")
def get_scenarios() -> list[dict]:
    return db.list_scenarios(_con)


@app.get("/analytics/{query_id}")
def analytics(query_id: str) -> dict:
    try:
        return db.run_analytics(_con, query_id)
    except KeyError:
        raise HTTPException(404, f"unknown analytics query '{query_id}'")


@app.get("/sensitivity")
def get_sensitivity(n_runs: int = 5_000, seed: int = 102) -> dict:
    if not 1_000 <= n_runs <= 50_000:
        raise HTTPException(422, "n_runs must be within [1000, 50000]")
    return sensitivity(Params(n_runs=n_runs, seed=seed))
