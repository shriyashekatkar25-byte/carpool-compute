# Case study: shipping on the confidence bound, not the estimate

*Shriya Shekatkar · APM Lab · Unofficial concept prototype; all data simulated.*

![Decision terrain](img/terrain-desktop.png)

## The problem
Databricks' October 22, 2026 beta lets the tasks in a bundle share one serverless environment. That makes sharing possible. The PM question is what the **default** should be. Sharing removes repeated setup, but every extra task in an environment adds pairs of dependencies that can clash. Pairs grow as k(k−1)/2, so risk grows faster than savings.

## My role
Sole PM, designer and engineer: problem framing, PRD, statistical model, both engines, data layer, 3D/UI design, tests and documentation.

## What I built
1. **A decision model.** Monte Carlo simulation of job runs: setup times drawn by rejection sampling from a two-hump curve (cached vs. cold installs); shared groups of k tasks; pairwise conflicts; fallbacks; hard failures; critical-path P90 delay.
2. **A decision rule that respects uncertainty.** Guardrails are judged on 95% bounds (Wilson for rates, batch means for savings), and the recommended cap is the largest k that clears every bound.
3. **A product people can explore.** A WebGL decision terrain (height = savings, colour = guardrail status, one isoline at the 2% limit), sliders that re-run 20,000 simulations in a Web Worker, CI charts, a self-writing director memo, and shareable URLs.
4. **Real persistence.** SQLite (WASM) in the browser with migrations, a saved-scenario ledger, three analytical queries and a read-only SQL console; the same schema and queries run in the Python API.
5. **A Python backend.** NumPy engine, FastAPI service, sensitivity, convergence and seed-stability analyses that generate the data the site renders.

## The insight
| | Point estimates | 95% bounds |
|---|---|---|
| Recommended cap | k = 4 | **k = 3** |
| Same answer across 20 seeds | 20/20 say 4 | 9 say 3, 11 say 4 |

At k = 4 the conflict rate is about 1.8%, just under the 2% limit. A point-estimate rule ships k = 4 in every simulated world, including the ones where it breaks the guardrail. The CI rule shows k = 4 is a coin flip against the limit. **Recommendation:** ship k = 3 (51% less setup time, conflicts ≤ 1.2% at the upper bound) and run k = 4 as an experiment once real conflict rates are measured.

Sensitivity analysis then answered "what should we measure first?" The deploy-time check's catch rate moves the cap from 2 to 7 across its plausible range. Cost assumptions (overhead, fallback penalty, cold-install share) don't move it at all. **Instrumenting the dependency check is the highest-value next step.**

## Things that went wrong and what I changed
- **Underpowered guardrail.** With 4,000 runs, no cap could certify the 0.3% hard-failure limit, because the interval was wider than the limit. I raised the default to 20,000 runs and documented the convergence curve.
- **Tests caught real bugs:** the API's save request leaked a `name` field into model parameters; the memo read a run count from UI state instead of model parameters; the 3D renderer sized itself from the whole stage (aspect ≈ 0.3 on phones); the conflict isoline drew at every multiple of 2% instead of exactly 2%.
- **Performance:** the scene originally re-rendered every frame. Render-on-demand brought idle main-thread long tasks to zero, and devices without WebGL2 now skip the 650 KB 3D download entirely.

## Results (verified in this build)
- 19 Python tests, 14 JS tests and 9 Playwright end-to-end tests pass; axe-core reports 0 accessibility violations.
- Sampler validated: KS p = 0.86 on 200,000 draws; mean 61.18 s vs. 61.2 s true.
- Two independent engines (JS, NumPy) agree within Monte Carlo error.

## Resume bullets
- Built a Monte Carlo decision system (JS Web Worker + NumPy/FastAPI) that recommends a default sharing cap for serverless bundle environments, cutting simulated setup time 51% while bounding conflict risk under 2% at 95% confidence.
- Designed a CI-aware decision rule that reversed a point-estimate recommendation (k = 4 → 3) after showing k = 4 failed its 95% guardrail bound in 9 of 20 seeded runs; used sensitivity analysis to identify dependency-check quality as the input to measure first.
- Shipped a WebGL decision terrain with custom GLSL, SQLite-in-WASM persistence, and 42 automated tests (unit, cross-language parity, Playwright e2e), with 0 axe accessibility violations.

## Interview talking points
- **Product:** why "default" is the real decision; north star vs. guardrails; why ship k = 3 and run k = 4 as an experiment.
- **Statistics:** rejection sampling and why the keep rate is 1/M; common random numbers; Wilson vs. normal intervals for rare events; batch means; why point-estimate rules overshoot near a threshold.
- **Engineering:** worker-based compute; one schema and query file shared by two databases; parity testing two engines with independent RNGs; read-only console via savepoint rollback; render-on-demand and the WebGL2 probe.
- **Design:** every vertex is data; the guardrail is a visible contour; colour is never the only signal; reduced motion and a no-WebGL table fallback.
- **What I'd do next:** replace assumptions with beta telemetry (SQL in the README), host the API with Postgres and auth for a team ledger, and model clustered (non-independent) conflicts.
