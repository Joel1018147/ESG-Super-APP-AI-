# SEDG v2 — the source, and what importing it actually costs

Phase 1 research output, 2026-08-07. **Findings with sources. Nothing built.**
Produced by Cowork under `Modus-Agent-OS/BUILD_PROTOCOL.md`. Every claim about
this repo was read out of the repo; every claim about SEDG was read out of the
publisher's own PDF. Claims about the Windows runtime or Railway are absent
because Cowork cannot see them.

---

## 1 · Provenance

| | |
|---|---|
| Document | Simplified ESG Disclosure Guide (SEDG) **Version 2** |
| Publisher | Capital Markets Malaysia (CMM), an affiliate of the Securities Commission Malaysia |
| Published | July 2025 |
| Consultants | Thoughts in Gear; Lasaju Consulting |
| Landing page | https://sedg.capitalmarketsmalaysia.com/ |
| PDF (English v2) | https://sedg.capitalmarketsmalaysia.com/wp-content/uploads/2025/07/SEDG-v2.pdf |
| Data template (v2) | https://sedg.capitalmarketsmalaysia.com/wp-content/uploads/2025/07/SEDG-Data-Collection-Template_V.2.xlsx |
| Count | **38 disclosures** — 17 E, 11 S, 10 G |
| Tiers | Basic 16, Intermediate 13, Advanced 9 |
| Relationship to v1 | v2 supersedes v1 (October 2023, 35 disclosures). Three added: **SEDG-E1.7, SEDG-E3.1, SEDG-S2.3** |
| ASEAN | Fully aligned with the ASEAN SEDG launched by the ASEAN Capital Markets Forum, April 2025 |

This is the right benchmark. It is published by an affiliate of the securities
regulator, it is entity-level, and it is what a Malaysian SME's customer would
actually ask for. Contrast Verra, which certifies carbon *projects* and
publishes no company-level indicators — see `docs/VERRA_BENCHMARK.md`.

### A caution about the count

**CMM's own v2 PDF says "35 disclosures" three times.** Lines 94 and 113 of the
extracted text, in the OVERVIEW section, are stale v1 wording the publisher left
in. The authoritative statement is in *A SUMMARY OF VERSION 2 UPDATE*: three new
disclosures "bring the total number of disclosures to 38." An independent count
of the disclosure pages agrees: 38.

Do not parse the count out of the document. A reader who greps for "disclosures"
gets 35 and is wrong.

### Trilingual — the official translations are v1 only

Bahasa Melayu and Simplified Chinese full guides exist and are downloadable from
the same page, but both were uploaded in December 2023 and are **Version 1**.
So official publisher wording exists for 35 of the 38. **E1.7, E3.1 and S2.3
have no official BM or ZH text.** Anything filling `question_bm` / `question_zh`
for those three is a Modus translation and must be badged as one.

- BM: https://sedg.capitalmarketsmalaysia.com/wp-content/uploads/2023/12/SEDG-Layout-BM-Final_Full-Guide.pdf
- ZH: https://sedg.capitalmarketsmalaysia.com/wp-content/uploads/2023/12/SEDG_CH_Full-Disclosure.pdf

---

## 2 · The finding that changes the plan

**SEDG and the current assessment are not the same kind of instrument, and the
import is not a remap.**

The 40 Modus indicators ask *maturity and capability* questions:

> E-01 — "Does the company track its monthly electricity consumption?"
> (`yes_partial_no`, weight 2.0)
> G-07 — "Maturity of the risk management process" (`maturity_0_4`, weight 2.0)

SEDG asks for *reported figures*:

> SEDG-E1.1 — "Report total Scope 1 (direct) GHG emissions in metric tonnes of
> CO2 equivalent"
> SEDG-G3.1 — "Report the year of the last submitted audited financial report"

SEDG contains **no maturity scale and no yes/no disclosure at all.** The scoring
engine's whole basis — `points_earned = weight × answer_ratio ×
evidence_multiplier`, where `answer_ratio` comes from a fixed option map — has
nothing to attach to "1,240 tCO2e". A reported figure has no ratio unless
somebody defines a benchmark, a target, or a band for it, and **nobody has.**

This is a Phase 2 design decision, not an import task, and it is the real work
between here and a defensible claim.

### The shape mismatch, counted

Of the 38 disclosures, against the five response types the schema permits
(`yes_no`, `yes_partial_no`, `maturity_0_4`, `quantitative`, `multi_select`):

| Shape | Count | Fits an existing type? |
|---|---|---|
| Single figure — a number, percent, year or amount | ~19 | `quantitative`, yes |
| **Multi-line-item numeric** — one disclosure that is 3–6 separate numbers (E2.1 has six fuel/energy lines; E4.2 has three sub-breakdowns) | 8 | **No.** `quantitative` stores one number |
| **List** — "List the company's policies…", "List the operations and suppliers…" | 8 | **No.** `multi_select` needs a fixed option set; these are open |
| **Number + free-text nature** — "Report the number and nature of confirmed incidents of corruption" | 3 | **No.** Compound, and the narrative half has no type |

So roughly **half of SEDG has no home in the current schema.** The boundary
between "single figure" and "multi-line-item" is arguable by one or two either
way; the conclusion is not.

`docs/SCORING_METHODOLOGY.md` step 4 says "several SEDG disclosures are
narrative, which none of the current response types capture." That was right and
understated. The narrative gap is the small half of this problem; the
multi-line-item and list shapes are the larger half and are not mentioned.

---

## 3 · The 38 disclosures, verbatim

Text is quoted from the publisher's PDF. Bullet sub-items appear as `•` in the
source. Only SEDG-E5.1 and SEDG-E5.2 carry terminal full stops — that is the
source's own inconsistency, reproduced rather than normalised.

### Environmental — 17

| Code | Topic | Tier | Disclosure (verbatim) | Unit |
|---|---|---|---|---|
| SEDG-E1.1 | Emissions | Basic | Report total Scope 1 (direct) GHG emissions in metric tonnes of CO2 equivalent | tCO2e |
| SEDG-E1.2 | Emissions | Basic | Report total Scope 2 (indirect) GHG emissions in metric tonnes of CO2 equivalent | tCO2e |
| SEDG-E1.3 | Emissions | Intermediate | Report total Scope 1 GHG emissions reduced as a direct result of reduction initiatives, in metric tonnes of CO2 equivalent | tCO2e |
| SEDG-E1.4 | Emissions | Intermediate | Report total Scope 2 GHG emissions reduced as a direct result of reduction initiatives, in metric tonnes of CO2 equivalent | tCO2e |
| SEDG-E1.5 | Emissions | Advanced | Report total Scope 3 (other indirect) GHG emissions in metric tonnes of CO2 equivalent | tCO2e |
| SEDG-E1.6 | Emissions | Advanced | Report total Scope 3 GHG emissions reduced as a direct result of reduction initiatives, in metric tonnes of CO2 equivalent | tCO2e |
| **SEDG-E1.7** *(new in v2)* | Emissions | Advanced | Report total Scope 1 and 2 GHG intensity in metric tonnes CO2 equivalent per unit of organisation-specific metrics | tCO2e per unit (ratio) |
| SEDG-E2.1 | Energy | Basic | Report the consumption of the following in joules or watthours: • Renewable fuel sources • Non-renewable fuel sources • Electricity • Heating (if applicable) • Cooling (if applicable) • Steam (if applicable) | J / Wh × 6 |
| SEDG-E2.2 | Energy | Intermediate | Report the reduction in consumption of the following (achieved as a direct result of conservation and efficiency initiatives) in joules or watthours: • Non-renewable fuel sources • Electricity • Heating (if applicable) • Cooling (if applicable) • Steam (if applicable) | J / Wh × 5 |
| **SEDG-E3.1** *(new in v2)* | Water | Basic | Report the total water withdrawn from all areas, and a breakdown of this total by type in litres: • Purchased water • Surface water (if applicable) • Groundwater (if applicable) • Seawater (if applicable) • Produced water (if applicable) | litres × 5 |
| SEDG-E3.2 | Water | Intermediate | Report the reduction in total water withdrawn from all areas, and a breakdown of this total by type in litres: • Purchased water • Surface water (if applicable) • Groundwater (if applicable) • Seawater (if applicable) • Produced water (if applicable) | litres × 5 |
| SEDG-E4.1 | Waste | Basic | Report total waste in metric tonnes: • Generated • Diverted from disposal • Directed to disposal | tonnes × 3 |
| SEDG-E4.2 | Waste | Intermediate | Report total waste generated, diverted from disposal, and directed to disposal, each broken down into metric tonnes of: • Hazardous and non-hazardous waste • Sector specific waste streams • Material composition | tonnes × 3×3 |
| SEDG-E4.3 | Waste | Advanced | Report total hazardous and non-hazardous waste diverted from disposal broken down into the following recovery streams in metric tonnes: • Preparation for reuse • Recycling • Other recovery options | tonnes × 3 |
| SEDG-E4.4 | Waste | Advanced | Report total hazardous and non-hazardous waste directed to disposal broken down into the following disposal streams in metric tonnes: • Incineration (with energy recovery) • Incineration (without energy recovery) • Landfilling • Other disposal options | tonnes × 4 |
| SEDG-E5.1 | Materials | Basic | List the materials and total weights used to produce and package the company's primary products and services in metric tonnes, if any. | list + tonnes |
| SEDG-E5.2 | Materials | Advanced | Report the percentage of recycled input materials used to manufacture the company's primary products and services. | % |

### Social — 11

| Code | Topic | Tier | Disclosure (verbatim) | Unit |
|---|---|---|---|---|
| SEDG-S1.1 | Human Rights and Labour Practices | Basic | Report the number and nature of child labour and forced labour incidents, if any | number + narrative, ×2 |
| SEDG-S1.2 | Human Rights and Labour Practices | Intermediate | List the operations and suppliers considered to have significant risk for incidents of child labour and forced labour, including: • Type of operation or supplier • Locations at risk | list ×2 |
| SEDG-S2.1 | Employee Management | Basic | Report the average hours of training per employee | hours |
| SEDG-S2.2 | Employee Management | Intermediate | Report the total number of employees and the turnover rate | number + % |
| **SEDG-S2.3** *(new in v2)* | Employee Management | Basic | Report the percentage of employees meeting or above applicable minimum wage laws, if any | % |
| SEDG-S3.1 | Diversity, Equity and Inclusion | Basic | Report the percentage of the company's employees by: • Gender • Age | % ×2 |
| SEDG-S3.2 | Diversity, Equity and Inclusion | Intermediate | Report the percentage of the company's directors by: • Gender • Age | % ×2 |
| SEDG-S4.1 | Occupational Health and Safety | Basic | Report the number of fatalities and injuries in the company, if any | number ×2 |
| SEDG-S4.2 | Occupational Health and Safety | Intermediate | Report the total number and percentage of employees trained on health and safety standards | number + % |
| SEDG-S5.1 | Community Engagement | Basic | Report the total amount of community investments and donations | MYR |
| SEDG-S5.2 | Community Engagement | Advanced | List the company's operations with negative impact on local communities | list |

### Governance — 10

| Code | Topic | Tier | Disclosure (verbatim) | Unit |
|---|---|---|---|---|
| SEDG-G1.1 | Governance Structure | Basic | Report the number of directors in the company | number |
| SEDG-G1.2 | Governance Structure | Intermediate | List the governance structure of the board, including committees of the board and management, if applicable | structure / list |
| SEDG-G2.1 | Policy Commitments | Basic | List the company's policies, including but not limited to: • Code of Conduct • Anti-Corruption Policy • Whistleblowing Policy • Health and Safety Policy | list |
| SEDG-G3.1 | Risk Management and Reporting | Basic | Report the year of the last submitted audited financial report | year |
| SEDG-G3.2 | Risk Management and Reporting | Intermediate | List the risks of company operations and activities, including but not limited to: • Regulatory compliance risk • Business continuity risk | list |
| SEDG-G3.3 | Risk Management and Reporting | Advanced | List the sustainability risks of company if applicable, including but not limited to: • Climate-related physical risk • Climate-related transition risk | list |
| SEDG-G4.1 | Anti-Corruption | Basic | Report the total number and nature of confirmed incidents of corruption, if any | number + narrative |
| SEDG-G4.2 | Anti-Corruption | Intermediate | Report the total number and percentage of employees who have received training on the company's anti-bribery and anti-corruption policy | number + % |
| SEDG-G4.3 | Anti-Corruption | Advanced | List the significant risks related to corruption | list |
| SEDG-G5.1 | Customer Privacy | Intermediate | Report the total number and nature of substantiated complaints received concerning breaches of customer privacy and loss of customer data, if any | number + narrative |

Customer Privacy has **no Basic and no Advanced disclosure** — G5.1 is
Intermediate and alone in its topic. That is the publisher's structure, not an
extraction error; it was confirmed against both the summary matrix and the topic
page.

### Standards cross-references are per TOPIC, not per disclosure

The SEDG gives its GRI / IFRS S1-S2 / Bursa / FTSE4Good / CDP references in a
"RELATED REFERENCES" block at the end of each of the 15 topics. **There is no
per-disclosure attribution and it cannot be derived from the document.** Any
schema that stores a standards reference on an indicator row is inventing a
precision the source does not have. Store it at topic level or not at all.

Two specifics worth recording:

- **TCFD is not referenced against any topic.** It appears once, in BASIS FOR
  CONCLUSIONS, noting that IFRS S1 and S2 are themselves TCFD-aligned. Do not
  tag SEDG codes with TCFD on the strength of that.
- **CDP is referenced for two topics only** — E1 Emissions (SME1) and E3 Water
  (SME3).

---

## 4 · What the repo does today

Read out of the repo at commit `02538c7`.

- **The 40 indicators** are seeded in `src/db/seed.sql:83–136`, 14 E + 13 S +
  13 G. `mapping_status` is the literal `'draft'` in the SELECT list (line 86),
  so all 40 are draft by construction rather than by data.
- **`esg_indicators`** (`src/db/schema.sql:129–169`) already has every column
  the import needs: `framework_id`, `code`, `pillar`, `tier`, `sort_order`,
  `question_en`, `question_bm`, `question_zh`, `response_type`, `unit`,
  `weight`, `allows_na`, `external_ref`, `mapping_status`. **No schema change
  is required to insert 38 rows.**
- **`UNIQUE (framework_id, code)`** (`schema.sql:167`) is scoped per framework,
  so SEDG codes cannot collide with the Modus ones and `ON CONFLICT DO NOTHING`
  has a real target.
- **The `SEDG v2.0` framework row exists** (`seed.sql:58–62`) with
  `is_active = false`, `effective_from = NULL`, and genuinely zero indicators —
  confirmed structurally: the only `INSERT INTO esg_indicators` in the repo is
  scoped `WHERE f.code = 'MODUS_SEDG_ALIGNED'`.
- **Existing scores cannot move.** Every scoring query is
  `WHERE framework_id = $1`, and `$1` is a stamped FK on the assessment. Adding
  rows under a different framework is arithmetically invisible to assessments
  already taken.

---

## 5 · Traps, each verified in the code

**A · Activating SEDG v2.0 is a silent no-op.** Both assessment-creation paths
(`api.js:86–88`, `pages.js:201–202`) pick the framework with

```sql
WHERE framework_kind='entity_disclosure' AND is_active
ORDER BY effective_from DESC NULLS LAST LIMIT 1
```

`MODUS_SEDG_ALIGNED` has `effective_from = 2026-01-01`; the SEDG row has `NULL`.
`NULLS LAST` sorts NULL behind, so **setting `is_active = true` alone changes
nothing and throws no error.** `effective_from` must be set to a date after
2026-01-01 in the same statement. There is no UI or API to choose a framework —
the choice is entirely implicit in that ORDER BY.

**B · The idempotency guard will go red, and that is correct.**
`test/schema-idempotency-test.js:40` asserts `count(*) = 40` **globally**, not
per framework. 40 + 38 = 78 fails. `schema.sql:13–16` calls this test "the only
thing standing between a typo here and a boot that quietly runs on last week's
schema", so it must be re-scoped per framework — not bumped to 78, which would
just re-arm the same trap at the next import.

**C · The smoke test breaks at activation, not at import.**
`test/smoke-test.js:104–106` requests
`/api/indicators?framework=MODUS_SEDG_ALIGNED`, and `api.js:43` filters on
`f.code` only, **not `f.version`**. The assertion
`b.written === inds.indicators.length` holds until the default framework flips;
then every posted code lands in `rejected` and `written` is 0.

**D · `multi_select` is a silent hole.** `esg_indicator_options` is created
(`schema.sql:171`) and read by the engine, and **nothing has ever inserted a
row into it.** `scoringEngine.js:92` returns `null` for a `multi_select` with no
options — unscorable, dropped from both numerator and denominator. And
`indicators_unscorable` is produced per pillar (`scoringEngine.js:206`) but
**`esg_scores` has no column for it** (`schema.sql:334–336`), so it is never
persisted. A SEDG disclosure seeded as `multi_select` without options would
vanish from the score with no trace in the database. That is the
uninstrumented-vs-empty-vs-zero distinction failing in the most expensive
direction.

**E · Step 3 of the checklist has nowhere to write.**
`docs/SCORING_METHODOLOGY.md` step 3 says "map each `MODUS_SEDG_ALIGNED`
indicator to an official reference or mark it Modus-only." **There is no
cross-framework link table, and `external_ref` on the Modus rows is already
occupied** by an invented theme slug (`SEDG:E-energy`, `SEDG:G-abac`) that is
not a disclosure ID. This is the one genuinely missing piece of schema, and it
is a table, not a column — the relationship is many-to-many, since one Modus
maturity question can evidence several SEDG figures and one SEDG figure can be
evidenced by none.

**F · `mapping_status` is invisible to the engine** — the indicator SELECT at
`scoringEngine.js:293–294` does not read it. A draft indicator scores exactly
like an official one. It is used in exactly one runtime place, the badge at
`pages.js:267`, and **only `'draft'` renders a badge** — so a `'reconciled'` row
would be visually indistinguishable from an `'official'` one.

**G · The Layer 2 extractor's prompt grows with the indicator set.**
`extractionService.js:93–97` puts every eligible indicator into every chunk
prompt, up to `MAX_CHUNKS = 30`, against an 8,000 token/min Groq ceiling noted
in the file. `eligible()` (`:53–55`) drops `quantitative` and `multi_select`, so
a mostly-numeric SEDG set would either be dropped entirely — extraction
proposing nothing, silently — or enlarge every prompt.

**H · There is no admin UI.** `seed.sql:56–57` says the SEDG row exists "so the
gap is visible in the admin UI." **That admin UI does not exist.** The only
surface showing the gap is `GET /api/frameworks`.

---

## 6 · What this means for the 20 August claim

Unchanged, and now for a better-evidenced reason: **"SEDG-aligned (draft)"** is
the honest ceiling, and it stays the ceiling until the Phase 2 decision below is
made and built — not until 38 rows are inserted.

Inserting the 38 is perhaps a day. It buys the ability to say the official
disclosure set is *present in the platform*. It does not buy "SEDG-compliant",
because a disclosure set that cannot be scored, cannot be answered in its own
shapes, and cannot be traced back to the Modus questions is not an
implementation of SEDG. SME Corp would reach that in one question, exactly as
the handover says.

---

## 7 · The Phase 2 decision, stated but not made

**Is M-EasyESG a maturity assessment that references SEDG, or a SEDG disclosure
tool that also scores maturity?**

They are different products and the answer changes the schema.

- If **maturity assessment**: the 40 stay primary and scored, SEDG v2.0 is
  imported as a reference framework with a link table, and the platform's claim
  is "our assessment maps to SEDG" — provable, modest, and shippable well before
  20 August.
- If **disclosure tool**: SEDG becomes primary, which needs a response-type
  system for multi-line-item figures, lists and compound number+narrative
  answers, plus a scoring basis for reported figures that does not exist yet
  (benchmark? target? completeness-of-disclosure?). That is a sprint, not a day.

There is a third option worth arguing for: **score completeness, not
performance.** A SEDG disclosure has no good/bad — 1,240 tCO2e is neither. But
*disclosed / not disclosed / not applicable* is exactly what SEDG is for, and it
maps onto the existing engine cleanly, since `answer_ratio` can be 1.0 for a
complete disclosure and the evidence multiplier already exists. That would make
the SEDG score mean "how much of SEDG you can actually answer", which is the
honest thing a supply-chain customer wants to know, and it needs no new scoring
theory.

I rate the third option 8/10 and the disclosure-tool rebuild 4/10 before
20 August. But this is a positioning decision as much as a technical one, and
per `ecosystem-context.md` it routes through Dato' Dr Tan, not through me.

---

## Sources

- [Simplified ESG Disclosure Guide (SEDG) — Capital Markets Malaysia](https://sedg.capitalmarketsmalaysia.com/)
- [SEDG Version 2, full guide (PDF, July 2025)](https://sedg.capitalmarketsmalaysia.com/wp-content/uploads/2025/07/SEDG-v2.pdf)
- [SEDG Data Collection Template v2 (XLSX)](https://sedg.capitalmarketsmalaysia.com/wp-content/uploads/2025/07/SEDG-Data-Collection-Template_V.2.xlsx)
- [SEDG Version 1, full guide (PDF, October 2023)](https://sedg.capitalmarketsmalaysia.com/wp-content/uploads/2023/10/SEDG-Full-Guide.pdf)
- [SEDG Bahasa Melayu (v1)](https://sedg.capitalmarketsmalaysia.com/wp-content/uploads/2023/12/SEDG-Layout-BM-Final_Full-Guide.pdf)
- [SEDG Simplified Chinese (v1)](https://sedg.capitalmarketsmalaysia.com/wp-content/uploads/2023/12/SEDG_CH_Full-Disclosure.pdf)
- [Capital Markets Malaysia launches simplified ESG disclosure guide for SMEs — The Edge Malaysia](https://theedgemalaysia.com/node/686779)
- [Capital Markets Malaysia — Simplified ESG Disclosure Guide for SMEs in Supply Chains (OECD case study)](https://www.oecd.org/en/publications/scaling-up-public-financial-and-non-financial-support-for-sme-sustainability_4b79ddf3-en/capital-markets-malaysia-simplified-esg-disclosure-guide-for-smes-in-supply-chains_250ebf4a-en.html)
