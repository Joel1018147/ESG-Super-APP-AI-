-- ═══════════════════════════════════════════════════════════════════════════
-- Modus ESG Super App — reference data
--
-- Replayed on every boot, after schema.sql, as its own transaction.
-- Every statement is an idempotent upsert keyed on a natural key.
--
-- WHAT THIS FILE MAY AND MAY NOT CONTAIN
-- Reference data only: frameworks, indicators, weights, bands, emission
-- factors. No company data, no demo assessments. A seed that invents a company
-- makes the "genuinely zero" and "nobody has used it yet" empty states
-- indistinguishable on a fresh deploy.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. WEIGHTING SCHEME v1.0 ───────────────────────────────────────────────
-- E 40 / S 30 / G 30. This split is a MODUS DECISION, not a published standard:
-- SEDG does not weight its disclosures. It is stamped onto every score row, so
-- when SSEO revises it, insert a v1.1 row and flip is_active — never edit this
-- one, or every score ever issued silently changes meaning.
INSERT INTO esg_weighting_schemes
  (version, description, weight_e, weight_s, weight_g,
   mult_self_declared, mult_documented, mult_verified, is_active)
VALUES
  ('1.0',
   'Modus baseline. E/S/G 40/30/30. Evidence multipliers apply Verra''s conservativeness principle: an unverified claim scores below a documented one.',
   0.400, 0.300, 0.300, 0.600, 0.850, 1.000, true)
ON CONFLICT (version) DO NOTHING;

INSERT INTO esg_rating_bands (scheme_id, band_code, band_label, min_score, max_score, sort_order)
SELECT s.id, b.code, b.label, b.lo, b.hi, b.ord
FROM esg_weighting_schemes s
CROSS JOIN (VALUES
  ('AAA', 'Leading',      85.00, 100.00, 1),
  ('AA',  'Advanced',     75.00,  84.99, 2),
  ('A',   'Established',  65.00,  74.99, 3),
  ('BBB', 'Progressing',  55.00,  64.99, 4),
  ('BB',  'Developing',   45.00,  54.99, 5),
  ('B',   'Emerging',     30.00,  44.99, 6),
  ('CCC', 'Starting Out',  0.00,  29.99, 7)
) AS b(code, label, lo, hi, ord)
WHERE s.version = '1.0'
ON CONFLICT (scheme_id, band_code) DO NOTHING;


-- ── 2. FRAMEWORKS ──────────────────────────────────────────────────────────
INSERT INTO esg_frameworks (code, version, name, publisher, source_url, framework_kind, is_active, effective_from)
VALUES
  ('MODUS_SEDG_ALIGNED', '0.9-draft',
   'Modus SME ESG Assessment (SEDG-aligned draft)',
   'Modus AI Associates LLP',
   'https://sedg.capitalmarketsmalaysia.com/',
   'entity_disclosure', true, DATE '2026-01-01'),

  -- Placeholder. Carries NO indicators on purpose: the official SEDG
  -- disclosure list has not been imported, and a framework row with invented
  -- questions under the official name would be worse than an empty one.
  -- A table with no writer answers nothing; this row exists so the import has
  -- somewhere to land and so the gap is visible in the admin UI.
  ('SEDG', '2.0',
   'Simplified ESG Disclosure Guide v2 (38 disclosures) — AWAITING OFFICIAL IMPORT',
   'Capital Markets Malaysia / Securities Commission Malaysia',
   'https://sedg.capitalmarketsmalaysia.com/',
   'entity_disclosure', false, NULL),

  -- Reference only, and framework_kind enforces it. Verra certifies carbon
  -- PROJECTS and issues VCUs; it publishes no company-level E/S/G indicators.
  -- scoringEngine.js refuses to score against any framework whose kind is not
  -- 'entity_disclosure'. See docs/VERRA_BENCHMARK.md.
  ('VERRA_VCS', '4.x',
   'Verified Carbon Standard — reference registry, not an entity rating scheme',
   'Verra',
   'https://verra.org/programs/verified-carbon-standard/',
   'project_crediting', true, NULL)
ON CONFLICT (code, version) DO NOTHING;


-- ── 3. INDICATORS (MODUS_SEDG_ALIGNED 0.9-draft) ───────────────────────────
-- mapping_status = 'draft' on every row: Modus authored these against public
-- descriptions of SEDG's themes, GHG Protocol scopes and common Bursa
-- indicators. NOBODY has reconciled them line-by-line against the official
-- SEDG PDF. The UI badges them. Reconciliation is a checklist in
-- docs/SCORING_METHODOLOGY.md and must happen before any external claim of
-- SEDG alignment is made.
INSERT INTO esg_indicators
  (framework_id, code, pillar, tier, sort_order, question_en, guidance_en,
   response_type, unit, weight, allows_na, external_ref, mapping_status)
SELECT f.id, v.code, v.pillar, v.tier, v.ord, v.q, v.guidance, v.rtype, v.unit, v.w, v.na, v.ref, 'draft'
FROM esg_frameworks f
CROSS JOIN (VALUES
  -- ENVIRONMENTAL
  ('E-01','E','basic',        10,'Does the company track its monthly electricity consumption?','Meter readings or TNB/SESB/SEB bills for the reporting year.','yes_partial_no',NULL,2.0,false,'SEDG:E-energy'),
  ('E-02','E','basic',        20,'Total electricity consumed in the reporting year','From utility bills. Feeds the Scope 2 calculation.','quantitative','kWh',2.0,false,'SEDG:E-energy'),
  ('E-03','E','basic',        30,'Does the company track fuel consumed by owned vehicles or generators?','Fuel receipts or fleet card statements.','yes_partial_no',NULL,1.5,true,'SEDG:E-scope1'),
  ('E-04','E','basic',        40,'Total diesel consumed by owned assets in the reporting year','Leave as Not Applicable if the company owns no vehicles or generators.','quantitative','litre',1.5,true,'SEDG:E-scope1'),
  ('E-05','E','basic',        50,'Total petrol consumed by owned assets in the reporting year','Leave as Not Applicable if the company owns no petrol vehicles.','quantitative','litre',1.0,true,'SEDG:E-scope1'),
  ('E-06','E','basic',        60,'Does the company track water consumption?','Water bills or meter readings.','yes_partial_no',NULL,1.5,false,'SEDG:E-water'),
  ('E-07','E','basic',        70,'Total water consumed in the reporting year','From utility bills.','quantitative','m3',1.0,false,'SEDG:E-water'),
  ('E-08','E','basic',        80,'Does the company segregate and record waste?','General, recyclable and scheduled waste recorded separately.','yes_partial_no',NULL,1.5,false,'SEDG:E-waste'),
  ('E-09','E','intermediate', 90,'Proportion of waste diverted from landfill through recycling','Recycling contractor records.','quantitative','%',1.5,false,'SEDG:E-waste'),
  ('E-10','E','intermediate',100,'Maturity of the company''s greenhouse gas inventory','0 none / 1 ad hoc / 2 Scope 1+2 estimated / 3 Scope 1+2 documented annually / 4 Scope 1+2+3 with assurance.','maturity_0_4',NULL,3.0,false,'SEDG:E-ghg'),
  ('E-11','E','intermediate',110,'Does the company use any renewable energy?','Rooftop solar, a green tariff or purchased RECs.','yes_partial_no',NULL,1.5,false,'SEDG:E-energy'),
  ('E-12','E','intermediate',120,'Has the company set a documented emissions or energy reduction target?','A target with a base year, a target year and a number.','yes_partial_no',NULL,2.0,false,'SEDG:E-target'),
  ('E-13','E','advanced',    130,'Maturity of environmental management across the supply chain','0 none / 1 aware / 2 key suppliers asked / 3 suppliers assessed / 4 assessed and remediated.','maturity_0_4',NULL,2.0,false,'SEDG:E-supply'),
  ('E-14','E','advanced',    140,'Were there any reportable environmental incidents or DOE notices in the year?','Answering yes does not score zero — an undisclosed incident is the risk, not a disclosed one.','yes_partial_no',NULL,1.0,false,'SEDG:E-compliance'),

  -- SOCIAL
  ('S-01','S','basic',        10,'Total number of employees at year end','Headcount including permanent, contract and part-time.','quantitative','people',1.5,false,'SEDG:S-workforce'),
  ('S-02','S','basic',        20,'Proportion of women in the total workforce','','quantitative','%',1.5,false,'SEDG:S-diversity'),
  ('S-03','S','basic',        30,'Proportion of women in management positions','','quantitative','%',1.5,false,'SEDG:S-diversity'),
  ('S-04','S','basic',        40,'Does the company record workplace injuries and lost time?','DOSH-reportable incidents and internal near-miss records.','yes_partial_no',NULL,2.0,false,'SEDG:S-safety'),
  ('S-05','S','basic',        50,'Number of lost-time injuries in the reporting year','Enter 0 if none occurred. 0 is a real answer and scores as disclosed.','quantitative','cases',1.5,false,'SEDG:S-safety'),
  ('S-06','S','basic',        60,'Average training hours per employee in the reporting year','Total training hours divided by headcount. HRD Corp claims are a good source.','quantitative','hours',1.5,false,'SEDG:S-training'),
  ('S-07','S','basic',        70,'Does the company have a written health and safety policy?','','yes_partial_no',NULL,2.0,false,'SEDG:S-safety'),
  ('S-08','S','intermediate', 80,'Employee turnover rate in the reporting year','Leavers divided by average headcount.','quantitative','%',1.0,false,'SEDG:S-workforce'),
  ('S-09','S','intermediate', 90,'Does the company have a documented human rights and non-discrimination policy?','','yes_partial_no',NULL,1.5,false,'SEDG:S-humanrights'),
  ('S-10','S','intermediate',100,'Has the company declared that it uses no child labour and no forced labour?','A signed declaration covering the company and its direct suppliers.','yes_partial_no',NULL,2.0,false,'SEDG:S-labour'),
  ('S-11','S','intermediate',110,'Maturity of the employee grievance mechanism','0 none / 1 informal / 2 named contact / 3 documented procedure / 4 documented, anonymous and reported on.','maturity_0_4',NULL,1.5,false,'SEDG:S-grievance'),
  ('S-12','S','advanced',    120,'Does the company measure customer satisfaction?','Survey, NPS or a recorded complaints process.','yes_partial_no',NULL,1.0,false,'SEDG:S-customer'),
  ('S-13','S','advanced',    130,'Community investment or volunteering during the year','Cash, in-kind or hours contributed to the community.','yes_partial_no',NULL,1.0,false,'SEDG:S-community'),

  -- GOVERNANCE
  ('G-01','G','basic',        10,'Number of directors on the board','','quantitative','people',1.0,false,'SEDG:G-board'),
  ('G-02','G','basic',        20,'Proportion of women on the board','','quantitative','%',1.5,false,'SEDG:G-board'),
  ('G-03','G','basic',        30,'Does the board include at least one independent or non-executive director?','','yes_no',NULL,1.5,false,'SEDG:G-board'),
  ('G-04','G','basic',        40,'Does the company have a written code of conduct?','','yes_partial_no',NULL,2.0,false,'SEDG:G-ethics'),
  ('G-05','G','basic',        50,'Does the company have an anti-bribery and anti-corruption policy?','Relevant to Section 17A of the MACC Act 2009 — adequate procedures are a defence.','yes_partial_no',NULL,2.5,false,'SEDG:G-abac'),
  ('G-06','G','basic',        60,'Does the company have a whistleblowing channel?','','yes_partial_no',NULL,2.0,false,'SEDG:G-whistle'),
  ('G-07','G','intermediate', 70,'Maturity of the risk management process','0 none / 1 informal / 2 risks listed / 3 register with owners / 4 register reviewed by the board.','maturity_0_4',NULL,2.0,false,'SEDG:G-risk'),
  ('G-08','G','intermediate', 80,'Does the company have a data privacy policy aligned to the PDPA 2010?','','yes_partial_no',NULL,1.5,false,'SEDG:G-privacy'),
  ('G-09','G','intermediate', 90,'Maturity of cybersecurity controls','0 none / 1 antivirus only / 2 backups and access control / 3 documented policy and MFA / 4 tested incident response.','maturity_0_4',NULL,1.5,false,'SEDG:G-cyber'),
  ('G-10','G','intermediate',100,'Does the company have a supplier code of conduct?','','yes_partial_no',NULL,1.5,false,'SEDG:G-supply'),
  ('G-11','G','advanced',    110,'Is there a named person or committee accountable for ESG?','','yes_partial_no',NULL,2.0,false,'SEDG:G-oversight'),
  ('G-12','G','advanced',    120,'Are the accounts subject to an internal or external audit?','','yes_partial_no',NULL,1.5,false,'SEDG:G-audit'),
  ('G-13','G','advanced',    130,'Was ethics or compliance training delivered during the year?','','yes_partial_no',NULL,1.0,false,'SEDG:G-training')
) AS v(code, pillar, tier, ord, q, guidance, rtype, unit, w, na, ref)
WHERE f.code = 'MODUS_SEDG_ALIGNED' AND f.version = '0.9-draft'
ON CONFLICT (framework_id, code) DO NOTHING;


-- ── 4. EMISSION FACTORS ────────────────────────────────────────────────────
-- Malaysia has THREE grids and their factors differ by a factor of 3.7. Using a
-- national average would overstate a Sarawak SME's Scope 2 by roughly 270%.
INSERT INTO esg_emission_factors
  (code, scope, category, label, factor_value, unit_from, unit_to, region,
   source_name, source_url, source_year, version, valid_from, verification_status)
VALUES
  ('GEF_PENINSULAR', 2, 'grid_electricity', 'Grid electricity — Peninsular Malaysia',
   0.74000000, 'kWh', 'kgCO2e', 'peninsular',
   'Suruhanjaya Tenaga (Energy Commission Malaysia), Grid Emission Factor',
   'https://myenergystats.st.gov.my/documents/d/guest/grid-emission-factor-gef-in-malaysia-2022-2024-provisional-',
   '2022-2024 (provisional)', '2022-2024', DATE '2022-01-01', 'verified'),

  ('GEF_SABAH', 2, 'grid_electricity', 'Grid electricity — Sabah & Labuan',
   0.53900000, 'kWh', 'kgCO2e', 'sabah',
   'Suruhanjaya Tenaga (Energy Commission Malaysia), Grid Emission Factor',
   'https://myenergystats.st.gov.my/documents/d/guest/grid-emission-factor-gef-in-malaysia-2022-2024-provisional-',
   '2022-2024 (provisional)', '2022-2024', DATE '2022-01-01', 'verified'),

  ('GEF_SARAWAK', 2, 'grid_electricity', 'Grid electricity — Sarawak',
   0.19900000, 'kWh', 'kgCO2e', 'sarawak',
   'Sarawak Energy Berhad annual and sustainability reporting, as compiled by Suruhanjaya Tenaga',
   'https://myenergystats.st.gov.my/documents/d/guest/grid-emission-factor-gef-in-malaysia-2022-2024-provisional-',
   '2022-2024 (provisional)', '2022-2024', DATE '2022-01-01', 'verified'),

  -- UNVERIFIED ON PURPOSE. These are the widely-used DEFRA well-to-tank +
  -- combustion figures, not Malaysian ones, and nobody at Modus has checked
  -- them against a Malaysian fuel specification. carbonEngine.js will still
  -- calculate with them, but stamps is_provisional = true on the entry and the
  -- UI badges the result. Replace with a sourced Malaysian factor and flip
  -- verification_status; do NOT edit these rows in place — insert a new version.
  ('FUEL_DIESEL', 1, 'mobile_combustion', 'Diesel — mobile and stationary combustion',
   2.68000000, 'litre', 'kgCO2e', NULL,
   'DEFRA GHG conversion factors (PLACEHOLDER — Malaysian factor not yet sourced)',
   NULL, 'pending', 'placeholder-1', DATE '2026-01-01', 'unverified'),

  ('FUEL_PETROL', 1, 'mobile_combustion', 'Petrol / RON95 — mobile combustion',
   2.31000000, 'litre', 'kgCO2e', NULL,
   'DEFRA GHG conversion factors (PLACEHOLDER — Malaysian factor not yet sourced)',
   NULL, 'pending', 'placeholder-1', DATE '2026-01-01', 'unverified')
ON CONFLICT (code, version) DO NOTHING;
