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

Two separate facts about Railway Postgres, which are easy to collapse into one
wrong rule:

1. **The template never publishes `DATABASE_PUBLIC_URL`** — not even with the
   TCP proxy switched on. Its absence tells you nothing about reachability.
2. **`RAILWAY_TCP_PROXY_DOMAIN` / `RAILWAY_TCP_PROXY_PORT` are the signal.**
   Present means public networking is on; absent means the database is reachable
   only from inside Railway, and no amount of URL-building will change that.

Production (`Postgres-Lo_D`) has neither — deliberately. It is private and stays
private. Staging has the proxy vars and no `DATABASE_PUBLIC_URL`, which is the
normal, correct state for a reachable database.

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

## Agentic Engineering Standards (ecosystem-wide, added 2026-08-03)

Added to this repo 2026-08-07. It was the only one of ten platforms without it,
because this CLAUDE.md was written from scratch rather than from
`Modus-Agent-OS/skills/claude-md-pattern.md` — which is why the M-EasyESG build
re-derived three defect classes the SOP already documented.

0. LOAD THE AGENT OS BEFORE BUILDING. `Modus-Agent-OS/BUILD_PROTOCOL.md` is the
   control layer: how Cowork, Claude Code and sub-agents divide work by what each
   can SEE, and why a claim about the other side is a hypothesis, never a fact.
   Read it, plus `Modus-Agent-OS/skills/recurring-bugs-checklist.md`, before any
   code. DO NOT RE-DERIVE what is on that checklist.

1. KEEP THIS FILE MINIMAL. Current models correctly infer stack, structure, and
   conventions by reading the codebase. Only document what a fresh read genuinely
   can't recover: business rules, the vision behind a non-obvious decision, and
   anything that would otherwise require asking Joel.

2. SOURCE CODE OVER MEMORY FOR THIRD-PARTY INTEGRATIONS. Before writing code
   against any external library, SDK, or API this platform doesn't already have
   documented in this file, pull its real source into reference/repos/<org>/<project>/
   and read that. See `Modus-Agent-OS/skills/source-code-context.md`.

3. STRUCTURE CLEANUP BEFORE THE DEPLOY GATE. After a feature works and is tested,
   check whether anything in the diff duplicates a mechanic already elsewhere in
   this platform. See `Modus-Agent-OS/skills/code-structure-cleanup.md`.

4. "DONE" MEANS THE THREE-STAGE GATE, NOT JUST ACTIVE ON RAILWAY. Compile (ACTIVE)
   is a floor, not a finish line. A prompt isn't complete until Verify (live smoke
   test against real-shaped data) and Structure (audit against
   Modus-Agent-OS/skills/recurring-bugs-checklist.md, which is canonical) both
   pass. Gate 0, the pre-deploy env-var diff, runs before all three. See
   Modus-Agent-OS/skills/three-stage-deploy-gate.md.

## Known divergence from the canonical harness

`Modus-Agent-OS/skills/test-harness-integrity-audit.md` names
`test/harness.js` + `negative-control*.js` as the pattern. This repo uses
`test/run-all.js` with four suites and has **no negative-control plants**. Of 50
assertions, only five have been mutation-tested.

Adoption across the ecosystem is 2 of 10 — Dragon Ginseng and M-EasyMall follow
it; M-EasyCommerce, the reference implementation, does not. So this is an open
ecosystem decision, not an ESG-only defect. Either roll the pattern out or
downgrade the language in that skill; do not silently leave a standard nobody
follows.
