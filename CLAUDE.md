# Modus ESG Super App — working notes

Read `docs/VERRA_BENCHMARK.md` and `docs/SCORING_METHODOLOGY.md` before changing
anything in `src/services/`.

## Non-negotiables

1. **The model never produces a figure.** Five guards in `aiAdvisor.js`. Do not
   open a sixth. `test/no-model-figures-test.js` fails the build if the AI layer
   touches `esg_scores` or `score_0_100`.
2. **Only `scoringEngine.js` writes `esg_scores`.** Enforced by test.
3. **Only `groqService.js` reads `GROQ_MODEL`.** The env var OVERRIDES the code
   default — check the Railway dashboard, not just the source.
4. **`schema.sql` replays as one transaction on every boot.** Any failing
   statement rolls back the whole file. Every statement must be idempotent; new
   columns go in `DO $$ ... $$` blocks, never a bare `ALTER TABLE`.
5. **No nullable UNIQUE.** Postgres admits unlimited NULLs past one. Partial
   unique indexes only, each with a comment naming the rows it covers.
6. **Factors and weights are stamped on the record, never joined at read time.**
   Same rule as SST on a Commerce transaction.
7. **Scheduled work lives in `esg_scheduled_jobs`.** Never `setTimeout`.
8. **Report the three empty states distinctly** — uninstrumented,
   instrumented-but-empty, genuinely zero. `layout.emptyState()` does this.
9. **Every feature ships with its API equivalent.** Checked in `smoke-test.js`.
10. **Design tokens only.** A custom property that merely looks like a token
    fails silently. `[data-platform="esg"]` was added to the shared CSS because
    a missing accent block renders in the default blue and nobody notices.

## Before every deploy

`smoke-test.js` REGISTERS COMPANIES AND NEVER CLEANS UP. It must never be
pointed at production. Use the scratch database in the separate Railway project
**ESG AI+ Staging** (`6d7eab4d-f45a-42f0-8e88-ba6b769dc567`), which exists for
exactly this and holds nothing else.

Railway's Postgres template does NOT publish a `DATABASE_PUBLIC_URL` variable
even with the TCP proxy enabled — assuming it does has cost time twice now.
Build the URL from the service's own variables:

```
postgresql://<PGUSER>:<PGPASSWORD>@<RAILWAY_TCP_PROXY_DOMAIN>:<RAILWAY_TCP_PROXY_PORT>/<PGDATABASE>
```

```powershell
$env:DATABASE_URL="<the URL built above>"
npm test                     # includes the schema replay
node test/smoke-test.js      # spawns its own server on 127.0.0.1:3999
```

Note this exercises a code path production does not: the proxy host is
`*.proxy.rlwy.net`, so `sslConfig()` takes its SSL branch. Production connects
over `*.railway.internal` and takes the non-SSL branch. Running here is the only
way that branch gets tested.
