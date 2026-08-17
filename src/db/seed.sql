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


-- ── 3b. SEDG v2.0 — THE 38 OFFICIAL DISCLOSURES ────────────────────────────
-- Imported 2026-08-09 (Run 22) from docs/SEDG_V2_SOURCE.md §3, which quotes
-- the publisher's own PDF. 17 E / 11 S / 10 G; tiers 16 basic / 13
-- intermediate / 9 advanced. test/sedg-import-test.js asserts those counts and
-- compares every question_en against that document string-for-string.
--
-- WHY THESE VALUES ARE WHAT THEY ARE:
--   question_en  verbatim, INCLUDING the source's own inconsistent terminal
--                full stops on E5.1 and E5.2. Not normalised — the point of
--                mapping_status='official' is that this text is the
--                publisher's, and a tidied quote is no longer a quote.
--   question_bm  NULL, and question_zh NULL. The official BM and Chinese
--   question_zh  guides are VERSION 1 (Dec 2023) and cover 35 of these 38 —
--                E1.7, E3.1 and S2.3 have no official translation at all.
--                Inventing one would be precisely what mapping_status exists
--                to prevent.
--   weight       1.000 on all 38. SEDG publishes no weighting. Inventing one
--                would be a Modus opinion wearing the regulator's name.
--   allows_na    true exactly where the published text says "(if applicable)"
--                or "if any", and nowhere else.
--   external_ref the disclosure code itself — unlike the Modus rows, whose
--                external_ref holds an invented theme slug (trap E).
--   line_items   the expected parts, verbatim, for a fixed-part disclosure;
--                NULL for an open list. This is what makes one response type
--                carry all three awkward shapes.
--
-- Scoped to the SEDG framework and ON CONFLICT DO NOTHING, so it can never
-- touch MODUS_SEDG_ALIGNED and cannot multiply on replay.
INSERT INTO esg_indicators
  (framework_id, code, pillar, tier, sort_order, question_en, guidance_en,
   response_type, unit, weight, allows_na, external_ref, mapping_status, line_items)
SELECT f.id, v.code, v.pillar, v.tier, v.ord, v.q, NULL, v.rtype, v.unit,
       1.000, v.na, v.code, 'official', v.lines::jsonb
FROM esg_frameworks f
CROSS JOIN (VALUES
  -- ── ENVIRONMENTAL — 17 ──────────────────────────────────────────────────
  ('SEDG-E1.1','E','basic',        10,'Report total Scope 1 (direct) GHG emissions in metric tonnes of CO2 equivalent','quantitative','tCO2e',false,NULL),
  ('SEDG-E1.2','E','basic',        20,'Report total Scope 2 (indirect) GHG emissions in metric tonnes of CO2 equivalent','quantitative','tCO2e',false,NULL),
  ('SEDG-E1.3','E','intermediate', 30,'Report total Scope 1 GHG emissions reduced as a direct result of reduction initiatives, in metric tonnes of CO2 equivalent','quantitative','tCO2e',false,NULL),
  ('SEDG-E1.4','E','intermediate', 40,'Report total Scope 2 GHG emissions reduced as a direct result of reduction initiatives, in metric tonnes of CO2 equivalent','quantitative','tCO2e',false,NULL),
  ('SEDG-E1.5','E','advanced',     50,'Report total Scope 3 (other indirect) GHG emissions in metric tonnes of CO2 equivalent','quantitative','tCO2e',false,NULL),
  ('SEDG-E1.6','E','advanced',     60,'Report total Scope 3 GHG emissions reduced as a direct result of reduction initiatives, in metric tonnes of CO2 equivalent','quantitative','tCO2e',false,NULL),
  ('SEDG-E1.7','E','advanced',     70,'Report total Scope 1 and 2 GHG intensity in metric tonnes CO2 equivalent per unit of organisation-specific metrics','quantitative','tCO2e per unit',false,NULL),
  ('SEDG-E2.1','E','basic',        80,'Report the consumption of the following in joules or watthours: • Renewable fuel sources • Non-renewable fuel sources • Electricity • Heating (if applicable) • Cooling (if applicable) • Steam (if applicable)','disclosure','J / Wh',true,'["Renewable fuel sources","Non-renewable fuel sources","Electricity","Heating (if applicable)","Cooling (if applicable)","Steam (if applicable)"]'),
  ('SEDG-E2.2','E','intermediate', 90,'Report the reduction in consumption of the following (achieved as a direct result of conservation and efficiency initiatives) in joules or watthours: • Non-renewable fuel sources • Electricity • Heating (if applicable) • Cooling (if applicable) • Steam (if applicable)','disclosure','J / Wh',true,'["Non-renewable fuel sources","Electricity","Heating (if applicable)","Cooling (if applicable)","Steam (if applicable)"]'),
  ('SEDG-E3.1','E','basic',       100,'Report the total water withdrawn from all areas, and a breakdown of this total by type in litres: • Purchased water • Surface water (if applicable) • Groundwater (if applicable) • Seawater (if applicable) • Produced water (if applicable)','disclosure','litres',true,'["Purchased water","Surface water (if applicable)","Groundwater (if applicable)","Seawater (if applicable)","Produced water (if applicable)"]'),
  ('SEDG-E3.2','E','intermediate',110,'Report the reduction in total water withdrawn from all areas, and a breakdown of this total by type in litres: • Purchased water • Surface water (if applicable) • Groundwater (if applicable) • Seawater (if applicable) • Produced water (if applicable)','disclosure','litres',true,'["Purchased water","Surface water (if applicable)","Groundwater (if applicable)","Seawater (if applicable)","Produced water (if applicable)"]'),
  ('SEDG-E4.1','E','basic',       120,'Report total waste in metric tonnes: • Generated • Diverted from disposal • Directed to disposal','disclosure','tonnes',false,'["Generated","Diverted from disposal","Directed to disposal"]'),
  ('SEDG-E4.2','E','intermediate',130,'Report total waste generated, diverted from disposal, and directed to disposal, each broken down into metric tonnes of: • Hazardous and non-hazardous waste • Sector specific waste streams • Material composition','disclosure','tonnes',false,'["Hazardous and non-hazardous waste","Sector specific waste streams","Material composition"]'),
  ('SEDG-E4.3','E','advanced',    140,'Report total hazardous and non-hazardous waste diverted from disposal broken down into the following recovery streams in metric tonnes: • Preparation for reuse • Recycling • Other recovery options','disclosure','tonnes',false,'["Preparation for reuse","Recycling","Other recovery options"]'),
  ('SEDG-E4.4','E','advanced',    150,'Report total hazardous and non-hazardous waste directed to disposal broken down into the following disposal streams in metric tonnes: • Incineration (with energy recovery) • Incineration (without energy recovery) • Landfilling • Other disposal options','disclosure','tonnes',false,'["Incineration (with energy recovery)","Incineration (without energy recovery)","Landfilling","Other disposal options"]'),
  ('SEDG-E5.1','E','basic',       160,'List the materials and total weights used to produce and package the company''s primary products and services in metric tonnes, if any.','disclosure','list + tonnes',true,NULL),
  ('SEDG-E5.2','E','advanced',    170,'Report the percentage of recycled input materials used to manufacture the company''s primary products and services.','quantitative','%',false,NULL),

  -- ── SOCIAL — 11 ─────────────────────────────────────────────────────────
  ('SEDG-S1.1','S','basic',        10,'Report the number and nature of child labour and forced labour incidents, if any','disclosure','number + narrative',true,'["Number","Nature"]'),
  ('SEDG-S1.2','S','intermediate', 20,'List the operations and suppliers considered to have significant risk for incidents of child labour and forced labour, including: • Type of operation or supplier • Locations at risk','disclosure','list',false,'["Type of operation or supplier","Locations at risk"]'),
  ('SEDG-S2.1','S','basic',        30,'Report the average hours of training per employee','quantitative','hours',false,NULL),
  ('SEDG-S2.2','S','intermediate', 40,'Report the total number of employees and the turnover rate','disclosure','number + %',false,'["Total number of employees","Turnover rate"]'),
  ('SEDG-S2.3','S','basic',        50,'Report the percentage of employees meeting or above applicable minimum wage laws, if any','quantitative','%',true,NULL),
  ('SEDG-S3.1','S','basic',        60,'Report the percentage of the company''s employees by: • Gender • Age','disclosure','%',false,'["Gender","Age"]'),
  ('SEDG-S3.2','S','intermediate', 70,'Report the percentage of the company''s directors by: • Gender • Age','disclosure','%',false,'["Gender","Age"]'),
  ('SEDG-S4.1','S','basic',        80,'Report the number of fatalities and injuries in the company, if any','disclosure','number',true,'["Fatalities","Injuries"]'),
  ('SEDG-S4.2','S','intermediate', 90,'Report the total number and percentage of employees trained on health and safety standards','disclosure','number + %',false,'["Total number","Percentage"]'),
  ('SEDG-S5.1','S','basic',       100,'Report the total amount of community investments and donations','quantitative','MYR',false,NULL),
  ('SEDG-S5.2','S','advanced',    110,'List the company''s operations with negative impact on local communities','disclosure','list',false,NULL),

  -- ── GOVERNANCE — 10 ─────────────────────────────────────────────────────
  ('SEDG-G1.1','G','basic',        10,'Report the number of directors in the company','quantitative','number',false,NULL),
  ('SEDG-G1.2','G','intermediate', 20,'List the governance structure of the board, including committees of the board and management, if applicable','disclosure','structure / list',true,NULL),
  ('SEDG-G2.1','G','basic',        30,'List the company''s policies, including but not limited to: • Code of Conduct • Anti-Corruption Policy • Whistleblowing Policy • Health and Safety Policy','disclosure','list',false,NULL),
  ('SEDG-G3.1','G','basic',        40,'Report the year of the last submitted audited financial report','quantitative','year',false,NULL),
  ('SEDG-G3.2','G','intermediate', 50,'List the risks of company operations and activities, including but not limited to: • Regulatory compliance risk • Business continuity risk','disclosure','list',false,NULL),
  ('SEDG-G3.3','G','advanced',     60,'List the sustainability risks of company if applicable, including but not limited to: • Climate-related physical risk • Climate-related transition risk','disclosure','list',true,NULL),
  ('SEDG-G4.1','G','basic',        70,'Report the total number and nature of confirmed incidents of corruption, if any','disclosure','number + narrative',true,'["Number","Nature"]'),
  ('SEDG-G4.2','G','intermediate', 80,'Report the total number and percentage of employees who have received training on the company''s anti-bribery and anti-corruption policy','disclosure','number + %',false,'["Total number","Percentage"]'),
  ('SEDG-G4.3','G','advanced',     90,'List the significant risks related to corruption','disclosure','list',false,NULL),
  ('SEDG-G5.1','G','intermediate',100,'Report the total number and nature of substantiated complaints received concerning breaches of customer privacy and loss of customer data, if any','disclosure','number + narrative',true,'["Number","Nature"]')
) AS v(code, pillar, tier, ord, q, rtype, unit, na, lines)
WHERE f.code = 'SEDG' AND f.version = '2.0'
ON CONFLICT (framework_id, code) DO NOTHING;



-- ── 3c. ACTIVATE SEDG v2.0 ─────────────────────────────────────────────────
-- TRAP A, and the reason this is one UPDATE setting TWO columns. Both
-- assessment-creation paths used to resolve a framework with
--     ORDER BY effective_from DESC NULLS LAST LIMIT 1
-- and SEDG's effective_from was NULL, so setting is_active alone would sort it
-- behind MODUS_SEDG_ALIGNED's 2026-01-01 and change nothing — silently, with no
-- error. Setting only the flag IS the failure this statement exists to avoid.
--
-- WHY 2025-07-01: it is when Capital Markets Malaysia actually published SEDG
-- v2. The honest value is also the safe one here — it sorts BEFORE the Modus
-- framework's 2026-01-01, so anything still falling through that ORDER BY keeps
-- resolving to MODUS_SEDG_ALIGNED. After Run 25 no creation path falls through,
-- but the ordering is what a future caller inherits, so it is not cosmetic. A
-- date that made SEDG the implicit default would have changed what every
-- unspecified caller receives, which is the silent switch RULE 6 is about.
--
-- display_name is corrected in the same statement: it read 'AWAITING OFFICIAL
-- IMPORT', which stopped being true in Run 22.
UPDATE esg_frameworks
   SET is_active      = true,
       effective_from = DATE '2025-07-01',
       name           = 'Simplified ESG Disclosure Guide v2 (38 disclosures)'
 WHERE code = 'SEDG' AND version = '2.0';


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


-- ── 5. GREEN FINANCE — TAXONOMIES, PROJECT TYPES, THE REGISTER  (Run 47) ────
--
-- EVERY ROW BELOW IS TRANSCRIBED FROM docs/GREEN_FINANCE_REGISTER_SOURCES.md,
-- which was compiled on 2026-08-15 and records the URL each figure was read
-- from. That file is the source of truth for this block:
--
--   * `null` means the source did NOT state it. It is not zero, and it is not
--     an invitation to fill in something plausible. A null renders as
--     INSTRUMENTED-BUT-EMPTY: the product exists, the institution does not
--     publish the term.
--   * Nothing is enriched. No figure is carried from an earlier version of a
--     scheme into a later one, and no tenure is inferred from a similar product.
--   * source_publisher = 'news' is a first-class fact. Two flagship products
--     here have no published terms anywhere and everything known about them
--     comes from BERNAMA.
--   * When this seed and that document disagree, the DATABASE is what users saw
--     and the document gets corrected. The artefact wins.
--
-- last_verified is 2026-08-15 on every seeded row, because that is the date the
-- source file records for every row. It is expected to go stale between deploys
-- — that is what the admin writer in routes/api.js exists for.

-- ── 5a. TAXONOMY SCHEMES ───────────────────────────────────────────────────
-- One row per published revision. ASEAN V3 is superseded by V4 and is NOT
-- seeded: we never read V3, so seeding it would be a row with no source.
INSERT INTO esg_taxonomy_schemes (code, version, publisher, source_url, effective_from, is_current)
VALUES
  ('CCPT', '2021-04-30',
   'Bank Negara Malaysia',
   'https://www.bnm.gov.my/documents/20124/938039/Climate+Change+and+Principle-based+Taxonomy.pdf',
   DATE '2021-04-30', true),
  ('ASEAN', 'V4-2025-11-06',
   'ASEAN',
   'https://asean.org/wp-content/uploads/2025/11/ASEAN-Taxonomy-Sustainable-Finance-V4_06Nov25.pdf',
   DATE '2025-11-06', true)
ON CONFLICT (code, version) DO NOTHING;

-- ── 5b. CCPT — the axis a Malaysian bank's credit paper actually references ─
-- Five guiding principles and five classification categories. They are two
-- different kinds and are kept apart by `kind`: GP1 is a principle a facility
-- is tested against, C1 is where the facility lands.
INSERT INTO esg_taxonomy_categories (scheme_id, code, label_en, definition_en, kind, sort_order)
SELECT s.id, v.code, v.label, v.def, v.kind, v.ord
FROM esg_taxonomy_schemes s
CROSS JOIN (VALUES
  ('GP1', 'Climate Change Mitigation',
   'Reduce or prevent emission of greenhouse gases into the atmosphere.', 'principle', 10),
  ('GP2', 'Climate Change Adaptation',
   'Lower the negative effects and/or moderate harm caused by climate change.', 'principle', 20),
  ('GP3', 'No Significant Harm to the Environment', NULL, 'principle', 30),
  ('GP4', 'Remedial Measures to Transition', NULL, 'principle', 40),
  ('GP5', 'Prohibited Activities', NULL, 'principle', 50),
  ('C1', 'Climate Supporting',
   'Meets GP1 or GP2 with no environmental harm.', 'classification', 110),
  ('C2', 'Transitioning',
   'Meets GP1 or GP2 but causes harm; has remedial efforts.', 'classification', 120),
  ('C3', 'Transitioning',
   'No climate contribution; implements remedial measures.', 'classification', 130),
  ('C4', 'Watchlist',
   'Meets GP1 or GP2 but lacks commitment to remediation.', 'classification', 140),
  ('C5', 'Watchlist',
   'No climate contribution and no remedial efforts.', 'classification', 150)
) AS v(code, label, def, kind, ord)
WHERE s.code = 'CCPT' AND s.version = '2021-04-30'
ON CONFLICT (scheme_id, code) DO NOTHING;

-- ── 5c. ASEAN Taxonomy V4 — the OTHER axis, deliberately not merged ─────────
-- The Foundation Framework is principles-based and qualitative; the Plus
-- Standard is criteria-based. Their tiers are not interchangeable, so the codes
-- carry the framework they belong to.
INSERT INTO esg_taxonomy_categories (scheme_id, code, label_en, definition_en, kind, sort_order)
SELECT s.id, v.code, v.label, v.def, v.kind, v.ord
FROM esg_taxonomy_schemes s
CROSS JOIN (VALUES
  ('FF_GREEN',    'Foundation Framework — Green', NULL, 'tier', 10),
  ('FF_AMBER',    'Foundation Framework — Amber', NULL, 'tier', 20),
  ('FF_RED',      'Foundation Framework — Red',   NULL, 'tier', 30),
  ('PS_GREEN_T1', 'Plus Standard — Green (Tier 1)', NULL, 'tier', 40),
  ('PS_AMBER_T2', 'Plus Standard — Amber (Tier 2)', NULL, 'tier', 50),
  ('PS_AMBER_T3', 'Plus Standard — Amber (Tier 3)', NULL, 'tier', 60),
  ('PS_RED',      'Plus Standard — Red',            NULL, 'tier', 70),
  ('OBJ_CCM',       'Climate Change Mitigation', NULL, 'objective', 110),
  ('OBJ_CCA',       'Climate Change Adaptation', NULL, 'objective', 120),
  ('OBJ_ECOSYSTEM', 'Protection of Healthy Ecosystems and Biodiversity', NULL, 'objective', 130),
  ('OBJ_CIRCULAR',  'Resource Resilience and the Transition to a Circular Economy', NULL, 'objective', 140),
  -- The deliberate overlap with CCPT: EC_DNSH and EC_RMT are the same ground as
  -- CCPT GP3 and GP4. Recorded on both axes on purpose — merging them would
  -- lose which taxonomy a bank is asking under.
  ('EC_DNSH',   'Do No Significant Harm',          NULL, 'criterion', 210),
  ('EC_RMT',    'Remedial Measures to Transition', NULL, 'criterion', 220),
  ('EC_SOCIAL', 'Social Aspects',                  NULL, 'criterion', 230)
) AS v(code, label, def, kind, ord)
WHERE s.code = 'ASEAN' AND s.version = 'V4-2025-11-06'
ON CONFLICT (scheme_id, code) DO NOTHING;

-- ── 5d. PROJECT TYPES ──────────────────────────────────────────────────────
-- label_bm and label_zh seed NULL and STAY NULL. See the column comment in
-- schema.sql. default_ccpt_category_id and default_asean_objective_id also seed
-- NULL: no source states a default classification per project type, and the
-- routing run is where that judgement is made and recorded.
INSERT INTO esg_project_types (code, label_en, sort_order)
VALUES
  ('SOLAR_PV',                     'Solar PV',                             10),
  ('ENERGY_EFFICIENCY',            'Energy Efficiency',                    20),
  ('ENERGY_STORAGE',               'Energy Storage',                       30),
  ('CLEANER_PRODUCTION',           'Cleaner Production',                   40),
  ('RECYCLING_CIRCULAR',           'Recycling and Circular Economy',       50),
  ('WATER_EFFICIENCY',             'Water Efficiency',                     60),
  ('SUSTAINABLE_MATERIALS',        'Sustainable Materials',                70),
  ('EV_LOW_CARBON_TRANSPORT',      'EV and Low Carbon Transport',          80),
  ('GREEN_BUILDING',               'Green Building',                       90),
  ('SUSTAINABLE_AGRICULTURE',      'Sustainable Agriculture',             100),
  ('WASTE_MANAGEMENT',             'Waste Management',                    110),
  ('SUSTAINABILITY_CERTIFICATION', 'Sustainability Certification',        120)
ON CONFLICT (code) DO NOTHING;

-- ── 5e. THE REGISTER — 31 rows ─────────────────────────────────────────────
--
-- WHY THIS IS `WHERE NOT EXISTS` AND NOT `ON CONFLICT DO NOTHING`.
-- The uniqueness index is PARTIAL — `WHERE is_active` — so it does not cover
-- the GTFS 4.0 row, which ships with is_active = false. An ON CONFLICT keyed on
-- that index could never fire for that row, and every boot would insert another
-- copy of a superseded scheme. The NOT EXISTS probe covers active and inactive
-- rows alike, which is what idempotency on replay actually requires here.
--
-- FOUR ROWS ARE THE EXPENSIVE ONES AND ARE SEEDED EXACTLY AS THE SOURCE STATES:
--   BNM LCTF     -> 'unclear'. Gone from BNM's own fund page, two banks' pages
--                   404, two other banks still market it.
--   BNM HTG      -> 'unclear'. BNM's brochure says availability ended
--                   31 Dec 2023; three banks still list it.
--   GTFS 4.0     -> 'superseded' and is_active = false. Expired 31 Dec 2025 and
--                   NOT fully utilised.
--   GTFS 5.0     -> 'open', and rate_note records that it DROPPED the rebate.
--                   Carrying 4.0's 1.5% forward is a wrong number about someone
--                   else's money.
INSERT INTO esg_finance_products
  (institution_name, institution_kind, product_name, financing_type, borrower_scope,
   max_financing_myr, min_financing_myr, amount_note, tenure_note, rate_note,
   documentation_note, eligibility_note, availability_status, status_note,
   source_url, source_publisher, last_verified, is_active)
SELECT v.inst, v.kind, v.prod, v.ftype, v.scope,
       v.maxi::numeric(18,2), v.mini::numeric(18,2), v.amt, v.tenure, v.rate,
       v.docs, v.elig, v.avail, v.snote, v.url, v.pub,
       DATE '2026-08-15', v.active::boolean
FROM (VALUES

  -- ── Regulator and agency programmes ────────────────────────────────────
  ('Bank Negara Malaysia', 'regulator', 'Low Carbon Transition Facility (LCTF)',
   'use_of_proceeds_green', 'sme',
   10000000, NULL, NULL, 'Up to 10 years',
   'Maximum 5.0% per annum including any guarantee fee. The brochure states: "Collateral is not required under the LCTF".',
   NULL, NULL, 'unclear',
   'Availability is unclear. The facility is absent from BNM''s own current Fund for SMEs page, which now lists only SME SRF, MEF, PTF and RAFt. Hong Leong''s LCTF page returns 404 and Alliance Bank''s returns 404 — yet Maybank and CIMB both still market it as available. BNM''s launch release says RM1 billion; CIMB''s product page says "the scheme limit of RM2 billion", and no BNM source confirms an increase, so neither figure is recorded here as authoritative. BNM''s announcement of 6 January 2026 records a shift toward credit guarantee schemes operated with CGC.',
   'https://www.bnm.gov.my/documents/20124/6025157/lctf_broc_en_v3.pdf', 'regulator', true),

  ('Bank Negara Malaysia', 'regulator', 'High Tech and Green Facility (HTG)',
   'use_of_proceeds_green', 'sme',
   10000000, NULL, NULL, 'Up to 10 years',
   'Up to 3.5% per annum without a guarantee; up to 5% per annum including the guarantee fee.',
   NULL, NULL, 'unclear',
   'Availability is unclear. BNM''s own brochure states availability "Until 31 December 2023." The facility is absent from BNM''s current fund page, yet CIMB, Maybank and CGC all still list it. BNM''s announcement of 6 January 2026 records a shift toward credit guarantee schemes operated with CGC.',
   'https://www.bnm.gov.my/documents/20124/6025157/htg_broc_en.pdf', 'regulator', true),

  ('Bank Negara Malaysia', 'regulator', 'Greening Value Chain (GVC) Programme',
   'grant_or_subsidy', 'sme',
   NULL, NULL, NULL, NULL,
   'No rate is published. Financing under the programme routes via the Low Carbon Transition Facility.',
   NULL, NULL, 'unclear',
   'Availability is unclear. The programme''s financing routes via the Low Carbon Transition Facility, whose own availability is unclear — see that row. BNM''s announcement of 6 January 2026 records a shift toward credit guarantee schemes operated with CGC.',
   'https://www.bnm.gov.my/-/cop27-gvc-lctf', 'regulator', true),

  ('MGTC', 'agency', 'Green Technology Financing Scheme (GTFS) 5.0',
   'guarantee', 'both',
   NULL, NULL, NULL, NULL,
   'NO REBATE. GTFS 5.0 "will no longer provide rebates on interest or profit rates" — only the 60–80% government guarantee on the green component remains. The 1.5% per annum rebate belonged to GTFS 4.0 and is not carried forward here.',
   'Signed Undertaking Letter; project approval documents where applicable (EIA Report, Small Renewable Energy Project approval, Renewable Energy Purchase Agreement, Energy Performance Contract, Land Purchase or Tenancy Agreement, Development Order, Product Purchase Contract, Fuel Supply Agreement); valid quotations, Purchase Agreement, invoices or valuation reports for all green equipment; shop drawings indicating metering and sensor locations for measurement and verification; CVs, employment contract or latest EPF receipts, and the project management team organisation structure; site plans, layout drawings and project boundary evidence. Process: MGTC screening, technical evaluation, a Green Project Certificate valid 6 months, submission to a participating financial institution, CGC guarantee, disbursement, then quarterly reports until completion and an M&V Audit Report within 6 months of commissioning.',
   'Malaysian-registered companies with at least 60% Malaysian shareholding. Categories: Producer, User, ESCO, Housing Developer, Low Carbon Mobility Infrastructure. Sectors: Energy, Manufacturing, Transport, Building, Waste, Water. RM1.0 billion allocation to 31 December 2026. Housing maximum selling price raised to RM450,000.',
   'open',
   'Open. GTFS 5.0 dropped the rate rebate its predecessor carried, and publishes no per-category caps or tenures. GTFS 4.0''s figures belong to the expired scheme and are deliberately not carried across.',
   'https://www.gtfs.my/faq/what-gtfs-50', 'agency', true),

  ('MGTC', 'agency', 'Green Technology Financing Scheme (GTFS) 4.0',
   'guarantee', 'both',
   NULL, NULL,
   'Producer RM100m · User RM50m · ESCO RM25m · Housing Developer RM100m · Low Carbon Mobility RM50m',
   'Producer 15 years · User and ESCO 10 years · Housing Developer and Low Carbon Mobility 5 years',
   '1.5% per annum rebate on the interest or profit rate for up to 7 years (5 years for housing and low carbon mobility); guarantee up to 60%, and up to 80% for waste; CGC guarantee charge 0.50% per annum.',
   NULL, NULL, 'superseded',
   'Superseded. The scheme expired on 31 December 2025 and was NOT fully utilised — it ran out of time. CGC''s own page is stale and still advertises RM846,608,250 remaining as at 31 July 2025. Kept in the register, inactive, so that a borrower who was told about this scheme can see what replaced it.',
   'https://www.gtfs.my/page/features-gtfs-40', 'agency', false),

  ('Credit Guarantee Corporation', 'guarantee_corp', 'Green Technology Financing Scheme/-i 5.0',
   'guarantee', 'both',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'open',
   'Open. CGC channels MGTC''s GTFS 5.0; the scheme''s own terms are on the MGTC row. CGC publishes no separate amount, tenure or rate for it.',
   'https://www.cgc.com.my/en-us/what-we-do/guarantee/green-technology-financing-scheme-i-5-0/', 'agency', true),

  ('Credit Guarantee Corporation', 'guarantee_corp', 'BizJamin/-i High Tech & Green Facility Scheme',
   'guarantee', 'sme',
   NULL, NULL,
   'Between 30% and 80%, or up to RM8.0 million per SME, whichever is lower',
   'Up to 10 years', 'Guarantee fee 0.50% per annum.',
   NULL, NULL, 'unclear',
   'Availability is unclear because it depends on BNM''s High Tech and Green Facility, whose own availability is unclear: BNM''s brochure states availability "Until 31 December 2023" and the facility is absent from BNM''s current fund page, yet CIMB, Maybank and CGC still list it.',
   'https://www.cgc.com.my/en-us/what-we-do/guarantee/bizjamin-i-high-tech-green-facility/', 'agency', true),

  -- ── Banks — SME green financing ─────────────────────────────────────────
  ('RHB Bank', 'bank', 'SME Green Renewable Energy and CAPEX Financing',
   'use_of_proceeds_green', 'sme',
   NULL, NULL, 'Margin of financing up to 100%. No maximum amount is published.',
   NULL, 'As low as 4.5% per annum.', NULL, NULL, 'open',
   'Open. Read from RHB''s own green financing page on 15 August 2026.',
   'https://www.rhbgroup.com/greenfinancing/index.html', 'institution_own', true),

  ('RHB Bank', 'bank', 'SME Green Building Financing',
   'use_of_proceeds_green', 'sme',
   NULL, NULL, 'Margin of financing up to 90%. No maximum amount is published.',
   NULL, 'As low as BLR/BFR minus 2.80% per annum.', NULL, NULL, 'open',
   'Open. Read from RHB''s own green financing page on 15 August 2026.',
   'https://www.rhbgroup.com/greenfinancing/index.html', 'institution_own', true),

  ('RHB Bank', 'bank', 'SME Green Working Capital Financing',
   'use_of_proceeds_green', 'sme',
   NULL, NULL, NULL, NULL, 'As low as 4.5% per annum.', NULL, NULL, 'open',
   'Open. Read from RHB''s own green financing page on 15 August 2026.',
   'https://www.rhbgroup.com/greenfinancing/index.html', 'institution_own', true),

  ('RHB Bank', 'bank', 'SME Green Construction Financing',
   'use_of_proceeds_green', 'sme',
   NULL, NULL, 'Margin of financing up to 90%. No maximum amount is published.',
   NULL, 'As low as BLR/BFR minus 2.80% per annum.', NULL, NULL, 'open',
   'Open. Read from RHB''s own green financing page on 15 August 2026.',
   'https://www.rhbgroup.com/greenfinancing/index.html', 'institution_own', true),

  ('RHB Bank', 'bank', 'Sustainable Trade Finance Programme/-i',
   'use_of_proceeds_green', 'unstated',
   NULL, NULL, 'Programme size RM1 billion. No per-borrower maximum is published.',
   NULL, NULL, NULL, NULL, 'open',
   'Open. Read from RHB''s own sustainable finance page on 15 August 2026. The programme size is published; no per-borrower term is.',
   'https://www.rhbgroup.com/others/sustainability/sustainable-responsible-finance/advancing-smes-towards-sustainable-business-practices/index.html', 'institution_own', true),

  ('CIMB Bank / CIMB Islamic', 'bank', 'Low Carbon Transition Facility / LCTF-i',
   'use_of_proceeds_green', 'sme',
   NULL, NULL, NULL, NULL,
   'No rate is published; the product page states only "Attractive Financing Rate".',
   NULL, NULL, 'unclear',
   'Availability is unclear. CIMB still markets the facility, but it is absent from BNM''s own current Fund for SMEs page and Hong Leong''s and Alliance Bank''s LCTF pages both return 404. CIMB''s page says "the scheme limit of RM2 billion" where BNM''s launch release says RM1 billion, and no BNM source confirms an increase.',
   'https://www.cimb.com.my/en/business/business-solutions/financing/government-bnm-schemes-financing/low-carbon-transition-facility.html', 'institution_own', true),

  ('CIMB Bank / CIMB Islamic', 'bank', 'High Tech and Green Facility / HTG-i',
   'use_of_proceeds_green', 'sme',
   10000000, NULL, NULL, 'Up to 10 years',
   'Up to 3.5% per annum without a guarantee; up to 5.0% per annum with an SJPP guarantee.',
   NULL, NULL, 'unclear',
   'Availability is unclear. BNM''s own brochure states availability "Until 31 December 2023" and the facility is absent from BNM''s current fund page, yet CIMB, Maybank and CGC all still list it.',
   'https://www.cimb.com.my/en/business/business-solutions/financing/government-bnm-schemes-financing/high-tech-and-green-facility.html', 'institution_own', true),

  ('CIMB Group', 'bank', 'GreenBizReady Sustainability-Linked Financing Programme',
   'sustainability_linked', 'sme',
   NULL, NULL, 'Programme size RM3 billion through 2030. No per-borrower maximum is published.',
   NULL, 'Up to 0.50% per annum rebate on achieving agreed targets.',
   'Energy and fuel consumption data entered into MGTC''s low-carbon operating system platform for measurement and verification. Reported by BERNAMA, not published by CIMB.',
   NULL, 'open',
   'Open. Every term recorded here comes from BERNAMA, not from CIMB: CIMB''s own GreenBizReady and sustainability-linked financing pages are JavaScript-rendered and serve no terms at all, only taglines. The RM250 million figure from the 2021 launch and the RM3 billion 2025 programme are different things and must not be merged.',
   'https://www.bernama.com/en/news.php?id=2211870', 'news', true),

  ('Maybank', 'bank', 'Low Carbon Transition Facility/-i',
   'use_of_proceeds_green', 'sme',
   NULL, NULL,
   'Up to RM2.5m (turnover ≤RM25m); up to RM10m (turnover ≥RM25m)',
   'Up to 10 years', 'Up to 5% per annum.',
   NULL, NULL, 'unclear',
   'Availability is unclear. Maybank still markets the facility, but it is absent from BNM''s own current Fund for SMEs page and Hong Leong''s and Alliance Bank''s LCTF pages both return 404. The published cap varies by turnover, so no single maximum is recorded.',
   'https://www.maybank2u.com.my/maybank2u/malaysia/en/business/financing/working_capital/business/solar-financing.page', 'institution_own', true),

  ('Maybank', 'bank', 'Sustainability-Linked Loan Programme',
   'sustainability_linked', 'corporate',
   NULL, 50000000, 'Minimum RM50,000,000. Published as a minimum, not a maximum.',
   NULL, '"More attractive loan terms" on baseline verification; the rebate is not disclosed.',
   'Loan application indicating ESG alignment intent; an ESG Disclosure Report prepared with Carbon Next; an ESG Assurance Report verified by Chemsain; ongoing annual sustainability performance target compliance to retain preferential pricing.',
   NULL, 'open',
   'Open, and it is a CORPORATE product despite sitting in Maybank''s SME section: it carries a RM50 million minimum. Routing an SME here is exactly the confidently-wrong answer this register exists to prevent.',
   'https://www.maybank2u.com.my/maybank2u/malaysia/en/business/sme/promotions/sustainability-linked-loan-programme.page', 'institution_own', true),

  ('Maybank', 'bank', 'Energy-Efficient Appliances for Business',
   'use_of_proceeds_green', 'sme',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'open',
   'Open. Maybank publishes no amount, tenure or rate for this product. The institution does not disclose the terms, which is not the same as the product having none.',
   'https://www.maybank2u.com.my/maybank2u/malaysia/en/business/sme/grow/esg-financing-listing.page', 'institution_own', true),

  ('Bank Islam Malaysia', 'bank', 'SME SMART Eco Financing Program-i (ECO)',
   'use_of_proceeds_green', 'sme',
   NULL, NULL,
   'Up to RM5m (User) · up to RM15m (Producer) · sole proprietorships and partnerships limited to RM2.5m',
   'BF-i up to 9 years; BCL-i 1 year subject to annual review',
   'Profit rate not stated. Margin: working capital 100%, capital expenditure up to 90%. Up to 80% SJPP guarantee, fee up to 1% per annum. Directors'' joint and several guarantees for a Sdn Bhd.',
   NULL,
   'Malaysian SMEs; Malaysians resident in Malaysia holding at least 51% shareholding; PLC or GLC shareholding capped at 20%. Sectors: Energy, Building & Township, Transport, Waste, Manufacturing.',
   'open',
   'Open. Read from Bank Islam''s own SME banking page on 15 August 2026. The published cap varies by category, so no single maximum is recorded.',
   'https://www.bankislam.com/business-banking/sme-banking/eco/', 'institution_own', true),

  ('Bank Islam Malaysia', 'bank', 'IHSAN Financing for Business Resilience, Sustainability and Green Transition (IFiRST)',
   'unclear', 'both',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'open',
   'Announced in June 2025 by press release only. NO PRODUCT PAGE EXISTS on the institution''s own site, so everything recorded here comes from BERNAMA — including that the product is live. The financing type could not be determined from the announcement and is recorded as unclear rather than guessed.',
   'https://www.bernama.com/en/news.php/?id=2436080', 'news', true),

  ('AmBank Group', 'bank', 'Sustainability-Linked Financing',
   'sustainability_linked', 'unstated',
   NULL, NULL, NULL, NULL,
   '"Pricing rebates" on target achievement; the amount is not disclosed.',
   NULL, NULL, 'open',
   'Open. AmBank publishes no amount, tenure or rate for any green product; its green page lists mostly government schemes it distributes.',
   'https://www.ambankgroup.com/sustainability/our-solutions', 'institution_own', true),

  ('AmBank Group', 'bank', 'Project Financing for Green and Renewable Energy Projects',
   'use_of_proceeds_green', 'unstated',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'open',
   'Open. AmBank publishes no amount, tenure or rate for any green product; its green page lists mostly government schemes it distributes.',
   'https://www.ambankgroup.com/sustainability/our-solutions', 'institution_own', true),

  ('Hong Leong Bank', 'bank', 'HLB SME Solar Financing',
   'use_of_proceeds_green', 'sme',
   10000000, NULL, NULL, NULL, NULL,
   'Electricity bills, preferably for the past 6 months; the physical premises address; the solar provider must be a SEDA-registered PV Service Provider.',
   'SME as defined by BNM; sole proprietorship, partnership, LLP or Sdn Bhd; at least 3 years operating, or a key person with at least 3 years'' experience; annual sales turnover of RM500,000 and above.',
   'open',
   'Open. Read from Hong Leong''s own SME banking page on 15 August 2026. Note that the same bank''s Low Carbon Transition Facility page returns 404.',
   'https://www.hlb.com.my/en/business-banking/group-sme-banking/loan/sme-solar-financing.html', 'institution_own', true),

  ('HSBC Malaysia', 'bank', 'Green Loans',
   'use_of_proceeds_green', 'unstated',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'open',
   'Open. HSBC Malaysia publishes framework-level material only — six product names, no terms and no SME variant. The institution does not disclose amounts, tenures or rates for this product.',
   'https://business.hsbc.com.my/en-gb/campaigns/sustainability', 'institution_own', true),

  ('HSBC Malaysia', 'bank', 'Sustainability-Linked Loans',
   'sustainability_linked', 'unstated',
   NULL, NULL, NULL, NULL,
   'Cost of capital linked to ESG or sustainability metrics.',
   NULL, NULL, 'open',
   'Open. HSBC Malaysia publishes framework-level material only — six product names, no terms and no SME variant. The institution does not disclose amounts or tenures for this product.',
   'https://business.hsbc.com.my/en-gb/campaigns/sustainability', 'institution_own', true),

  ('HSBC Malaysia', 'bank', 'Green Trade Loans',
   'use_of_proceeds_green', 'unstated',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'open',
   'Open. HSBC Malaysia publishes framework-level material only — six product names, no terms and no SME variant. The institution does not disclose amounts, tenures or rates for this product.',
   'https://business.hsbc.com.my/en-gb/campaigns/sustainability', 'institution_own', true),

  ('HSBC Malaysia', 'bank', 'Sustainable Supply Chain Loan',
   'use_of_proceeds_green', 'unstated',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'open',
   'Open. HSBC Malaysia publishes framework-level material only — six product names, no terms and no SME variant. The institution does not disclose amounts, tenures or rates for this product.',
   'https://business.hsbc.com.my/en-gb/campaigns/sustainability', 'institution_own', true),

  ('MIDF', 'development_fi', 'Sustainable Green Biz Financing (SGBF)',
   'use_of_proceeds_green', 'both',
   10000000, NULL, NULL, 'Up to 25 years (varies by asset type)',
   '3% per annum for SMEs; 5% per annum for non-SMEs. Margin up to 100%.',
   'Valid business licence; company registration forms; director and shareholder identity copies; 6 months of bank statements; latest annual return; 3 years of audited financial statements; current management accounts. Approval takes about one month after a complete submission.',
   NULL, 'open',
   'Open. Read from MIDF''s own green financing page on 15 August 2026.',
   'https://www.growyourbusiness.com.my/financing/green-financing', 'institution_own', true),

  -- ── Retail — recorded for completeness, excluded from SME routing ───────
  -- The retail table in the source file publishes no financing-type column, so
  -- the two solar products take their type from the stated purpose of the
  -- product and Public Bank's takes 'unclear', because its page could not be
  -- read at all.
  ('RHB Bank', 'bank', 'Solar Panel Financing Package',
   'use_of_proceeds_green', 'retail',
   100000, NULL, NULL, 'Up to 7 years',
   'As low as 4.27% per annum conventional / 4.13% per annum Islamic.',
   NULL, NULL, 'open',
   'Open. A RETAIL product, recorded for completeness and excluded from SME routing.',
   'https://www.rhbgroup.com/greenfinancing/index.html', 'institution_own', true),

  ('Maybank', 'bank', 'Maybank Solar Financing/-i',
   'use_of_proceeds_green', 'retail',
   100000, NULL, NULL, 'Up to 10 years', NULL, NULL, NULL, 'open',
   'Open. A RETAIL product, recorded for completeness and excluded from SME routing.',
   'https://www.maybank2u.com.my/maybank2u/malaysia/en/personal/loans/others/maybank-solar-financing.page', 'institution_own', true),

  ('Public Bank', 'bank', 'GO GREEN with Green Vehicle Financing',
   'unclear', 'retail',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'unclear',
   'Listed in Public Bank''s promotions index; the product page could not be read (robots.txt). Terms unverified. This is the one row in the source file that was not read from its own page, and it is recorded rather than hidden. Public Bank is on BNM''s LCTF participating-financial-institution list and publishes a Sustainable Finance chapter, yet no SME green financing product page exists on its site at all.',
   'https://www.pbebank.com/en/promotions/latest-promotions/go-green-with-green-vehicle-financing/', 'institution_own', true)

) AS v(inst, kind, prod, ftype, scope, maxi, mini, amt, tenure, rate,
       docs, elig, avail, snote, url, pub, active)
WHERE NOT EXISTS (
  SELECT 1 FROM esg_finance_products p
   WHERE lower(p.institution_name) = lower(v.inst)
     AND lower(p.product_name)     = lower(v.prod));


-- ── 6. THE JOURNEY, MISSIONS AND THE LEVEL LADDER            (Run 52) ───────
--
-- THIS FILE IS THE WRITER FOR ALL THREE TABLES, and that is the whole design
-- rather than an unfinished corner (recurring-bugs-checklist.md #22 asks for
-- the writer to be named in the same change — it is named here). They hold the
-- DEFINITION of the journey: which stages exist, which fact satisfies each,
-- which cannot happen yet and why. They hold nobody's progress. A company's
-- position on this journey is computed by src/services/journeyEngine.js from
-- rows that already exist, every time it is asked, and is stored nowhere.
--
-- Each stage names a PREDICATE. journeyEngine.js implements the closed set of
-- predicate codes below and THROWS on any other, so a stage added here without
-- an implementation fails loudly instead of rendering as an ordinary
-- not-your-turn-yet step. test/journey-test.js asserts the two sets agree.

-- ── 6a. STAGES ─────────────────────────────────────────────────────────────
-- Thirteen: ten a company can actually reach, and three that are BLOCKED.
--
-- The three blocked reasons are quoted verbatim from
-- docs/design/UI_REFERENCE_ANNOTATED.md §1.3, §1.4 and §1.5, which are the
-- three elements on the reference dashboard that must never ship as drawn. A
-- blocked stage renders differently from a pending one and says which sentence
-- above applies to it — pending means your turn next, blocked means this cannot
-- happen yet, and here is why.
--
-- predicate_code is 'never' on all three. It is NOT a placeholder for logic
-- somebody forgot: the engine implements 'never' explicitly as a predicate that
-- is never satisfied, so the column stays NOT NULL and honest, and the
-- blocked_reason carries the substance.
--
-- label_bm and label_zh are absent from this INSERT and therefore NULL. See the
-- column comment in schema.sql and the ruling at lines 150-154 above.
INSERT INTO esg_journey_stages
  (code, sort_order, label_en, description_en, group_code, predicate_code, blocked_reason)
VALUES
  ('COMPANY_PROFILE', 10, 'Set up your company profile',
   'Name, SSM number, MSIC code, headcount and electricity grid. The grid cannot be defaulted — Malaysia has three and their emission factors differ by a factor of 3.7.',
   'assess', 'company_profile_complete', NULL),

  ('DOCUMENTS_UPLOADED', 20, 'Upload the documents you already hold',
   'Utility bills, policies, certificates. Nothing has to be written for this platform; it reads what already exists.',
   'evidence', 'documents_uploaded', NULL),

  ('EXTRACTION_RUN', 30, 'Let the platform read them',
   'Each document is read and checked for statements that answer a disclosure. Every proposal must carry a verbatim quote that is found in the document, or it is discarded before you see it.',
   'evidence', 'extraction_run', NULL),

  ('PROPOSALS_REVIEWED', 40, 'Review what it proposed',
   'A proposal is a proposal until a person accepts it. Nothing an AI read out of a PDF raises your score on its own.',
   'evidence', 'proposals_reviewed', NULL),

  ('ASSESSMENT_ANSWERED', 50, 'Answer the assessment',
   'Every indicator the framework asks for, minus the ones you marked not applicable. A not-applicable answer leaves the denominator; it does not count against you.',
   'assess', 'assessment_answered', NULL),

  ('ASSESSMENT_SCORED', 60, 'Calculate your score',
   'Arithmetic over your own answers, at the weighting version stamped on the assessment. No part of the score is generated by AI.',
   'assess', 'assessment_scored', NULL),

  ('CARBON_DATA', 70, 'Record your energy and fuel data',
   'Electricity, diesel and petrol. Each entry stamps the emission factor it used, so last year''s tonnage does not move when a new factor is published.',
   'assess', 'carbon_entries_present', NULL),

  ('RECOMMENDATIONS', 80, 'Read your improvement roadmap',
   'The points behind each recommendation are computed by the scoring engine. The model writes the sentence around them and never the number.',
   'improve', 'recommendations_present', NULL),

  ('GREEN_PROJECT', 90, 'Define a green project',
   'A project is what a lender is actually told about, in the vocabulary a Malaysian bank''s credit paper uses.',
   'finance', 'green_project_defined', NULL),

  ('CARBON_BASELINE', 100, 'Compute the project''s baseline',
   'Computed from your carbon entries. A baseline resting on any unverified factor is marked provisional and says which factor made it so.',
   'finance', 'carbon_baselined', NULL),

  ('PILLAR_IMPACT', 110, 'Your contribution to the four pillars',
   'Blocked. The reference design shows a High / Medium contribution level per pillar; nothing published supports one.',
   'improve', 'never',
   'SustNET publishes no methodology mapping company activity to the four pillars. Until one exists in writing, this platform will not claim a contribution level.'),

  ('CONSULTATION', 120, 'Expert consultation',
   'Blocked. A button that opens nothing is worse than an absent feature, because you would believe the capability exists and stop looking.',
   'expert', 'never',
   'Expert consultation is not built into the platform yet.'),

  ('CERTIFICATION', 130, 'Certification',
   'Blocked. This platform produces a self-declared assessment supported by evidence, and deliberately stops before the steps that need an independent party.',
   'certify', 'never',
   'No SustNET ESG certification scheme is published. This platform assesses; it does not certify.')
ON CONFLICT (code) DO NOTHING;

-- ── 6b. MISSIONS ───────────────────────────────────────────────────────────
-- One per reachable stage, and NONE under a blocked stage: a mission whose
-- predicate can never be satisfied is XP nobody can earn, sitting next to XP
-- they can. Ten missions, 570 XP in total, which is what the ladder below is
-- scaled against.
--
-- The XP numbers are a PRODUCT CHOICE and are weighted by effort, not by
-- importance: answering the assessment is 120 because it is the longest single
-- piece of work in the product, not because it matters most.
INSERT INTO esg_missions
  (code, stage_code, label_en, description_en, predicate_code, xp_award, sort_order)
VALUES
  ('M_PROFILE',  'COMPANY_PROFILE',     'Complete every profile field',
   'Five fields. The electricity grid is the one that cannot be guessed for you.',
   'company_profile_complete', 40, 10),
  ('M_UPLOAD',   'DOCUMENTS_UPLOADED',  'Upload your first document',
   'Anything you already hold — a utility bill is enough to start.',
   'documents_uploaded', 30, 20),
  ('M_EXTRACT',  'EXTRACTION_RUN',      'Have a document read',
   'One document taken from uploaded to extracted.',
   'extraction_run', 40, 30),
  ('M_REVIEW',   'PROPOSALS_REVIEWED',  'Clear the review queue',
   'Every proposal accepted or rejected, and at least one accepted.',
   'proposals_reviewed', 60, 40),
  ('M_ANSWER',   'ASSESSMENT_ANSWERED', 'Answer every indicator',
   'The ones you mark not applicable leave the denominator rather than counting against you.',
   'assessment_answered', 120, 50),
  ('M_SCORE',    'ASSESSMENT_SCORED',   'Calculate your score',
   'Submitting the assessment computes it.',
   'assessment_scored', 80, 60),
  ('M_CARBON',   'CARBON_DATA',         'Record your first carbon entry',
   'Electricity, diesel or petrol, for any period.',
   'carbon_entries_present', 40, 70),
  ('M_ROADMAP',  'RECOMMENDATIONS',     'Generate your improvement roadmap',
   'Produced when the assessment is scored.',
   'recommendations_present', 40, 80),
  ('M_PROJECT',  'GREEN_PROJECT',       'Define a green project',
   'What a lender is told about.',
   'green_project_defined', 60, 90),
  ('M_BASELINE', 'CARBON_BASELINE',     'Compute a project baseline',
   'Needs carbon entries inside the period you choose.',
   'carbon_baselined', 60, 100)
ON CONFLICT (code) DO NOTHING;

-- ── 6c. THE LEVEL LADDER ───────────────────────────────────────────────────
-- A PRODUCT CHOICE, NOT A STANDARD. Nobody outside this product defines these
-- names or these thresholds — not SEDG, not SSEO, not Bursa, not BNM. They are
-- five labels on a 0-570 range and they carry no external meaning whatsoever.
-- They must never be presented as a rating, and nothing in the platform derives
-- a rating from them: esg_rating_bands is the rating ladder and it is a
-- different thing entirely.
INSERT INTO esg_xp_levels (level, min_xp, label_en)
VALUES
  (1,   0, 'Seedling'),
  (2,  80, 'Sprout'),
  (3, 200, 'Sapling'),
  (4, 360, 'Green Pioneer'),
  (5, 520, 'Canopy')
ON CONFLICT (level) DO NOTHING;
