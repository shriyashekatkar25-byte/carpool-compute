# Creative references & art direction

**No reference asset is reused.** Every visual on the site is original code: CSS, SVG and a GLSL shader. The references below were studied for technique only. Creator names are what Pinterest displayed on 2026-10-26; "pinned by" means the uploader, who may not be the original author. Citing these pins does not imply endorsement by, or any affiliation with, their creators.

## Art-direction specification

| | |
|---|---|
| **Project** | Carpool Compute: Decision Terrain |
| **Visual concept** | A dark editorial research document with one sculptural object at its centre: a pearlescent terrain whose every vertex is simulation output. Swiss grid discipline around a single expressive 3D form. |
| **Target user** | AI/data-platform PMs and engineers reviewing a launch decision; portfolio reviewers |
| **Pinterest searches (6)** | "iridescent chrome 3d abstract render" · "dark editorial website typography swiss grid" · "3d topographic data visualization surface generative" · "pearlescent blush violet glass 3d gradient" · "kinetic typography brutalist motion design" · "scientific data visualization dark ui particles" |
| **Typography** | Inter Tight 900 at up to 168 px with −0.055 em tracking for display; Inter for body; IBM Plex Mono for data labels, micro-labels and axes |
| **Palette** | `#0b0a0f` ink-black · `#efe9f4` pearl text · `#f4b6c8` blush (pass / accent) · `#b9a3ff` violet (data) · `#3a3542` graphite (fail) · chrome gradient for numerals |
| **3D / graphics** | Three.js r160, custom GLSL: thin-film-style cosine palette driven by Fresnel and height, `fwidth` anti-aliased contour lines, a single 2% conflict isoline, iridescent `MeshPhysicalMaterial` marker lit by a PMREM room environment |
| **Motion** | Staggered word-rise headline (ease-out-expo), section reveals, count-up numerals, a 1.8 s camera dolly intro, and a slow shimmer for 5 s after each interaction, then render-on-demand. All disabled under `prefers-reduced-motion`. |
| **Interaction model** | Orbit; hover tooltip; click or arrow keys to pick (k, conflict), which drives the sliders; sliders re-run the model in a worker; URL hash holds the scenario |
| **Accessibility** | Keyboard-operable terrain, table view of the same data, SVG charts with `<title>`s, focus rings, skip link, AA contrast, 0 axe violations |

## Directions considered
| Direction | Idea | Verdict |
|---|---|---|
| A. Liquid Chrome Lab | An iridescent blob whose wobble tracks conflict risk | Rejected: beautiful but decorative; the shape would not encode decision data precisely |
| **B. Decision Terrain** | Swiss editorial page plus a pearlescent 3D surface of savings over (cap k × conflict) | **Chosen:** every vertex is data, the 2% guardrail becomes a visible contour, and it still has a sculptural presence |
| C. Kinetic Ledger | Brutalist animated typography where numbers rearrange as the model runs | Folded into B as the type system and count-up numerals |

## References
| # | Pin | Creator / uploader shown | Source | Studied | Used in | Asset reused? |
|---|---|---|---|---|---|---|
| 1 | [Swiss-style website (Black Pearl)](https://www.pinterest.com/pin/975099756819565544/) | Valeria Ulaeva | Behance | Black field, white grotesk, numbered sections, hairline rules | Section heads (`01 / Decision`), 12-column grid | No |
| 2 | [Swiss style brochures](https://www.pinterest.com/pin/836191855843786858/) | Chris (@madebychristopher) | savee.it/madebychristopher | Extreme type scale contrast, ragged display setting | Hero headline scale and tracking | No |
| 3 | [Elements & Principles website](https://www.pinterest.com/pin/278238083213829328/) | pinned by Szatmári Huba (author not shown) | — | Dark site with large heading plus small mono meta columns | Hero meta grid, mono micro-labels | No |
| 4 | [Iridescent Chrome Abstract 3D Art](https://www.pinterest.com/pin/1143492161676883714/) | pinned by "The sigmas" (author not shown) | — | Fresnel-driven hue shift on chrome | Thin-film colour term in the terrain shader | No |
| 5 | [Abstract iridescent torus knot with chromatic refraction](https://www.pinterest.com/pin/432978951699457588/) | dnvrmx | Freepik (premium licence; **not** used) | Pearl highlights, soft studio lighting | Iridescent `MeshPhysicalMaterial` marker | No |
| 6 | [Liquid sunset vibes](https://www.pinterest.com/pin/912260468313752286/) | FlowWallAI | flowwall.ai | Blush-to-violet glass palette | `--blush`, `--violet`, `--pearl` tokens | No |
| 7 | [3D terrain renderings](https://www.pinterest.com/pin/743445851026551557/) | pinned by "AI Art & More" | — | Terrain slabs with contour lines | Savings contours every 10% on the surface | No |
| 8 | [Black-and-white data poster with terrain](https://www.pinterest.com/pin/916482592928785750/) | pinned by Ola Hmurka | — | Scientific labelling around a 3D form | Mono axis sprites and legend strip | No |
| 9 | [Loop kinetic typography](https://www.pinterest.com/pin/1050675788088129863/) | Anushka Gaikwad | Instagram reel | Word-by-word rhythmic reveal | Headline word-rise animation | No |

## Libraries (actual reuse, with licences)
| Library | Version | Licence | Location |
|---|---|---|---|
| three.js (core, OrbitControls, RoomEnvironment) | 0.160.0 | MIT | `vendor/` (licence in `vendor/LICENSE-three.txt`) |
| sql.js (SQLite compiled to WASM) | 1.10.3 | MIT | `vendor/` (licence in `vendor/LICENSE-sqljs.txt`) |
| Inter, Inter Tight, IBM Plex Mono | — | SIL Open Font License | Google Fonts |
