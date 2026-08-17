# THE REFERENCE DASHBOARD — ANNOTATED

**The image:** `docs/design/reference-dashboard.png` (save it there; Cowork could
not write it — it arrived in a chat, not on disk).

**Read this file before implementing any part of that image.** The mock is the
visual target and it is trustworthy for layout, hierarchy, density, colour and
motion. It is **not** trustworthy as a data specification: about a third of the
figures on it are things this system cannot currently know, and several are
things it must never claim.

Every element below is one of:

| Mark | Meaning |
|---|---|
| **REAL** | The data exists today. Build it. |
| **DERIVABLE** | No table yet, but it can be computed honestly from tables that exist. Build it *derived*, never as a parallel counter. |
| **NOT BUILT** | Honest to build, needs a data model first. |
| **CANNOT BE HONEST** | The system does not have this and inventing it is a defect. Render a named empty state instead. |

**If you implement a CANNOT-BE-HONEST element as drawn, you have shipped a
number the product made up.** That is RULE 6 and the five model-figure guards,
one layer up in the UI.

---

## 1 · THE FIVE THINGS ON THIS IMAGE THAT MUST NOT SHIP AS DRAWN

### 1.1 — "Better than 68% of companies in your industry" · "Compared to industry: Top 32%"

**CANNOT BE HONEST. This is the most dangerous element on the page.**

There is no industry cohort in the database. `esg_scores` holds one row per
assessment per company; nothing aggregates across tenants, nothing records an
industry peer group, and `esg_companies.msic_code` is populated for some
companies and not others.

It is also a **cross-tenant surface**. Even once the data exists, a percentile
derived from other companies' scores is checklist #4 territory: it must never be
computable back to an individual competitor's score. Any future version needs a
minimum cohort size before it renders at all — below that floor it says so
rather than quietly widening the cohort.

**Render instead:** `emptyState('uninstrumented', …)` — *"Industry comparison is
not switched on yet. Nothing writes a peer cohort, so there is nothing to
compare against."* Not a blank space, not a hidden card.

### 1.2 — "AI Confidence 87%"

**CANNOT BE HONEST, and it is specifically the banned shape.**

`esg_document_extractions` has **no confidence column, deliberately**. It has
`quote_verified boolean`. The whole Layer 2 design rests on the model returning a
**verbatim quote that an executor checks against the extracted text** — an
unquotable claim is discarded before a human ever sees it. A percentage would be
a model-authored figure, which is exactly what the five guards exist to stop.

**Render instead:** the binary that is real, with the evidence beside it —
*"Evidence quote verified against Environmental Policy.pdf, page 8"* with a check
mark, or *"Quote could not be located in the document — proposal discarded."*
That is more trustworthy than 87% and it is true.

### 1.3 — "Your Impact on SustNET's 4 Pillars" — High / Medium / High / Medium

**CANNOT BE HONEST — blocker 0.1.** SustNET publishes no methodology mapping any
company activity to any pillar. Rendering a contribution level attributes a
mapping to an organisation that has authored none.

**Render instead:** the four pillars as the **mission the platform is aligned
to**, with no per-company level and no progress bar, until Dr Nor supplies a
written mapping or Modus publishes its own and labels it as Modus's.

### 1.4 — "SustNET ESG Certification" · "CERTIFIED" · "Download Certificate"

**CANNOT BE HONEST — blocker 0.2.** No such scheme is published. SustNET issues
awards; its certification page 404s; GPM Global's certifications certify people.
`pages.js:664-680` already badges certification *"Not part of this platform"* and
that is currently the most honest screen in the product.

**Render instead:** journey stage 09 as an explicit `uninstrumented` state naming
what is missing. Never a downloadable certificate.

### 1.5 — "Dr Nor Consultation"

**NOT BUILT.** Dr Norsaidatul is real and the relationship is real, but there is
no consultation module, no availability, no booking, no record. A card with a
"View Consultation Options" button that opens nothing is a dead control —
§4.3c bans exactly that, and it is worse than an absent feature because the user
believes the capability exists and stops looking.

**Render instead:** either a real mailto/contact path, or an honest
`uninstrumented` state. Not a button bound to nothing.

---

## 2 · WHAT IS REAL, AND WHERE IT COMES FROM

Build these exactly as drawn.

| Element on the image | Source | Note |
|---|---|---|
| **78 / 100** overall ring | `esg_scores` scope `OVERALL`, `score_0_100` | Real |
| **E 82 · S 74 · G 77** sub-rings | `esg_scores` scopes `E`, `S`, `G` | Real |
| Band label under the score | `esg_rating_bands` | **Use the seeded band name, not invented copy.** 78 is `AA`. "Good Performance" is not a band this system has. The seeded ladder is Leading (AAA 85+), then AA/A/BBB/BB/B/CCC. |
| **Answers Completed 18 / 32** | `esg_responses` count vs `esg_indicators` for the assessment's framework | Real — but **compute the denominator.** `MODUS_SEDG_ALIGNED` has 40 indicators and `SEDG@2.0` has 38. A hardcoded 32 is wrong for both. |
| **12 answers require your review** | `esg_document_extractions WHERE status='pending'` | Real |
| The verification question card | `esg_indicators.question_en` + `esg_document_extractions.proposed_option_code` | Real |
| **Extracted Evidence** quote + page | `esg_document_extractions` quote + page, `esg_documents.filename` | Real, and it is the strongest thing on the page — a verifiable quote beats a confidence score |
| Filter chips **All / Review Required / Missing** | `esg_document_extractions.status` + unanswered indicators | Real. **"Low Confidence (6)" is not** — see §1.2. Drop that chip. |
| Uploaded documents list, sizes, total | `esg_documents` | Real |
| **Improvement Roadmap** items with "+12 Potential" | `esg_recommendations.points_missed`, `priority` | **Real and engine-computed** — this is a genuinely good element. The points come from `scoringEngine`, not a model. |
| The **0% / 25%** progress bars on each recommendation | — | **NOT BUILT.** Nothing tracks progress against a recommendation. Either add an action-tracking table or drop the bar. Do not render 0% for "we don't track this". |
| **Strengths 12 · Priority Gaps 5** | `esg_recommendations` grouped by priority; strengths from high-ratio indicators | Real, derivable |

### The AI Analysis checklist (panel 03)

**PARTIALLY REAL.** The image shows eight steps. What actually exists is
`esg_documents.text_status` (`pending → extracting → extracted | no_text_layer |
failed`) plus the `document_extraction` job status. That is four or five states,
not eight.

**Do not invent four more steps to fill the design.** Render the states that
exist, at the granularity they exist. A progress checklist whose middle rows are
decorative is a fallback wearing a nicer coat.

---

## 3 · THE JOURNEY, MISSIONS AND XP — DERIVABLE, WITH ONE HARD RULE

### 3.1 The rule

**Journey progress, mission completion and XP are DERIVED from committed facts.
They are never a parallel counter that a route increments.**

An `xp` integer that some handler does `+= 130` on will drift from reality the
first time a request fails halfway, and once it has drifted nothing can tell you
it has. Derive XP from what the company has actually done — profile fields
completed, documents uploaded, extractions accepted, indicators answered,
assessment scored — and it is always correct by construction, recomputable, and
falsifiable against the source tables.

Same rule the whole platform already runs on: **the executor computes the figure,
nothing else is allowed to author one.**

### 3.2 The stages

The image shows **nine** stages. The product directive describes **sixteen**
(the extra seven are the Green Finance arc: opportunities → readiness → route →
implement → measure → report). The image predates Green Finance.

**Make the stages data, not markup** — an `esg_journey_stages` table with an
order, a label, a completion predicate and a blocked-reason. Then nine versus
sixteen is configuration, and adding the Green Finance arc doesn't mean editing
a template.

Stage state must be one of: `completed` · `in_progress` · `pending` ·
**`blocked`**. That fourth one is what stages 08 and 09 are today, and it must
render differently from `pending` — pending means *your turn next*, blocked means
*this cannot happen yet and here is why*. Drawing them identically is the same
error class as a failed AI call rendering like an empty one.

### 3.3 Missions, Leaderboard, Rewards

- **Missions** — DERIVABLE from the same predicates as the stages. Fine to build.
- **Rewards** — NOT BUILT. Needs a data model and, more importantly, a decision
  about what a reward *is*. Don't build a screen for it first.
- **Leaderboard** — **NOT BUILT, and think hard before building it at all.** A
  cross-company leaderboard exposes one tenant's progress to another. At minimum
  it needs opt-in, anonymised handles and a cohort floor. An SME's ESG score is
  commercially sensitive. This is a product decision, not a UI one.

---

## 4 · THE NAVIGATION — ADD, DO NOT REPLACE

The image's sidebar omits **Company Profile, Carbon, Frameworks, Green Finance,
Reports, Governance** — all of which are built and shipping, several of them this
week.

**Removing a working feature from the nav teaches the user it does not exist and
they stop looking for it.** That is the same principle as §4.2's "a platform that
does not use a settings section still shows it."

So the nav is the current 15 `MODULES` entries **plus** the new ones the image
introduces (ESG Journey, Improvement, Missions), with the blocked ones (4 Pillars,
Certification, Consultation) either omitted until unblocked or shown with an
honest state. It is not the image's list.

`BOTTOM_NAV_KEYS` is five, named explicitly, and adding to it displaces one.
That is a deliberate decision — see the comment at `layout.js:114-118` for why it
must never happen as a side effect.

---

## 5 · MOTION — THE VOCABULARY ALREADY EXISTS

Run 50 shipped §50 of the master stylesheet with exactly the classes this image
needs. **Use them. Do not write new one-off CSS in this repo** — a per-repo edit
to the design system is a §1 defect, and anything missing gets added to the
master and fanned out to all thirteen paths.

| Image element | §50 class |
|---|---|
| The 01–09 stage rail | `.journey-rail` / `.journey-node` + `.is-done` `.is-active` `.is-pending` |
| Mission and stage cards | `.mission-card` / `.mission-progress` |
| The 78/100 ring and the three sub-rings | `.score-ring` — a `conic-gradient` on a custom property, no canvas, no library |
| XP bar and the level chip | `.xp-bar` / `.level-chip` |
| Certification / milestone badges | `.milestone-badge` |
| Glowing stat cards | `.stat-card--glow` |
| Panels arriving as you scroll | `.reveal` |

Tokens: `--motion-fast` `--motion-base` `--motion-slow` `--ease-out`
`--ease-spring` `--shadow-glow` `--rail-w` `--node-size` `--ring-thickness`
`--surface-deep`. All in `:root`. **Never hardcode a duration** — a literal
`0.3s` is the same defect class as a literal `#16A34A`.

**Three motion rules that are not negotiable:**

1. **`prefers-reduced-motion` is already handled in one global block.** `.reveal`
   rests **visible** and is hidden only under `[data-reveal="on"]`, which JS sets
   after it has an `IntersectionObserver`. No script → nothing hidden. Do not
   add a second reduce block; do not invert `.reveal`.
2. **State is never colour alone.** A done node says "Done". A mission at 3 of 8
   says "3 of 8". The image's dark green palette makes several states
   near-indistinguishable at a glance — every one needs a text label.
3. **Nothing loops indefinitely** except a live progress indicator. The image has
   several ambient glows; make them one-shot on entry.

**"Smooth" is a performance property, not an easing curve.** Animate `transform`
and `opacity` only. Animating width, height, top or box-shadow on a dashboard
this dense will drop frames on a mid-range Android, which is where a Malaysian
SME owner will actually open this.

---

## 6 · WHAT THE IMAGE GETS RIGHT, AND SHOULD BE COPIED EXACTLY

Worth saying, because most of this file is caveats. The mock is a strong piece of
product design:

- **The journey rail as the spine of the product** is the right idea and it is
  what turns this from a form into a path.
- **The verification card** — question, proposed answer, source document, page
  number, verbatim quote, Edit / Confirm — is almost exactly the shape Layer 2
  already produces. Minus the confidence percentage, it is buildable today and it
  is the best screen in the design.
- **Density and hierarchy.** Four stat cards, then the score, then the journey.
  A user can answer "where am I, what's next" in one glance.
- **The mobile strip is not decoration.** Six phone frames showing the same
  states means the design was drawn for ≤768px rather than shrunk into it.
- **The dark, high-tech environmental palette** reads as serious infrastructure
  rather than a game, which is the line the directive asked for.

---

## 7 · THE ONE-LINE TEST FOR ANY SCREEN BUILT FROM THIS IMAGE

> **Every number on this page can be traced to a row a human could go and look
> at.**

If it cannot, it is a named empty state — uninstrumented, instrumented-but-empty,
or genuinely zero — and it says which. Never a plausible placeholder.
