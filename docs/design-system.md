# Design system: Decision Terrain

Tokens live in `app/styles.css` (`:root`). Components use only tokens.

## Colour
| Token | Value | Role | Contrast on `--bg` |
|---|---|---|---|
| `--bg` | `#0b0a0f` | page | — |
| `--surface` / `--surface-2` | `#14121a` / `#1c1924` | cards, inputs | — |
| `--fg` | `#efe9f4` | text | 16.6:1 |
| `--fg-muted` | `#a9a1b4` | secondary text | 7.9:1 |
| `--blush` | `#f4b6c8` | pass, accent, focus ring | 11.6:1 |
| `--violet` | `#b9a3ff` | data marks | 9.2:1 |
| `--pearl` | `#ede7f6` | primary button, tooltip | — |
| `--graphite` | `#3a3542` | fail marks (always paired with a text label) | non-text |
| `--rule` | `rgba(239,233,244,.12)` | hairlines | non-text |
| `--chrome` | 6-stop gradient | display numerals (decorative clip; value also in accessible text) | — |

Pass/fail never relies on colour alone: charts carry `<title>`s, the table spells out "pass" or "fails: conflict", and KPI badges carry words.

## Typography
| Token | Value |
|---|---|
| `--font-display` | Inter Tight 700/800/900 |
| `--font-body` | Inter 400/600 |
| `--font-mono` | IBM Plex Mono 500/600 |
| `--fs-mega` | `clamp(52px, 10.5vw, 168px)`, line-height .88, tracking −.055em |
| `--fs-h2` | `clamp(30px, 4.6vw, 64px)` |
| `--fs-h3` / body / small / micro | 20 / 16 / 13 / 11 px |

## Space, shape, grid
Spacing scale 4 · 8 · 12 · 16 · 24 · 32 · 48 · 72 · 120 px. Radii 6 / 14 / 28 px. Max width 1320 px; 12-column grid with 16 px gutters (32 px ≥ 900 px). Breakpoints 720 px (stacked stage, nav hidden) and 900 px (grid collapses to one column).

## Motion
| Token | Value | Used for |
|---|---|---|
| `--ease-out` | `cubic-bezier(.16,1,.3,1)` | reveals, headline rise, count-ups |
| `--ease-in-out` | `cubic-bezier(.65,0,.35,1)` | state changes |
| `--t-fast` / `--t-med` / `--t-slow` | 160 / 420 / 900 ms | hover, panels, reveals |
Under `prefers-reduced-motion: reduce` every animation and transition is removed, the camera starts at its final position, and the shader stops shimmering.

## Materials (3D)
- **Terrain:** custom `ShaderMaterial`. Cosine thin-film palette over Fresnel + height; graphite where guardrails fail; white contour every 10% savings; one blush isoline at the 2% conflict limit; sample grid at each simulated (k, p) cell.
- **Marker:** `MeshPhysicalMaterial` (metalness 1, roughness .08, iridescence 1, IOR 1.35, clearcoat 1) lit by a PMREM `RoomEnvironment`.

## Components
Buttons (default, primary, pressed), range sliders (chrome thumb, blush fill track), KPI tiles (chrome numerals, CI line, badge), glass panel, legend strip, tooltip, Swiss cells, chart cards, ledger rows, SQL block, memo.
