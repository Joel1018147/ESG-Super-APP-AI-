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
- `test/layer2-test.js` — the extraction guards, run against a hallucinating model
- `test/smoke-test.js` — register → profile → assessment → score → carbon →
  upload → analyse → dashboard, plus cross-tenant isolation

## What is built (sprint 1)

Auth · company profile · 40-indicator assessment · **deterministic scoring
engine** with E/S/G/overall, bands and provenance stamps · radar dashboard ·
Scope 1/2 carbon with stamped emission factors · carbon-registry reference mirror · AI
recommendations with offline fallback · full JSON API · Postgres job queue.

## Known gaps — deliberate and visible

| Gap | Where it shows |
|---|---|
| Official SEDG disclosures not imported. The 40 seeded indicators are `mapping_status = 'draft'`. | Badged "draft" in the assessment UI. `SEDG v2.0` framework row exists with zero indicators. See `docs/SCORING_METHODOLOGY.md`. |
| Diesel and petrol emission factors are DEFRA placeholders, not Malaysian. | `verification_status = 'unverified'`; every entry using them is stamped `is_provisional` and badged in the UI. |
| Report generation (PDF/DOCX/XLSX) not built. | `/reports` says so. |
| Registry ingest off until `VERRA_API_BASE` is set. | `/governance` reports **uninstrumented**, not "empty". |

A table with no writer answers nothing. Every one of the above is reported as
*not switched on* rather than as *zero*.

## Design system delivery — a deliberate divergence

This repo **links** `modus-design-system.css` and inlines only the custom-property
blocks (2.8 KB). The other nine platforms inline the whole sheet (94,580 bytes)
into every response.

The inherited comment justifying the inline approach claimed it "serves the same
bytes as a cached static file". It does not: an inline `<style>` is re-sent on
every navigation; a linked sheet is fetched once. Measured in production, by byte count from
the server's own access log:

| | Before | After |
|---|---|---|
| Signed-in page | 99,387 B | 8,187 B |
| Signed-out page | 96,132 B | 4,247 B |
| Stylesheet | inlined every time | 94,580 B once, then cached 7 days |

(Sizes are UTF-8 **bytes**. An earlier draft of this section quoted 87,240 for
the stylesheet — that was JavaScript string length, which counts the
box-drawing characters in the comments as one unit each rather than three.)

Inlining did buy one real thing — the shell could never render unstyled. Linking
alone would trade a bandwidth problem for a silent-failure one. Inlining the token
blocks keeps that guarantee: if the stylesheet fails to load, the page is unstyled
but every colour still resolves, so nothing renders transparent.

The link carries `?v=<content hash>`. `express.static` caches for 7 days and the
stylesheet is synced from master by a separate ecosystem process, so a fixed
version string would leave returning users on a stale sheet for a week after
every sync.

**This is ESG-only until proven.** If it holds up, it belongs in the Modus UI
Contract as a fan-out to all ten repos, not as ten independent edits.

## Naming

The user-facing page is **Governance & Recognition** at `/governance`. The
registry brand appears nowhere in the navigation, page titles or body copy —
that was a product decision.

It DOES remain in three places, deliberately:

- a one-line source caption under mirrored records, because provenance of
  third-party data is a licensing matter, not branding
- the `VERRA_API_BASE` / `VERRA_INGEST_ENABLED` env vars, `verraService.js`,
  the `/api/verra/*` endpoints and the `esg_verra_*` tables — configuration and
  schema identifiers, renaming which would be a migration for no user-visible gain
- `docs/VERRA_BENCHMARK.md`, which is the record of why the registry is not the
  scoring benchmark and must keep naming what it is about

There is no redirect from the old `/verra` path. Adding one would reintroduce
the name into the URL space the rename was meant to clear, to serve a bookmark
that does not exist.

## Documentation

- `docs/VERRA_BENCHMARK.md` — why Verra cannot be the entity-level benchmark, and
  what "benchmark against Verra" was resolved to mean
- `docs/SCORING_METHODOLOGY.md` — the arithmetic, the three empty states, and the
  SEDG reconciliation checklist
