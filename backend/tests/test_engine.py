import numpy as np
import pytest
from scipy import stats

from carpool.engine import Params, evaluate, make_world, rejection_sample, simulate_k, target_cdf, target_pdf, wilson


def test_target_density_integrates_to_one():
    s = np.linspace(0, 1500, 300_001)
    assert abs(np.trapezoid(target_pdf(s, 0.3), s) - 1) < 1e-4


@pytest.mark.parametrize("cold,mu", [(0.3, 70.0), (0.1, 40.0), (0.6, 120.0)])
def test_rejection_sampler_matches_target(cold, mu):
    smp = rejection_sample(60_000, cold, mu, np.random.default_rng(11))
    ks = stats.kstest(smp.draws, lambda s: target_cdf(s, cold))
    assert ks.pvalue > 0.001, ks
    # keep rate ~ 1/M (binomial SE over proposals)
    se = np.sqrt((1 / smp.m) * (1 - 1 / smp.m) / smp.proposals)
    assert abs(smp.acceptance - 1 / smp.m) < 4.5 * se


def test_envelope_dominates_target():
    from carpool.engine import envelope_m, envelope_pdf
    s = np.linspace(0.01, 600, 50_000)
    m = envelope_m(0.3, 70.0)
    assert np.all(target_pdf(s, 0.3) <= m * envelope_pdf(s, 70.0) + 1e-12)


def test_reproducible_with_seed():
    a, b = evaluate(Params(n_runs=2_000)), evaluate(Params(n_runs=2_000))
    assert [r.savings for r in a.sweep] == [r.savings for r in b.sweep]
    c = evaluate(Params(n_runs=2_000, seed=7))
    assert [r.savings for r in a.sweep] != [r.savings for r in c.sweep]


def test_isolated_baseline_has_no_effect():
    r = evaluate(Params(n_runs=2_000)).sweep[0]
    assert r.k == 1 and r.savings == 0 and r.conflict == 0 and not r.passes


def test_no_conflicts_when_check_is_perfect():
    w = make_world(Params(n_runs=3_000, q_catch=1.0))
    for k in range(2, 9):
        assert simulate_k(w, k).conflict == 0


def test_conflict_rate_increases_with_pair_probability():
    w = make_world(Params(n_runs=5_000))
    rates = [simulate_k(w, 8, p_pair=p).conflict for p in (0.0, 0.005, 0.01, 0.02)]
    assert rates == sorted(rates) and rates[0] == 0


def test_conflict_rate_matches_closed_form():
    # with one group of k=8 tasks: P(conflict) = 1 - (1 - p(1-q))^28
    p = Params(n_runs=40_000, tasks=8)
    r = simulate_k(make_world(p), 8)
    expected = 1 - (1 - p.p_pair * (1 - p.q_catch)) ** 28
    assert r.conflict_lo <= expected <= r.conflict_hi


def test_wilson_interval_properties():
    lo, hi = wilson(0, 100)
    assert lo == 0 and 0 < hi < 0.05
    lo, hi = wilson(50, 100)
    assert lo < 0.5 < hi


def test_ci_rule_is_never_more_aggressive_than_point_rule():
    for seed in (101, 102, 103):
        e = evaluate(Params(n_runs=5_000, seed=seed))
        assert e.kstar <= e.kstar_point


def test_param_validation():
    with pytest.raises(ValueError):
        Params(tasks=1)
    with pytest.raises(ValueError):
        Params(p_pair=1.5)
