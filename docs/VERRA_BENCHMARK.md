# Verra as the benchmark — what it can and cannot mean

**Status:** decided. Read this before changing anything in `verraService.js` or
the `framework_kind` guard in `scoringEngine.js`.

## The problem with the brief

The 8 June MoM records an agreement that "Verra should serve as the primary
benchmark" and that comprehensive benchmarking against Verra is a **mandatory
prerequisite** to development. Taken literally, that instruction cannot be
executed, and the reason is not a detail.

Verra operates the **Verified Carbon Standard**. VCS certifies **projects** that
reduce or remove greenhouse gases — a reforestation scheme, a cookstove
programme, a landfill-gas capture plant — and issues **Verified Carbon Units**,
one VCU per tonne of CO₂e. A project is validated and verified against a
**methodology** (VM0042, VM0007, and so on) by an accredited third party.

Verra publishes **no company-level environmental, social or governance
indicators**. There is no Verra questionnaire an SME fills in, no Verra score, no
Verra E/S/G rating. A forty-person furniture manufacturer in Klang cannot "get
Verra certified", because there is nothing about a furniture manufacturer for
VCS to certify unless that manufacturer is developing a carbon mitigation
project.

So "benchmark the ESG scoring engine against Verra" has no referent. There is
nothing on the other side of the comparison.

## What it was resolved to mean

Two concrete things, both built, both in this repo.

### 1. Verra's METHOD is the integrity model

VCS is the most demanding widely-used MRV regime in the voluntary market, and
three of its principles transfer directly to an SME disclosure tool:

| VCS principle | How it appears here |
|---|---|
| **Conservativeness** — where uncertainty exists, choose the assumption that understates the claim | `esg_weighting_schemes.mult_*`. A self-declared answer earns 60% of the available points, a documented one 85%, a third-party-verified one 100%. |
| **Third-party validation** — the proponent's own word is not evidence | `esg_responses.evidence_tier`, defaulting to the weakest tier, never inferred. |
| **Transparency and permanence of the record** — a claim must be reproducible later | Every `esg_scores` row stamps `framework_version`, `weighting_version` and `engine_version`; every `esg_carbon_entries` row stamps the emission factor value, version and source it used. |

The visible consequence, and it is deliberate: **an all-self-declared assessment
cannot exceed 60.00, and an all-documented one cannot exceed 85.00.** Band AAA is
unreachable without external verification. A screening that awards full marks for
unevidenced self-assessment is worth nothing to the bank or the buyer reading it.

### 2. Verra's DATA is mirrored, as reference

`esg_verra_projects` holds a local read-only copy of Verra's **public**
registry records, for the carbon-credit module in section 7 of the MoM.
`esg_verra_methodologies` and `esg_verra_issuances` exist in the schema and are
**NOT INGESTED** — `verraService.syncProjects()` writes projects only, and
neither of the other two has ever had a writer.

**Corrected in Run 61.** This paragraph previously named all three as though
all three were mirrored, and the section above still opens with "both built" —
the METHOD half is built and the DATA half is built for projects only. The
`/governance` page rendered a methodologies count as a stat-card reading `0`
for ever; that card is removed rather than left to be read as "Verra publishes
no methodologies". Restoring it means writing the ingest first.

Constraints on that mirror:

- **Metadata and canonical URLs only.** Methodology documents are Verra's
  copyrighted works. We store the identifier, name, scope, status and a link —
  never the document body.
- **Public endpoints only.** Verra's Registry Terms of Use require that data
  reached which is not part of a public report is not copied, disseminated or
  reused. Ingest touches only the public project feed.
- **Off by default.** `VERRA_INGEST_ENABLED` is `false` and `VERRA_API_BASE` is
  blank until set deliberately, so no fresh deploy starts polling a third party
  by accident.

## The boundary, enforced in code

`esg_frameworks.framework_kind` is `project_crediting` for `VERRA_VCS`.
`scoringEngine.scoreAssessment()` refuses any framework whose kind is not
`entity_disclosure` and says why. Nothing in the Verra tables can reach
`esg_scores`.

This is not defensive coding for its own sake. If an SME's ESG score were
computed against a carbon-crediting standard, the resulting number would be
presented to MITI, to SME Corp and to banks as an ESG rating while measuring
something else entirely — and it would be believed, because it carries Verra's
name.

## What the scoring engine IS benchmarked against

Malaysia's **Simplified ESG Disclosure Guide (SEDG)**, published by Capital
Markets Malaysia (an affiliate of the Securities Commission). It is the correct
anchor and it was already in the requirements document:

- v1 carries **35 priority disclosures** across Basic / Intermediate / Advanced
  tiers, aligned to Bursa Malaysia's sustainability indicators, GRI, ISSB and the
  GHG Protocol.
- v2 adds three more (**38**) and aligns to the ASEAN ASEDG.
- It is aimed precisely at SMEs sitting in the supply chains of listed issuers —
  the population this platform serves.

**Current gap, stated plainly.** The official SEDG disclosure list has not been
imported. The 40 indicators seeded in `seed.sql` sit under framework
`MODUS_SEDG_ALIGNED v0.9-draft`, every row carries `mapping_status = 'draft'`,
and the assessment UI badges them. A `SEDG v2.0` framework row exists with **zero
indicators** so the real import has somewhere to land and so the gap is visible
in the API rather than hidden.

**No external claim of SEDG alignment may be made until that reconciliation is
done.** See `SCORING_METHODOLOGY.md` for the checklist.

## What to take back to SSEO

1. Verra is the wrong benchmark for entity-level SME ESG, for the reason above.
   It is the right reference for the carbon-credit module, and it is built that
   way.
2. SEDG/ASEDG is the benchmark that actually matches the product, and it is what
   Malaysian supply-chain buyers already ask for.
3. If the intended analogue was "the thing large buyers demand from suppliers" —
   the "ESG CTOS" idea in section 10 of the MoM — the real-world comparator is
   **EcoVadis**, not Verra. Worth raising before the 20 August award event.
