# test/visual — NOT PART OF `npm test`

Three probes that need a real browser. They are **not** in `test/run-all.js` and
running `npm test` does not exercise any of them. Saying so here because this
repo has been bitten before by a guard that looked like it was holding a line
and was not: `no-fallbacks-tree.js` prints a "NOT A PASS" banner for exactly the
same reason.

Playwright is **not a dependency of this repo**. These files are function
bodies of the shape `async (page) => { … }`, executed through the Playwright
MCP server against a staging instance on `http://127.0.0.1:3000`. There is no
runner, no assertion library and no exit code — each one **returns a report you
have to read**. An empty report is the pass.

| file | what it measures |
| --- | --- |
| `audit.js` | Twelve pages × five viewports (1440/1280/1024/768/390): horizontal overflow, off-screen text, text–text collisions, sub-12px type, touch targets under 44px on a phone, and native controls still rendering as browser defaults. |
| `a11y.js` | `prefers-reduced-motion` resting state, post-animation settle, the track's server-gated pulse, keyboard focus rings on the P8 controls, and WCAG AA contrast for every P8 component in both themes. |
| `shots.js` | The before/after screenshot set in `docs/design/p8/`. |

## Two measurement bugs these probes had, and why they are commented in place

Both produced **false failures**, which is worse than missing a real one: a
fabricated defect sends the next run to "fix" something that is already correct.

1. **Contrast without alpha compositing.** Every `-bg` token in the design
   system is an 8%-alpha tint — `--red-bg` is `rgba(239, 68, 68, 0.08)`. Reading
   its first three channels measures the label against **solid red** and reports
   2.58:1 on a chip that renders near 12:1. `bgOf()` now walks up compositing
   each tint until it reaches an opaque layer.

2. **Reading reduced motion inside the load task.** The master collapses reduced
   motion to `animation-duration: 0.01ms` rather than removing the animation, so
   an element read synchronously on load is still on its `from` frame and
   reports `opacity: 0`. The probe now waits a frame first.

Two more artefacts are filtered rather than fixed, because they are the
browser's behaviour and not the product's: an inline element that **wraps across
lines** reports a union box spanning its whole paragraph (which read as eleven
collisions on two pages), and a **visually-hidden `<thead>`** hidden with
`clip: rect(0 0 0 0)` still gives its `<th>` children full-size rects (which read
as ten header/cell overlaps in the stacked table).

## Running them

The app must be up on `127.0.0.1:3000` against the staging database — see
CLAUDE.md, "Before every deploy". Then, through the Playwright MCP:

```
browser_run_code_unsafe  filename=test/visual/audit.js
browser_run_code_unsafe  filename=test/visual/a11y.js
```

`audit.js` signs in as the seeded demo company and hard-codes that company's
assessment and document ids. On a fresh database those ids do not exist and the
probe reports on the login page instead of on the product — check the returned
page titles before believing a clean run.
