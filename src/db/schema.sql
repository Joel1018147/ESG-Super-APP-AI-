-- ═══════════════════════════════════════════════════════════════════════════
-- Modus ESG Super App — schema
--
-- REPLAYED IN FULL ON EVERY BOOT, AS ONE TRANSACTION.
-- node-postgres sends a multi-statement string as a single implicit
-- transaction, so if ANY statement below fails, the ENTIRE file rolls back and
-- not one migration in it applies. Two consequences, both load-bearing:
--
--   1. Every statement must be idempotent. IF NOT EXISTS on tables and
--      indexes; DO $$ ... $$ blocks for constraints, columns and enum values,
--      which have no IF NOT EXISTS form.
--   2. A new statement added at the bottom can silently un-apply everything
--      above it. test/schema-idempotency-test.js replays this file twice
--      against a real Postgres and fails on any error, which is the only
--      thing standing between a typo here and a boot that quietly runs on
--      last week's schema.
--
-- Conventions (from the ecosystem standard):
--   • esg_ table prefix — multi-tenant schema shared with the other platforms
--   • UUID primary keys throughout
--   • created_at / updated_at on every table
--   • NO nullable UNIQUE constraints. Postgres admits unlimited NULLs past
--     one, so it is not a uniqueness guarantee. Partial unique indexes only,
--     each with a comment saying which rows it covers.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email

-- ── Session store (connect-pg-simple) ──────────────────────────────────────
-- Owned by this file rather than by connect-pg-simple's own createTableIfMissing
-- option: that option races on a multi-instance Railway deploy, where two
-- containers boot at once and both try to create it.
CREATE TABLE IF NOT EXISTS session (
  sid    varchar      NOT NULL COLLATE "default",
  sess   json         NOT NULL,
  expire timestamptz  NOT NULL
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_pkey') THEN
    ALTER TABLE session ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. TENANTS AND PEOPLE
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS esg_companies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text        NOT NULL,
  -- SSM registration number. Nullable because a company can start an
  -- assessment before finance supplies it, so uniqueness is enforced by a
  -- PARTIAL index below over non-null rows only.
  ssm_number         text,
  msic_code          text,                 -- Malaysia Standard Industrial Classification
  industry_label     text,
  employee_count     integer,
  annual_revenue_myr numeric(18,2),
  state              text,
  -- Which grid the company draws Scope 2 electricity from. Malaysia has three
  -- separate grids with emission factors that differ by a factor of 3.7
  -- (Peninsular 0.740 vs Sarawak 0.199 kg CO2e/kWh), so this is not cosmetic:
  -- defaulting it would silently mis-state every Sarawak SME's carbon number.
  grid_region        text CHECK (grid_region IN ('peninsular','sabah','sarawak')),
  esg_maturity       text CHECK (esg_maturity IN ('basic','intermediate','advanced')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- Covers: rows where ssm_number IS NOT NULL. Rows without an SSM number are
-- deliberately unconstrained — see the column comment.
CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_companies_ssm
  ON esg_companies (upper(ssm_number)) WHERE ssm_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_esg_companies_msic ON esg_companies (msic_code);

CREATE TABLE IF NOT EXISTS esg_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid REFERENCES esg_companies(id) ON DELETE SET NULL,
  email         citext NOT NULL,
  name          text,
  password_hash text,          -- null for Google-only accounts
  google_id     text,          -- null for local accounts
  role          text NOT NULL DEFAULT 'company_admin',
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Covers: every row. email is NOT NULL so a plain unique index is honest here.
CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_users_email ON esg_users (email);
-- Covers: rows that have linked a Google account. The NULLs are the local-only
-- accounts and must not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_users_google
  ON esg_users (google_id) WHERE google_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_esg_users_company ON esg_users (company_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. FRAMEWORKS AND INDICATORS
--
-- The scoring content is DATA, not code. A framework revision (SEDG v1 -> v2,
-- which added 3 disclosures) is a new row here plus new indicator rows — never
-- an edit to existing rows, because assessments already scored against v1 must
-- keep resolving to the v1 question text and the v1 weights forever.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS esg_frameworks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL,                  -- 'SEDG', 'ASEDG', 'VERRA_VCS'
  version        text NOT NULL,                  -- '1.0', '2.0'
  name           text NOT NULL,
  publisher      text,
  source_url     text,
  -- What this framework is FOR. Set deliberately, because the two kinds are not
  -- interchangeable and the app must never score a company against a
  -- project-crediting standard: see docs/SCORING_METHODOLOGY.md.
  framework_kind text NOT NULL DEFAULT 'entity_disclosure'
                 CHECK (framework_kind IN ('entity_disclosure','project_crediting','reference_only')),
  is_active      boolean NOT NULL DEFAULT true,
  effective_from date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_frameworks_code_version
  ON esg_frameworks (code, version);

CREATE TABLE IF NOT EXISTS esg_indicators (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id   uuid NOT NULL REFERENCES esg_frameworks(id) ON DELETE CASCADE,
  code           text NOT NULL,                  -- e.g. 'E-01'
  pillar         text NOT NULL CHECK (pillar IN ('E','S','G')),
  tier           text NOT NULL DEFAULT 'basic'
                 CHECK (tier IN ('basic','intermediate','advanced')),
  sort_order     integer NOT NULL DEFAULT 0,
  question_en    text NOT NULL,
  question_bm    text,
  question_zh    text,
  guidance_en    text,
  -- How the answer is captured, which decides how scoringEngine.js converts it
  -- to points. Adding a value here without adding its branch in
  -- POINTS_BY_RESPONSE_TYPE makes the indicator score zero silently, so the
  -- CHECK and that map are asserted against each other in
  -- test/scoring-engine-test.js.
  response_type  text NOT NULL CHECK (response_type IN ('yes_no','yes_partial_no','maturity_0_4','quantitative','multi_select')),
  unit           text,                           -- for quantitative: 'kWh', 'm3', 'hours'
  weight         numeric(8,3) NOT NULL DEFAULT 1.000 CHECK (weight >= 0),
  -- Whether "not applicable" is a legitimate answer (e.g. an SME with no
  -- company vehicles). N/A removes the indicator from the DENOMINATOR too;
  -- scoring it as zero would punish a company for an emission source it does
  -- not have.
  allows_na      boolean NOT NULL DEFAULT false,
  -- Provenance of the question itself. 'draft' means Modus authored it against
  -- our reading of the framework and NOBODY has reconciled it line-by-line
  -- against the publisher's document yet. The assessment UI badges draft
  -- indicators, and docs/SCORING_METHODOLOGY.md lists what reconciliation
  -- requires. Shipping a draft mapping is fine; shipping one that LOOKS
  -- official is not.
  external_ref   text,
  mapping_status text NOT NULL DEFAULT 'draft'
                 CHECK (mapping_status IN ('draft','reconciled','official')),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_indicators_framework_code
  ON esg_indicators (framework_id, code);
CREATE INDEX IF NOT EXISTS idx_esg_indicators_pillar ON esg_indicators (framework_id, pillar);

CREATE TABLE IF NOT EXISTS esg_indicator_options (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator_id uuid NOT NULL REFERENCES esg_indicators(id) ON DELETE CASCADE,
  option_code  text NOT NULL,
  label_en     text NOT NULL,
  label_bm     text,
  label_zh     text,
  -- Fraction of the indicator weight this option earns, 0.000 to 1.000.
  points_ratio numeric(5,3) NOT NULL DEFAULT 0
               CHECK (points_ratio >= 0 AND points_ratio <= 1),
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_indicator_options
  ON esg_indicator_options (indicator_id, option_code);


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. WEIGHTING AND BANDS — the scoring CONSTITUTION, versioned
--
-- Pillar weights, evidence multipliers and band cut-offs live in the database
-- and are STAMPED onto every score row. This is the same rule as storing SST
-- on the transaction: when the methodology is revised next year, a score
-- computed today must still resolve at today's weights. Recomputing history at
-- new weights would silently rewrite every certificate already issued.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS esg_weighting_schemes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version             text NOT NULL,
  description         text,
  weight_e            numeric(5,3) NOT NULL,
  weight_s            numeric(5,3) NOT NULL,
  weight_g            numeric(5,3) NOT NULL,
  -- CONSERVATIVENESS. Borrowed from Verra's VCS principle that an unverified
  -- claim must not score as if verified. A self-declared "yes" with no document
  -- behind it earns less than the same "yes" with an uploaded utility bill,
  -- which earns less than one an assurance provider has signed off.
  mult_self_declared  numeric(5,3) NOT NULL DEFAULT 0.600,
  mult_documented     numeric(5,3) NOT NULL DEFAULT 0.850,
  mult_verified       numeric(5,3) NOT NULL DEFAULT 1.000,
  is_active           boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_weighting_version
  ON esg_weighting_schemes (version);
-- Covers: the single active scheme. A partial unique index on a constant is how
-- you say "at most one row may have is_active = true" — a plain UNIQUE on
-- is_active would also forbid a second INACTIVE scheme, which is wrong.
CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_weighting_one_active
  ON esg_weighting_schemes ((true)) WHERE is_active;

CREATE TABLE IF NOT EXISTS esg_rating_bands (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id    uuid NOT NULL REFERENCES esg_weighting_schemes(id) ON DELETE CASCADE,
  band_code    text NOT NULL,          -- 'AAA' ... 'CCC'
  band_label   text NOT NULL,
  min_score    numeric(6,2) NOT NULL,  -- inclusive
  max_score    numeric(6,2) NOT NULL,  -- inclusive
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT esg_rating_bands_range CHECK (min_score <= max_score)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_rating_bands
  ON esg_rating_bands (scheme_id, band_code);


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. ASSESSMENTS, RESPONSES, EVIDENCE
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS esg_assessments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES esg_companies(id) ON DELETE CASCADE,
  framework_id        uuid NOT NULL REFERENCES esg_frameworks(id),
  -- Stamped, not joined. The framework row could in principle be corrected;
  -- these two columns record what the assessment was actually taken against.
  framework_code      text NOT NULL,
  framework_version   text NOT NULL,
  weighting_scheme_id uuid NOT NULL REFERENCES esg_weighting_schemes(id),
  weighting_version   text NOT NULL,
  reporting_year      integer NOT NULL,
  status              text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','submitted','scored','verified','archived')),
  submitted_at        timestamptz,
  scored_at           timestamptz,
  created_by          uuid REFERENCES esg_users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_esg_assessments_company
  ON esg_assessments (company_id, reporting_year DESC);
-- Covers: live assessments only. A company may hold at most one non-archived
-- assessment per framework per year; archived ones may pile up.
CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_assessments_live
  ON esg_assessments (company_id, framework_id, reporting_year)
  WHERE status <> 'archived';

CREATE TABLE IF NOT EXISTS esg_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES esg_companies(id) ON DELETE CASCADE,
  assessment_id  uuid REFERENCES esg_assessments(id) ON DELETE SET NULL,
  doc_type       text NOT NULL,          -- 'utility_bill','policy','iso_cert','esg_report',...
  filename       text NOT NULL,
  mime_type      text,
  byte_size      integer,
  -- Railway containers have an ephemeral filesystem, so bytes live in the
  -- database, not on disk. Kept out of every SELECT list by name — this column
  -- is the reason "never SELECT *" is not a style preference here.
  content        bytea,
  sha256         text,
  uploaded_by    uuid REFERENCES esg_users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_esg_documents_company ON esg_documents (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_esg_documents_assessment ON esg_documents (assessment_id);

CREATE TABLE IF NOT EXISTS esg_responses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id  uuid NOT NULL REFERENCES esg_assessments(id) ON DELETE CASCADE,
  indicator_id   uuid NOT NULL REFERENCES esg_indicators(id),
  option_code    text,                   -- for yes_no / yes_partial_no / maturity / multi_select
  value_numeric  numeric(20,4),          -- for quantitative
  value_text     text,
  is_na          boolean NOT NULL DEFAULT false,
  -- Drives the conservativeness multiplier. Defaults to the WEAKEST tier: a
  -- response arriving without an explicit tier must not be treated as verified.
  evidence_tier  text NOT NULL DEFAULT 'self_declared'
                 CHECK (evidence_tier IN ('self_declared','documented','verified')),
  document_id    uuid REFERENCES esg_documents(id) ON DELETE SET NULL,
  answered_by    uuid REFERENCES esg_users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_responses
  ON esg_responses (assessment_id, indicator_id);
CREATE INDEX IF NOT EXISTS idx_esg_responses_assessment ON esg_responses (assessment_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. SCORES
--
-- Every number in this table is produced by src/services/scoringEngine.js from
-- rows in esg_responses. NO LANGUAGE MODEL WRITES HERE. The AI layer reads
-- these rows and phrases them; it never authors them. That is the same rule the
-- Commerce secretary rests on, and this is the table where breaking it would
-- cost the most — an ESG rating is the entire product.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS esg_scores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id       uuid NOT NULL REFERENCES esg_assessments(id) ON DELETE CASCADE,
  scope               text NOT NULL CHECK (scope IN ('E','S','G','OVERALL')),
  points_earned       numeric(12,4) NOT NULL,
  points_available    numeric(12,4) NOT NULL,
  score_0_100         numeric(6,2)  NOT NULL CHECK (score_0_100 >= 0 AND score_0_100 <= 100),
  band_code           text,
  -- Counts behind the score, so a dashboard can distinguish the three empty
  -- states: nothing answered, answered-but-all-N/A, and genuinely zero points.
  indicators_total    integer NOT NULL DEFAULT 0,
  indicators_answered integer NOT NULL DEFAULT 0,
  indicators_na       integer NOT NULL DEFAULT 0,
  weighting_version   text NOT NULL,
  framework_version   text NOT NULL,
  engine_version      text NOT NULL,
  computed_at         timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_scores ON esg_scores (assessment_id, scope);

CREATE TABLE IF NOT EXISTS esg_recommendations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id  uuid NOT NULL REFERENCES esg_assessments(id) ON DELETE CASCADE,
  indicator_id   uuid REFERENCES esg_indicators(id) ON DELETE SET NULL,
  pillar         text CHECK (pillar IN ('E','S','G')),
  -- The gap is computed; the prose is generated. Keeping them in separate
  -- columns is what lets test/no-model-figures-test.js assert that no figure in
  -- the UI came out of the model: figures render from points_* , never from
  -- narrative_en.
  points_missed  numeric(12,4),
  priority       text CHECK (priority IN ('high','medium','low')),
  narrative_en   text,
  narrative_bm   text,
  narrative_zh   text,
  source         text NOT NULL DEFAULT 'engine'
                 CHECK (source IN ('engine','ai_phrasing','fallback_template')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_esg_recommendations_assessment
  ON esg_recommendations (assessment_id, priority);


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. CARBON — factors are versioned and STAMPED onto each entry
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS esg_emission_factors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL,            -- 'GEF_PENINSULAR'
  scope         integer NOT NULL CHECK (scope IN (1,2,3)),
  category      text NOT NULL,            -- 'grid_electricity','mobile_combustion',...
  label         text NOT NULL,
  factor_value  numeric(20,8) NOT NULL,
  unit_from     text NOT NULL,            -- 'kWh'
  unit_to       text NOT NULL DEFAULT 'kgCO2e',
  region        text,                     -- 'peninsular','sabah','sarawak', null = national
  source_name   text NOT NULL,
  source_url    text,
  source_year   text,
  version       text NOT NULL,
  valid_from    date NOT NULL,
  valid_to      date,                     -- null = current
  -- An unverified factor must never silently produce a number a company puts in
  -- a report. carbonEngine.js REFUSES to calculate with anything other than
  -- 'verified'; see the guard there.
  verification_status text NOT NULL DEFAULT 'unverified'
                      CHECK (verification_status IN ('verified','unverified','superseded')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_emission_factors
  ON esg_emission_factors (code, version);
-- Covers: the currently-open factor for each code. Historical rows carry a
-- valid_to and may coexist freely.
CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_emission_factors_current
  ON esg_emission_factors (code) WHERE valid_to IS NULL;

CREATE TABLE IF NOT EXISTS esg_carbon_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES esg_companies(id) ON DELETE CASCADE,
  assessment_id       uuid REFERENCES esg_assessments(id) ON DELETE SET NULL,
  period_start        date NOT NULL,
  period_end          date NOT NULL,
  scope               integer NOT NULL CHECK (scope IN (1,2,3)),
  category            text NOT NULL,
  activity_amount     numeric(20,4) NOT NULL CHECK (activity_amount >= 0),
  activity_unit       text NOT NULL,
  factor_id           uuid REFERENCES esg_emission_factors(id),
  -- ── The stamp ──────────────────────────────────────────────────────────
  -- Copied at time of entry, exactly as SST is stored on a Commerce
  -- transaction. When the Energy Commission publishes a new Grid Emission
  -- Factor, last year's tonnage must not move. Joining to the factor table at
  -- read time would restate every historical figure the moment a factor is
  -- superseded — including figures already printed in a submitted report.
  factor_value_used   numeric(20,8) NOT NULL,
  factor_version_used text NOT NULL,
  factor_source_used  text NOT NULL,
  -- Stamped alongside the value. A tonnage computed from an unverified factor
  -- is still useful for internal steering, but it must never leave the system
  -- looking like a verified one — every renderer keys the "provisional" badge
  -- off this column, not off a join.
  factor_verification_used text NOT NULL DEFAULT 'unverified',
  is_provisional      boolean NOT NULL DEFAULT true,
  kg_co2e             numeric(20,4) NOT NULL,
  evidence_tier       text NOT NULL DEFAULT 'self_declared'
                      CHECK (evidence_tier IN ('self_declared','documented','verified')),
  document_id         uuid REFERENCES esg_documents(id) ON DELETE SET NULL,
  created_by          uuid REFERENCES esg_users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT esg_carbon_entries_period CHECK (period_start <= period_end)
);
CREATE INDEX IF NOT EXISTS idx_esg_carbon_entries_company
  ON esg_carbon_entries (company_id, period_start DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- 7. VERRA REFERENCE DATABASE
--
-- READ-ONLY MIRROR of publicly available Verra registry records, for the
-- carbon-credit module and for methodology lookup. Metadata and canonical
-- links only — the methodology PDFs are Verra's copyrighted works and are
-- linked, never copied into `document_url` content.
--
-- Nothing in here feeds esg_scores. Verra certifies PROJECTS, not companies;
-- see docs/VERRA_BENCHMARK.md for why that boundary exists.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS esg_verra_methodologies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  methodology_id text NOT NULL,          -- 'VM0042'
  name           text NOT NULL,
  sectoral_scope text,
  category       text,
  version        text,
  status         text,
  document_url   text,
  fetched_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_verra_methodologies
  ON esg_verra_methodologies (methodology_id, coalesce(version,''));

CREATE TABLE IF NOT EXISTS esg_verra_projects (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verra_project_id   text NOT NULL,
  name               text,
  proponent          text,
  country            text,
  region             text,
  sectoral_scope     text,
  methodology_code   text,
  status             text,
  project_type       text,
  estimated_annual_reductions numeric(20,4),
  registration_date  date,
  crediting_start    date,
  crediting_end      date,
  raw                jsonb,
  fetched_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_verra_projects
  ON esg_verra_projects (verra_project_id);
CREATE INDEX IF NOT EXISTS idx_esg_verra_projects_country ON esg_verra_projects (country);
CREATE INDEX IF NOT EXISTS idx_esg_verra_projects_method  ON esg_verra_projects (methodology_code);

CREATE TABLE IF NOT EXISTS esg_verra_issuances (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verra_project_id text NOT NULL,
  vintage_start    date,
  vintage_end      date,
  quantity_vcu     numeric(20,4),
  issuance_date    date,
  serial_number    text,
  raw              jsonb,
  fetched_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- Covers: rows that carry a serial number. Verra's public feed does not always
-- expose one, and a nullable UNIQUE would let unlimited NULL-serial duplicates
-- through while looking like it prevented them.
CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_verra_issuances_serial
  ON esg_verra_issuances (serial_number) WHERE serial_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_esg_verra_issuances_project
  ON esg_verra_issuances (verra_project_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- 8. PLATFORM PLUMBING
-- ═══════════════════════════════════════════════════════════════════════════

-- Scheduled work. Postgres-backed, never setTimeout: Railway restarts a
-- container whenever it likes, and an in-memory timer dies with it silently.
CREATE TABLE IF NOT EXISTS esg_scheduled_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type      text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_at        timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','running','done','failed','cancelled')),
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 3,
  locked_at     timestamptz,
  locked_by     text,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_esg_jobs_claim
  ON esg_scheduled_jobs (run_at) WHERE status = 'pending';
-- Covers: pending/running rows of a recurring job type. Stops two container
-- instances from queueing the same nightly Verra sync twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_jobs_singleton
  ON esg_scheduled_jobs (job_type) WHERE status IN ('pending','running');

CREATE TABLE IF NOT EXISTS esg_ai_interactions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid REFERENCES esg_companies(id) ON DELETE SET NULL,
  user_id        uuid REFERENCES esg_users(id) ON DELETE SET NULL,
  feature        text NOT NULL,
  model          text NOT NULL,
  prompt_chars   integer,
  response_chars integer,
  latency_ms     integer,
  ok             boolean NOT NULL DEFAULT true,
  error_message  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_esg_ai_interactions_created
  ON esg_ai_interactions (created_at DESC);

CREATE TABLE IF NOT EXISTS esg_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES esg_companies(id) ON DELETE SET NULL,
  user_id     uuid REFERENCES esg_users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity      text,
  entity_id   uuid,
  detail      jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_esg_audit_log_company
  ON esg_audit_log (company_id, created_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- 9. updated_at TRIGGERS
-- Applied by loop so a table added above cannot be forgotten here.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION esg_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname = current_schema()
      AND c.relname LIKE 'esg\_%'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'trg_' || t || '_touch' AND NOT tgisinternal
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION esg_touch_updated_at()',
        'trg_' || t || '_touch', t);
    END IF;
  END LOOP;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 10. LAYER 2 — ANALYSIS OF UPLOADED ESG REPORTS
--
-- The MoM asks the AI to "estimate ESG performance" from an uploaded report.
-- Taken literally that would have a language model author a score, which is the
-- one thing this system must never do. The shape below is how that request is
-- honoured without breaking it:
--
--   1. The model answers a CLOSED question per indicator — yes / partial / no.
--      It never emits a number, a percentage or a score.
--   2. Every answer must come with a VERBATIM QUOTE. The quote is checked
--      against the extracted text; if it is not found, the proposal is
--      auto-rejected as a hallucination and never reaches a human.
--   3. A verified proposal is still only a PROPOSAL. A person accepts it before
--      it becomes a row in esg_responses. An AI reading a PDF must not silently
--      raise a company's ESG rating.
--   4. Coverage percentages are arithmetic over ACCEPTED proposals, computed by
--      scoringEngine.js, exactly as for questionnaire answers.
--
-- So Layer 2 is not a second scoring path. It is a second INPUT path into the
-- single scoring engine.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE esg_documents ADD COLUMN IF NOT EXISTS page_count      integer;
ALTER TABLE esg_documents ADD COLUMN IF NOT EXISTS extracted_text  text;
ALTER TABLE esg_documents ADD COLUMN IF NOT EXISTS extraction_error text;
-- Distinguishes "not looked at yet" from "looked at, and this PDF is a scan
-- with no text layer" from "looked at, and it genuinely says nothing relevant".
-- Reporting a scan as an empty report is the error that makes an owner stop
-- looking.
ALTER TABLE esg_documents ADD COLUMN IF NOT EXISTS text_status text NOT NULL DEFAULT 'pending';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'esg_documents_text_status_chk') THEN
    ALTER TABLE esg_documents ADD CONSTRAINT esg_documents_text_status_chk
      CHECK (text_status IN ('pending','extracting','extracted','no_text_layer','failed'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS esg_document_extractions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid NOT NULL REFERENCES esg_documents(id) ON DELETE CASCADE,
  assessment_id   uuid REFERENCES esg_assessments(id) ON DELETE SET NULL,
  indicator_id    uuid NOT NULL REFERENCES esg_indicators(id),
  -- An OPTION CODE, never a value. There is deliberately no numeric column on
  -- this table: adding one would create the first path by which a
  -- model-authored figure could reach a company, and
  -- test/layer2-test.js asserts the column does not exist.
  proposed_option_code text NOT NULL,
  evidence_quote  text NOT NULL,
  page_no         integer,
  -- Set by the extractor, not by the model. False means the quote could not be
  -- located in the document's own extracted text.
  quote_verified  boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','rejected','auto_rejected')),
  reject_reason   text,
  model           text,
  reviewed_by     uuid REFERENCES esg_users(id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- One live proposal per indicator per document. Auto-rejected hallucinations
-- are kept for audit and are excluded here, so a rejected proposal never blocks
-- a later good one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_doc_extractions_live
  ON esg_document_extractions (document_id, indicator_id)
  WHERE status <> 'auto_rejected';
CREATE INDEX IF NOT EXISTS idx_esg_doc_extractions_review
  ON esg_document_extractions (assessment_id, status);

-- The original singleton index was UNIQUE (job_type) WHERE pending/running.
-- Correct for a recurring job like the registry sync — exactly wrong for a
-- per-document job, where it would let ONE company analyse ONE report at a
-- time across the entire platform, and silently drop everyone else's request
-- via ON CONFLICT DO NOTHING. Nobody would see an error; the button would just
-- do nothing.
--
-- Dedupe is now per TARGET: jobs with no dedupe_key stay singleton per type
-- (the sync), jobs that name one are unique per key (one per document).
DROP INDEX IF EXISTS uq_esg_jobs_singleton;
CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_jobs_dedupe
  ON esg_scheduled_jobs (job_type, coalesce(payload->>'dedupe_key', ''))
  WHERE status IN ('pending','running');

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. CARBON BULK IMPORT (EXCEL UPLOAD -> AUTO-FILL)
--
-- Same shape as M-EasyCommerce's product import, and the same four guards as
-- extractionService.js's Layer 2, adapted to a structured spreadsheet instead
-- of prose:
--   1. THE MODEL NEVER SEES A CELL VALUE. It is shown column headers only and
--      proposes a header -> field mapping. It never proposes an activity
--      amount, a date, or a kg CO2e figure.
--   2. Evidence is the cell reference itself (row number, header) — stronger
--      than a PDF quote because it is exact, not fuzzy-matched.
--   3. An unmapped or invented target is dropped, not coerced.
--   4. Nothing reaches esg_carbon_entries until a human approves the mapping.
--      Commit is then fully deterministic: every row goes through the SAME
--      carbonEngine.electricityToCo2e / fuelToCo2e calculation and the SAME
--      factor-stamping as the manual /carbon form. No new calculation path.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS esg_carbon_import_batches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES esg_companies(id) ON DELETE CASCADE,
  filename          text NOT NULL,
  uploaded_by       uuid REFERENCES esg_users(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'mapping_pending'
                    CHECK (status IN ('mapping_pending','committing','committed','error')),
  column_headers    jsonb NOT NULL DEFAULT '[]',
  proposed_mapping  jsonb NOT NULL DEFAULT '{}',
  approved_mapping  jsonb,
  row_count         integer NOT NULL DEFAULT 0,
  committed_count   integer NOT NULL DEFAULT 0,
  error_count       integer NOT NULL DEFAULT 0,
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_esg_carbon_import_batches_company
  ON esg_carbon_import_batches (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS esg_carbon_import_rows (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id          uuid NOT NULL REFERENCES esg_carbon_import_batches(id) ON DELETE CASCADE,
  row_number        integer NOT NULL,
  raw_cells         jsonb NOT NULL,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','committed','error')),
  carbon_entry_id   uuid REFERENCES esg_carbon_entries(id) ON DELETE SET NULL,
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_carbon_import_rows_batch_row
  ON esg_carbon_import_rows (batch_id, row_number);


-- ═══════════════════════════════════════════════════════════════════════════
-- SEDG v2 — the `disclosure` response type            (Run 22, 2026-08-09)
-- ───────────────────────────────────────────────────────────────────────────
-- Roughly half of SEDG v2's 38 disclosures do not fit any existing response
-- type: 8 are multi-line-item numerics (E2.1 is six fuel/energy lines), 8 are
-- open lists, 3 are number-plus-narrative. See docs/SEDG_V2_SOURCE.md §2.
--
-- ONE new type carries all three shapes, because the SHAPE lives in data, not
-- in the type: esg_indicators.line_items names the expected parts, and
-- esg_responses.value_json holds one entry per part. Completeness is then a
-- single rule — disclosed parts / applicable parts — for all three.
--
-- The rejected alternative was splitting E2.1 into E2.1a..E2.1f. It needs no
-- schema change at all, which is genuinely attractive, but it breaks the 1:1
-- with published disclosure codes and turns 38 into ~70 — making "we implement
-- the 38 SEDG disclosures" false on its face, which is the whole point.
--
-- Both columns are additive and nullable, so no existing row changes and no
-- existing query sees a different value.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'esg_indicators' AND column_name = 'line_items') THEN
    ALTER TABLE esg_indicators ADD COLUMN line_items jsonb;
  END IF;
END $$;

COMMENT ON COLUMN esg_indicators.line_items IS
  'For response_type=disclosure: JSON array naming the expected parts, verbatim from the publisher (e.g. ["Renewable fuel sources",...]). NULL means a free-form list with no fixed parts.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'esg_responses' AND column_name = 'value_json') THEN
    ALTER TABLE esg_responses ADD COLUMN value_json jsonb;
  END IF;
END $$;

COMMENT ON COLUMN esg_responses.value_json IS
  'For response_type=disclosure: {"parts":{"<label>":{"value":<num|string>,"na":<bool>}}} for a fixed-part disclosure, or {"text":"..."} for a free list. NULL for every other type.';

-- The response_type CHECK is declared inline on the table, so it must be
-- replaced rather than extended. Dropped and re-added under an explicit name
-- so this block is idempotent and the constraint stops depending on Postgres's
-- auto-generated naming.
DO $$
BEGIN
  ALTER TABLE esg_indicators DROP CONSTRAINT IF EXISTS esg_indicators_response_type_check;
  ALTER TABLE esg_indicators DROP CONSTRAINT IF EXISTS chk_esg_indicators_response_type;
  ALTER TABLE esg_indicators ADD CONSTRAINT chk_esg_indicators_response_type
    CHECK (response_type IN ('yes_no','yes_partial_no','maturity_0_4','quantitative','multi_select','disclosure'));
END $$;
