# Evaluation

All numbers below come from `python -m carpool.cli analyze` (seed 102 unless stated). The raw output is in [`data/evaluation.json`](../data/evaluation.json). Rerun that command to reproduce them.

## 1. Is the sampler correct?
| Check | Result | Pass criterion |
|---|---|---|
| Kolmogorov–Smirnov vs. exact mixture CDF, 200,000 draws | D = 0.00135, **p = 0.86** | p > 0.001 |
| Sample mean vs. true mean (0.7·36 + 0.3·120 = 61.2 s) | **61.18 s** | within MC error |
| Observed keep rate vs. 1/M | 71.35% vs. 71.17% (z = 2.0) | \|z\| < 4.5 (test bound) |
| Envelope dominates target on [0, 600] | holds on a 50,000-point grid | f ≤ M·g everywhere |

KS checks also run in both test suites: Python (`scipy.stats.kstest`) for three (cold share, envelope mean) settings, and JS against the 1% critical value for the base setting.

## 2. Do the two engines agree?
`backend/tests/test_parity.py` runs the browser engine under Node and the NumPy engine with **different RNGs**. For every cap k, savings agree within 4 combined standard errors and conflict rates within 4 pooled binomial SEs. Both engines recommend **k = 3 (CI rule)** and **k = 4 (point rule)** for the base case.

## 3. How much simulation is enough?
Standard error of the savings estimate at k = 4 (batch means, 20 batches):

| runs | savings | SE | conflict | conflict CI half-width |
|---:|---:|---:|---:|---:|
| 1,000 | 61.21% | 0.81 pp | 1.40% | 0.75 pp |
| 5,000 | 60.49% | 0.43 pp | 1.72% | 0.36 pp |
| 20,000 | 60.62% | 0.17 pp | 1.78% | 0.18 pp |
| 40,000 | 60.68% | 0.09 pp | 1.72% | 0.13 pp |

The log-log slope of SE against runs is −0.59, close to the theoretical −0.5 (batch-means SEs are themselves noisy). **Finding:** at 4,000 runs (the first version's default) the 0.3% hard-failure guardrail could not be certified for *any* cap, because the Wilson upper bound on a rate near 0.1% was itself above 0.3%. The default is now 20,000 runs.

## 4. Point estimates vs. confidence bounds
| Rule | Base case (seed 102) | Across 20 seeds (101–120) |
|---|---|---|
| Point estimates | k = 4 | k = 4 in **20/20** |
| 95% bounds (shipped) | **k = 3** | k = 3 in 9/20, k = 4 in 11/20 |

At k = 4 the conflict rate is ≈ 1.8%, just under the 2% limit. A point rule ships k = 4 every time, *including in the worlds where k = 4 is over the limit*. The CI rule exposes that k = 4 is a coin flip against the guardrail. **Product conclusion:** ship k = 3, and treat k = 4 as an experiment that needs measured conflict rates, not more simulation.

## 5. Sensitivity: what would change the decision?
One-at-a-time, 20,000 runs per setting:

| Assumption | Low → cap | High → cap |
|---|---|---|
| Deploy check catch rate | 40% → **k = 2** | 90% → **k = 7** |
| Conflict chance per pair | 1.00% → k = 2 | 0.25% → k = 6 |
| Conflicts needing a human | 20% → k = 2 | 5% → k = 3 |
| Tasks per bundle | 12 → k = 3 | 4 → k = 4 |
| Setup overhead per extra task | 5% → k = 3 | 25% → k = 3 |
| Fallback penalty | 120 s → k = 3 | 480 s → k = 3 |
| Cold-install share | 15% → k = 3 | 50% → k = 3 |

**The decision is driven by risk inputs (check quality, conflict rate), not cost inputs.** That tells the PM where to spend measurement effort: instrument the dependency check before anything else.

## 6. Engineering verification (this build)
| Suite | Result |
|---|---|
| `pytest backend/tests` | 19 passed (engine, statistics, migrations, all shared SQL queries, API, JS↔Python parity) |
| `npm test` (Node test runner) | 14 passed (sampler KS, reproducibility, guardrail logic, SQLite store, console write-blocking, cascade deletes, perf budget) |
| `pytest tests/e2e` (Playwright, Chromium) | 9 passed (load, 375 px layout, sliders, URL state, terrain keyboard picking, table view, SQL ledger save/query/reload, reduced motion, no-WebGL fallback) |
| axe-core 4.10 (WCAG 2 A/AA + best practice) | 0 violations |

## 7. Limitations
- Inputs are assumptions, not telemetry; the sensitivity table shows which ones matter.
- Conflicts are independent across task pairs in the model; clustered conflicts (a few bad packages) would change the risk curve.
- Surface colours in the 3D terrain use point estimates on 1,500 runs per cell (labelled on the page); the decision itself uses 20,000 runs and confidence bounds.
- Performance numbers were measured in headless Chromium with software WebGL (SwiftShader); a real GPU will be faster, but this was not measured.
