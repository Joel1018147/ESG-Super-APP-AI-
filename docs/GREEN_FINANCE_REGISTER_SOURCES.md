# GREEN FINANCE REGISTER — SOURCE OF TRUTH FOR THE SEED

**Compiled by Cowork, 2026-08-15.** Every row was read from the URL given.
`last_verified` for every row is **2026-08-15**.

**The rules that govern this file, and the seed built from it:**

1. **`null` means the source did not state it.** It is not zero, not "ask us",
   and not an invitation to fill in something plausible. A null renders as
   *instrumented-but-empty* — the product exists, the institution does not
   publish the term.
2. **Never enrich a row.** Do not carry a figure from an earlier version of a
   scheme into a later one. Do not infer a tenure from a similar product.
3. **`source_publisher='news'` is a first-class fact**, not a footnote. Two
   flagship products in this register have no published terms anywhere and
   everything known about them comes from BERNAMA.
4. **`availability_status` is not decoration.** Telling an SME a retired facility
   is open is the most expensive error this module can make — they act on it.
5. When this file and the database disagree, **the database is what users saw**
   and this file gets corrected. Same rule as everywhere else: the artefact wins.

---

## PART A — THE FIVE ROWS THAT WILL BE WRONG IF TRANSCRIBED CARELESSLY

| Row | The trap |
|---|---|
| **BNM Low Carbon Transition Facility (LCTF)** | Seed `unclear`. Absent from BNM's own current Fund for SMEs page (which now lists only SME SRF, MEF, PTF, RAFt). Hong Leong's LCTF page **404s**; Alliance Bank's **404s**. Yet Maybank and CIMB both still market it as available. Also: BNM's launch release says **RM1 billion**; CIMB's product page says **"the scheme limit of RM2 billion"**. No BNM source confirms an increase. Seed neither figure as authoritative. |
| **BNM High Tech and Green Facility (HTG)** | Seed `unclear`. BNM's own brochure states availability **"Until 31 December 2023."** Absent from the current fund page. CIMB, Maybank and CGC still list it. |
| **GTFS 4.0** | Seed `superseded`, `is_active=false`. Expired **31 Dec 2025 and was NOT fully utilised** — it simply ran out of time. CGC's own page is stale and still advertises RM846,608,250 remaining as at 31 July 2025. |
| **GTFS 5.0** | Seed `open`. **It dropped the rate rebate.** 4.0 gave *"1.5% per annum rebate on the interest or profit rate"*; 5.0 says it *"will no longer provide rebates on interest or profit rates"* — only the 60–80% guarantee remains. **5.0 publishes no per-category caps or tenures.** 4.0's figures (RM100m/RM50m/RM25m, 15/10/5 years) belong to the expired scheme. Leave 5.0's null. |
| **Maybank Sustainability-Linked Loan Programme** | Sits in Maybank's SME section and has a **RM50 million minimum**. It is a corporate product. `borrower_scope='corporate'`. Routing an SME to it is the kind of confidently-wrong answer that costs trust. |

**BNM's strategic shift, 6 Jan 2026** — additional RM2.5bn (total RM34.9bn,
RM32.4bn already disbursed) and a stated move *"toward credit guarantee schemes
targeting guaranteed financing amounting to RM10 billion"* with CGC. This is the
mechanism by which LCTF and HTG appear to be giving way to guarantees, and it is
why `unclear` is the honest status rather than `open` or `closed`.
https://www.bnm.gov.my/-/addfund

---

## PART B — THE REGISTER

`FT` = financing_type: `UOP` use_of_proceeds_green · `SLF` sustainability_linked ·
`GTE` guarantee · `GRT` grant_or_subsidy · `UNC` unclear.
`BS` = borrower_scope. `SP` = source_publisher: `own` institution_own ·
`reg` regulator · `agy` agency · `news`.

### B0 — The three columns the table below does not carry, and how to fill them

**`institution_kind`** is deterministic from the institution, not from the row:

| Institution | `institution_kind` |
|---|---|
| Bank Negara Malaysia | `regulator` |
| MGTC | `agency` |
| Credit Guarantee Corporation | `guarantee_corp` |
| MIDF | `development_fi` |
| RHB · CIMB · Maybank · Bank Islam · AmBank · Hong Leong · HSBC · Public Bank | `bank` |

**`status_note`** is NOT NULL. Build it from the row's **Status** cell, plus the
Part A paragraph verbatim where the row appears in Part A, plus the eligibility
sentences printed under the table where they exist. It is a sentence a human
reads, not a code.

**`max_financing_myr` is NULL for every tiered product.** Four rows publish
different caps for different borrower or project categories and cannot be
reduced to one number — GTFS 4.0 (row 5), Maybank LCTF (16), Bank Islam ECO (19),
and CGC BizJamin (7, whose cap is a formula). For those, `max_financing_myr` is
NULL and `amount_note` carries the tiers verbatim. Picking one tier is the
enrichment this file exists to prevent.

Row 17, Maybank's SLL, publishes a **minimum, not a maximum** — RM50,000,000.
That is `min_financing_myr`, and it is the field that keeps an SME from being
routed to a corporate product.

### Regulator and agency programmes

| # | Institution | Product | FT | BS | Max (MYR) | Tenure | Rate | Status | SP | Source |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Bank Negara Malaysia | Low Carbon Transition Facility (LCTF) | UOP | sme | 10,000,000 | Up to 10 years | Max 5.0% p.a. incl. guarantee fee; *"Collateral is not required under the LCTF"* | **unclear** | reg | bnm.gov.my/documents/20124/6025157/lctf_broc_en_v3.pdf |
| 2 | Bank Negara Malaysia | High Tech and Green Facility (HTG) | UOP | sme | 10,000,000 | Up to 10 years | Up to 3.5% p.a. without guarantee; up to 5% p.a. incl. guarantee fee | **unclear** | reg | bnm.gov.my/documents/20124/6025157/htg_broc_en.pdf |
| 3 | Bank Negara Malaysia | Greening Value Chain (GVC) Programme | GRT | sme | null | null | null — financing routes via LCTF | unclear | reg | bnm.gov.my/-/cop27-gvc-lctf |
| 4 | MGTC | Green Technology Financing Scheme (GTFS) 5.0 | GTE | both | null | null | **No rebate.** 60–80% government guarantee on the green component only | **open** | agy | gtfs.my/faq/what-gtfs-50 |
| 5 | MGTC | Green Technology Financing Scheme (GTFS) 4.0 | GTE | both | **null — tiered.** `amount_note`: "Producer RM100m · User RM50m · ESCO RM25m · Housing Developer RM100m · Low Carbon Mobility RM50m" | Producer 15y · User/ESCO 10y · Housing/Mobility 5y | 1.5% p.a. rebate up to 7y (5y housing/mobility); guarantee to 60%, 80% waste; CGC charge 0.50% p.a. | **superseded** | agy | gtfs.my/page/features-gtfs-40 |
| 6 | Credit Guarantee Corporation | Green Technology Financing Scheme/-i 5.0 | GTE | both | null | null | null | open | agy | cgc.com.my/en-us/what-we-do/guarantee/green-technology-financing-scheme-i-5-0/ |
| 7 | Credit Guarantee Corporation | BizJamin/-i High Tech & Green Facility Scheme | GTE | sme | **null — formula.** `amount_note`: "Between 30% and 80%, or up to RM8.0 million per SME, whichever is lower" | Up to 10 years | Guarantee fee 0.50% p.a. | unclear — depends on BNM HTG | agy | cgc.com.my/en-us/what-we-do/guarantee/bizjamin-i-high-tech-green-facility/ |

**GTFS 5.0 eligibility:** Malaysian-registered companies with **≥60% Malaysian
shareholding**. Categories: Producer, User, ESCO, Housing Developer, Low Carbon
Mobility Infrastructure. Sectors: Energy, Manufacturing, Transport, Building,
Waste, Water. RM1.0bn allocation to 31 Dec 2026. Housing max selling price raised
to RM450,000.

### Banks — SME green financing

| # | Institution | Product | FT | BS | Max (MYR) | Tenure | Rate | Status | SP | Source |
|---|---|---|---|---|---|---|---|---|---|---|
| 8 | RHB Bank | SME Green Renewable Energy and CAPEX Financing | UOP | sme | null (margin up to 100%) | null | As low as 4.5% p.a. | open | own | rhbgroup.com/greenfinancing/index.html |
| 9 | RHB Bank | SME Green Building Financing | UOP | sme | null (margin up to 90%) | null | As low as BLR/BFR − 2.80% p.a. | open | own | rhbgroup.com/greenfinancing/index.html |
| 10 | RHB Bank | SME Green Working Capital Financing | UOP | sme | null | null | As low as 4.5% p.a. | open | own | rhbgroup.com/greenfinancing/index.html |
| 11 | RHB Bank | SME Green Construction Financing | UOP | sme | null (margin up to 90%) | null | As low as BLR/BFR − 2.80% p.a. | open | own | rhbgroup.com/greenfinancing/index.html |
| 12 | RHB Bank | Sustainable Trade Finance Programme/-i | UOP | unstated | null (programme size RM1bn) | null | null | open | own | rhbgroup.com/others/sustainability/sustainable-responsible-finance/advancing-smes-towards-sustainable-business-practices/index.html |
| 13 | CIMB Bank / CIMB Islamic | Low Carbon Transition Facility / LCTF-i | UOP | sme | null | null | null (page says only "Attractive Financing Rate") | unclear — see Part A | own | cimb.com.my/en/business/business-solutions/financing/government-bnm-schemes-financing/low-carbon-transition-facility.html |
| 14 | CIMB Bank / CIMB Islamic | High Tech and Green Facility / HTG-i | UOP | sme | 10,000,000 | Up to 10 years | Up to 3.5% p.a. without guarantee; up to 5.0% p.a. with SJPP guarantee | unclear — see Part A | own | cimb.com.my/en/business/business-solutions/financing/government-bnm-schemes-financing/high-tech-and-green-facility.html |
| 15 | CIMB Group | GreenBizReady Sustainability-Linked Financing Programme | SLF | sme | null (programme RM3bn through 2030) | null | Up to 0.50% p.a. rebate on achieving agreed targets | open | **news** | bernama.com/en/news.php?id=2211870 |
| 16 | Maybank | Low Carbon Transition Facility/-i | UOP | sme | **null — tiered.** `amount_note`: "Up to RM2.5m (turnover ≤RM25m); up to RM10m (turnover ≥RM25m)" | Up to 10 years | Up to 5% p.a. | unclear — see Part A | own | https://www.maybank2u.com.my/maybank2u/malaysia/en/business/financing/working_capital/business/solar-financing.page |
| 17 | Maybank | Sustainability-Linked Loan Programme | SLF | **corporate** | max null · **min 50,000,000** | null | "More attractive loan terms" on baseline verification; rebate not disclosed | open | own | https://www.maybank2u.com.my/maybank2u/malaysia/en/business/sme/promotions/sustainability-linked-loan-programme.page |
| 18 | Maybank | Energy-Efficient Appliances for Business | UOP | sme | null | null | null | open | own | https://www.maybank2u.com.my/maybank2u/malaysia/en/business/sme/grow/esg-financing-listing.page |
| 19 | Bank Islam Malaysia | SME SMART Eco Financing Program-i (ECO) | UOP | sme | **null — tiered.** `amount_note`: "Up to RM5m (User) · up to RM15m (Producer) · sole proprietorships and partnerships limited to RM2.5m" | BF-i up to 9 years; BCL-i 1 year subject to annual review | Profit rate not stated. Margin: working capital 100%, capex up to 90%. Up to 80% SJPP guarantee, fee up to 1% p.a. Directors' joint and several guarantees for Sdn Bhd | open | own | bankislam.com/business-banking/sme-banking/eco/ |
| 20 | Bank Islam Malaysia | IHSAN Financing for Business Resilience, Sustainability and Green Transition (IFiRST) | UNC | both | null | null | null | open — announced June 2025, **no product page exists** | **news** | bernama.com/en/news.php/?id=2436080 |
| 21 | AmBank Group | Sustainability-Linked Financing | SLF | unstated | null | null | "pricing rebates" on target achievement, amount not disclosed | open | own | ambankgroup.com/sustainability/our-solutions |
| 22 | AmBank Group | Project Financing for Green and Renewable Energy Projects | UOP | unstated | null | null | null | open | own | ambankgroup.com/sustainability/our-solutions |
| 23 | Hong Leong Bank | HLB SME Solar Financing | UOP | sme | 10,000,000 | null | null | open | own | hlb.com.my/en/business-banking/group-sme-banking/loan/sme-solar-financing.html |
| 24 | HSBC Malaysia | Green Loans | UOP | unstated | null | null | null | open | own | business.hsbc.com.my/en-gb/campaigns/sustainability |
| 25 | HSBC Malaysia | Sustainability-Linked Loans | SLF | unstated | null | null | Cost of capital linked to ESG/sustainability metrics | open | own | business.hsbc.com.my/en-gb/campaigns/sustainability |
| 26 | HSBC Malaysia | Green Trade Loans | UOP | unstated | null | null | null | open | own | business.hsbc.com.my/en-gb/campaigns/sustainability |
| 27 | HSBC Malaysia | Sustainable Supply Chain Loan | UOP | unstated | null | null | null | open | own | business.hsbc.com.my/en-gb/campaigns/sustainability |
| 28 | MIDF | Sustainable Green Biz Financing (SGBF) | UOP | both | 10,000,000 | Up to 25 years (varies by asset type) | **3% p.a. for SMEs; 5% p.a. for non-SMEs.** Margin up to 100% | open | own | growyourbusiness.com.my/financing/green-financing |

**HLB SME Solar eligibility (published):** SME per BNM definition; sole
prop/partnership/LLP/Sdn Bhd; ≥3 years operating or key person ≥3 years
experience; annual sales turnover RM500,000 and above.

**Bank Islam ECO eligibility (published):** Malaysian SMEs; Malaysians resident in
Malaysia holding ≥51% shareholding; PLC/GLC shareholding capped at 20%. Sectors:
Energy, Building & Township, Transport, Waste, Manufacturing.

### Retail — seed with `borrower_scope='retail'`, exclude from SME routing

| # | Institution | Product | Max | Tenure | Rate | Status | SP | Source |
|---|---|---|---|---|---|---|---|---|
| 29 | RHB Bank | Solar Panel Financing Package | 100,000 | Up to 7 years | As low as 4.27% p.a. conventional / 4.13% p.a. Islamic | open | own | https://www.rhbgroup.com/greenfinancing/index.html |
| 30 | Maybank | Maybank Solar Financing/-i | 100,000 | Up to 10 years | null | open | own | https://www.maybank2u.com.my/maybank2u/malaysia/en/personal/loans/others/maybank-solar-financing.page |
| 31 | Public Bank | GO GREEN with Green Vehicle Financing | null | null | null | **unclear** | own | https://www.pbebank.com/en/promotions/latest-promotions/go-green-with-green-vehicle-financing/ |

**Row 31 is the one row in this file that was NOT read.** The page is disallowed
by `pbebank.com`'s robots.txt and was not fetched. Its `status_note` must say so
in those words: *"Listed in Public Bank's promotions index; the product page
could not be read (robots.txt). Terms unverified."* The header rule "every row
was read from the URL given" has exactly this one exception, and it is recorded
rather than hidden.

---

## PART C — EXPECTED BUT NOT VERIFIABLE

Each of these is a **finding**, not a gap in the research. An institution
marketing sustainability heavily while publishing no terms is a fact the UI
should be able to state.

Each row's "actually found" was established by searching the institution's own
domain and reading what it returned. Where a URL is given, that is the page that
was read; where none is given, the finding is an **absence** on that domain and
there is nothing to link to. An absence is not a figure and seeds nothing.

| Institution | Expected | Actually found |
|---|---|---|
| **Public Bank** | An SME green product — it is on BNM's LCTF participating-FI list and publishes a Sustainable Finance chapter | **No SME green financing product page exists on pbebank.com.** Only a retail vehicle promotion, itself unfetchable. The weakest-documented major bank in this set. |
| **CIMB GreenBizReady** | Terms for the flagship SME sustainability proposition | CIMB's own GreenBizReady and SLF pages are JS-rendered and serve **no terms at all** — only taglines. Every figure comes from BERNAMA. The RM250m (2021 launch) and RM3bn (2025 SLF) figures are **different things** and must not be merged. |
| **Bank Islam IFiRST** | A product page with size, tenure, rate | Announced June 2025 by press release only. **No product page exists.** |
| **AmBank** | A proprietary SME green product, given heavily publicised green deals | Its green page lists mostly **government schemes it distributes**. **Zero published amounts, tenures or rates.** |
| **HSBC Malaysia** | An SME green loan (HSBC runs one in Singapore) | Corporate/commercial **framework-level only**. Six product names, no terms, no SME variant. |
| **Maybank** | An SME green product with published terms | Only the LCTF distribution has terms. "Solar for Business" and "Energy-Efficient Appliances" carry none. The SLL has a RM50m floor. |
| **CGC** | A standalone green guarantee independent of GTFS/HTG | **None exists.** CGC's only green schemes are GTFS/-i 4.0, GTFS/-i 5.0 and BizJamin/-i HTG — all channelling other agencies' programmes. https://www.cgc.com.my/en-us/what-we-do/guarantee/ |
| **Hong Leong LCTF** | HLB is on BNM's LCTF PFI list | **Page returns 404.** Withdrawn or restructured. |

---

## PART D — THE TAXONOMIES

### BNM Climate Change and Principle-based Taxonomy (CCPT)
Issued **30 April 2021**, effective same date. Binds nine categories of
BNM-supervised institution. **This is what a Malaysian bank's credit paper
references.**
https://www.bnm.gov.my/documents/20124/938039/Climate+Change+and+Principle-based+Taxonomy.pdf

**Guiding principles**

| Code | Name |
|---|---|
| GP1 | Climate Change Mitigation — reduce or prevent emission of GHG into the atmosphere |
| GP2 | Climate Change Adaptation — lower the negative effects and/or moderate harm caused by climate change |
| GP3 | No Significant Harm to the Environment |
| GP4 | Remedial Measures to Transition |
| GP5 | Prohibited Activities |

**Classification categories**

| Code | Group | Definition |
|---|---|---|
| C1 | Climate Supporting | Meets GP1 or GP2 with no environmental harm |
| C2 | Transitioning | Meets GP1/GP2 but causes harm; has remedial efforts |
| C3 | Transitioning | No climate contribution; implements remedial measures |
| C4 | Watchlist | Meets GP1/GP2 but lacks commitment to remediation |
| C5 | Watchlist | No climate contribution and no remedial efforts |

### ASEAN Taxonomy for Sustainable Finance — Version 4
**6 November 2025. Version 3 is superseded.**
https://asean.org/wp-content/uploads/2025/11/ASEAN-Taxonomy-Sustainable-Finance-V4_06Nov25.pdf

- **Foundation Framework** (principles-based, qualitative): `Green` · `Amber` · `Red`
- **Plus Standard** (criteria-based): `Green — Tier 1` · `Amber — Tier 2` · `Amber — Tier 3` · `Red — PS`
- **Four environmental objectives:** Climate Change Mitigation · Climate Change
  Adaptation · Protection of Healthy Ecosystems and Biodiversity · Resource
  Resilience and the Transition to a Circular Economy
- **Three essential criteria:** Do No Significant Harm · Remedial Measures to
  Transition · Social Aspects
- **Six focus sectors:** Agriculture, Forestry and Fishing · Electricity, Gas,
  Steam and Air Conditioning Supply · Manufacturing · Transportation and Storage ·
  Water Supply, Sewerage, Waste Management and Remediation · Construction and Real Estate
- **Three enabling sectors:** Information and Communication · Professional,
  Scientific and Technical Activities · Carbon Capture, Utilisation and Storage

**Store both classifications separately. Do not collapse them into one enum.**
CCPT's GP3 and GP4 map onto ASEAN's Do No Significant Harm and Remedial Measures
to Transition — the overlap is deliberate, and merging the axes loses the
distinction a bank will ask about.

---

## PART E — WHAT A BANK ACTUALLY ASKS AN SME FOR

Only five sources publish an explicit list. These are the only ones that should
seed a document checklist. Everything else would be a guess about someone else's
credit process.

| Source | URL | Requirements |
|---|---|---|
| **MGTC / GTFS** | https://www.gtfs.my/page/application-form · https://www.gtfs.my/page/application-process | Signed Undertaking Letter · project approval documents where applicable (EIA Report, Small Renewable Energy Project approval, Renewable Energy Purchase Agreement, Energy Performance Contract, Land Purchase/Tenancy Agreement, Development Order, Product Purchase Contract, Fuel Supply Agreement) · valid quotations / Purchase Agreement / Invoices / valuation reports for all green equipment · shop drawings indicating metering and sensor locations for M&V · CVs, employment contract or latest EPF receipts, project management team org structure · site plans, layout drawings, project boundary evidence. **Process:** MGTC screening → technical evaluation → **Green Project Certificate, valid 6 months** → submit to a participating FI → CGC guarantee → disbursement → **quarterly reports until completion, then an M&V Audit Report within 6 months of commissioning.** |
| **Maybank SLL** | https://www.maybank2u.com.my/maybank2u/malaysia/en/business/sme/promotions/sustainability-linked-loan-programme.page | Loan application indicating ESG alignment intent · **ESG Disclosure Report** (prepared with Carbon Next) · **ESG Assurance Report** (verified by Chemsain) · ongoing annual SPT compliance to retain preferential pricing |
| **MIDF SGBF** | https://www.growyourbusiness.com.my/financing/green-financing | Valid business licence · company registration forms · director/shareholder ID copies · **6 months bank statements** · latest annual return · **3 years audited financials** · current management accounts. Approval ~1 month after complete submission |
| **CIMB GreenBizReady** | https://www.bernama.com/en/news.php?id=2211870 — **news outlet, not CIMB** | Energy and fuel consumption data entered into MGTC's low-carbon operating system platform for measurement and verification |
| **Hong Leong SME Solar** | https://www.hlb.com.my/en/business-banking/group-sme-banking/loan/sme-solar-financing.html | **Electricity bills, preferably past 6 months** · physical premises address · solar provider must be a **SEDA-registered PV Service Provider** |

**The pattern across all five:** ordinary credit documentation — financials,
registration, bank statements — **plus exactly one green-specific artefact**:
a third-party certificate (MGTC Green Project Certificate, a SEDA-registered
installer), a quantified baseline (6 months of electricity bills, energy/fuel
consumption data), or an assured ESG report.

**No Malaysian bank publishes a green-specific document checklist beyond that.**
Every requirement above is quoted from the URL in its row. Nothing has been
generalised from one institution to another — five sources publish a list, and
those five are the only ones that seed anything.

---

## PART F — WHAT THIS FILE DELIBERATELY DOES NOT CONTAIN

**A product → project-type mapping.** Deciding that "RHB SME Green Renewable
Energy and CAPEX Financing" covers `SOLAR_PV` *and* `ENERGY_STORAGE` but not
`GREEN_BUILDING` is judgement about eligibility, not transcription. The
institutions publish categories in their own words (quoted per row), and those
words do not partition cleanly onto twelve codes.

The junction table therefore **does not ship in Run 47.** It ships in the routing
run, where a human decision about each mapping is the feature rather than a
side-effect of seeding, and where a wrong mapping is visible because it produces
a wrong route.

**Bahasa Malaysia and Chinese labels.** This file is English because every source
is English. `seed.sql:150-154` already records the rule for this repo:
*"`question_bm` NULL, and `question_zh` NULL … Inventing one would be precisely
what `mapping_status` exists to prevent."* Project-type `label_bm` and `label_zh`
seed **NULL** and render as English with a translation-pending state. A
machine-translated financial term is a wrong term in two more languages.
The green burden sits with the agency or a named verifier, not the bank. That is
the whole shape of the financing application pack, and it means the platform's
real contribution is the **quantified baseline** — which it already holds, in
`esg_carbon_entries`, with the emission factor stamped on every row.
