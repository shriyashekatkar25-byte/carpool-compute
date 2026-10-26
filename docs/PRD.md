# PRD: Shared environments by default for bundle tasks

**Author:** Shriya Shekatkar · **Status:** Concept prototype (unofficial; all data simulated) · **Last updated:** 2026-10-26

## 1. Context
On October 22, 2026, Databricks released *Shared Serverless for Asset Bundles* (Beta): notebooks and files in a bundle can share serverless compute and an environment defined in the bundle-root `pyproject.toml` ([release notes](https://docs.databricks.com/aws/en/release-notes/product/2026/october)). The beta makes sharing *possible*. This PRD is about the follow-on decision a PM would own: **should sharing become the default, and with what cap?**

## 2. Product hypothesis
> If bundle tasks share a serverless environment by default, capped at **k** tasks per environment and protected by a deploy-time dependency check, then environment setup minutes per job run fall by **≥ 30%**, without pushing dependency-conflict failures above **2% of runs**.

## 3. Target user and unmet need
| | |
|---|---|
| **Primary user** | Data engineer shipping multi-task bundles (5–12 notebook/Python tasks) on serverless jobs |
| **Job to be done** | "Get from `bundle deploy` to results quickly, without debugging environments." |
| **Pain today** | Each task resolves and installs the same dependencies. Setup dominates short tasks. |
| **Secondary user** | Workspace/FinOps admin who pays for idle setup minutes |

## 4. Requirements
**Must**
1. Shared environment is the default for new bundles; opt-out per task.
2. Cap of k tasks per shared environment (bundles larger than k get several shared environments).
3. Deploy-time dependency check that refuses or splits conflicting task groups.
4. Automatic fallback: a shared environment that fails to resolve at run time retries those tasks in isolated environments.
5. Telemetry: setup time per task, conflict events, fallback events, hard failures.

**Should**
6. Workspace-level kill switch.
7. `bundle validate` explains *which* packages conflict.

**Won't (this release)**
8. Cross-bundle environment sharing. 9. Automatic cap tuning per workspace.

## 5. Success metric and guardrails
All guardrails are judged on the **pessimistic 95% bound**, not the point estimate (rationale in [evaluation.md](evaluation.md)).

| Type | Metric | Threshold | Statistic |
|---|---|---|---|
| North star | Setup minutes per run vs. isolated | ≥ 30% saved | batch-means lower 95% bound |
| Guardrail | Runs hitting a dependency conflict | ≤ 2.0% | Wilson upper 95% bound |
| Guardrail | Hard failures needing a human | ≤ 0.3% | Wilson upper 95% bound |
| Guardrail | Tasks re-run per 100 runs | ≤ 8 | mean |
| Guardrail | P90 setup delay on the critical path | no worse than isolated | empirical P90 |

## 6. MVP (prioritized)
| # | Scope | Why first |
|---|---|---|
| P0 | Default-on sharing with cap k = 3, fallback, telemetry | Captures most of the savings (51%) inside every guardrail |
| P0 | Deploy-time dependency check | The single assumption that moves the cap most (sensitivity: k = 2 → 7) |
| P1 | Kill switch, conflict explanations in `bundle validate` | Reduces support cost of the conflicts that remain |
| P2 | Raise cap to 4 | Only after telemetry shows the true per-pair conflict rate keeps k = 4's upper bound under 2% |

## 7. Recommendation (from the prototype, seed 102, 20,000 runs)
**Go, cap k = 3.** Setup minutes fall 51.1% (95% CI 50.9–51.4%), conflicts hit 1.03% of runs (upper bound 1.18%), and P90 setup delay drops from 6.6 to 5.0 minutes. A point-estimate rule would pick k = 4 (conflict 1.83%), but its upper bound is 2.03%, and across 20 seeds the CI rule lands on k = 4 only 55% of the time. **k = 4 sits on the guardrail; it needs measured data, not a bigger simulation.**

## 8. Rollout
1. Default-on for new bundles in 5% of workspaces, with a holdout. 2. 25% after two weeks if every guardrail holds on its CI bound. 3. 100%. Kill switch at the workspace level throughout.

## 9. Stakeholders
Bundles & CLI engineering (config, validate) · Serverless compute (pool sizing, isolation) · Jobs PM (task semantics, retries) · Support & field engineering (conflict tickets) · Customer FinOps admins.

## 10. Open questions
- What is the real per-pair conflict rate in beta telemetry? (Replace the 0.5% assumption.)
- What share of conflicts does the deploy-time check catch in practice? (Replace the 70% assumption; it dominates the decision.)
- Are conflicts independent across pairs, or clustered around a few packages? Clustering would change the shape of the risk curve, so the independence assumption must be tested before raising the cap.
