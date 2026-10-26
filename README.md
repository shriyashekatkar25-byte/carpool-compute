# Carpool Compute

**Should every task in a bundle share one serverless environment by default, and how many tasks per environment?** A rejection-sampling Monte Carlo decision prototype.

- **Live demo:** https://shriyashekatkar25-byte.github.io/carpool-compute/
- **Gallery:** https://shriyashekatkar25-byte.github.io/apm-lab/
- Part of **APM Lab** by Shriya Shekatkar · UCLA · Stats 102C Monte Carlo Methods

## The launch that inspired it
On October 22, 2026, Databricks released **Shared Serverless for Asset Bundles (Beta)**: notebooks and files in a bundle can share serverless compute and an environment defined in the bundle-root `pyproject.toml`.
Source: [Databricks platform release notes, October 2026](https://docs.databricks.com/aws/en/release-notes/product/2026/october)

## The PM decision
If I owned this launch, the hard call is whether sharing should become the **default**, and with what **cap k on tasks per shared environment**. Sharing cuts repeated environment setup, but dependency conflicts scale with *pairs* of tasks (k(k−1)/2), so risk grows faster than savings.

- **Success metric:** environment setup minutes per job run, down ≥ 30% vs. one environment per task
- **Guardrails:** runs with a dependency conflict ≤ 2% · P90 setup delay no worse than isolated · tasks re-run ≤ 8 per 100 runs · hard failures ≤ 0.3%
- **Stakeholders:** Bundles/CLI engineering, serverless compute, Jobs PM, support, customer FinOps admins

## What the prototype shows
| APM skill | Where it shows up |
|---|---|
| Customer problem framing | An 8-task bundle re-installs the same packages 8 times |
| Prototyping | Four sliders drive a live simulation of 2,000 job runs |
| Data-driven decisions | Sweeps every cap k and marks the largest one that clears all guardrails |
| SQL / Python | Illustrative telemetry queries and a NumPy rejection sampler |
| Clear writing | A director memo and one-sentence VP summary that rewrite themselves from the results |

## Methods
| Course idea (Stats 102C) | How it's used here |
|---|---|
| Ch4 rejection sampling (general envelope) | Setup times follow a fitted curve (fast cached resolves + slow cold installs). Proposals come from an exponential envelope M·g and are kept when U ≤ f/(M·g); the keep rate is 1/M |
| Ch3 inverse CDF | Envelope proposals via s = −μ·ln(1−U) |
| Ch1 Monte Carlo averages | Savings, P90 delay and conflict rates are averages over 2,000 simulated runs |
| Common random numbers | The same draws replay every k, so differences between caps reflect the policy, not noise |

All numbers are synthetic and chosen to be realistic, not measured.

## Design baseline
A deliberately simple page: white background, black type, one accent color, no decoration, so the focus stays on the product decision.
- **KPI numbers and accent color** ← ["chilli flex", saanvi](https://www.pinterest.com/pin/869687378069934509/): electric blue with big, tight grotesk numbers
- **Headline type** ← ["graduATE", Hyunjin Kim](https://www.pinterest.com/pin/794955771770627264/): plain black sans, nothing else around it

---
Unofficial concept prototype by Shriya Shekatkar. All data is simulated. Not affiliated with any company.
