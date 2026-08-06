# Modus ESG Super App

Malaysia SMEs ESG e-Reporting System. Part of the Modus AI Ecosystem — same
stack, same design system, same auth pattern as the other nine platforms.

Platform accent: `data-platform="esg"` → moss green `#4D7C0F`.
Table prefix: `esg_`.

## Stack

Node 18+ · Express · PostgreSQL (Railway) · Passport (Google OAuth + local
bcryptjs) · connect-pg-simple · Groq `qwen/qwen3.6-27b` · server-rendered HTML
with vanilla JS. No frontend framework, no external CSS framework.

## Run locally

```powershell
Copy-Item .env.example .env      # then fill in DATABASE_URL and SESSION_SECRET
npm install
npm start
```

`initDb()` replays `src/db/schema.sql` and `src/db/seed.sql` on every boot and
**throws** if either fails, so a broken migration fails the deploy instead of
producing a running app on last week's schema.

## Test

```powershell
npm test                                   # unit + guard suites (+ schema replay if DATABASE_URL is set)
$env:DATABASE_URL="postgres://..."; node test/smoke-test.js   # full end-to-end against a live listener
```

- `test/scoring-engine-test.js` — hand-computed fixtures for every scoring rule
- `test/no-model-figures-test.js` — static guards: only the engine writes scores,
  only `groqService.js` reads `GROQ_MODEL`, no `SELECT *`, no SQL interpolation,
  no nullable UNIQUE, no `setTimeout` scheduling
- `test/schema-idempotency-test.js` — replays schema + seed three times
- `test/smoke-test.js` — register → profile → assessment → score → carbon →
  dashboard, plus cross-tenant isolation

## What is built (sprint 1)

Auth · company profile · 40-indicator assessment · **deterministic scoring
engine** with E/S/G/overall, bands and provenance stamps · radar dashboard ·
Scope 1/2 carbon with stamped emission factors · Verra reference mirror · AI
recommendations with offline fallback · full JSON API · Postgres job queue.

## Known gaps — deliberate and visible

| Gap | Where it shows |
|---|---|
| Official SEDG disclosures not imported. The 40 seeded indicators are `mapping_status = 'draft'`. | Badged "draft" in the assessment UI. `SEDG v2.0` framework row exists with zero indicators. See `docs/SCORING_METHODOLOGY.md`. |
| Diesel and petrol emission factors are DEFRA placeholders, not Malaysian. | `verification_status = 'unverified'`; every entry using them is stamped `is_provisional` and badged in the UI. |
| Evidence upload not built. `esg_documents` exists with no writer. | `/documents` says so rather than showing a broken button. |
| Report generation (PDF/DOCX/XLSX) not built. | `/reports` says so. |
| Verra ingest off until `VERRA_API_BASE` is set. | `/verra` reports **uninstrumented**, not "empty". |

A table with no writer answers nothing. Every one of the above is reported as
*not switched on* rather than as *zero*.

## Documentation

- `docs/VERRA_BENCHMARK.md` — why Verra cannot be the entity-level benchmark, and
  what "benchmark against Verra" was resolved to mean
- `docs/SCORING_METHODOLOGY.md` — the arithmetic, the three empty states, and the
  SEDG reconciliation checklist
