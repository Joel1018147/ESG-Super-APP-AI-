'use strict';

const express = require('express');
const { query } = require('../db');
const { layout, esc, emptyState, frameworkLabel } = require('../utils/layout');
const sedg = require('../data/sedgV2');
const { scoreAssessment, loadActiveScheme } = require('../services/scoringEngine');
const { generateRecommendations } = require('../services/aiAdvisor');
const { electricityToCo2e, fuelToCo2e } = require('../services/carbonEngine');
const { mirrorStatus } = require('../services/verraService');
const journey = require('../services/journeyEngine');
const view = require('../utils/journeyView');

const router = express.Router();

const companyIdOf = (req) => req.user && req.user.company_id;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const DAY_MS = 24 * 3600 * 1000;

// ═══════════════════════════════════════════════════════════════════════════
// THE DASHBOARD                                            (Run 53 · Run 55)
//
// Built from docs/design/reference-dashboard.png, and from
// docs/design/UI_REFERENCE_ANNOTATED.md, which OUTRANKS it. About a third of
// the figures on that mock are things this system cannot honestly know; §1 of
// the annotation names five that must never ship as drawn, and every one of
// them is either absent here or rendered as a named empty state that says why.
//
// EVERY NUMBER TRACES TO A ROW. The score, the sub-scores and the band come
// from esg_scores and esg_rating_bands. The journey, the missions and the XP
// come from journeyEngine, which derives them from committed facts and stores
// nothing. There is no counter anywhere on this page.
//
// RUN 55 MADE IT A GRID. Run 53 got the content right and left it a one-column
// stack, because the master had no column system. Run 54 added §52 — a twelve
// column grid, a numbered .panel, chips, file rows, metric rows, KPI tiles and
// a hero score ring — so this run is composition and adds no CSS whatsoever.
// Four rows: the four counters, then the score beside the journey, then three
// working panels, then evidence beside carbon.
//
// TWO ORDERS, ONE PAGE. The mock draws a mature account, and its reading order
// — stat cards, score, journey, panels — is right for one: the score answers
// "where am I" and the rail answers "what next". A company that registered ten
// minutes ago has no score, and rendering that layout for them produces a grid
// of zeroes and an empty ring, which reads as BROKEN rather than as NEW. So
// when there is no score the rail leads instead and takes the wider column,
// because it is the one component fully populated on day one — the stages exist
// before the company does anything.
//
// WHAT WAS DROPPED FROM THE MOCK, deliberately:
//   the five stars under the score   a second rating scale competing with the
//                                    band, mapping to nothing
//   the peer percentile              annotation §1.1 — no cohort exists, and it
//                                    is a cross-tenant surface. Rendered as a
//                                    named uninstrumented state, not hidden.
//   AI confidence %                  §1.2 — there is deliberately no confidence
//                                    column; quote_verified is the real fact
//   4 Pillars contribution           §1.3 — no published methodology
//   certification / consultation     §1.4, §1.5
//   the 0% / 25% roadmap bars        nothing tracks progress against a
//                                    recommendation; 0% would be a claim
//   the topbar search, bell and mail three dead controls in the most prominent
//                                    row of the page (§4.3c)
//   the radar chart                  200 KB of Chart.js from a CDN for what the
//                                    three .score-ring components already say
// ═══════════════════════════════════════════════════════════════════════════

const PILLAR_NAME = Object.freeze({ E: 'Environmental', S: 'Social', G: 'Governance' });

// EACH PANEL IS A JOURNEY STAGE SEEN FROM A DIFFERENT ANGLE, so its number is
// that stage's own position in the rail rather than a decorative 01/02/03. The
// reference image heads every panel "Mission 05 of 09" and that instinct is
// right — it is only honest if the number comes from esg_journey_stages, which
// is what this map makes it do. Reorder the seed and these renumber themselves.
// A panel whose stage is not seeded renders with NO index and NO meta rather
// than with a made-up one.
const PANEL_STAGE = Object.freeze({
  review: 'PROPOSALS_REVIEWED',
  roadmap: 'RECOMMENDATIONS',
  green: 'GREEN_PROJECT',
  evidence: 'DOCUMENTS_UPLOADED',
  carbon: 'CARBON_DATA',
});

const pad2 = (n) => String(n).padStart(2, '0');

/** A SCORE IS SHOWN AS A WHOLE NUMBER (Run 56). `esg_scores.score_0_100` stays
 *  `numeric(6,2)` and the engine keeps computing it to two places — this is a
 *  RENDERING choice and nothing about what is stored or recomputed changes.
 *  `34.47` under a hero ring reads as a spreadsheet cell; `34` reads as a figure
 *  a company puts in front of a bank.
 *
 *  Rounded ONCE, here, and the same value drives both the numeral and the arc,
 *  so a ring can never be drawn at 34.47% underneath the number 34. Returns
 *  null rather than 0 for an absent score, because scoreRing() renders null as
 *  "—" and 0 as a measured zero, and those are different facts. */
function wholeScore(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Bytes as a human size. Not a fallback: a byte count that is not a number is
 *  a bug upstream, and printing "—" says so rather than printing "0 KB", which
 *  is a claim that the files are empty. */
function fileSize(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v < 1024) return `${Math.round(v)} B`;
  if (v < 1024 * 1024) return `${Math.round(v / 1024)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

/** A ring with its number in the DOM as TEXT. §3.4 rule 4: if a figure ever
 *  animates, the final value is present before any script runs — a number that
 *  is only correct once JavaScript has finished is a wrong number to a screen
 *  reader, to a no-JS user, and to anyone whose script was dropped.
 *
 *  `--score` is the only inline style here. It is a DATA value driving §50's
 *  conic-gradient, which is the mechanism §50 documents; it is not a theme
 *  choice, and no size, colour or duration appears anywhere in this file. */
function scoreRing(value, label, aria, opts = {}) {
  const n = Number(value);
  const known = Number.isFinite(n);
  const safe = known ? Math.max(0, Math.min(100, n)) : 0;
  const size = opts.size ? ` score-ring--${opts.size}` : '';
  const figure = opts.den
    ? `<div class="score-ring-figure"><span class="score-ring-value">${known ? esc(value) : '—'}</span
       ><span class="score-ring-den">/${esc(opts.den)}</span></div>`
    : `<div class="score-ring-value">${known ? esc(value) : '—'}</div>`;
  return `<div class="score-ring${size}" style="--score:${safe}" role="img" aria-label="${esc(aria)}">
    ${figure}
    ${label ? `<div class="score-ring-label">${esc(label)}</div>` : ''}
  </div>`;
}

/** Ring, then whatever names it. §52 puts the caption OUTSIDE the ring because
 *  inside it fights the arc. */
function ringWrap(ring, caption, chip) {
  return `<div class="score-ring-wrap">
    ${ring}
    ${chip || ''}
    ${caption ? `<div class="score-ring-caption">${caption}</div>` : ''}
  </div>`;
}

function statCard(label, value, sub, glow) {
  return `<div class="stat-card${glow ? ' stat-card--glow' : ''}">
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-value">${esc(value)}</div>
    <div class="stat-sub">${sub}</div>
  </div>`;
}

router.get('/dashboard', async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const [{ stages, missions, levels }, facts] = await Promise.all([
      journey.loadDefinitions(),
      journey.gatherFacts(cid),
    ]);

    // The journey is DEFINED in seed.sql. No rows means the seed did not run,
    // which is a deployment fault and not a company that has done nothing —
    // and those two must never render the same way.
    const journeyReady = stages.length > 0 && missions.length > 0 && levels.length > 0;
    const j = journeyReady ? journey.computeJourney(facts, stages) : null;
    const m = journeyReady ? journey.computeMissions(facts, missions) : null;
    const xp = journeyReady ? journey.computeXp(facts, missions, levels) : null;
    // The clock lives here, not in the engine: computeXp stays pure, and the
    // week filter applies to each award's own source-row timestamp.
    const weekXp = xp ? journey.xpSince(xp.awards, new Date(Date.now() - 7 * DAY_MS).toISOString()) : 0;

    const a = facts.assessment;
    let by = {};
    let bandLabel = null;
    let bandList = [];
    let recs = [];
    if (a) {
      const [{ rows: scores }, { rows: bands }, { rows: recRows }] = await Promise.all([
        query(
          `SELECT s.scope, s.score_0_100, s.band_code, s.indicators_total,
                  s.indicators_answered, s.indicators_na, s.weighting_version,
                  s.framework_version, s.engine_version, s.computed_at
             FROM esg_scores s
             JOIN esg_assessments asm ON asm.id = s.assessment_id
            WHERE asm.company_id = $1 AND s.assessment_id = $2`, [cid, a.id]),
        // THE BAND LABEL COMES FROM esg_rating_bands, never from copy in this
        // file. 78 is 'AA' and the seeded label is 'Advanced'; "Good
        // Performance", which the mock prints, is not a band this system has.
        // min_score / max_score added in Run 56: the whole ladder was already
        // being fetched and six of its seven rows thrown away.
        query(
          `SELECT b.band_code, b.band_label, b.min_score, b.max_score
             FROM esg_rating_bands b
             JOIN esg_assessments asm ON asm.weighting_scheme_id = b.scheme_id
            WHERE asm.id = $1 AND asm.company_id = $2
            ORDER BY b.sort_order`, [a.id, cid]),
        query(
          `SELECT r.pillar, r.points_missed, r.priority, r.narrative_en, r.source
             FROM esg_recommendations r
             JOIN esg_assessments asm ON asm.id = r.assessment_id
            WHERE asm.company_id = $1 AND r.assessment_id = $2 AND r.source <> 'engine'
            ORDER BY r.points_missed DESC LIMIT 6`, [cid, a.id]),
      ]);
      by = Object.fromEntries(scores.map((s) => [s.scope, s]));
      bandList = bands;
      recs = recRows;
      const overallBand = by.OVERALL && by.OVERALL.band_code;
      const band = bands.find((b) => b.band_code === overallBand);
      bandLabel = band ? band.band_label : null;
    }
    const overall = by.OVERALL || null;
    const answers = facts.predicates.assessment_answered;

    // ── THE PANEL DATA ──────────────────────────────────────────────────────
    // journeyEngine answers "has this happened", which is all a predicate needs.
    // The panels need the detail behind it — which files, how many proposals,
    // which period — so this is the dashboard's own wave and it is deliberately
    // not pushed into the engine: gatherFacts stays a predicate loader.
    //
    // Every one is an aggregate over a table this company owns, so each returns
    // exactly one row and is read without a guard. A count query that returns
    // nothing is a broken connection, and it should throw rather than render 0.
    const [
      { rows: docTotals }, { rows: recentDocs }, { rows: propTotals },
      { rows: carbonTotals }, { rows: greenTotals }, { rows: registerTotals },
    ] = await Promise.all([
      query(
        `SELECT count(*)::int AS n, coalesce(sum(byte_size), 0)::bigint AS bytes
           FROM esg_documents WHERE company_id = $1`, [cid]),
      query(
        `SELECT id, filename, byte_size, text_status
           FROM esg_documents WHERE company_id = $1
          ORDER BY created_at DESC, id DESC LIMIT 5`, [cid]),
      // auto_rejected proposals never reach a human, so they are outside both
      // the numerator and the denominator — the same rule journeyEngine applies.
      query(
        `SELECT count(*)::int AS proposals_live,
                count(*) FILTER (WHERE e.status = 'pending')::int AS proposals_pending
           FROM esg_document_extractions e
           JOIN esg_documents d ON d.id = e.document_id
          WHERE d.company_id = $1 AND e.status <> 'auto_rejected'`, [cid]),
      query(
        `SELECT count(*)::int AS entries, min(period_start) AS period_from,
                max(period_end) AS period_to,
                count(*) FILTER (WHERE is_provisional)::int AS provisional
           FROM esg_carbon_entries WHERE company_id = $1`, [cid]),
      query(
        `SELECT count(*)::int AS projects FROM esg_green_projects WHERE company_id = $1`, [cid]),
      query(
        `SELECT count(*)::int AS products FROM esg_finance_products WHERE is_active`, []),
    ]);
    const docs = docTotals[0];
    const props = propTotals[0];
    const carbon = carbonTotals[0];
    const green = greenTotals[0];
    const register = registerTotals[0];

    /* ── panel chrome ─────────────────────────────────────────────────────
       The index and the meta are the STAGE's, looked up by code. No stage, no
       number — the alternative is a panel that claims a position in a rail it
       is not on. */
    const stageOf = (key) => (j ? j.stages.find((s) => s.stage_code === PANEL_STAGE[key]) : null);
    function panel(key, title, body) {
      const s = stageOf(key);
      const idx = s ? j.stages.indexOf(s) + 1 : null;
      return `<div class="panel panel--accent-top">
        <div class="panel-head">
          ${idx ? `<span class="panel-index">${esc(pad2(idx))}</span>` : ''}
          <h3 class="panel-title">${esc(title)}</h3>
          ${s ? `<span class="panel-meta">Stage ${esc(idx)} of ${esc(j.total_stages)} · ${
  esc(view.stateWords(s))}</span>` : ''}
        </div>
        <div class="panel-body">${body}</div>
      </div>`;
    }

    /* ── ROW A · the four counters ──────────────────────────────────────── */
    const reachable = j ? j.total_stages - j.counts.blocked : 0;
    const journeyPct = reachable > 0 ? Math.round((j.counts.completed / reachable) * 100) : 0;
    const active = j ? j.stages.find((s) => s.stage_code === j.active_stage_code) : null;
    const activeMission = (m && active)
      ? m.missions.find((x) => x.stage_code === active.stage_code) : null;

    const statCards = journeyReady ? `<div class="grid-12 reveal">
      <div class="col-3">${statCard('Journey progress', `${journeyPct}%`,
    `${esc(j.counts.completed)} of ${esc(reachable)} stages you can reach${
      j.counts.blocked ? ` · ${esc(j.counts.blocked)} blocked` : ''}`)}</div>
      <div class="col-3">${statCard('Answers completed',
    a ? `${esc(answers.done)} / ${esc(answers.total)}` : '—',
    a ? esc(frameworkLabel(a.framework_code, a.framework_version))
      : 'No assessment started yet, so there is no denominator to count against')}</div>
      <div class="col-3">${statCard('XP earned', esc(xp.total),
    `${weekXp > 0 ? `${esc(weekXp)} in the last 7 days · ` : ''}Level ${esc(xp.level)} · ${esc(xp.label)}`)}</div>
      <div class="col-3">${statCard('Next milestone', active ? esc(active.label_en) : 'Nothing waiting',
    active
      ? (activeMission ? `${esc(view.stateWords(activeMission))} · ${esc(activeMission.xp_award)} XP` : 'No mission on this stage')
      : 'Every stage you can reach is done',
    Boolean(active))}</div>
    </div>` : emptyState('uninstrumented', {
      title: 'The journey has not been set up on this deployment',
      body: 'No stage, mission or level is defined, so there is nothing to measure your position '
          + 'against. That is a configuration gap, not an empty account.' });

    /* ── ROW B · the score ──────────────────────────────────────────────────
       A HERO RING AND THREE INLINE ONES, which is what replaced the radar. The
       radar plotted three numbers on three axes; three rings state the same
       three numbers, each with the ratio it was computed from underneath, and
       cost nothing to load.

       NOT .panel--deep. That variant paints --surface-deep, and §50's
       .score-ring::before fills its centre with --surface — the disc would sit
       on the wrong colour in the middle of the ring. A component's backdrop is
       part of its contract. */
    const pillarRings = ['E', 'S', 'G'].map((p) => {
      const s = by[p] || {};
      const unanswered = !s.indicators_answered;
      const shown = unanswered ? null : wholeScore(s.score_0_100);
      return ringWrap(
        scoreRing(shown, p,
          `${PILLAR_NAME[p]} score ${shown === null ? 'not yet available' : `${shown} out of 100`}`,
          { size: 'inline' }),
        `${esc(PILLAR_NAME[p])}<br>${esc(s.indicators_answered || 0)} of ${esc(s.indicators_total || 0)} answered${
          s.indicators_na > 0 ? ` · ${esc(s.indicators_na)} N/A` : ''}`);
    }).join('');

    const overallShown = overall ? wholeScore(overall.score_0_100) : null;

    /* ── THE SEEDED RATING LADDER (Run 56) ────────────────────────────────
       THE ROWS WERE ALREADY IN HAND AND SIX OF SEVEN WERE BEING DISCARDED.
       The band query returns the whole ladder ordered by sort_order; the page
       used one row of it for the chip and dropped Leading, Advanced,
       Established, Progressing, Developing and Starting Out on the floor. This
       costs no query, invents nothing, and answers what a single number cannot
       — what 34 MEANS, and what the next band would take.

       It is also what fills the left column of Row B. Deleting the two
       methodology paragraphs left a 250px panel beside a 900px journey rail,
       and a hole that size reads as unfinished rather than as calm. The answer
       is not to put the prose back: it is to put something TRUE there, and the
       ladder was already loaded.

       §52's .checklist is the component, and its three states are exactly a
       ladder read top-down — bands above you are not reached, yours is where
       you are, bands below are cleared. Each states its status in WORDS as
       well as by mark (§6: state is never colour alone). `cleared` is computed
       from the seeded min_score, not from the ordering, so a reseeded ladder
       stays correct. */
    const ladder = (overall && bandList.length) ? `
        <div class="stat-label">Rating ladder</div>
        <div class="checklist">${bandList.map((b) => {
    const lo = num(b.min_score);
    const hi = num(b.max_score);
    const here = Boolean(overall.band_code) && b.band_code === overall.band_code;
    const cleared = !here && lo !== null && overallShown !== null && overallShown >= lo;
    const state = here ? 'is-active' : (cleared ? 'is-done' : 'is-pending');
    const word = here ? 'You are here' : (cleared ? 'Cleared' : 'Not reached');
    return `<div class="checklist-item ${state}">
            <span class="checklist-mark" aria-hidden="true">${cleared ? '✓' : ''}</span>
            <span>${esc(b.band_code)} · ${esc(b.band_label)}</span>
            <span class="checklist-status">${lo === null || hi === null
    ? esc(word) : `${esc(lo)}–${esc(hi)} · ${esc(word)}`}</span>
          </div>`;
  }).join('')}</div>` : '';

    const scorePanel = overall ? `<div class="panel">
      <div class="panel-head">
        <h3 class="panel-title">ESG score overview</h3>
        <span class="panel-meta">${esc(frameworkLabel(a.framework_code, a.framework_version))} · ${
  esc(a.reporting_year)}</span>
      </div>
      <div class="panel-body">
        <div class="flex flex-wrap items-center gap-5">
          ${ringWrap(
    scoreRing(overallShown, null,
      `Overall ESG score ${overallShown} out of 100`, { size: 'hero', den: '100' }),
    `${esc(overall.indicators_answered)} of ${esc(overall.indicators_total)} indicators answered`,
    `<span class="badge badge-accent">${esc(overall.band_code || 'Not banded')}${
      bandLabel ? ` · ${esc(bandLabel)}` : ''}</span>`)}
          <div class="flex flex-wrap gap-4 items-start">${pillarRings}</div>
        </div>
        ${ladder}
        <!-- NO PROSE FOLLOWS THE RINGS, AND THAT IS THE CHANGE (Run 56).
             This panel ended with two paragraphs: the weighting and engine
             versions plus "every figure here is arithmetic over your own
             answers, no part of it is generated by AI", and a note that there
             is no peer cohort to compare against. Both were true and both were
             ENGINEERING JUSTIFICATION, sitting directly under the most
             important number in the product — which is most of why the page
             read as unfinished. Honesty is structural: a real number with a
             real source, and an empty state that names which of the three it
             is. A paragraph about having been honest is a different thing, and
             it costs the panel its hierarchy.
             Where each half went instead:
               provenance   the panel header's metadata line already names the
                            framework and the reporting year, and /governance
                            exists for the methodology in full
               peer cohort  a named emptyState('uninstrumented') at the foot of
                            the page, in the card that registers absences
             Run 55 had already cut the peer note from a full empty state down
             to one line here for the same reason, measured off a screenshot;
             this run finishes the move rather than shortening it again. -->
      </div>
    </div>` : `<div class="panel">
      <div class="panel-head"><h3 class="panel-title">ESG score overview</h3></div>
      <div class="panel-body">${a
    ? emptyState('instrumented_but_empty', {
      title: 'Assessment started, not scored yet',
      body: 'The score is computed from your answers when you submit the assessment. Nothing is '
          + 'estimated in the meantime, so there is no provisional figure to show you.' })
      + `<p class="text-center"><a class="btn btn-primary" href="/assessment/${esc(a.id)}">Continue the assessment</a></p>`
    : emptyState('instrumented_but_empty', {
      title: 'No assessment yet',
      body: 'This is switched on and working — you have not started one. Your ESG score is '
          + 'calculated from an assessment, so it begins there.' })
      + '<p class="text-center"><a class="btn btn-primary" href="/assessment">Start an assessment</a></p>'}
      </div>
    </div>`;

    const railPanel = journeyReady ? `<div class="panel">
      <div class="panel-head">
        <h3 class="panel-title">Your ESG journey</h3>
        <span class="panel-meta">${esc(j.counts.completed)} of ${esc(j.total_stages)} stages</span>
      </div>
      <div class="panel-body">
        ${view.rail(j.stages, { compact: true })}
        <!-- No sentence explaining what "Blocked" means. journeyView renders
             each blocked stage's own reason on the node itself, which says it
             at the place it applies to instead of in a general note above the
             fold. Run 56, §3.-1. -->
        <p><a class="btn btn-outline btn-sm" href="/journey">Open the journey</a></p>
      </div>
    </div>` : '';

    /* ── ROW C · review queue, roadmap, green finance ───────────────────── */

    // THE COUNTS ARE .tag, NOT .chip, AND THAT IS A DELIBERATE DEVIATION from
    // the brief. §52's own header draws the line: ".tag is a LABEL — it
    // describes something. A chip is a CONTROL: it is pressed, it has an active
    // state." Nothing on this deployment filters a review queue — /documents
    // takes no status parameter and proposals are reviewed per document — so
    // three pressable-looking chips that do not filter would be three dead
    // controls (§4.3c), in the panel whose whole job is to be actioned. The
    // .chip-row is kept, because it is the row layout; the one real control is
    // the link beneath it.
    const missing = a ? Math.max(0, answers.total - answers.done) : 0;
    const reviewPanel = panel('review', 'Review queue', `
      <div class="chip-row">
        <span class="tag">All proposals <b class="chip-count">${esc(props.proposals_live)}</b></span>
        <span class="tag tag-amber">Review required <b class="chip-count">${esc(props.proposals_pending)}</b></span>
        <span class="tag">Unanswered indicators <b class="chip-count">${esc(missing)}</b></span>
      </div>
      ${props.proposals_live > 0
    // ONE SENTENCE, AND IT TELLS THE USER WHAT THEY WILL SEE when they follow
    // the link. The argument for why there is no confidence percentage is a
    // methodology point and it lives in "On the design, not on this page".
    ? `<p class="text-sm">Each proposal carries a verbatim quote from the document it came from.</p>
       <p><a class="btn btn-outline btn-sm" href="/documents">Open evidence to review</a></p>`
    : emptyState(docs.n > 0 ? 'instrumented_but_empty' : 'uninstrumented', {
      title: docs.n > 0 ? 'Nothing waiting for you' : 'No documents to read yet',
      body: docs.n > 0
        ? 'Your documents have been read and no proposal is outstanding. That is a measured '
          + 'result — the queue is empty rather than switched off.'
        : 'Proposals are produced by reading the documents you upload. Nothing has been '
          + 'uploaded, so there is nothing to propose.' })}`);

    const priorityBadge = (p) => `<span class="badge badge-${
      p === 'high' ? 'red' : p === 'medium' ? 'amber' : 'gray'}">${esc(p || 'unrated')}</span>`;

    const roadmapPanel = panel('roadmap', 'Improvement roadmap', recs.length
      ? `${recs.slice(0, 3).map((r) => `<div class="metric-row">
          <span class="metric-row-label">${esc(PILLAR_NAME[r.pillar] || r.pillar || 'General')}</span>
          <span class="flex-1"><span class="tag tag-accent">+${esc(r.points_missed)} points</span>
            ${priorityBadge(r.priority)}</span>
          <span class="metric-row-value">${esc(r.points_missed)}</span>
        </div>
        <p class="text-sm">${esc(r.narrative_en)}${
  r.source === 'fallback_template' ? ' — written offline; the model was unavailable.' : ''}</p>`).join('')}
      <!-- The paragraph that stood here explained that the engine computes the
           points, that the model never writes a number, and that there is
           deliberately no progress bar. All three are true, none of them is
           something the owner of this company needs to read above a list of
           three actions, and the last one is an argument with a design nobody
           on this screen can see. /governance carries the methodology. -->
      <p><a class="btn btn-outline btn-sm" href="/reports">See every recommendation</a></p>`
      : (overall
        ? emptyState('zero', {
          title: 'No gaps worth listing',
          body: 'The engine found nothing above the reporting threshold for this assessment. That '
              + 'is a measured result, not a missing one.' })
        : emptyState('instrumented_but_empty', {
          title: 'Nothing to improve yet',
          body: 'The roadmap is produced when the assessment is scored. It is switched on and '
              + 'working — there is no scored assessment to build it from.' })));

    // TWO KPI TILES, BECAUSE TWO IS WHAT IS REAL. Readiness has not shipped —
    // no table, no route, nothing writes one — so the panel says so by name
    // rather than showing a readiness figure of zero, which would read as
    // "assessed and found wanting" instead of "not built".
    const greenPanel = panel('green', 'Green finance', `
      <div class="grid-12 grid--dense">
        <div class="col-6"><div class="kpi-tile">
          <span class="kpi-tile-icon" aria-hidden="true">🌿</span>
          <span><span class="kpi-tile-value">${esc(green.projects)}</span>
            <span class="kpi-tile-label">${green.projects === 1 ? 'project defined' : 'projects defined'}</span></span>
        </div></div>
        <div class="col-6"><div class="kpi-tile">
          <span class="kpi-tile-icon" aria-hidden="true">🏦</span>
          <span><span class="kpi-tile-value">${esc(register.products)}</span>
            <span class="kpi-tile-label">products on the register</span></span>
        </div></div>
      </div>
      ${green.projects > 0
    // Same judgement as the score panel. With projects on file the panel is
    // populated, so the missing MATCHING is a footnote; with none it is the
    // whole state of the region and gets the full named empty state.
    ? `<p class="text-sm text-muted">Nothing matches you to a product yet — readiness is not built,
         so a match shown now would be a guess.</p>`
    : emptyState('uninstrumented', {
      title: 'Nothing matches you to a product yet',
      body: 'The register is a public reference list and the projects are yours. Nothing joins the '
          + 'two — readiness is not built, so no product here has been assessed against your '
          + 'position, and a match shown now would be a guess.' })}
      <p><a class="btn btn-outline btn-sm" href="/green-finance">Open green finance</a></p>`);

    /* ── ROW D · evidence and carbon ────────────────────────────────────── */
    const DOC_STATUS = {
      pending: ['Not analysed', 'badge'],
      extracting: ['Reading…', 'badge badge-amber'],
      extracted: ['Text extracted', 'badge badge-green'],
      no_text_layer: ['No text layer', 'badge badge-amber'],
      failed: ['Could not read', 'badge badge-red'],
    };

    const evidencePanel = panel('evidence', 'Evidence', docs.n > 0
      ? `${recentDocs.map((d) => {
        const [label, cls] = DOC_STATUS[d.text_status] || ['Unknown state', 'badge'];
        return `<div class="file-row">
          <span class="file-row-icon" aria-hidden="true">📄</span>
          <span class="file-row-main">
            <span class="file-row-name">${esc(d.filename)}</span>
            <span class="file-row-meta">${esc(fileSize(d.byte_size))}</span>
          </span>
          <span class="file-row-status"><span class="${cls}">${esc(label)}</span></span>
        </div>`;
      }).join('')}
      <p class="text-sm">${esc(docs.n)} ${docs.n === 1 ? 'document' : 'documents'} on file ·
         ${esc(fileSize(docs.bytes))} in total${
  docs.n > recentDocs.length ? ` · the ${esc(recentDocs.length)} most recent shown` : ''}.</p>
      <p><a class="btn btn-outline btn-sm" href="/documents">Open evidence</a></p>`
      : emptyState('instrumented_but_empty', {
        title: 'No documents yet',
        body: 'Uploading is switched on and working — nothing has been uploaded. Documents are '
            + 'what the assessment draws its evidence from, so this is where the shortest path '
            + 'to a score begins.' })
        + '<p><a class="btn btn-primary" href="/documents">Upload a document</a></p>');

    const carbonPanel = panel('carbon', 'Carbon', carbon.entries > 0
      ? `<div class="grid-12 grid--dense">
        <div class="col-6"><div class="kpi-tile">
          <span class="kpi-tile-icon" aria-hidden="true">📊</span>
          <span><span class="kpi-tile-value">${esc(carbon.entries)}</span>
            <span class="kpi-tile-label">${carbon.entries === 1 ? 'entry on file' : 'entries on file'}</span></span>
        </div></div>
        <div class="col-6"><div class="kpi-tile">
          <span class="kpi-tile-icon" aria-hidden="true">🕓</span>
          <span><span class="kpi-tile-value">${esc(carbon.provisional)}</span>
            <span class="kpi-tile-label">provisional</span></span>
        </div></div>
      </div>
      <p class="text-sm">Covering ${esc(String(carbon.period_from).slice(0, 10))} to
         ${esc(String(carbon.period_to).slice(0, 10))}.${carbon.provisional > 0
    ? ' A provisional entry used an unverified factor and can be recomputed.'
    : ' Every entry used a verified factor.'}</p>
      <p><a class="btn btn-outline btn-sm" href="/carbon">Open carbon</a></p>`
      : emptyState('instrumented_but_empty', {
        title: 'No energy or fuel data yet',
        body: 'The factors are loaded and the calculator is working — you have not entered a '
            + 'period. Nothing is estimated on your behalf, so there is no provisional figure '
            + 'standing in for one.' })
        + '<p><a class="btn btn-primary" href="/carbon">Record a period</a></p>');

    /* ── what the mock shows and this page will not ───────────────────────
       THE INDUSTRY COMPARISON IS THE FIRST THING IN HERE, and it is a full
       named empty state rather than a table row or a line under the score.
       Annotation §1.1 calls it the most dangerous element on the mock and
       requires it NAMED rather than hidden — emptyState('uninstrumented') is
       exactly the instrument for that, and this card is the page's own register
       of absences, so the block is the right size for what it says here in a
       way it was not in the score panel. The other five stay as table rows:
       they are shorter facts and a wall of five empty states would be the same
       mistake at five times the volume. */
    const notShown = `<div class="card">
      <div class="card-header"><h3 class="card-title">On the design, not on this page</h3></div>
      <div class="card-body">
        ${emptyState('uninstrumented', {
    title: 'No industry comparison',
    body: 'Nothing writes a peer cohort and no industry group is recorded, so there is no industry '
        + 'to compare you against — it is not switched on rather than empty. Even once it exists, a '
        + 'percentile must never be computable back to one competitor\'s score, so it needs opt-in '
        + 'and a minimum cohort size before it could be shown at all.' })}
        <div class="table-wrap"><table>
          <thead><tr><th>Element</th><th>Why it is not here</th></tr></thead>
          <tbody>
            <tr><td>Your impact on the four pillars</td>
                <td>No published methodology maps company activity to a pillar. Claiming a
                    contribution level would attribute a mapping to an organisation that has
                    authored none.</td></tr>
            <tr><td>AI confidence percentage</td>
                <td>There is deliberately no confidence column. What exists is stronger: a verbatim
                    quote checked against the document, or the proposal is discarded before you
                    see it.</td></tr>
            <tr><td>ESG certification</td>
                <td>No certification scheme is published. This platform assesses; it does not
                    certify, and it will not render a downloadable certificate.</td></tr>
            <tr><td>Expert consultation</td>
                <td>Not built. A button that opens nothing is worse than an absent feature, because
                    you would believe the capability exists and stop looking.</td></tr>
          </tbody>
        </table></div>
      </div>
    </div>`;

    // THE ORDER IS THE DESIGN DECISION. With a score, the mock's order stands
    // and the score takes the wider column. Without one, the rail leads AND
    // takes .col-7 — it is the only block fully populated on day one, and it
    // answers both "where am I" and "what next" when nothing else can.
    const rowB = overall
      ? `<div class="grid-12 reveal">
          <div class="col-7">${scorePanel}</div>
          <div class="col-5">${railPanel}</div>
        </div>`
      : `<div class="grid-12 reveal">
          <div class="col-7">${railPanel}</div>
          <div class="col-5">${scorePanel}</div>
        </div>`;

    const rowC = `<div class="grid-12 reveal">
      <div class="col-4">${reviewPanel}</div>
      <div class="col-4">${roadmapPanel}</div>
      <div class="col-4">${greenPanel}</div>
    </div>`;

    const rowD = `<div class="grid-12 reveal">
      <div class="col-6">${evidencePanel}</div>
      <div class="col-6">${carbonPanel}</div>
      <div class="col-12">${notShown}</div>
    </div>`;

    const body = overall
      ? `${statCards}${rowB}${rowC}${rowD}`
      : `${rowB}${statCards}${rowC}${rowD}`;

    res.send(layout('Dashboard', body, req.user, '/dashboard'));
  } catch (err) { next(err); }
});

// ── Company profile ────────────────────────────────────────────────────────
router.get('/company', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, ssm_number, msic_code, industry_label, employee_count,
              annual_revenue_myr, state, grid_region, esg_maturity
         FROM esg_companies WHERE id = $1`, [companyIdOf(req)]);
    const c = rows[0] || {};
    const opt = (v, cur, label) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(label)}</option>`;
    res.send(layout('Company Profile', `
      <form class="card" method="post" action="/company">
        <div class="form-group"><label for="name">Company name</label>
          <input id="name" name="name" value="${esc(c.name || '')}" required></div>
        <div class="form-group"><label for="ssm_number">SSM registration number</label>
          <input id="ssm_number" name="ssm_number" value="${esc(c.ssm_number || '')}"></div>
        <div class="form-group"><label for="msic_code">MSIC code</label>
          <input id="msic_code" name="msic_code" value="${esc(c.msic_code || '')}"></div>
        <div class="form-group"><label for="employee_count">Number of employees</label>
          <input id="employee_count" name="employee_count" type="number" min="0" value="${esc(c.employee_count ?? '')}"></div>
        <div class="form-group"><label for="annual_revenue_myr">Annual revenue (RM)</label>
          <input id="annual_revenue_myr" name="annual_revenue_myr" type="number" min="0" step="0.01" value="${esc(c.annual_revenue_myr ?? '')}"></div>
        <div class="form-group"><label for="grid_region">Electricity grid</label>
          <select id="grid_region" name="grid_region" required>
            <option value="">Select…</option>
            ${opt('peninsular', c.grid_region, 'Peninsular Malaysia (TNB)')}
            ${opt('sabah', c.grid_region, 'Sabah &amp; Labuan (SESB)')}
            ${opt('sarawak', c.grid_region, 'Sarawak (Sarawak Energy)')}
          </select>
          <small class="text-muted">Required for Scope 2. The three grids differ by up to 3.7x, so this cannot be defaulted.</small></div>
        <button class="btn btn-primary" type="submit">Save</button>
      </form>`, req.user, '/company'));
  } catch (err) { next(err); }
});

router.post('/company', async (req, res, next) => {
  try {
    const b = req.body;
    const grid = ['peninsular', 'sabah', 'sarawak'].includes(b.grid_region) ? b.grid_region : null;
    await query(
      `UPDATE esg_companies SET name=$2, ssm_number=NULLIF($3,''), msic_code=NULLIF($4,''),
              employee_count=$5, annual_revenue_myr=$6, grid_region=$7
        WHERE id=$1`,
      [companyIdOf(req), String(b.name || '').trim(), String(b.ssm_number || '').trim(),
       String(b.msic_code || '').trim(), num(b.employee_count), num(b.annual_revenue_myr), grid]);
    res.redirect('/company');
  } catch (err) { next(err); }
});

// ── Assessment ─────────────────────────────────────────────────────────────
router.get('/assessment', async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    // Every selectable framework, with the number of questions each actually
    // carries. A name and a version alone do not tell a company what it is
    // committing to answering — 40 maturity questions and 38 disclosures are
    // very different undertakings.
    const { rows: frameworkChoices } = await query(
      `SELECT f.id, f.code, f.version, count(i.id)::int AS n
         FROM esg_frameworks f
         LEFT JOIN esg_indicators i ON i.framework_id = f.id AND i.is_active
        WHERE f.framework_kind = 'entity_disclosure' AND f.is_active
        GROUP BY f.id, f.code, f.version
        ORDER BY f.code`);

    const { rows } = await query(
      `SELECT a.id, a.reporting_year, a.status, a.framework_code, a.framework_version,
              (SELECT score_0_100 FROM esg_scores s WHERE s.assessment_id = a.id AND s.scope='OVERALL') AS overall
         FROM esg_assessments a WHERE a.company_id = $1 AND a.status <> 'archived'
        ORDER BY a.reporting_year DESC`, [cid]);
    const list = rows.length ? `<table><thead><tr>
        <th>Year</th><th>Framework</th><th>Status</th><th>Score</th><th></th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${esc(r.reporting_year)}</td>
          <td>${esc(frameworkLabel(r.framework_code, r.framework_version))}</td>
          <td><span class="badge">${esc(r.status)}</span></td>
          <td>${r.overall === null || r.overall === undefined ? '—' : esc(r.overall)}</td>
          <td><a class="btn btn-outline" href="/assessment/${esc(r.id)}">Open</a></td></tr>`).join('')}
        </tbody></table>` : emptyState('instrumented_but_empty', { title: 'No assessments yet' });

    res.send(layout('ESG Assessment', `
      <div class="card"><h3>Start an assessment</h3>
        <form method="post" action="/assessment" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
          <div class="form-group" style="margin:0"><label for="framework_id">Framework</label>
            <select id="framework_id" name="framework_id" required>
              <option value="">— choose a framework —</option>
              ${frameworkChoices.map((fw) => `<option value="${esc(fw.id)}">${esc(frameworkLabel(fw.code, fw.version))} · ${esc(fw.n)} questions</option>`).join('')}
            </select></div>
          <div class="form-group" style="margin:0"><label for="year">Reporting year</label>
            <input id="year" name="reporting_year" type="number" min="2015" max="2100"
                   value="${new Date().getFullYear() - 1}" required></div>
          <button class="btn btn-primary" type="submit">Create</button>
        </form>
        <small class="text-muted">The framework is stamped on the assessment when it is created and
        does not change afterwards — that is what stops a later switch from rescoring answers you
        have already given.</small></div>
      <div class="table-wrap" style="margin-top:16px">${list}</div>`, req.user, '/assessment'));
  } catch (err) { next(err); }
});

router.post('/assessment', async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const year = parseInt(req.body.reporting_year, 10);
    if (!Number.isInteger(year)) return res.redirect('/assessment');

    // RULE 6. The framework is an explicit CHOICE now, not the first row of an
    // ORDER BY. A request naming nothing, or naming something inactive or
    // nonexistent, is refused — never quietly given a substitute. A user who
    // believed they were assessing against SEDG and silently received the Modus
    // 40 could not tell from any screen afterwards; the score, the questions and
    // the report would all be internally consistent and all be the wrong thing.
    const chosen = String(req.body.framework_id || '').trim();
    if (!chosen) {
      return res.status(400).send(layout('Choose a framework',
        emptyState('zero', { title: 'No framework was chosen',
          body: 'An assessment is scored against one specific framework, so it cannot be created until you pick one. Nothing was saved.' }),
        req.user, '/assessment'));
    }

    const { rows: f } = await query(
      `SELECT id, code, version FROM esg_frameworks
        WHERE id = $1 AND framework_kind = 'entity_disclosure' AND is_active`, [chosen]);
    if (!f[0]) {
      return res.status(400).send(layout('Unknown framework',
        emptyState('zero', { title: 'That framework is not available',
          body: 'It does not exist, or it is not currently active. Nothing was created — choose one from the list.' }),
        req.user, '/assessment'));
    }
    const scheme = await loadActiveScheme();

    const { rows } = await query(
      `INSERT INTO esg_assessments
         (company_id, framework_id, framework_code, framework_version,
          weighting_scheme_id, weighting_version, reporting_year, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (company_id, framework_id, reporting_year) WHERE status <> 'archived'
       DO UPDATE SET updated_at = now()
       RETURNING id`,
      [cid, f[0].id, f[0].code, f[0].version, scheme.id, scheme.version, year, req.user.id]);
    res.redirect(`/assessment/${rows[0].id}`);
  } catch (err) { next(err); }
});

router.get('/assessment/:id', async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const { rows: a } = await query(
      `SELECT id, framework_id, framework_code, framework_version, reporting_year, status
         FROM esg_assessments WHERE id = $1 AND company_id = $2`, [req.params.id, cid]);
    if (!a[0]) return res.status(404).send(layout('Not found',
      emptyState('zero', { title: 'Assessment not found', body: 'It may belong to another company.' }), req.user, '/assessment'));

    const [{ rows: inds }, { rows: resp }] = await Promise.all([
      query(`SELECT id, code, pillar, tier, question_en, guidance_en, response_type, unit,
                    weight, allows_na, mapping_status, line_items
               FROM esg_indicators WHERE framework_id = $1 AND is_active ORDER BY pillar, sort_order`,
            [a[0].framework_id]),
      query(`SELECT indicator_id, option_code, value_numeric, value_text, value_json, is_na, evidence_tier
               FROM esg_responses WHERE assessment_id = $1`, [req.params.id]),
    ]);
    const byInd = Object.fromEntries(resp.map((r) => [r.indicator_id, r]));

    // A SEDG disclosure is answered part by part. The parts come from
    // esg_indicators.line_items, so the SHAPE is data and this renderer needs
    // no per-indicator knowledge.
    //
    // Field names are FLAT — dv_<id>__<index> and dn_<id>__<index> — for two
    // reasons: express.urlencoded runs with extended:false here, so bracket
    // nesting would not parse at all; and the part labels contain spaces and
    // parentheses ("Heating (if applicable)"), which have no business in a
    // form field name. The index is the position in line_items, and the label
    // is looked up from the indicator on the way back in.
    //
    // A part labelled "Nature" takes free text; every other part takes a
    // number. That is a property of the data — the three compound disclosures
    // (S1.1, G4.1, G5.1) all carry line_items ["Number","Nature"] — not a list
    // of exempt indicators, so it does not grow by one every time (#13).
    const isNarrativePart = (label) => String(label).toLowerCase() === 'nature';

    const disclosureField = (i, r) => {
      const parts = Array.isArray(i.line_items) ? i.line_items : null;
      const vj = (r.value_json && typeof r.value_json === 'object') ? r.value_json : {};

      // No fixed parts: an open list. Non-empty text is a complete disclosure.
      if (!parts || parts.length === 0) {
        const text = typeof vj.text === 'string' ? vj.text : (r.value_text || '');
        return `<textarea name="dt_${esc(i.id)}" rows="3"
                  placeholder="${esc(i.unit || 'One per line')}">${esc(text)}</textarea>`;
      }

      const answered = (vj.parts && typeof vj.parts === 'object') ? vj.parts : {};
      return `<div style="display:flex;flex-direction:column;gap:6px">${parts.map((label, idx) => {
        const part = answered[label] || {};
        const isNa = part.na === true;
        // Zero is a real disclosure. `?? ''` keeps 0 rendered as "0"; a truthy
        // test here would blank it and silently turn a disclosure into a gap.
        const val = part.value ?? '';
        const input = isNarrativePart(label)
          ? `<input name="dv_${esc(i.id)}__${idx}" type="text"
                    value="${esc(val)}" placeholder="${esc(label)}"${isNa ? ' disabled' : ''}>`
          : `<input name="dv_${esc(i.id)}__${idx}" type="number" step="any" min="0"
                    value="${esc(val)}" placeholder="${esc(i.unit || '')}"${isNa ? ' disabled' : ''}>`;
        return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span style="flex:1;min-width:160px;font-size:13px">${esc(label)}</span>
          <span style="flex:1;min-width:140px">${input}</span>
          <label style="display:flex;align-items:center;gap:4px;font-size:12px">
            <input type="checkbox" name="dn_${esc(i.id)}__${idx}"${isNa ? ' checked' : ''}> N/A</label>
        </div>`;
      }).join('')}</div>`;
    };

    const field = (i) => {
      const r = byInd[i.id] || {};
      const sel = (v) => (String(r.option_code) === v ? ' selected' : '');
      if (i.response_type === 'disclosure') return disclosureField(i, r);
      if (i.response_type === 'quantitative') {
        return `<input name="v_${i.id}" type="number" step="any" min="0"
                  value="${esc(r.value_numeric ?? '')}" placeholder="${esc(i.unit || '')}">`;
      }
      if (i.response_type === 'maturity_0_4') {
        return `<select name="o_${i.id}"><option value="">Not answered</option>
          ${[0, 1, 2, 3, 4].map((n) => `<option value="${n}"${sel(String(n))}>Level ${n}</option>`).join('')}</select>`;
      }
      if (i.response_type === 'yes_no') {
        return `<select name="o_${i.id}"><option value="">Not answered</option>
          <option value="yes"${sel('yes')}>Yes</option><option value="no"${sel('no')}>No</option></select>`;
      }
      return `<select name="o_${i.id}"><option value="">Not answered</option>
        <option value="yes"${sel('yes')}>Yes</option>
        <option value="partial"${sel('partial')}>Partially</option>
        <option value="no"${sel('no')}>No</option></select>`;
    };

    // Trap F's user-visible half: only 'draft' rendered a badge, so the 38
    // rows whose text IS the publisher's — mapping_status='official' — showed
    // no provenance at all and looked identical to an unreconciled one. All
    // three states render now.
    const mappingBadge = (status) => {
      if (status === 'draft') return '<span class="badge badge-amber" title="Platform-authored mapping, not yet reconciled against the official framework document">draft</span>';
      if (status === 'official') return '<span class="badge badge-green" title="Verbatim from the publisher\'s own document">official</span>';
      if (status === 'reconciled') return '<span class="badge" title="Platform-authored, checked against the official framework document">reconciled</span>';
      return '';
    };

    const section = (p, title) => {
      const list = inds.filter((i) => i.pillar === p);
      if (!list.length) return '';
      return `<div class="card" style="margin-bottom:16px"><h3>${esc(title)}</h3>
        ${list.map((i) => {
          const r = byInd[i.id] || {};
          return `<div class="form-group" style="border-top:1px solid var(--border);padding-top:14px">
            <label for="o_${esc(i.id)}"><strong>${esc(i.code)}</strong> ${esc(i.question_en)}
              ${mappingBadge(i.mapping_status)}
            </label>
            ${i.guidance_en ? `<small class="text-muted">${esc(i.guidance_en)}</small>` : ''}
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">
              <div style="flex:2;min-width:180px">${field(i)}</div>
              <div style="flex:1;min-width:150px">
                <select name="e_${esc(i.id)}" aria-label="Evidence level">
                  <option value="self_declared"${r.evidence_tier === 'self_declared' || !r.evidence_tier ? ' selected' : ''}>Self-declared</option>
                  <option value="documented"${r.evidence_tier === 'documented' ? ' selected' : ''}>Documented</option>
                  <option value="verified"${r.evidence_tier === 'verified' ? ' selected' : ''}>Third-party verified</option>
                </select></div>
              ${i.allows_na ? `<label style="display:flex;align-items:center;gap:6px;font-size:13px">
                <input type="checkbox" name="na_${esc(i.id)}"${r.is_na ? ' checked' : ''}> Not applicable</label>` : ''}
            </div></div>`;
        }).join('')}</div>`;
    };

    res.send(layout(`Assessment ${a[0].reporting_year}`, `
      <div class="ai-insight" style="margin-bottom:16px">
        <strong>How this is scored.</strong> Answers marked <em>self-declared</em> earn 60% of the
        available points, <em>documented</em> 85%, <em>third-party verified</em> 100%. That is
        deliberate: a screening that awards full marks for unevidenced self-assessment is worth
        nothing to the bank or buyer reading it. Attaching documents you already hold is the
        cheapest way to raise your score.
      </div>
      <form method="post" action="/assessment/${esc(a[0].id)}">
        ${section('E', 'Environmental')}${section('S', 'Social')}${section('G', 'Governance')}
        <div style="display:flex;gap:12px">
          <button class="btn btn-primary" type="submit" name="action" value="save">Save</button>
          <button class="btn btn-primary" type="submit" name="action" value="submit">Save &amp; calculate score</button>
        </div>
      </form>`, req.user, '/assessment'));
  } catch (err) { next(err); }
});

router.post('/assessment/:id', async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const { rows: a } = await query(
      `SELECT id, framework_id FROM esg_assessments WHERE id = $1 AND company_id = $2`,
      [req.params.id, cid]);
    if (!a[0]) return res.status(404).send('Not found');

    const { rows: inds } = await query(
      `SELECT id, response_type, allows_na, line_items FROM esg_indicators WHERE framework_id = $1 AND is_active`,
      [a[0].framework_id]);

    for (const i of inds) {
      const isNa   = i.allows_na && Boolean(req.body[`na_${i.id}`]);
      const opt    = req.body[`o_${i.id}`];
      const valRaw = req.body[`v_${i.id}`];
      const val    = num(valRaw);
      const tier   = ['self_declared', 'documented', 'verified'].includes(req.body[`e_${i.id}`])
                     ? req.body[`e_${i.id}`] : 'self_declared';

      // ── disclosure ────────────────────────────────────────────────────────
      // Persisted as jsonb rather than through value_numeric, because one
      // response carries up to six parts. The three states a part can be in —
      // disclosed (including ZERO), not applicable, and simply unanswered —
      // must stay distinguishable here or the engine cannot tell them apart
      // either, and a company reporting 0 tonnes of hazardous waste would be
      // scored as if it had not answered.
      if (i.response_type === 'disclosure') {
        const parts = Array.isArray(i.line_items) ? i.line_items : null;
        let payload = null;
        let has = false;

        if (!parts || parts.length === 0) {
          const text = String(req.body[`dt_${i.id}`] ?? '').trim();
          if (text !== '') { payload = { text }; has = true; }
        } else {
          const bag = {};
          parts.forEach((label, idx) => {
            const na  = Boolean(req.body[`dn_${i.id}__${idx}`]);
            const raw = req.body[`dv_${i.id}__${idx}`];
            if (na) { bag[label] = { na: true }; has = true; return; }
            if (raw === undefined || String(raw).trim() === '') return;   // unanswered
            const n = Number(String(raw).trim());
            // Number('') is 0, which is why the empty check happens first.
            bag[label] = { value: Number.isFinite(n) ? n : String(raw).trim() };
            has = true;
          });
          if (has) payload = { parts: bag };
        }

        if (!has && !isNa) {
          await query(`DELETE FROM esg_responses WHERE assessment_id=$1 AND indicator_id=$2`, [a[0].id, i.id]);
          continue;
        }
        await query(
          `INSERT INTO esg_responses (assessment_id, indicator_id, value_json, is_na, evidence_tier, answered_by)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (assessment_id, indicator_id) DO UPDATE SET
             value_json = EXCLUDED.value_json, is_na = EXCLUDED.is_na,
             evidence_tier = EXCLUDED.evidence_tier, answered_by = EXCLUDED.answered_by`,
          [a[0].id, i.id, payload === null ? null : JSON.stringify(payload), isNa, tier, req.user.id]);
        continue;
      }

      const answered = isNa || (opt !== undefined && opt !== '') || val !== null;
      if (!answered) {
        await query(`DELETE FROM esg_responses WHERE assessment_id=$1 AND indicator_id=$2`, [a[0].id, i.id]);
        continue;
      }
      await query(
        `INSERT INTO esg_responses (assessment_id, indicator_id, option_code, value_numeric, is_na, evidence_tier, answered_by)
         VALUES ($1,$2,NULLIF($3,''),$4,$5,$6,$7)
         ON CONFLICT (assessment_id, indicator_id) DO UPDATE SET
           option_code = EXCLUDED.option_code, value_numeric = EXCLUDED.value_numeric,
           is_na = EXCLUDED.is_na, evidence_tier = EXCLUDED.evidence_tier, answered_by = EXCLUDED.answered_by`,
        [a[0].id, i.id, opt === undefined ? '' : String(opt), val, isNa, tier, req.user.id]);
    }

    if (req.body.action === 'submit') {
      await query(`UPDATE esg_assessments SET status='submitted', submitted_at=now() WHERE id=$1`, [a[0].id]);
      await scoreAssessment(a[0].id);
      // AI phrasing is best-effort and must never block the score. The engine
      // has already written every figure by this point.
      generateRecommendations(a[0].id, { companyId: cid, userId: req.user.id })
        .catch((e) => console.error('recommendations:', e.message));
      return res.redirect('/dashboard');
    }
    res.redirect(`/assessment/${a[0].id}`);
  } catch (err) { next(err); }
});

// ── Carbon ─────────────────────────────────────────────────────────────────
router.get('/carbon', async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const [{ rows: co }, { rows: entries }] = await Promise.all([
      query(`SELECT grid_region FROM esg_companies WHERE id=$1`, [cid]),
      query(`SELECT id, period_start, period_end, scope, category, activity_amount, activity_unit,
                    kg_co2e, factor_value_used, factor_version_used, factor_source_used,
                    factor_verification_used, is_provisional
               FROM esg_carbon_entries WHERE company_id=$1 ORDER BY period_start DESC LIMIT 50`, [cid]),
    ]);
    const grid = co[0] && co[0].grid_region;

    const table = entries.length ? `<table><thead><tr>
      <th>Period</th><th>Scope</th><th>Activity</th><th>Factor</th><th>kg CO2e</th></tr></thead><tbody>
      ${entries.map((e) => `<tr${e.is_provisional ? ' class="provisional"' : ''}>
        <td>${esc(e.period_start)} → ${esc(e.period_end)}</td>
        <td>Scope ${esc(e.scope)}</td>
        <td>${esc(e.activity_amount)} ${esc(e.activity_unit)}</td>
        <td><small>${esc(e.factor_value_used)} · v${esc(e.factor_version_used)}
          ${e.is_provisional ? '<span class="badge badge-amber">provisional</span>' : ''}</small></td>
        <td><strong>${esc(e.kg_co2e)}</strong></td></tr>`).join('')}
      </tbody></table>` : emptyState('instrumented_but_empty', { title: 'No carbon entries yet' });

    res.send(layout('Carbon', `
      ${!grid ? `<div class="ai-insight"><strong>Set your electricity grid first.</strong>
        Scope 2 cannot be calculated without it — Peninsular and Sarawak factors differ by 3.7x.
        <a href="/company">Company profile →</a></div>` : `
      <div class="card"><h3>Add an entry</h3>
        <a href="/carbon/import" class="btn btn-outline" style="float:right">🤖 Bulk Import (Excel)</a>
        <form method="post" action="/carbon" style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
          <div class="form-group" style="margin:0"><label for="kind">Type</label>
            <select id="kind" name="kind">
              <option value="electricity">Electricity (Scope 2)</option>
              <option value="FUEL_DIESEL">Diesel (Scope 1)</option>
              <option value="FUEL_PETROL">Petrol (Scope 1)</option>
            </select></div>
          <div class="form-group" style="margin:0"><label for="amount">Amount</label>
            <input id="amount" name="amount" type="number" step="any" min="0" required></div>
          <div class="form-group" style="margin:0"><label for="period_start">From</label>
            <input id="period_start" name="period_start" type="date" required></div>
          <div class="form-group" style="margin:0"><label for="period_end">To</label>
            <input id="period_end" name="period_end" type="date" required></div>
          <div style="display:flex;align-items:flex-end"><button class="btn btn-primary" type="submit">Add</button></div>
        </form>
        <small class="text-muted">Diesel and petrol factors are placeholders pending a sourced Malaysian
        figure. Entries using them are stored and shown, and marked provisional — never presented as verified.</small>
      </div>`}
      <div class="table-wrap" style="margin-top:16px">${table}</div>`, req.user, '/carbon'));
  } catch (err) { next(err); }
});

router.post('/carbon', async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const { rows: co } = await query(`SELECT grid_region FROM esg_companies WHERE id=$1`, [cid]);
    const amount = num(req.body.amount);
    if (amount === null || amount < 0) return res.redirect('/carbon');

    const calc = req.body.kind === 'electricity'
      ? await electricityToCo2e(amount, co[0] && co[0].grid_region)
      : await fuelToCo2e(amount, req.body.kind);

    await query(
      `INSERT INTO esg_carbon_entries
         (company_id, period_start, period_end, scope, category, activity_amount, activity_unit,
          factor_id, factor_value_used, factor_version_used, factor_source_used,
          factor_verification_used, is_provisional, kg_co2e, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [cid, req.body.period_start, req.body.period_end,
       req.body.kind === 'electricity' ? 2 : 1,
       req.body.kind === 'electricity' ? 'grid_electricity' : 'mobile_combustion',
       calc.activity_amount, calc.activity_unit, calc.factor_id, calc.factor_value_used,
       calc.factor_version_used, calc.factor_source_used, calc.factor_verification_used,
       calc.is_provisional, calc.kg_co2e, req.user.id]);
    res.redirect('/carbon');
  } catch (err) { next(err); }
});

// ── Verra ──────────────────────────────────────────────────────────────────
router.get('/governance', async (req, res, next) => {
  try {
    const status = await mirrorStatus();
    const q = String(req.query.q || '').trim();
    let results = [];
    if (q) {
      const { rows } = await query(
        `SELECT verra_project_id, name, country, methodology_code, status
           FROM esg_verra_projects
          WHERE name ILIKE $1 OR country ILIKE $1 OR methodology_code ILIKE $1
          ORDER BY name LIMIT 50`, [`%${q}%`]);
      results = rows;
    }
    const body = status.state === 'populated'
      ? `<form method="get" style="display:flex;gap:10px;margin-bottom:16px;align-items:flex-end">
           <div class="form-group" style="margin:0;flex:1">
             <label for="verra-q">Search the registry mirror</label>
             <input id="verra-q" name="q" value="${esc(q)}" placeholder="Project, country or methodology">
           </div>
           <button class="btn btn-primary">Search</button></form>
         ${q ? (results.length ? `<table><thead><tr><th>ID</th><th>Name</th><th>Country</th><th>Methodology</th><th>Status</th></tr></thead><tbody>
            ${results.map((r) => `<tr><td>${esc(r.verra_project_id)}</td><td>${esc(r.name)}</td>
              <td>${esc(r.country)}</td><td>${esc(r.methodology_code)}</td><td>${esc(r.status)}</td></tr>`).join('')}
            </tbody></table>
            <small class="text-sm">Records mirrored from a public carbon crediting registry. Metadata and links only.</small>`
          : emptyState('zero', { title: 'No matches', body: `Nothing in the mirror matches "${q}".` })) : ''}`
      : emptyState(status.state, {
          title: status.state === 'uninstrumented' ? 'Registry mirror is not switched on' : 'Registry mirror is empty',
          body: status.state === 'uninstrumented'
            ? 'Registry ingest has not been configured, so nothing writes to this table yet. See the deployment notes for the environment variables it needs.'
            : 'Ingest is configured and working — the sync has not run yet or returned no records.' });

    res.send(layout('Governance & Recognition', `
      <div class="card">
        <h3 class="card-title">Governance &amp; Recognition</h3>
        <p><strong>Registration.</strong> The Malaysia SMEs ESG e-Reporting System is
        registered under the SMEs Sustainable Entrepreneur Organisation (SSEO) as the
        official platform for participating SME organisations and ESG reporting
        initiatives.</p>
        <p><strong>Platform owner.</strong> SMEs Sustainable Entrepreneur Organisation (SSEO).
        SSEO owns the assessment framework this platform runs on and is the body that
        revises it — a new version is issued as a new framework record, never an edit
        to the one companies have already been scored against.</p>
        <p class="text-sm">Scores carry the framework version, the weighting version and
        the engine version that produced them, so any result on this platform can be traced
        back to the exact rules in force when it was calculated.</p>
      </div>

      <div class="card">
        <h3 class="card-title">Purpose</h3>
        <p class="text-sm">The platform aims to:</p>
        <ul>
          <li>Accelerate ESG adoption among Malaysian SMEs.</li>
          <li>Simplify ESG reporting through a user-friendly digital system.</li>
          <li>Enhance ESG readiness for local and international supply chains.</li>
          <li>Support access to sustainable finance and ESG-linked opportunities.</li>
          <li>Strengthen SME competitiveness through improved governance and sustainability
              practices.</li>
        </ul>
      </div>

      <!-- OBJECTIVES ARE NOT A FEATURE LIST.
           Two of the eight — peer benchmarking and report generation — describe
           capability that renders an uninstrumented empty state today. They are
           what the source document calls objectives, so they are rendered as
           objectives: a prose block of its own, carrying no control, no badge and
           no link to a working screen. A reader who mistakes this for an inventory
           of what is built has been misled by the page, not by the list. Do not
           put a button in this card. -->
      <h3 class="section-title">Platform objectives</h3>
      <div class="card">
        <p class="text-sm">Stated by SSEO for the system as a whole. This is what the
        platform is for — not a description of what this screen does. Where a capability
        is not built yet, the page for it says so in its own words.</p>
        <p class="text-sm">The system supports SMEs to:</p>
        <ul>
          <li>Register and establish their ESG profile.</li>
          <li>Conduct ESG maturity assessments.</li>
          <li>Perform ESG self-reporting.</li>
          <li>Monitor ESG performance through real-time dashboards.</li>
          <li>Generate ESG reports aligned with Malaysian and international frameworks.</li>
          <li>Benchmark performance against industry peers.</li>
          <li>Receive AI-driven recommendations for continuous improvement.</li>
          <li>Prepare for external verification, certification, and investor or customer
              due diligence.</li>
        </ul>
      </div>

      <div class="card">
        <h3 class="card-title">Where this platform sits</h3>
        <p>This platform produces a <strong>self-declared assessment supported by evidence</strong>.
        It is a starting point, not an endorsement, and it deliberately stops before the
        steps that require an independent party:</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Stage</th><th>Who does it</th><th>Status here</th></tr></thead>
            <tbody>
              <tr><td>1 · Self-assessment against the framework</td><td>The company</td>
                  <td><span class="badge badge-green">This platform</span></td></tr>
              <tr><td>2 · Evidence attached and reviewed by a person</td><td>The company</td>
                  <td><span class="badge badge-green">This platform</span></td></tr>
              <tr><td>3 · Independent verification of the disclosures</td><td>An external assurance provider</td>
                  <td><span class="badge badge-amber">Not part of this platform</span></td></tr>
              <tr><td>4 · Certification against a published standard</td><td>A certification body</td>
                  <td><span class="badge badge-amber">Not part of this platform</span></td></tr>
              <tr><td>5 · Investor or customer due diligence</td><td>The counterparty</td>
                  <td><span class="badge badge-amber">Not part of this platform</span></td></tr>
            </tbody>
          </table>
        </div>
        <p class="text-sm">A score here does not certify anything and is not a substitute for
        stages 3 to 5. It is designed to make those stages cheaper by having the evidence
        already organised against the disclosures a counterparty will ask for.</p>
      </div>

      <div class="card">
        <h3 class="card-title">Stakeholder ecosystem</h3>
        <p><strong>Platform owner</strong> — SMEs Sustainable Entrepreneur Organisation (SSEO)</p>
        <p><strong>Supporting partners</strong></p>
        <ul>
          <li>Universities and Research Institutions</li>
          <li>ESG Consultants</li>
          <li>Professional Bodies</li>
          <li>Financial Institutions</li>
          <li>Technology Providers</li>
          <li>Sustainability Assurance Partners</li>
        </ul>
      </div>

      <div class="card">
        <h3 class="card-title">Expected outcomes</h3>
        <ul>
          <li>Increase ESG adoption among Malaysian SMEs.</li>
          <li>Improve supply-chain sustainability readiness.</li>
          <li>Enhance transparency and governance.</li>
          <li>Enable access to green financing and investment opportunities.</li>
          <li>Support Malaysia's ESG and Sustainable Development Goals (SDGs) agenda.</li>
          <li>Build a nationally recognised digital ESG reporting ecosystem for SMEs.</li>
        </ul>
      </div>

      <h3 class="section-title">Carbon Crediting Registry (public reference)</h3>
      <div class="ai-insight" style="margin-bottom:16px">
        <strong>What this is.</strong> A local mirror of a public carbon-crediting registry, for
        carbon-credit lookup. That registry certifies individual carbon <em>projects</em> and issues
        tradable carbon units — it does not rate companies on E, S and G, so nothing here feeds your
        ESG score. The scoring engine refuses to score against it by design.
        <br><br>
        <strong>What is mirrored, and what is not.</strong> Projects are ingested. Methodology
        records and credit issuances are <em>not</em> — nothing writes those tables, so this page
        shows no count for them rather than a zero that would read as "none exist".
      </div>
      <div class="grid grid-3" style="margin-bottom:16px">
        <div class="stat-card"><div class="stat-label">Projects mirrored</div><div class="stat-value">${esc(status.projects)}</div></div>
        <div class="stat-card"><div class="stat-label">Last fetch</div><div class="stat-value" style="font-size:16px">${status.last_fetch ? esc(new Date(status.last_fetch).toISOString().slice(0, 10)) : '—'}</div></div>
      </div>
      ${body}`, req.user, '/governance'));
  } catch (err) { next(err); }
});

// ── Reports & documents (sprint 2 surfaces, honestly labelled) ─────────────
router.get('/reports', (req, res) => {
  res.send(layout('Reports', emptyState('uninstrumented', {
    title: 'Report generation is not built yet',
    body: 'The scoring data it needs exists. PDF/DOCX/XLSX export is sprint 2 — this page is here so the gap is visible rather than hidden behind a broken button.',
  }), req.user, '/reports'));
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION SCREENS
//
// One navigable screen per requirement section. Each states honestly what it
// is: built, not-instrumented, or not-built. NO DEAD CONTROLS (contract
// §4.3c) — there is no filter that filters nothing, no toggle bound to
// nothing, and no Save that never posts on any page below. If it does not
// act, it does not render.
//
// The scope list on each page is STATIC TEXT describing what the section will
// cover. It is a scope statement, not a claim that any of it works.
// ═══════════════════════════════════════════════════════════════════════════

/** A scope list. Deliberately not a checklist and not a progress bar — both
 *  would imply measured completion that nothing here measures. */
const scope = (title, items) => `
  <div class="card">
    <h3 class="card-title">${esc(title)}</h3>
    <ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
  </div>`;

/** `.coming-soon` — defined at modus-design-system.css:986. Not built at all. */
const comingSoon = (title, body, phase) => `
  <div class="coming-soon">
    <div class="coming-soon-icon">🚧</div>
    <h2>${esc(title)}</h2>
    <p>${esc(body)}</p>
    ${phase ? `<div class="coming-soon-phase">${esc(phase)}</div>` : ''}
  </div>`;

// ── Frameworks — the real one ──────────────────────────────────────────────
router.get('/frameworks', (req, res) => {
  const { PROVENANCE: p, COUNTS: c } = sedg;

  const tierBadge = (tier) => {
    const tone = { Basic: 'badge-green', Intermediate: 'badge-blue', Advanced: 'badge-amber' }[tier] || '';
    return `<span class="badge ${tone}">${esc(tier)}</span>`;
  };

  const pillars = sedg.grouped().map((g) => `
    <div class="card">
      <h3 class="card-title">${esc(g.pillarName)} — ${g.topics.reduce((n, t) => n + t.disclosures.length, 0)} disclosures</h3>
      ${g.topics.map((t) => `
        <h4>${esc(t.topic)}</h4>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Tier</th><th>Disclosure</th><th>Unit</th></tr></thead>
            <tbody>
              ${t.disclosures.map((d) => `<tr>
                <td>${esc(d.code)}${d.newInV2 ? ' <span class="badge badge-blue">new in v2</span>' : ''}</td>
                <td>${tierBadge(d.tier)}</td>
                <td>${esc(d.text)}</td>
                <td>${esc(d.unit)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`).join('')}
    </div>`).join('');

  const others = `
    <div class="card">
      <h3 class="card-title">Other frameworks</h3>
      <p class="text-sm">Named so the gap is visible. None of these is loaded, mapped or scored.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Framework</th><th>Status</th><th>Note</th></tr></thead>
          <tbody>
            ${sedg.OTHER_FRAMEWORKS.map((f) => `<tr>
              <td>${esc(f.name)}</td>
              <td><span class="badge badge-amber">Not loaded</span></td>
              <td>${esc(f.note)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  res.send(layout('Frameworks', `
    <div class="card">
      <h3 class="card-title">${esc(p.document)}</h3>
      <p><strong>Publisher.</strong> ${esc(p.publisher)}, ${esc(p.publisherNote)}. Published ${esc(p.published)}.</p>
      <p><strong>Source.</strong> <a href="${esc(p.pdf)}" rel="noreferrer noopener" target="_blank">${esc(p.pdf)}</a></p>
      <div class="grid grid-3">
        <div class="stat-card"><div class="stat-label">Disclosures</div><div class="stat-value">${c.total}</div></div>
        <div class="stat-card"><div class="stat-label">E / S / G</div><div class="stat-value">${c.pillars.E} / ${c.pillars.S} / ${c.pillars.G}</div></div>
        <div class="stat-card"><div class="stat-label">Basic / Inter. / Adv.</div><div class="stat-value">${c.tiers.Basic} / ${c.tiers.Intermediate} / ${c.tiers.Advanced}</div></div>
      </div>
      <p class="text-sm">${esc(p.countNote)}</p>
    </div>

    <div class="alert">
      <span class="badge badge-amber">SEDG-ALIGNED (DRAFT)</span>
      <p><strong>What this platform claims, precisely.</strong> The assessment you take on this
      platform is <em>${esc(frameworkLabel('MODUS_SEDG_ALIGNED', '0.9-draft'))}</em>. The
      ${c.total} disclosures below are the official published set it will be reconciled against.
      They are <strong>implemented</strong>: all ${c.total} are loaded as questions, answerable in
      the assessment, and scored — <strong>on completeness of disclosure, not on performance</strong>.
      A reported figure has no good or bad; 1,240 tCO2e is neither. What is scored is how much of
      SEDG this company can actually disclose, with a part marked not-applicable leaving the
      denominator rather than counting against you.</p>
      <p>What is still <strong>not</strong> true, stated so it is not assumed:
      SEDG v2.0 is <strong>selectable</strong> — choose it when you start an assessment, and all
      ${c.total} disclosures are what you are asked. It is deliberately not the framework you get
      by default; the default remains
      <em>${esc(frameworkLabel('MODUS_SEDG_ALIGNED', '0.9-draft'))}</em> unless SEDG is chosen;
      there is <strong>no cross-framework mapping</strong> between those 40 questions and these
      ${c.total} disclosures; and <strong>no Bahasa Melayu or 中文 text exists</strong> for them,
      because the official translations are Version 1 and three of these disclosures are new in
      Version 2. This platform is <strong>not SEDG-compliant</strong> and does not claim to be.</p>
    </div>

    ${pillars}
    ${others}`, req.user, '/frameworks'));
});

// ── Analytics — table exists, nothing writes to it ─────────────────────────
router.get('/analytics', (req, res) => {
  res.send(layout('Analytics', `
    ${emptyState('uninstrumented', {
      title: 'Analytics is not instrumented yet',
      body: 'Scores are stored per assessment, but nothing yet writes the time series, peer '
          + 'benchmarks or trend aggregates this section needs. It is not switched on, rather than empty.',
    })}
    ${scope('What this section will cover', [
      'Score trend over time, per pillar and overall',
      'Peer benchmarking by sector and company size',
      'Disclosure completeness against the official framework',
      'Carbon intensity trend against reported activity',
      'Evidence coverage — which answers are documented',
    ])}`, req.user, '/analytics'));
});

// ── KPIs — table exists, nothing writes to it ──────────────────────────────
router.get('/kpis', (req, res) => {
  res.send(layout('KPIs', `
    ${emptyState('uninstrumented', {
      title: 'KPI tracking is not instrumented yet',
      body: 'No target has been set and nothing writes KPI values. An empty chart here would '
          + 'claim a capability that does not exist yet.',
    })}
    ${scope('What this section will cover', [
      'Targets per pillar, set by the company',
      'Actual against target, per reporting period',
      'Emissions intensity and reduction targets',
      'Training hours, turnover and safety rates',
      'Alerting when a KPI moves away from its target',
    ])}`, req.user, '/kpis'));
});

// ── AI Assistant — not built as a standalone surface ───────────────────────
// The AI layer itself IS real and reachable today: `generateRecommendations`
// runs on the assessment result and every call is logged to
// esg_ai_interactions. What does not exist is a conversational assistant, so
// this is coming-soon rather than uninstrumented — and it says where the
// working AI actually is, rather than implying there is none.
router.get('/assistant', (req, res) => {
  res.send(layout('AI Assistant', `
    ${comingSoon('A conversational assistant is not built yet',
      'AI is already working elsewhere in this platform: your assessment result carries '
      + 'AI-generated recommendations, and the model is never allowed to author a figure. '
      + 'A general-purpose assistant surface is a separate piece of work.',
      'Available today: open an assessment result to see AI recommendations')}
    ${scope('What this section will cover', [
      'Ask questions about your own assessment and evidence',
      'Guidance on what a specific disclosure is asking for',
      'Drafting narrative answers for review — never auto-submitted',
      'Trilingual (EN / BM / 中文)',
      'The model never produces a figure — the same guard the rest of the platform uses',
    ])}`, req.user, '/assistant'));
});

// ── Workflow — not built ───────────────────────────────────────────────────
router.get('/workflow', (req, res) => {
  res.send(layout('Workflow', `
    ${comingSoon('Review and approval workflow is not built yet',
      'Assessments are currently completed and scored in one step, with no review stage. '
      + 'Nothing in the database tracks an approval, so there is nothing to show here yet.',
      'Not started')}
    ${scope('What this section will cover', [
      'Submit an assessment for internal review before it is final',
      'Reviewer and approver roles, with an audit trail',
      'Return-for-revision with comments against specific answers',
      'Period locking once a reporting year is signed off',
      'Notification when an action is waiting on someone',
    ])}`, req.user, '/workflow'));
});

// ── Users & Roles — not built ──────────────────────────────────────────────
router.get('/users', (req, res) => {
  res.send(layout('Users & Roles', `
    ${comingSoon('User and role management is not built yet',
      'Accounts exist and are authenticated, and every route is authorised server-side. '
      + 'What is missing is the screen to invite people and change their role — that is '
      + 'currently a database operation.',
      'Not started')}
    ${scope('What this section will cover', [
      'Invite a colleague by email',
      'Assign and change roles, granted by an administrator and never self-claimed',
      'Remove access, with the change recorded',
      'See who last signed in',
      'Audit trail of role changes',
    ])}`, req.user, '/users'));
});

// ── Integrations — not built ───────────────────────────────────────────────
router.get('/integrations', (req, res) => {
  res.send(layout('Integrations', `
    ${comingSoon('Integrations are not built yet',
      'No third-party connection is configured, and none is running in the background. '
      + 'Showing a list of logos with Connect buttons that do nothing would be worse than '
      + 'showing this.',
      'Not started')}
    ${scope('What this section will cover', [
      'Utility and energy data import for the carbon calculator',
      'Accounting system import for the financial disclosures',
      'HR system import for headcount, turnover and training hours',
      'Document storage for evidence files',
      'Export to a customer’s supplier portal',
    ])}`, req.user, '/integrations'));
});


module.exports = router;
