# Governance & Recognition — source text

Supplied by Joel 2026-08-07 from the SSEO governance document. **This is the
authoritative wording for the landing page and `/governance`.** Do not
paraphrase it and do not extend it — these are statements about a real
organisation, and inventing one more is a claim about them.

---

## Platform registration

> The Malaysia SMEs ESG e-Reporting System is registered under the SMEs
> Sustainable Entrepreneur Organisation (SSEO) as the official platform for
> participating SME organisations and ESG reporting initiatives.

## Purpose — "The platform aims to:"

- Accelerate ESG adoption among Malaysian SMEs.
- Simplify ESG reporting through a user-friendly digital system.
- Enhance ESG readiness for local and international supply chains.
- Support access to sustainable finance and ESG-linked opportunities.
- Strengthen SME competitiveness through improved governance and sustainability
  practices.

## Platform objectives — "The system supports SMEs to:"

- Register and establish their ESG profile.
- Conduct ESG maturity assessments.
- Perform ESG self-reporting.
- Monitor ESG performance through real-time dashboards.
- Generate ESG reports aligned with Malaysian and international frameworks.
- Benchmark performance against industry peers.
- Receive AI-driven recommendations for continuous improvement.
- Prepare for external verification, certification, and investor or customer
  due diligence.

## Stakeholder ecosystem

**Platform owner** — SMEs Sustainable Entrepreneur Organisation (SSEO)

**Supporting partners**

- Universities and Research Institutions
- ESG Consultants
- Professional Bodies
- Financial Institutions
- Technology Providers
- Sustainability Assurance Partners

## Expected outcomes

- Increase ESG adoption among Malaysian SMEs.
- Improve supply-chain sustainability readiness.
- Enhance transparency and governance.
- Enable access to green financing and investment opportunities.
- Support Malaysia's ESG and Sustainable Development Goals (SDGs) agenda.
- Build a nationally recognised digital ESG reporting ecosystem for SMEs.

---

## OMITTED DELIBERATELY — do not add it back

The source document lists a **Strategic Endorsement** section naming SME Corp.
Malaysia, marked "subject to formal approval and continuing endorsement", and
carries this footnote:

> \*Use the SME Corp. Malaysia endorsement statement and logo only after
> obtaining formal written approval and in accordance with SME Corp. Malaysia's
> branding guidelines.

**So it does not appear anywhere in this software.** Not the name, not the
logo, not an "endorsement pending" line. A qualifier in a proposal and a
rendered claim in working software are different things, and the second is the
one a government partner's due diligence would ask about.

This stays out until Joel confirms formal written approval exists. It is
asserted by a test — `smecorp=false` — rather than by this paragraph, because
prose decays and a red build does not.

## A caution on the objectives

Two of the eight objectives describe capability this platform does not yet
have: **"Benchmark performance against industry peers"** and, in its full form,
**"Generate ESG reports aligned with Malaysian and international frameworks"**
— Reports renders `uninstrumented` today and there is no peer dataset.

Render them as the platform's stated objectives, which is what the source
document calls them. Do **not** render them as features, do not put them beside
a working control, and do not let a reader mistake the objectives list for a
feature list. If the distinction is not obvious on the page, label the section
"Platform objectives" and leave it at that.
