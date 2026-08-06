# Scoring methodology

Everything here is implemented in `src/services/scoringEngine.js` and asserted
in `test/scoring-engine-test.js` against hand-computed fixtures.

## The rule the design rests on

**The model never produces a figure.** Every score, sub-score, point total and
band on this platform is ordinary arithmetic over rows the company entered. The
AI layer reads those figures and writes sentences around them. Five guards close
every path where a model-authored number could reach a company — they are listed
at the top of `src/services/aiAdvisor.js`. Do not open a sixth.

## How an answer becomes points

```
points_earned(indicator) = weight × answer_ratio × evidence_multiplier
```

**answer_ratio**

| response_type | ratio |
|---|---|
| `yes_no` | yes 1.00, no 0.00 |
| `yes_partial_no` | yes 1.00, partial 0.50, no 0.00 |
| `maturity_0_4` | level ÷ 4 |
| `quantitative` | 1.00 if a figure ≥ 0 was supplied, else 0.00 |
| `multi_select` | from `esg_indicator_options.points_ratio` |

A quantitative indicator scores on **disclosure, not performance**. "Is 42,000
kWh good?" is unanswerable without an industry and floor-area benchmark, and
inventing a threshold would produce a confident number with nothing behind it.
Performance benchmarking arrives when there is a peer population to benchmark
against. Until then this platform measures whether a company *knows* its
numbers — which is what SEDG asks for at the Basic tier anyway.

**evidence_multiplier** — from the active weighting scheme:

| tier | multiplier | ceiling it implies |
|---|---|---|
| `self_declared` | 0.60 | 60.00 |
| `documented` | 0.85 | 85.00 |
| `verified` | 1.00 | 100.00 |

This is Verra's conservativeness principle, applied. See `VERRA_BENCHMARK.md`.

## Pillar and overall

```
pillar_score  = 100 × Σ earned ÷ Σ available     (available = Σ weight)
overall_score = Σ(pillar_weight × pillar_score) ÷ Σ(pillar_weight)
                — summed over SCORABLE pillars only
```

Default pillar weights are **E 0.40 / S 0.30 / G 0.30**. This split is a **Modus
decision, not a published standard** — SEDG does not weight its disclosures. It
is stamped onto every score row so that revising it never rewrites history.

## Three things that are not a zero

The single most expensive error this system can make is telling an owner that a
capability they *have* does not exist, because they never look for it again. The
engine keeps these apart and reports them distinctly:

| situation | handling |
|---|---|
| **Not applicable** (`is_na`) | Removed from numerator **and denominator**. Charging a company zero for an emission source it does not have makes the score dishonest. |
| **Unscorable** — an option code the framework does not define, or a `multi_select` with no option rows | Removed from both, counted in `indicators_unscorable`. A data fault must be visible, not absorbed as poor performance. |
| **Unanswered** | Counted in the denominator, earns zero. Not answering is not the same as not applying. |

A pillar with nothing scorable reports `state: 'no_scorable_indicators'`, not a
score of 0. An assessment nobody has touched reports `state: 'unanswered'` and
**no band** — banding it CCC would read as "we assessed you and you did badly"
when the truth is "you have not filled this in".

A pillar with no scorable indicators is also dropped from the overall
denominator, so the remaining pillars renormalise. Without that, a missing
governance section would silently cap every company at 70.

## Versioning

Never edit a scheme, band or indicator row in place. Insert a new version.

- `esg_weighting_schemes.version` → stamped on every `esg_scores` row
- `esg_frameworks.version` → stamped on the assessment and every score row
- `ENGINE_VERSION` in `scoringEngine.js` → stamped on every score row

A score must be reproducible from the three stamps alone.

## SEDG reconciliation checklist — before any claim of SEDG alignment

The 40 seeded indicators are `mapping_status = 'draft'`: Modus-authored against
public descriptions of SEDG's themes. Nobody has reconciled them line by line.

1. Obtain the official SEDG v2 disclosure list (38 disclosures, 3 tiers) from
   Capital Markets Malaysia.
2. For each official disclosure, insert a row under framework `SEDG v2.0` with
   the publisher's own wording, `external_ref` set to the official reference, and
   `mapping_status = 'official'`.
3. Map each `MODUS_SEDG_ALIGNED` indicator to an official reference or mark it
   Modus-only.
4. Reconcile response types against SEDG's own answer formats — several SEDG
   disclosures are narrative, which none of the current response types capture.
5. Agree the pillar weights with SSEO in writing and record the decision in a new
   `esg_weighting_schemes` version.
6. Set `SEDG v2.0` active and migrate. Existing assessments stay on the framework
   version they were taken against.

Until step 6, the platform must describe itself as **SEDG-aligned (draft)** and
nothing stronger.
