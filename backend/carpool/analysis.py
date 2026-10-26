"""Statistical analysis that powers the site: sensitivity (tornado), convergence, sampler validation."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import numpy as np
from scipy import stats

from .engine import Params, evaluate, make_world, rejection_sample, target_cdf, simulate_k

# (param, label, low, high, formatter)
SENSITIVITY = [
    ("q_catch", "Deploy check catch rate", 0.40, 0.90, lambda v: f"{v:.0%}"),
    ("p_pair", "Conflict chance per pair", 0.0025, 0.0100, lambda v: f"{v:.2%}"),
    ("union_overhead", "Setup overhead per extra task", 0.05, 0.25, lambda v: f"{v:.0%}"),
    ("fallback_sec", "Fallback penalty", 120.0, 480.0, lambda v: f"{v:.0f}s"),
    ("hard_frac", "Conflicts needing a human", 0.05, 0.20, lambda v: f"{v:.0%}"),
    ("cold_share", "Cold-install share", 0.15, 0.50, lambda v: f"{v:.0%}"),
    ("tasks", "Tasks per bundle", 4, 12, lambda v: f"{v} tasks"),
]
JS_NAMES = {"q_catch": "qCatch", "p_pair": "pPair", "union_overhead": "unionOverhead", "fallback_sec": "fallbackSec",
            "hard_frac": "hardFrac", "cold_share": "coldShare", "tasks": "tasks"}


def sensitivity(base: Params = Params()) -> dict:
    b = evaluate(base)
    rows = []
    for name, label, lo, hi, fmt in SENSITIVITY:
        klo = evaluate(base.with_(**{name: lo, "cap_k": min(base.cap_k, int(lo) if name == "tasks" else base.cap_k)})).kstar
        khi = evaluate(base.with_(**{name: hi})).kstar
        rows.append({"param": JS_NAMES[name], "label": label, "low": lo, "high": hi, "low_label": fmt(lo),
                     "high_label": fmt(hi), "kstar_low": klo, "kstar_high": khi, "swing": abs(khi - klo)})
    rows.sort(key=lambda r: -r["swing"])
    return {"base_kstar": b.kstar, "base_kstar_point": b.kstar_point, "n_runs": base.n_runs, "seed": base.seed,
            "generated": date.today().isoformat(), "rows": rows}


def sampler_validation(n: int = 200_000, seed: int = 7, cold_share: float = 0.30, mu: float = 70.0) -> dict:
    smp = rejection_sample(n, cold_share, mu, np.random.default_rng(seed))
    ks = stats.kstest(smp.draws, lambda s: target_cdf(s, cold_share))
    se = np.sqrt((1 / smp.m) * (1 - 1 / smp.m) / smp.proposals)
    return {"n": n, "M": smp.m, "acceptance": smp.acceptance, "theoretical": 1 / smp.m,
            "acceptance_z": (smp.acceptance - 1 / smp.m) / se, "ks_stat": float(ks.statistic), "ks_p": float(ks.pvalue),
            "mean": float(smp.draws.mean()), "mean_true": 0.7 * 36 + 0.3 * 120}


def convergence(base: Params = Params(), ns=(1000, 2000, 5000, 10_000, 20_000, 40_000), k: int = 4) -> list[dict]:
    """Standard error of the savings estimate vs. number of runs (should fall like 1/sqrt(n))."""
    w = make_world(base.with_(n_runs=max(ns)))
    out = []
    for n in ns:
        r = simulate_k(w, k, n_runs=n)
        out.append({"n_runs": n, "savings": r.savings, "savings_se": r.savings_se, "conflict": r.conflict,
                    "conflict_halfwidth": (r.conflict_hi - r.conflict_lo) / 2})
    return out


def seed_stability(base: Params = Params(), seeds=range(101, 121)) -> dict:
    ks = [evaluate(base.with_(seed=s)) for s in seeds]
    ci = [e.kstar for e in ks]; pt = [e.kstar_point for e in ks]
    return {"seeds": list(seeds), "kstar_ci": ci, "kstar_point": pt,
            "ci_mode_share": max(ci.count(v) for v in set(ci)) / len(ci),
            "point_mode_share": max(pt.count(v) for v in set(pt)) / len(pt)}


def write_artifacts(root: Path) -> dict:
    sens = sensitivity()
    (root / "data").mkdir(exist_ok=True)
    (root / "data" / "sensitivity.json").write_text(json.dumps(sens, indent=2))
    ev = evaluate()
    report = {"evaluation": ev.to_dict(), "sampler": sampler_validation(), "convergence": convergence(),
              "seed_stability": seed_stability(), "sensitivity": sens}
    (root / "data" / "evaluation.json").write_text(json.dumps(report, indent=2, default=float))
    return report
