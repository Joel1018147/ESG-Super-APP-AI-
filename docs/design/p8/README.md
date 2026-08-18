# P8 — before / after

Rendered by `test/visual/shots.js` through the Playwright MCP against a staging
instance with the seeded demo company. They are **evidence, not fixtures** —
nothing reads them, and a stale one is only misleading, so re-shoot rather than
patch if a surface changes.

The `before-*` set exists because most of what P8 fixed is otherwise an
unverifiable claim. "The assessment page had 112 white form controls" and "the
top bar clipped 100px off every page at 390px" are checkable against
`before-03-assessment-1440.png` and the measurements in the run report; without
them the after-shots only show that the product looks fine now.

## Before

| file | what it shows |
| --- | --- |
| `before-01-dashboard-1440.png` | the hero built from a centred empty-state, ~180px of dead space |
| `before-02-journey-1440.png` | XP and level chrome in four places |
| `before-03-assessment-1440.png` | 112 native form controls, white on a dark surface, 19px tall |
| `before-04-readiness-1440.png` | the progress bar 2.4px under the paragraph, reading as a strikethrough |
| `before-nav-sheet-open-on-load.png` | the phone overflow sheet covering ~60% of the viewport on arrival |

## After

`after-01` … `after-19` are the P8 design and motion pass; `after-20` … `after-30`
are the governance/company migration and the overflow-sheet fix.

Viewports are named in the filename. Unsuffixed is 1440; `-mobile` is 390;
`-768`, `-1024` as written. `-light` is the light theme — everything else is
dark, which is this platform's default.

Three are not page shots but the specific evidence for one finding each:

- `after-17-document-track.png` — the analysis track driven by real job state
- `after-28-governance-stage-table-mobile.png` — the stage table stacked on a
  phone, with the "Status here" column that used to be clipped away
- `after-29-more-sheet-opened-by-tap.png` — the overflow sheet still opens on
  demand after it stopped opening itself
