# P9 — the SME ESG operating workflow

What P9 changed, why, and — more usefully — the connections it deliberately
did **not** draw.

P8 made the product look like one thing. P9 makes it *do* one thing: answer
"what should I do next", every time, from rows the company can go and check.

---

## 1 · The one rule everything else follows

> **The UI may CONNECT. It may not INVENT.**

Every claim P9 renders falls into one of four kinds, and the kind is carried in
the data rather than implied by a layout:

| kind | what it means | where it is used |
| --- | --- | --- |
| `derived` | one service computed this from the other's rows | gap ← score, action ← predicate, readiness ← inputs, measurement ← carbon entries |
| `recorded` | a column joins the two rows | project ← proposal (`source_opportunity_id`, added by P9), verification ← person |
| `sequence` | adjacent in the product; **nothing joins them** | gap → opportunity, project → forecast, everything → reporting |
| `none` | nothing connects them at all | the first rung, which has nothing above it |

`test/action-center-test.js` asserts the kind of every rung, and the
gap→opportunity assertion is checked **twice** — once that the rung says
`sequence`, and once that `opportunityService` still stamps
`derived_from_kind='company_profile'`. If somebody ever makes the AI scan
gap-aware, the second half fails and the claim has to be re-reasoned rather
than silently becoming true.

---

## 2 · What is new

### `services/actionCenter.js` — the only place a priority is decided

Before P9, three surfaces each picked their own "most important thing": the
dashboard took the journey's active stage, the readiness page took its own
largest gap, the impact page took whichever project it was rendering. Three
answers to one question.

Seven states, and each carries a `basis` — the sentence naming the rows that
put it there. An action with no basis **throws**; an action with no
destination throws. A priority a user cannot check is a priority taken on
trust.

**URGENT is not "important".** It means *something already recorded is out of
date until you act*, and exactly two rules produce it:

- **U1** — a score is on file *and* proposals sit unreviewed. The published
  figure was computed against a smaller evidence set. It does **not** predict
  which way the score moves; nothing here knows which way a proposal cuts, and
  the suite asserts the card never claims it will rise.
- **U2** — a project is implemented, has a baseline, and has never been
  measured. Every month without a reading is impact that cannot be evidenced
  later, because the carbon entries it derives from are period-scoped.

U1 **supersedes** its own journey stage, so one review queue is never two cards
at two different priorities.

### `services/gapAnalysis.js` — why the score is what it is

Five questions per gap: what is missing, why it matters, what would resolve it,
what to do, who should act.

- **The points figure is the engine's**, copied from
  `esg_recommendations.points_missed`. This file computes no point value; the
  suite asserts it never multiplies a weight, because a second scoring path
  would disagree with the published figure the day a weight changed.
- **One gap per indicator.** `esg_recommendations` legitimately holds two rows
  for the same indicator — the engine row owns the number, the `ai_phrasing`
  row owns the sentence and copies the number across. A naive join doubles
  every figure on the page. They are merged.
- **Three kinds do not collapse**: `unanswered` (no row), `unevidenced`
  (answered, nothing attached), `partial`. A company that answered honestly and
  has no certificate is not in the same position as one that has not looked.
- **Evidence examples are never invented.** Where `guidance_en` is configured
  it is rendered verbatim; where it is not, the page says no requirement is
  configured. There is no fallback example list anywhere in the file, and the
  suite checks for the obvious inventions ("utility bill", "for example").
- **Who should act**: nobody. There is no owner, reviewer or approver column in
  this schema. `answered_by` is a real fact and is reported; anything stronger
  would be a role invented on a page.

### `services/roadmapService.js` — ten rungs, each declaring its joint

Position → gap → action → opportunity → project → readiness → expected →
measured → verified → reporting. Seven states, and **no percentages**: every
rung is a set of discrete facts, and a percentage over discrete states is a
fabricated figure. `waiting` and `blocked` carry the most information and are
exactly what a percentage would erase.

### `services/consultationTriggers.js` — expert support, and why

Six situations, none of which is a score. The directive rules out "score below
X shows the expert card" and it is right to: a company at a high score with
every disclosure unreconciled needs more help than one at a lower score with a
clean, fully evidenced assessment. `test/copilot-test.js` asserts `esg_scores`
is never referenced in the file at all.

Every threshold is exported and **printed on the page next to the trigger it
fired**, including the ones that did not fire, so a reader sees the rule rather
than a conclusion.

**There is no booking module.** `/consultation` opens with that, not with a
footnote.

### `services/copilotService.js` — four contextual asks, no chatbot

`explain_requirement`, `evidence_for`, `improve_area`, `summarise_document`.
A closed set; anything else throws.

The same five guards as `aiAdvisor`, applied by **reusing its `stripFigures`**
rather than writing a second copy — with an **empty allow-list**, which is
stricter: the model is handed no figures, so no figure may come out. It writes
to no table but the interaction log. It cannot accept a proposal, set an
evidence tier, mark anything verified, or answer on the company's behalf.

Rendered server-side at `/explain`, deliberately: one model call per deliberate
click rather than thirty-nine on an assessment page load, and a page that works
without scripting cannot ship the `fetch(...).catch(() => ({}))` shape this
repo's two RULE 6 guards exist to keep out.

### `services/reportReadiness.js` — what a report could be made of

**There is still no report generator and P9 did not build one.**
`generator.built` is a stated constant, paired with a test asserting nothing in
the codebase writes a report file while it says `false`.

Eleven sections in three states that must never read the same: `available`
(rows exist), `missing` (an empty account — you can change it),
`not_configured` (the platform cannot do this for anyone). The three that
cannot exist — SustNET contribution, certification, independent assurance —
each say **why**, so they do not read as a gap in the company's data.

---

## 3 · The one schema change

`esg_green_projects.source_opportunity_id`, nullable, `ON DELETE SET NULL`,
with a **partial** unique index (CLAUDE.md #5 — a plain `UNIQUE` over a mostly-
NULL column is no constraint at all).

`acceptOpportunity()` has always created a project from a proposal and recorded
nothing about it, so the chain the product tells a company about was
unrecoverable one step after it happened. This is the one relationship the
system genuinely establishes, and now it is written down. NULL is the honest
and common case: a project a person defined by hand has no source proposal, and
that is a *different* fact, not a missing one.

Note what is still **not** joined: a project carries no link to an ESG
indicator, because the scan is never told which gap to answer.

---

## 4 · Defects found, and where they came from

| # | what | how it was found |
| --- | --- | --- |
| 1 | `scripts/demo-seed.js` had 400'd at step 3 since **Run 25** — it posted an assessment with no framework, and RULE 6 removed the default. Invisible because on every database people actually use, the demo assessment already existed. | running it against a database that did not have one |
| 2 | `/frameworks` put a badge and two paragraphs directly inside the master's `.alert`, which is `display:flex`. At 360px the first paragraph was squeezed to a 74px column ending at x=391 and clipped by `.app-main`'s own `overflow:hidden`. The most carefully worded paragraph in the product was unreadable on a phone. | the 360px viewport P9 added to `test/visual/audit.js` |
| 3 | `.esg-reserved__status` was `white-space: nowrap`, so "Certification framework required" was a 185px unbreakable box running off the right edge at 360 on `/dashboard` and `/impact`. | same |
| 4 | `test/dashboard-test.js`'s aggregate predicate knew only `count(*)`, so a `sum()`-only statement was answered `rows: []` — a database that cannot exist, and a shape that forces a RULE 6 guard onto the code. Widened to every bare aggregate; the same fix in `no-model-figures-test.js`, which its own comment says to keep in sync. | the dashboard's byte total |
| 5 | `journey-test.js`'s "the API block issues no SQL" guard sliced `api.js` from its anchor **to the end of the file** — correct only while the journey block was last. Anchor rot. Now bounded at both ends, with a second assertion covering the block that follows. | appending the P9 endpoints |
| 6 | Three P9 labels shipped at 11px, which §3 reserves for legal text and explicitly forbids for labels. | the visual audit |
| 7 | `.btn-sm` renders 24px, under the desktop target floor. Right for a control in a dense table row, wrong for the single action of a card. | the visual audit |
| 8 | `test/visual/audit.js` had no **in-line exception** for target size, so a link inside a sentence reported as a defect at every viewport. WCAG 2.2 exempts exactly that; the probe now encodes the exception's own condition, narrowly. | the visual audit |

### Still open, and deliberately not changed

- **`.btn-sm` on the proposal Accept / Dismiss controls** (`pages.js`, P6) is
  the same 24px target as #7. It was never measured because the demo company
  has no pending proposals. Changing it alters the visual density of the
  product's densest and most important review surface, which is a design
  decision P9 was not asked to make. **Reported, not fixed.**
- **`.esg-meta` and `.badge-gray` at 11px** are pre-existing and appear on
  seven pages.
- **The `.milestone-badge.is-locked` contrast failure** recorded in
  `journeyView.js` is still unfixed in the master.

---

## 5 · What P9 does not claim

- It does not predict a new score. Closing a 2.4-point gap does not add 2.4:
  the overall figure renormalises pillar weights across the pillars that are
  scorable, so the effect of any one change depends on every other answer. The
  engine recomputes when asked; nothing estimates the outcome in advance.
- It does not assign work.
- It does not say a green project fixes an ESG question.
- It does not say a readiness figure means a bank will lend.
- It does not turn an expected benefit into an impact, or a measurement into a
  verification.
- It does not generate a report, book a consultation, or claim a SustNET
  contribution or a certification.
