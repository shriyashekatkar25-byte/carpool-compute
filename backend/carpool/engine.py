"""Vectorized NumPy implementation of the Carpool Compute model.

Mirrors app/engine.js (same model, same guardrails, independent RNG). The parity test in
backend/tests/test_parity.py checks both implementations agree within Monte Carlo error.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict, replace
from math import sqrt

import numpy as np
from scipy import stats


@dataclass(frozen=True)
class Params:
    tasks: int = 8
    cap_k: int = 4
    p_pair: float = 0.005
    q_catch: float = 0.70
    cold_share: float = 0.30
    mu: float = 70.0
    n_runs: int = 20_000
    seed: int = 102
    union_overhead: float = 0.12
    attach_sec: float = 3.0
    fallback_sec: float = 240.0
    hard_frac: float = 0.10
    s_max: float = 600.0

    def __post_init__(self) -> None:
        if not 2 <= self.tasks <= 16:
            raise ValueError("tasks must be in [2, 16]")
        if not 1 <= self.cap_k <= self.tasks:
            raise ValueError("cap_k must be in [1, tasks]")
        for name in ("p_pair", "q_catch", "cold_share", "hard_frac"):
            v = getattr(self, name)
            if not 0.0 <= v <= 1.0:
                raise ValueError(f"{name} must be a probability")
        if self.n_runs < 20 or self.mu <= 0:
            raise ValueError("n_runs >= 20 and mu > 0 required")

    def with_(self, **kw) -> "Params":
        return replace(self, **kw)


GUARDRAILS = {"min_savings": 0.30, "max_conflict": 0.02, "max_hard": 0.003, "max_rerun_per100": 8.0}


# ---------------------------------------------------------------- densities
def target_pdf(s: np.ndarray, cold_share: float) -> np.ndarray:
    s = np.asarray(s, dtype=float)
    fast = stats.gamma.pdf(s, a=2, scale=18)
    cold = stats.gamma.pdf(s, a=4, scale=30)
    return (1 - cold_share) * fast + cold_share * cold


def target_cdf(s: np.ndarray, cold_share: float) -> np.ndarray:
    return (1 - cold_share) * stats.gamma.cdf(s, a=2, scale=18) + cold_share * stats.gamma.cdf(s, a=4, scale=30)


def envelope_pdf(s: np.ndarray, mu: float) -> np.ndarray:
    return np.exp(-np.asarray(s, dtype=float) / mu) / mu


def envelope_m(cold_share: float, mu: float, s_max: float = 600.0) -> float:
    grid = np.linspace(s_max / 6000, s_max, 6000)
    return float(np.max(target_pdf(grid, cold_share) / envelope_pdf(grid, mu)) * 1.01)


@dataclass
class Sample:
    draws: np.ndarray
    proposals: int
    m: float

    @property
    def acceptance(self) -> float:
        return len(self.draws) / self.proposals


def rejection_sample(n: int, cold_share: float, mu: float, rng: np.random.Generator, s_max: float = 600.0) -> Sample:
    """Ch4 rejection sampling with an exponential envelope drawn by inverse CDF (Ch3)."""
    m = envelope_m(cold_share, mu, s_max)
    out: list[np.ndarray] = []
    kept = proposals = 0
    while kept < n:
        batch = max(1024, int((n - kept) * m * 1.1))
        s = -mu * np.log1p(-rng.random(batch))
        v = rng.random(batch)
        ok = (s <= s_max) & (v <= target_pdf(s, cold_share) / (m * envelope_pdf(s, mu)))
        # count proposals up to the point where we have enough accepted draws (exact keep-rate accounting)
        idx = np.flatnonzero(ok)
        need = n - kept
        if len(idx) >= need:
            proposals += int(idx[need - 1]) + 1
            out.append(s[idx[:need]])
            kept = n
        else:
            proposals += batch
            out.append(s[idx])
            kept += len(idx)
    return Sample(np.concatenate(out), proposals, m)


# ---------------------------------------------------------------- statistics
def wilson(x: int, n: int, z: float = 1.959964) -> tuple[float, float]:
    if n == 0:
        return 0.0, 1.0
    p = x / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    h = z * sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return max(0.0, (c - h) / d), min(1.0, (c + h) / d)


def batch_ratio_ci(shared: np.ndarray, iso: np.ndarray, batches: int = 20) -> tuple[float, float]:
    size = len(shared) // batches
    vals = np.array([1 - shared[i * size:(i + 1) * size].sum() / iso[i * size:(i + 1) * size].sum() for i in range(batches)])
    se = vals.std(ddof=1) / sqrt(batches)
    return float(stats.t.ppf(0.975, batches - 1) * se), float(se)


# ---------------------------------------------------------------- simulation
@dataclass
class World:
    params: Params
    sample: Sample
    draws: np.ndarray  # (n_runs, tasks)
    u_conf: np.ndarray
    u_hard: np.ndarray


def make_world(p: Params) -> World:
    rng = np.random.default_rng(p.seed * 7919 + p.tasks)
    smp = rejection_sample(p.n_runs * p.tasks, p.cold_share, p.mu, rng, p.s_max)
    shape = (p.n_runs, p.tasks)
    return World(p, smp, smp.draws.reshape(shape), rng.random(shape), rng.random(shape))


@dataclass
class KResult:
    k: int
    savings: float
    savings_lo: float
    savings_hi: float
    savings_se: float
    conflict: float
    conflict_lo: float
    conflict_hi: float
    hard: float
    hard_hi: float
    rerun_per100: float
    p90_iso: float
    p90_shared: float
    minutes_iso: float
    minutes_shared: float
    passes: bool = False
    passes_point: bool = False

    def failing(self) -> list[str]:
        g, out = GUARDRAILS, []
        if self.savings_lo < g["min_savings"]: out.append("savings")
        if self.conflict_hi > g["max_conflict"]: out.append("conflict")
        if self.hard_hi > g["max_hard"]: out.append("hard failures")
        if self.rerun_per100 > g["max_rerun_per100"]: out.append("re-runs")
        if self.p90_shared > self.p90_iso + 1e-9: out.append("P90 delay")
        return out


def _passes(r: KResult, conservative: bool) -> bool:
    if r.k < 2:
        return False
    g = GUARDRAILS
    sav = r.savings_lo if conservative else r.savings
    conf = r.conflict_hi if conservative else r.conflict
    hard = r.hard_hi if conservative else r.hard
    return sav >= g["min_savings"] and conf <= g["max_conflict"] and hard <= g["max_hard"] \
        and r.rerun_per100 <= g["max_rerun_per100"] and r.p90_shared <= r.p90_iso + 1e-9


def simulate_k(w: World, k: int, p_pair: float | None = None, n_runs: int | None = None) -> KResult:
    p = w.params
    n = n_runs or p.n_runs
    d, uc, uh = w.draws[:n], w.u_conf[:n], w.u_hard[:n]
    T, D = p.tasks, -(-p.tasks // 2)
    pe = (p.p_pair if p_pair is None else p_pair) * (1 - p.q_catch)
    cost_iso, delay_iso = d.sum(1), d[:, :D].sum(1)
    if k == 1:
        res = KResult(1, 0.0, 0.0, 0.0, 0.0, 0.0, *wilson(0, n), 0.0, wilson(0, n)[1], 0.0,
                      float(np.quantile(delay_iso, .9)), float(np.quantile(delay_iso, .9)),
                      float(cost_iso.mean() / 60), float(cost_iso.mean() / 60))
        return res
    cost_sh = np.zeros(n); delay_sh = np.zeros(n)
    any_c = np.zeros(n, bool); hard = np.zeros(n, bool); reruns = 0
    for g0 in range(0, T, k):
        m = min(k, T - g0)
        pc = 1 - (1 - pe) ** (m * (m - 1) / 2)
        base = d[:, g0] * (1 + p.union_overhead * (m - 1))
        setup = base + p.attach_sec * (m - 1)
        on_path = g0 < D
        path_tasks = max(0, min(D, g0 + m) - g0)
        delay = base + p.attach_sec * max(0, path_tasks - 1)
        if m > 1:
            c = uc[:, g0] < pc
            fb = p.fallback_sec + d[:, g0:g0 + m].sum(1)
            fbd = p.fallback_sec + d[:, g0:min(D, g0 + m)].sum(1) if on_path else 0.0
            setup = setup + c * fb
            if on_path:
                delay = delay + c * fbd
            any_c |= c
            hard |= c & (uh[:, g0] < p.hard_frac)
            reruns += int(c.sum()) * m
        cost_sh += setup
        if on_path:
            delay_sh += delay
    sav = 1 - cost_sh.sum() / cost_iso.sum()
    half, se = batch_ratio_ci(cost_sh, cost_iso)
    xc, xh = int(any_c.sum()), int(hard.sum())
    clo, chi = wilson(xc, n)
    r = KResult(k, float(sav), float(sav - half), float(sav + half), se, xc / n, clo, chi, xh / n, wilson(xh, n)[1],
                reruns / n * 100, float(np.quantile(delay_iso, .9)), float(np.quantile(delay_sh, .9)),
                float(cost_iso.mean() / 60), float(cost_sh.mean() / 60))
    r.passes, r.passes_point = _passes(r, True), _passes(r, False)
    return r


@dataclass
class Evaluation:
    params: Params
    sweep: list[KResult]
    kstar: int
    kstar_point: int
    m: float
    acceptance: float
    proposals: int

    def to_dict(self) -> dict:
        return {"params": asdict(self.params), "sweep": [asdict(r) for r in self.sweep], "kstar": self.kstar,
                "kstar_point": self.kstar_point, "M": self.m, "acceptance": self.acceptance, "proposals": self.proposals,
                "verdict": "go" if self.kstar else "hold"}


def evaluate(p: Params = Params()) -> Evaluation:
    w = make_world(p)
    sweep = [simulate_k(w, k) for k in range(1, p.tasks + 1)]
    kstar = max([r.k for r in sweep if r.passes], default=0)
    kpt = max([r.k for r in sweep if r.passes_point], default=0)
    return Evaluation(p, sweep, kstar, kpt, w.sample.m, w.sample.acceptance, w.sample.proposals)
