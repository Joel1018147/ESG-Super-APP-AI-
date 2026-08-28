'use strict';

const express = require('express');
const { query } = require('../db');
const { layout, esc, dayOf, emptyState, frameworkLabel, icon } = require('../utils/layout');
const { STAGE_LINK, STAGE_CTA } = require('../utils/journeyView');
/* readinessService is NO LONGER REQUIRED HERE (P9). The dashboard's only
   caller of it was `readiness.calculate(cid)` in the pathway, and that result
   now arrives on actionCenter's return — which ran the same engine on the same
   request. Leaving the import would leave a second way for this route to reach
   the engine, and the next author to need a readiness figure would take it. */
const sedg = require('../data/sedgV2');
const { scoreAssessment, loadActiveScheme } = require('../services/scoringEngine');
const { generateRecommendations } = require('../services/aiAdvisor');
const { electricityToCo2e, fuelToCo2e } = require('../services/carbonEngine');
const { mirrorStatus } = require('../services/verraService');
const journey = require('../services/journeyEngine');
const view = require('../utils/journeyView');
const actionCenter = require('../services/actionCenter');
const reportReadiness = require('../services/reportReadiness');
const actionView = require('../utils/actionView');

const router = express.Router();

const companyIdOf = (req) => req.user && req.user.company_id;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

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

// STAGE_LINK / STAGE_CTA moved to utils/journeyView.js in P5 so the journey
// page and this one cannot send a user to different screens for the same
// stage. Imported below rather than copied.
// NAMED, NEVER SCORED. SustNET publishes no methodology mapping a company's
// activity to these, so the platform states the mission and stops there. The
// moment a published methodology exists, this list stops being decoration and
// starts being an axis — and that is a different run, from the real source.
const SUSTNET_PILLARS = Object.freeze([
  'Biodiversity and food security',
  'Shared prosperity and economic balance',
  'Sustainable education for all',
  'Social values and value creation',
]);

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

    /* ── P9 · THE ACTION CENTER IS NOW THE FIRST THING THIS PAGE ASKS FOR ──
       It loads the journey definitions, gathers the facts, computes the
       journey, reads the counts behind each predicate and runs the readiness
       engine — all of which this route used to do for itself, in three places,
       and one of which (readiness) it ran a second time further down.

       The reason is not fewer queries, although it is that too. It is that the
       dashboard's "next action", the journey page's "current mission" and the
       action list below now all come from ONE decision about what state
       everything is in. Before P9 the hero picked the journey's active stage
       and the pathway picked readiness's own largest gap, and the two could
       point a user at different work on the same screen. */
    const ab = await actionCenter.build(cid);
    const { stages, missions, levels } = ab.definitions || { stages: [], missions: [], levels: [] };
    const facts = ab.facts || await journey.gatherFacts(cid);

    // The journey is DEFINED in seed.sql. No rows means the seed did not run,
    // which is a deployment fault and not a company that has done nothing —
    // and those two must never render the same way.
    const journeyReady = stages.length > 0 && missions.length > 0 && levels.length > 0;
    const j = journeyReady ? ab.journey : null;
    const m = journeyReady ? journey.computeMissions(facts, missions) : null;
    // P8 REMOVED THE XP CHROME FROM THIS PAGE, not the XP engine.
    //
    // The directive rules out points, levels and a ladder as the metaphor: the
    // product is a MISSION PROGRESSION, and "60 XP · Level 3, Sapling" under a
    // financing-readiness figure reads as a different, smaller product than the
    // one the sentence above it belongs to. What the line said that was true —
    // where this mission sits and how many are done — is still said, in those
    // words, below.
    //
    // computeXp, xpSince, esg_missions.xp_award and GET /api/xp are all
    // UNTOUCHED. This is a rendering decision, and the day a genuine product
    // requirement for points appears the arithmetic is still there and still
    // derived. `levels` stays in the destructure above because loadDefinitions
    // returns it and journeyReady is asserted against all three tables.

    const a = facts.assessment;
    let by = {};
    let bandLabel = null;
    let bandList = [];
    let recs = [];
    /* EVERY SCORED YEAR THIS COMPANY HAS, for §32.2's history columns (Run 68).
       Scoped to the COMPANY and not to the current assessment, which is the
       whole point of it — it is the only read on this page that looks outside
       the year the rest of the page is about, and it is what lets the score
       card say whether the position is moving instead of only where it is.

       Aliased `history_year` because nothing else in this repo selects that
       name. The populated test stub keys its fixtures on a unique alias per
       statement, and a key on `esg_scores` would have been answered by the
       per-assessment fixture above — silently, with plausible rows, which is
       the failure mode that fixture file's own comment warns about. */
    let history = [];
    if (a) {
      const [{ rows: scores }, { rows: bands }, { rows: recRows }, { rows: hist }] = await Promise.all([
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
        query(
          `SELECT asm.reporting_year AS history_year, s.score_0_100, s.band_code
             FROM esg_scores s
             JOIN esg_assessments asm ON asm.id = s.assessment_id
            WHERE asm.company_id = $1 AND s.scope = 'OVERALL' AND asm.status <> 'archived'
            ORDER BY asm.reporting_year ASC, s.computed_at ASC`, [cid]),
      ]);
      by = Object.fromEntries(scores.map((s) => [s.scope, s]));
      bandList = bands;
      recs = recRows;
      history = hist;
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
    //
    // P9 REMOVED THREE OF THE SIX. The proposal counts, the project count and
    // the document total were being read here AND in actionCenter.gatherDetail
    // on the same request, from the same tables, with the same predicates —
    // two independent copies of the same aggregate on one page, which is the
    // shape that eventually renders "12 proposals" beside "11 waiting". They
    // now come from `ab.detail`. `recentDocs` and the byte total are the
    // dashboard's own and stay here; nothing else needs them.
    const [
      { rows: docBytes }, { rows: recentDocs },
      { rows: carbonTotals }, { rows: registerTotals },
    ] = await Promise.all([
      query(
        `SELECT coalesce(sum(byte_size), 0)::bigint AS bytes
           FROM esg_documents WHERE company_id = $1`, [cid]),
      query(
        `SELECT id, filename, byte_size, text_status
           FROM esg_documents WHERE company_id = $1
          ORDER BY created_at DESC, id DESC LIMIT 5`, [cid]),
      query(
        `SELECT count(*)::int AS entries, min(period_start) AS period_from,
                max(period_end) AS period_to,
                count(*) FILTER (WHERE is_provisional)::int AS provisional
           FROM esg_carbon_entries WHERE company_id = $1`, [cid]),
      query(
        `SELECT count(*)::int AS products FROM esg_finance_products WHERE is_active`, []),
    ]);
    // Shaped exactly as before so nothing downstream in this route changed.
    // `ab.figures` is null only in the uninstrumented case, which this page
    // already renders through `journeyReady`.
    const d = ab.figures || { docs: { total: 0 }, proposals: { live: 0, pending: 0 }, projects: { total: 0 } };
    const docs = { n: d.docs.total, bytes: docBytes[0].bytes };
    const props = { proposals_live: d.proposals.live, proposals_pending: d.proposals.pending };
    const carbon = carbonTotals[0];
    const green = { projects: d.projects.total };
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

    /* ═══════════════════════════════════════════════════════════════════════
       THE DASHBOARD, AS ONE STORY                                    (P4)
       ─────────────────────────────────────────────────────────────────────
       WHERE AM I → WHAT IS MY POSITION → WHAT HAS THE AI DONE → WHAT NEEDS ME
       → WHAT NEXT → WHERE CAN THIS GO.

       Everything below is read from the queries above. Not one figure is
       invented, and three capabilities that the platform cannot currently
       compute — Green Finance Readiness, SustNET Impact and SustNET ESG
       Certification — are rendered as RESERVED rather than as zero, because a
       zero is a claim and "not configured" is the truth.
       ═════════════════════════════════════════════════════════════════════ */

    const shellCtx = (req.user && req.user.shell) || {};
    const reachable = j ? j.total_stages - j.counts.blocked : 0;
    const journeyPct = reachable > 0 ? Math.round((j.counts.completed / reachable) * 100) : 0;
    const active = j ? j.stages.find((s) => s.stage_code === j.active_stage_code) : null;
    const activeMission = (m && active)
      ? m.missions.find((x) => x.stage_code === active.stage_code) : null;

    // ── 1 · HERO ────────────────────────────────────────────────────────────
    // The score is the single primary visualisation. The three pillars are a
    // BREAKDOWN beside it, not three more dials competing with it — the audit
    // found four identical donuts on one card, which is four things claiming to
    // be the most important.
    // THE MASTER'S RING, not a local one. P2 built .esg-score__dial before
    // checking, and the master already ships .score-ring with hero/inline
    // sizes, a --ring-thickness token and its own geometry guards — so the
    // local dial was the one thing the ESG layer is not allowed to be: a
    // duplicate of a master component. It has been removed from the layer.
    const heroScore = wholeScore(overall && overall.score_0_100);
    const scoreDial = overall
      ? scoreRing(heroScore, null, `ESG score ${heroScore} out of 100`, { size: 'hero', den: 100 })
      : '';

    const heroLeft = overall
      ? `<div>
          <p class="esg-hero__eyebrow">${esc(shellCtx.companyName || 'Your company')}${
  a ? ` · ${esc(a.reporting_year)}` : ''}</p>
          <!-- RUN 68 · THE BAND BLOCK COMES FIRST AND THE RING FOLLOWS IT.
               §14.2's grid puts the text in the flexible track and the ring in
               the auto one, which is the reference dashboard's hero and which
               fills the dead column this hero measured to the ring's right.
               Source order is also reading order for a screen reader, and
               position-then-figure is the order the sentence is written in. -->
          <div class="esg-hero__score">
            <div class="esg-score__band">
              ${bandLabel ? `<span class="esg-chip esg-chip--done">${esc(overall.band_code)} · ${esc(bandLabel)}</span>` : ''}
              <span class="esg-score__bandname">${esc(bandLabel || 'Scored')}</span>
              <span class="esg-score__basis"><span class="esg-num">${esc(answers.done)} / ${esc(answers.total)}</span>
                indicators answered${overall.indicators_na ? `, ${esc(overall.indicators_na)} not applicable` : ''}.
                Computed by the scoring engine at weighting version ${esc(overall.weighting_version)} — no part
                of it is generated by AI.</span>
            </div>
            ${scoreDial}
          </div>
        </div>`
    // P8. THIS USED TO BE emptyState(), WHICH IS A CENTRED COMPONENT.
    //
    // Dropped into the hero's left column it produced the measured defect in
    // the before-shot: a 430px panel holding one small centre-aligned block,
    // with the company name left-aligned above it and 180px of nothing under
    // it. The generic empty state is right in a card and wrong as a hero,
    // because a hero states a POSITION and a position is read from the left
    // edge like every other line on the page.
    //
    // The three lines below are the same eyebrow / headline / sub the finance
    // readiness hero already uses for its own not-yet-assessable case, so the
    // unscored dashboard and the partly-assessed readiness page now read as
    // one product. NOTHING IS CLAIMED THAT WAS NOT CLAIMED BEFORE: the state
    // is still named, the denominator is still real, and there is still no
    // provisional figure.
      : `<div>
          <p class="esg-hero__eyebrow">${esc(shellCtx.companyName || 'Your company')}${
  a ? ` · ${esc(a.reporting_year)}` : ''}</p>
          ${a
    ? `<h2 class="esg-hero__headline">Assessment started, not scored yet</h2>
          <p class="esg-hero__sub">The score is computed from your own answers when you submit the
            assessment. <span class="esg-num">${esc(answers.done)} / ${esc(answers.total)}</span>
            indicators are answered so far. Nothing is estimated in the meantime, so there is no
            provisional figure to show you.</p>`
    : `<h2 class="esg-hero__headline">No assessment started yet</h2>
          <p class="esg-hero__sub">Scoring is switched on and working — there is nothing to score
            until an assessment exists, so there is no denominator to count against either.</p>`}
        </div>`;

    /* THE ONE NEXT ACTION (P9).
       It used to be the journey engine's active stage read directly. It is now
       actionCenter's `lead`, which is the SAME stage in every case where the
       journey is the most pressing thing — and is something else in the two
       cases where it is not: a score that predates unreviewed evidence, and an
       implemented project that has never been measured. Both are situations
       where the journey's active stage is genuinely not the next move, and
       before P9 this panel could not say so.

       `lead` is null when nothing is open. That is a real answer and it is
       rendered as one; it is never backfilled with the first action of any
       state, because "revisit this completed stage" is not a next move. */
    const lead = ab.lead;
    const nextPanel = lead ? `
      <div class="esg-next">
        <span class="esg-next__label">${esc(actionCenter.STATE_WORD[lead.state])} · what to do next</span>
        <h2 class="esg-next__title">${esc(lead.what)}</h2>
        <p class="esg-next__why">${esc(lead.why)}</p>
        <div class="esg-next__actions">
          <a class="btn btn-primary" href="${esc(lead.href)}">${esc(lead.cta)}</a>
          <a class="btn btn-outline" href="/journey">See the whole journey</a>
        </div>
        <span class="esg-meta">${esc(lead.basis)}${activeMission
    ? ` · mission ${esc(j.stages.indexOf(active) + 1)} of ${esc(j.total_stages)} · ${
      esc(m.completed)} of ${esc(m.total)} complete` : ''}</span>
      </div>`
      : `<div class="esg-next">
          <span class="esg-next__label">What to do next</span>
          <h2 class="esg-next__title">Nothing is waiting for you</h2>
          <p class="esg-next__why">Every stage you can currently reach is done, no proposal is
            outstanding and no measurement is overdue. The stages that remain are blocked on
            something outside this platform, and each one says what.</p>
          <div class="esg-next__actions"><a class="btn btn-outline" href="/journey">Review the journey</a></div>
        </div>`;

    const hero = `<section class="esg-hero esg-enter">
      ${heroLeft}
      ${nextPanel}
    </section>`;

    /* ═══════════════════════════════════════════════════════════════════════
       0 · THE PAGE HEAD                                              (Run 68)
       ─────────────────────────────────────────────────────────────────────
       A greeting, and the period every figure below belongs to.

       THE HOUR IS READ IN A NAMED ZONE. `new Date().getHours()` reads the
       SERVER's clock and this deploys to Railway, which runs UTC — so a
       Malaysian SME opening the dashboard at 8am would be told "Good evening",
       every morning, and nothing on the page would look wrong enough to
       report. The zone is written down instead of inherited.

       IT IS A <p>, NOT AN <h1>. The shell already renders the page's h1 in the
       top bar and the content region starts at h2; a second h1 here would give
       the page two and put a heading-level skip under it. The greeting is not
       the page's title anyway — "Dashboard" is.
       ═════════════════════════════════════════════════════════════════════ */
    const klHour = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', hourCycle: 'h23',
    }).format(new Date()));
    const greeting = klHour < 12 ? 'Good morning'
      : (klHour < 18 ? 'Good afternoon' : 'Good evening');

    const pageHead = `<div class="esg-pagehead esg-enter">
      <p class="esg-pagehead__greeting">${esc(greeting)}${
  shellCtx.companyName ? `, ${esc(shellCtx.companyName)}` : ''}</p>
      <span class="esg-pagehead__context">
        <span class="esg-pagehead__context-icon">${icon('assessment')}</span>
        ${a
    ? `Reporting year ${esc(a.reporting_year)} · ${esc(frameworkLabel(a.framework_code, a.framework_version))}`
    : 'No reporting year open yet'}
      </span>
    </div>`;

    /* ═══════════════════════════════════════════════════════════════════════
       0b · THE METRIC ROW                                            (Run 68)
       ─────────────────────────────────────────────────────────────────────
       P4 DELETED A TILE ROW AND THIS IS NOT IT COMING BACK. What it deleted
       was five equal-weight numbers above two panels that contradicted each
       other — nothing said which one mattered and nothing said what to do. The
       hero now carries the position and the one next action, the list below
       carries the rest, and this row is a SUMMARY underneath both rather than
       a competitor to either.

       WHAT EARNS IT BACK IS `__basis`. Every card here states what its figure
       is measured against, and the component has no variant without that slot:
       a number with no denominator is the thing the audit objected to.

       THE DELTA IS RENDERED ONLY WHERE ONE WAS MEASURED. A company with one
       reporting year has nothing to compare against, and the card says that in
       words. It never prints "0%", which is a claim that the score held
       steady — a different statement from "there is no previous year".
       ═════════════════════════════════════════════════════════════════════ */
    const metric = (label, value, unit, delta, basis, i) => `<div class="esg-metric" style="--esg-i:${i}">
      <span class="esg-metric__label">${esc(label)}</span>
      <span class="esg-metric__figure">
        <span class="esg-metric__value">${value === null ? '—' : esc(value)}</span>
        ${unit ? `<span class="esg-metric__unit">${esc(unit)}</span>` : ''}
        ${delta ? `<span class="esg-metric__delta esg-metric__delta--${esc(delta.dir)}">${esc(delta.word)}</span>` : ''}
      </span>
      <p class="esg-metric__basis">${basis}</p>
    </div>`;

    /* The previous scored year, and the arithmetic done here rather than in
       the template: `history` is every OVERALL score this company holds, in
       year order, so the one before the current year is the last row that is
       not it. Compared as WHOLE numbers because that is what both cards
       print — comparing 78.4 to 78.0 and rendering "+0" is a delta the reader
       cannot reproduce from the two figures on screen. */
    const priorScore = (() => {
      if (!overall || !a || history.length < 2) return null;
      const earlier = history.filter((h) => Number(h.history_year) < Number(a.reporting_year));
      return earlier.length ? earlier[earlier.length - 1] : null;
    })();
    const scoreDelta = (() => {
      if (!priorScore || heroScore === null) return null;
      const diff = heroScore - wholeScore(priorScore.score_0_100);
      if (diff > 0) return { dir: 'up', word: `+${diff} on ${priorScore.history_year}` };
      if (diff < 0) return { dir: 'down', word: `${diff} on ${priorScore.history_year}` };
      return { dir: 'flat', word: `level with ${priorScore.history_year}` };
    })();

    const openCount = ab.state === 'ok' ? ab.open.length : null;
    const urgentCount = ab.state === 'ok' ? ab.counts.urgent : 0;
    const metricsSection = `<div class="esg-metrics">
      ${metric('ESG score', heroScore, heroScore === null ? null : '/ 100', scoreDelta,
    overall
      ? `Band ${esc(overall.band_code)}${bandLabel ? ` · ${esc(bandLabel)}` : ''} · weighting v${
        esc(overall.weighting_version)}${priorScore ? '' : ' · no earlier year to compare against'}`
      : 'Nothing is scored yet, so there is no figure to show and none is estimated.', 0)}
      ${metric('Indicators answered', a ? answers.done : null, a ? `of ${esc(answers.total)}` : null, null,
    a
      ? `Applicable indicators only${overall && overall.indicators_na
        ? `, ${esc(overall.indicators_na)} marked not applicable` : ''}.`
      : 'No assessment exists, so there is no denominator either.', 1)}
      ${metric('Open actions', openCount, null,
    urgentCount ? { dir: 'down', word: `${urgentCount} urgent` } : null,
    ab.state === 'ok'
      ? 'Every one names the rows that put it on the list.'
      : 'The action list has nothing to derive from on this deployment.', 2)}
      ${metric('Evidence on file', docs.n, docs.n === 1 ? 'document' : 'documents', null,
    props.proposals_pending
      ? `${esc(props.proposals_pending)} proposal${props.proposals_pending === 1 ? '' : 's'} from them is waiting for a person.`
      : 'Nothing an AI read raises your score on its own — accepting is what does.', 3)}
    </div>`;

    /* ═══════════════════════════════════════════════════════════════════════
       1b · THE ACTION CENTER                                            (P9)
       ─────────────────────────────────────────────────────────────────────
       WHAT SHOULD I DO NEXT — not once, in the hero, but the whole list, in
       priority order, with the reason each item sits where it does.

       THE OPEN WORK LEADS AND THE REST DISCLOSES. Completed, blocked and
       not-configured actions are real and are not hidden — a blocked
       capability is the one card that explains why something a user expected
       is not there — but a company opening this page needs the four states it
       can act on, and thirteen completed stages above them would bury the two
       that matter. So the open list renders and the rest sits in a <details>,
       which is the same treatment the rating ladder gets below.

       THE LEGEND IS NARROWED TO THE STATES ACTUALLY PRESENT. Seven definitions
       under a list showing three of them is noise; omitting one the reader IS
       looking at is worse. actionView.legend() takes the set from the data.
       ═════════════════════════════════════════════════════════════════════ */
    const actionSection = (() => {
      if (ab.state !== 'ok') {
        return `<section class="esg-section">
          <div class="esg-section__head">
            <h2 class="esg-section__title">What needs you</h2>
          </div>
          <!-- THE SERVICE'S OWN SENTENCE, NOT A SECOND COPY OF IT.
               This used to test ab.detail.text and fall back to a hand-written
               string, which was wrong twice over: detail never had a .text
               property on either branch, so the ternary always took the
               fallback — and the fallback was a near-identical duplicate of
               the words the service already publishes, which is exactly the
               drift STAGE_DETAIL's own comment warns about. detail is now
               unambiguously the sentence, and there is one copy of it. -->
          ${emptyState('uninstrumented', {
    title: 'The action list has nothing to derive from',
    body: ab.detail })}
        </section>`;
      }
      const openList = ab.open;
      const rest = ab.actions.filter((a) => !openList.includes(a));
      const openStates = [...new Set(openList.map((a) => a.state))];
      const urgent = ab.counts.urgent;

      return `<section class="esg-section">
        <div class="esg-section__head">
          <h2 class="esg-section__title">What needs you</h2>
          <span class="esg-section__note">${openList.length
    ? `${esc(openList.length)} open${urgent ? ` · ${esc(urgent)} urgent` : ''} · every one says which rows put it here`
    : 'Nothing is open · every reachable stage is done'}</span>
        </div>
        ${openList.length ? `
          <div class="esg-card"><div class="esg-card__body">
            ${actionView.legend(openStates)}
          </div></div>
          <div class="esg-actions">
            ${openList.map((a, i) => actionView.actionCard(a, i)).join('')}
          </div>`
    : emptyState('zero', {
      title: 'Nothing is waiting on you',
      body: 'Every stage you can reach is complete, no AI proposal is outstanding and no '
          + 'measurement is overdue. That is a measured result — the list is empty rather than '
          + 'switched off.' })}
        ${rest.length ? `
          <details class="esg-stage__more">
            <summary>${esc(rest.length)} more: what is done, what is blocked, and what this
              platform cannot do</summary>
            <div class="esg-card"><div class="esg-card__body">
              ${actionView.legend([...new Set(rest.map((a) => a.state))])}
            </div></div>
            <div class="esg-actions">
              ${rest.map((a, i) => actionView.actionCard(a, i)).join('')}
            </div>
          </details>` : ''}
      </section>`;
    })();

    // ── 2 · POSITION · the pillar breakdown ─────────────────────────────────
    // ONE DENOMINATOR CONVENTION ON THE PAGE. The hero counts answered against
    // APPLICABLE indicators (the journey engine excludes not-applicable ones);
    // the pillar rows were counting against the raw total, so the same screen
    // read "39 / 39" above "13 of 14" and looked like it disagreed with itself.
    // The audit found exactly this. Both now exclude N/A and name it separately.
    /* ── 2a · THE PILLAR PROFILE ─────────────────────────────────────────
       RUN 68 REPLACED THREE INLINE RINGS WITH THREE BARS, which is P4's own
       finding carried to its end. P4 wrote that the pillars are "a BREAKDOWN
       beside [the score], not three more dials competing with it" — and then
       drew them as three small dials. A ring answers "how far around is it";
       a row of bars on one axis answers "which of the three is carrying you",
       which is the only question this block exists for and the one thing
       three separate rings genuinely cannot show.

       IT IS §8's .esg-progress, NOT A NEW BAR. The track, the fill and the
       radius already exist and are already guarded; §32.1 adds a height
       modifier and nothing else. P4's rule, applied to our own layer this
       time rather than to the master's.

       P8's REASON FOR DROPPING THE RING LABEL SURVIVES INTACT: the pillar is
       named in text at 14px, once, and no 9px letter is printed beside it. */
    const pillar = (scope, name, i) => {
      const s = by[scope];
      if (!s) return '';
      const v = wholeScore(s.score_0_100);
      const applicable = Number(s.indicators_total) - Number(s.indicators_na || 0);
      return `<div class="esg-pillar esg-pillar--chart" style="--esg-i:${i}">
        <div class="esg-pillar__figure">
          <span class="esg-pillar__name">${esc(name)}</span>
          <span class="esg-pillar__value">${v === null ? '—' : esc(v)}<span class="esg-metric__unit"> / 100</span></span>
        </div>
        <span class="esg-progress esg-progress--chart esg-progress--current"
              role="img" aria-label="${esc(name)} ${v === null ? 'not scored' : `${v} out of 100`}">
          <span class="esg-progress__fill" style="width:${v === null ? 0 : esc(v)}%"></span>
        </span>
        <span class="esg-pillar__basis">${esc(s.indicators_answered)} of ${
  esc(applicable)} answered${
  s.indicators_na ? `, ${esc(s.indicators_na)} not applicable` : ''}</span>
      </div>`;
    };

    /* ── 2b · THE HISTORY COLUMNS ────────────────────────────────────────
       The first thing this product has ever rendered that says whether the
       position is MOVING. One column per reporting year that carries a scored
       OVERALL row, height computed here and written into --esg-h, so the
       browser measures nothing and no chart library is loaded — the CSP names
       no script host and dashboard-test asserts nothing loads Chart.js.

       TWO COLUMNS IS THE FLOOR. One column drawn on a time axis is a chart
       asserting a direction from a single point, so a company in its first
       reporting year gets a named empty state that says what a second year
       would buy it. */
    const COL_H = 112;
    const historyCard = (() => {
      /* Finite on BOTH, not merely non-null. A row that reaches here without a
         year is a row this chart cannot place on its axis, and `undefined !==
         null` is true — so a null check alone would put a column labelled
         "undefined" on the page rather than dropping it. */
      const scored = history.filter((h) => Number.isFinite(Number(h.history_year))
        && Number.isFinite(Number(h.score_0_100)));
      if (scored.length < 2) {
        return emptyState('instrumented_but_empty', {
          title: 'One reporting year on file, so there is no trend yet',
          body: 'A trend needs two scored years and this company has '
              + (scored.length ? 'one' : 'none') + '. The comparison is drawn the year a second '
              + 'assessment is scored — nothing is projected in the meantime, so there is no '
              + 'provisional direction to show you.' });
      }
      return `<div class="esg-cols">
        ${scored.map((h, i) => {
    const v = wholeScore(h.score_0_100);
    const here = a && Number(h.history_year) === Number(a.reporting_year);
    return `<div class="esg-col${here ? ' esg-col--current' : ''}" style="--esg-i:${i}">
            <span class="esg-col__value">${v === null ? '—' : esc(v)}</span>
            <span class="esg-col__stem" style="--esg-h:${Math.max(6, Math.round((Number(h.score_0_100) / 100) * COL_H))}"
                  role="img" aria-label="${esc(h.history_year)} scored ${esc(v)} out of 100"></span>
            <span class="esg-col__x">${esc(h.history_year)}${here ? '<br>this year' : ''}</span>
          </div>`;
  }).join('')}
      </div>
      <div class="esg-cols__base" aria-hidden="true"></div>`;
    })();

    // The ladder is where you sit among the bands. It is TERTIARY — it was 40%
    // of the score card and six of its seven rows were bands this company is
    // not in — so it discloses rather than occupies.
    const ladder = bandList.length ? `
      <details class="esg-stage__more">
        <summary>Where ${esc(overall ? overall.band_code : 'this')} sits on the rating ladder</summary>
        <div class="esg-table-scroll" tabindex="0" role="region" aria-label="Rating ladder">
          <table class="esg-table esg-table--stack">
            <thead><tr><th>Band</th><th>Range</th><th>Status</th></tr></thead>
            <tbody>${bandList.slice().reverse().map((b) => {
    const here = overall && b.band_code === overall.band_code;
    const cleared = overall && Number(overall.score_0_100) >= Number(b.max_score);
    return `<tr><td data-label="Band">${esc(b.band_code)} · ${esc(b.band_label)}</td>
        <td data-label="Range" class="esg-td-nowrap">${esc(b.min_score)}–${esc(b.max_score)}</td>
        <td data-label="Status">${here
    ? '<span class="esg-chip esg-chip--current">You are here</span>'
    : (cleared ? '<span class="esg-chip esg-chip--done">Cleared</span>'
      : '<span class="esg-chip esg-chip--blocked">Not reached</span>')}</td></tr>`;
  }).join('')}</tbody>
          </table>
        </div>
      </details>` : '';

    /* THE SECTION NOTE IS THE ENGINE VERSION, NOT THE FRAMEWORK LABEL. The
       framework is now named once, in the page head, and printing it again
       here would be the same sentence twice on one screen — the duplication
       this file's own audits keep finding. What belongs here instead is the
       thing that is true of these two charts specifically: both are drawn
       from rows the deterministic engine wrote. */
    const positionSection = overall ? `<section class="esg-section">
      <div class="esg-section__head">
        <h2 class="esg-section__title">Where the score comes from</h2>
        <!-- NOT a table name. The first draft printed the scores table here by name,
             and no-model-figures-test's SQL scanner reads any template literal
             holding FROM followed by an esg_ table as SQL, then fails it for
             carrying an interpolation — which this literal, being a page, is
             full of. The scanner is right to be blunt about that shape, and a
             table name is developer provenance rather than anything a user
             needs: what they need is that a deterministic engine produced it.
             (No backticks in this comment. It sits INSIDE a template literal,
             so one would close it and turn the prose into code.) -->
        <span class="esg-section__note">Computed by the scoring engine · engine v${esc(overall.engine_version)} · no part of it is generated</span>
      </div>
      <div class="esg-charts">
        <article class="esg-chartcard">
          <div class="esg-chartcard__head">
            <h3 class="esg-chartcard__title">The three pillars</h3>
            <span class="esg-chartcard__note">One axis, so the three are comparable</span>
          </div>
          <div class="esg-chartcard__body">
            <div class="esg-pillars esg-pillars--chart">
              ${pillar('E', 'Environmental', 0)}
              ${pillar('S', 'Social', 1)}
              ${pillar('G', 'Governance', 2)}
            </div>
          </div>
        </article>
        <article class="esg-chartcard">
          <div class="esg-chartcard__head">
            <h3 class="esg-chartcard__title">Score by reporting year</h3>
            <span class="esg-chartcard__note">Every scored year this company holds</span>
          </div>
          <div class="esg-chartcard__body">
            ${historyCard}
          </div>
        </article>
      </div>
      ${ladder}
    </section>` : '';

    /* ═══════════════════════════════════════════════════════════════════════
       3 · THE INSIGHT TRIAD                                          (Run 68)
       ─────────────────────────────────────────────────────────────────────
       WHAT THE PLATFORM READ · WHAT THE DATA LOOKS LIKE · WHAT WOULD MOVE IT.

       These three cards REPLACE two flat sections rather than summarising
       them. What used to be "What the platform did, and what needs you" (two
       .esg-ai cards) and "What would move the score" (a card of .esg-rec rows)
       is the same content, in the same order, in one component — so nothing on
       this page is said twice, which a summary triad sitting above an
       identical list would have broken immediately.

       THE TINT IS A DOMAIN, NOT A SEVERITY (§33). A card does not change
       colour when its contents get worse. Every ROW carries its own state, as
       a word and as an icon colour, exactly as §26's action card does — so a
       reader who cannot separate the three tints loses nothing but grouping.

       NOT ONE FIGURE HERE IS WRITTEN BY A MODEL. The counts come from
       actionCenter's own aggregates, the points come from the scoring engine's
       `points_missed` column, and the model writes only the sentence beside
       them. That is CLAUDE.md's rule and this is one of the places it is
       visible on screen.
       ═════════════════════════════════════════════════════════════════════ */
    const insightRow = (r) => `<div class="esg-insight__row">
      <span class="esg-insight__rowmark esg-insight__rowmark--${esc(r.tone)}">${icon(r.mark)}</span>
      <div>
        <div class="esg-insight__rowhead">
          <p class="esg-insight__rowtitle">${r.title}</p>
          ${r.figure === undefined ? '' : `<span class="esg-insight__figure">${r.figure}</span>`}
        </div>
        <p class="esg-insight__rownote">${r.note}</p>
      </div>
    </div>`;

    /* ── 3a · WHAT THE PLATFORM READ ─────────────────────────────────────
       The three document branches are the ones §7's .esg-ai block already
       distinguished and they are unchanged in meaning: nothing to read, read
       and proposed, read and proposed nothing. Carbon is the second row for
       the same reason it was the second card — it is the other thing on this
       platform that reads a figure out of something a person supplied. */
    /* actionCenter's own aggregates, read ONCE for all three cards below. Null
       only on a deployment whose journey seed never ran; every use of it is
       guarded, because five zeroes and "nothing is configured" are different
       statements and this file is not allowed to render the first for the
       second. */
    const fig = ab.figures;
    const readRows = [];
    if (!docs.n) {
      readRows.push({ tone: 'info', mark: 'evidence',
        title: 'No documents to read yet',
        note: 'Document reading is switched on and working. It reads what you already hold — a utility '
            + 'bill, a policy, a certificate — and proposes answers with a verbatim quote from the page '
            + 'it found them on. It has not been given a document yet.' });
    } else if (props.proposals_pending > 0) {
      readRows.push({ tone: 'caution', mark: 'waiting',
        title: `${esc(props.proposals_pending)} proposal${props.proposals_pending === 1 ? '' : 's'} waiting for you`,
        figure: esc(props.proposals_pending),
        note: 'Each one carries a verbatim quote from the document it came from. Nothing an AI read '
            + 'raises your score on its own — accepting is what does.' });
    } else if (props.proposals_live > 0) {
      readRows.push({ tone: 'done', mark: 'measured',
        title: 'Every proposal has been reviewed',
        figure: esc(props.proposals_live),
        note: `${esc(props.proposals_live)} were put to you and none is outstanding. That is a measured `
            + 'result — the queue is empty rather than switched off.' });
    } else {
      readRows.push({ tone: 'info', mark: 'ai',
        title: 'Read, and proposed nothing',
        note: `Your ${esc(docs.n)} document${docs.n === 1 ? ' was' : 's were'} read and checked for `
            + 'statements that answer a disclosure. None carried one that could be quoted verbatim, so '
            + 'nothing was proposed rather than something being guessed.' });
    }
    readRows.push({
      tone: carbon.provisional > 0 ? 'caution' : (carbon.entries ? 'done' : 'info'),
      mark: 'carbon',
      title: carbon.entries
        ? `${esc(carbon.entries)} carbon entr${carbon.entries === 1 ? 'y' : 'ies'} on file`
        : 'No carbon data yet',
      figure: carbon.entries ? esc(carbon.entries) : undefined,
      note: carbon.entries
        ? (carbon.provisional > 0
          ? `${esc(carbon.provisional)} use an unverified emission factor and are marked provisional. `
            + 'They can be recomputed when a sourced Malaysian figure is published.'
          : 'Every entry stamps the emission factor it used, so last year&rsquo;s tonnage does not move '
            + 'when a new factor is published.')
        : 'Electricity, diesel and petrol. Each entry stamps the factor it used at the time.' });
    /* The green-opportunity queue is the third thing the model produces on this
       platform, and it belongs on this card for the same reason the other two
       do: it is a PROPOSAL, and a person accepting it is what makes it real. */
    readRows.push({
      tone: fig && fig.opportunitiesPending > 0 ? 'caution' : 'done',
      mark: 'projects',
      title: fig && fig.opportunitiesPending > 0
        ? `${esc(fig.opportunitiesPending)} green suggestion${fig.opportunitiesPending === 1 ? '' : 's'} to review`
        : 'No green suggestion is outstanding',
      figure: fig ? esc(fig.opportunitiesPending) : undefined,
      note: fig && fig.opportunitiesPending > 0
        ? 'Each was scanned from your own company profile, never from the gap list — the model is not '
          + 'told which gaps you have and is never asked to name one.'
        : 'A suggestion becomes a project only when you accept it, and none is waiting.' });

    /* THE BADGE IS SHORT, and that is a measured decision rather than taste.
       "AI proposes · a person verifies" wrapped onto its own line under the
       title at every card width the triad renders at, which turns the card
       head into two rows and pushes the first row down on one card and not the
       others. The sentence is already the section note above the three, said
       once; the badge states this card's SCOPE, which is what the reference
       puts there and what fits. */
    const readCard = `<article class="esg-insight" data-tone="accent" style="--esg-i:0">
      <div class="esg-insight__head">
        <div class="esg-insight__id">
          <span class="esg-insight__mark">${icon('ai')}</span>
          <h3 class="esg-insight__title">What the platform read</h3>
        </div>
        <span class="esg-insight__badge">${esc(docs.n)} document${docs.n === 1 ? '' : 's'}</span>
      </div>
      <div class="esg-insight__list">${readRows.map(insightRow).join('')}</div>
    </article>`;

    /* ── 3b · DATA VITALS ────────────────────────────────────────────────
       The reference's Body Vitals card: a short column of label-and-value
       rows that are read at a glance and never rank against each other.

       EVERY ROW IS AN AGGREGATE actionCenter ALREADY RAN on this request, so
       this card issues no query of its own — the second copy of an aggregate
       is what P9 spent a run removing from this route. `ab.figures` is null
       only on a deployment whose journey seed never ran, which the card says
       rather than rendering five zeroes.

       A VITAL IS FLAGGED, NEVER FAILED. Each row's tone is a threshold on its
       own number and the word beside it says which one; nothing here is
       aggregated into a health score, because there is no methodology that
       would justify weighting "four self-declared answers" against "one
       unreadable document". */
    const vitals = fig ? [
      { tone: fig.docs.unreadable > 0 ? 'caution' : (fig.docs.total ? 'done' : 'info'),
        mark: 'evidence',
        title: 'Documents read',
        figure: `${esc(fig.docs.read_ok)} / ${esc(fig.docs.total)}`,
        note: fig.docs.unreadable > 0
          ? `${esc(fig.docs.unreadable)} could not be read as text, so nothing was proposed from ${
            fig.docs.unreadable === 1 ? 'it' : 'them'}.`
          : 'Text was extracted from every document on file.' },
      /* `unattached`, NOT `awaitingReading`. The first draft of this row read
         `figures.awaitingReading` and called it "awaiting reading", which is
         what the name says and not what the column holds: actionCenter selects
         it as the ROWS of implemented-and-baselined green projects that have
         never been measured, so the card rendered [object Object] and, had it
         been a count, would have printed a project total under a heading about
         documents. Checked against gatherDetail's own SELECT, which is where
         this kind of guess has to be settled. */
      { tone: fig.docs.unattached > 0 ? 'caution' : 'done',
        mark: 'waiting',
        title: 'Documents attached to no answer',
        figure: esc(fig.docs.unattached),
        note: fig.docs.unattached > 0
          ? 'Read, but not yet linked to an indicator. A document raises no score until an answer '
            + 'cites it.'
          : 'Every document on file is cited by an answer.' },
      { tone: fig.unanswered > 0 ? 'caution' : 'done',
        mark: 'assessment',
        title: 'Indicators unanswered',
        figure: esc(fig.unanswered),
        note: fig.unanswered > 0
          ? 'An unanswered indicator earns nothing. It is not scored as a zero — it is not scored.'
          : 'Every applicable indicator carries an answer.' },
      { tone: fig.selfDeclared > 0 ? 'caution' : 'done',
        mark: 'governance',
        title: 'Answers with no evidence',
        figure: esc(fig.selfDeclared),
        note: fig.selfDeclared > 0
          ? 'Self-declared answers score at the lowest evidence multiplier the weighting scheme defines. '
            + 'Attaching a document is what raises them.'
          : 'Every answer on file carries a document or a verification.' },
      /* NO CARBON ROW HERE. The first draft carried "Provisional carbon
         entries" as a fifth vital, and the card above already states the
         carbon position including the provisional count — the same subject
         twice on one screen, which is precisely what this triad was built to
         stop. It stays on the card that owns it. */
    ] : [];
    const flagged = vitals.filter((v) => v.tone === 'caution').length;

    const vitalsCard = `<article class="esg-insight" data-tone="info" style="--esg-i:1">
      <div class="esg-insight__head">
        <div class="esg-insight__id">
          <span class="esg-insight__mark">${icon('company')}</span>
          <h3 class="esg-insight__title">Data vitals</h3>
        </div>
        <span class="esg-insight__badge">${fig
    ? (flagged ? `${esc(flagged)} flagged` : 'Nothing flagged')
    : 'Nothing to read'}</span>
      </div>
      <div class="esg-insight__list">${fig
    ? vitals.map(insightRow).join('')
    : insightRow({ tone: 'info', mark: 'unplugged',
      title: 'No journey stage is defined on this deployment',
      note: 'These figures are the counts behind the action list, and there is no action list to '
          + 'derive them from. That is a configuration gap, not an empty account.' })}</div>
    </article>`;

    /* ── 3c · WHAT WOULD MOVE THE SCORE ──────────────────────────────────
       `points_missed` is written by the SCORING ENGINE. The narrative beside
       it is the model's, and the two are never swapped — which is why the
       figure is rendered from the column and the sentence is rendered from
       narrative_en, in separate slots, rather than from one string the model
       composed.

       The three shown are the top three of a longer list and the foot says
       how long it is; /improvement is the page that holds the rest. */
    const improveRows = recs.length
      ? recs.slice(0, 3).map((r) => ({
        tone: r.priority === 'high' ? 'problem' : 'caution',
        mark: 'projects',
        title: `${esc(PILLAR_NAME[r.pillar] || r.pillar)} · ${esc(r.priority)} priority`,
        figure: `+${esc(Number(r.points_missed).toFixed(1))}`,
        note: esc(r.narrative_en || ''),
      }))
      : [{ tone: 'info', mark: 'future',
        title: 'Nothing to rank yet',
        note: 'The roadmap is written when the score is. Until an assessment is submitted there are no '
            + 'gaps to order, and none is guessed at in the meantime.' }];

    const improveCard = `<article class="esg-insight" data-tone="done" style="--esg-i:2">
      <div class="esg-insight__head">
        <div class="esg-insight__id">
          <span class="esg-insight__mark">${icon('finance')}</span>
          <h3 class="esg-insight__title">What would move the score</h3>
        </div>
        <span class="esg-insight__badge">${recs.length
    ? `${esc(recs.length)} gap${recs.length === 1 ? '' : 's'}`
    : 'Nothing ranked'}</span>
      </div>
      <div class="esg-insight__list">${improveRows.map(insightRow).join('')}</div>
      ${recs.length ? `<div class="esg-insight__foot">
        <a class="btn btn-outline btn-sm" href="/improvement">${recs.length > 3
    ? `Work through all ${esc(recs.length)} gaps`
    : 'Open the improvement roadmap'}</a>
        <a class="btn btn-outline btn-sm" href="/assessment/${esc(a.id)}">Open the assessment</a>
      </div>` : ''}
    </article>`;

    const insightSection = `<section class="esg-section">
      <div class="esg-section__head">
        <h2 class="esg-section__title">What the platform sees</h2>
        <!-- The points provenance moved here when the third card's badge was
             shortened. It is the one claim on this section that must not be
             lost to a layout decision: CLAUDE.md's first non-negotiable is
             that the model never produces a figure, and the +12.0 beside a
             sentence the model DID write is exactly where a reader would
             assume otherwise. -->
        <span class="esg-section__note">Every figure here counts your own rows · points are computed by the scoring engine, not by the model</span>
      </div>
      <div class="esg-insights">
        ${readCard}
        ${vitalsCard}
        ${improveCard}
      </div>
    </section>`;

    /* The readiness engine reads eight scoped aggregates of its own. It used to
       be awaited here; P9 takes actionCenter's result instead, because that
       function has already run it on this very request and a second run would
       be the same engine reaching the same conclusion twice on one page — the
       shape that eventually renders two different readiness figures. */
    const ready = ab.readiness;

    /* ── Green Finance Readiness, from the ENGINE ─────────────────────────
       P6.5 replaced a hardcoded "Not configured" string with a real service.
       The step now renders whatever readinessService reports, so the dashboard
       cannot claim a different state from the engine — including the day the
       engine can finally calculate, which needs no edit here.

       A HEADLINE FIGURE IS RENDERED ONLY WHEN `score` IS NON-NULL, which the
       engine permits only when every criterion was assessable. Below that the
       step shows what IS assessed and how much is still unassessable, because
       "42 of 50 assessable points" and "42/100" are different claims. */
    const READINESS_WORD = {
      not_configured:     'Not configured',
      insufficient_data:  'Data required',
      partially_assessed: 'Partly assessed',
      calculated:         null,   // the number speaks for itself
    };
    const readinessStep = (() => {
      if (!ready) {
        return `<div class="esg-pathway__step esg-pathway__step--reserved">
          <span class="esg-pathway__n">04</span>
          <span class="esg-pathway__name">Green Finance Readiness</span>
          <span class="esg-pathway__value">Not configured</span>
          <span class="esg-pathway__note">The readiness model is defined but nothing could be read
            for this company yet.</span>
        </div>`;
      }
      const calculated = ready.score !== null;
      const gap = ready.maximum - ready.assessable;
      // The criterion with the LARGEST unassessable gap, not merely the first
      // one reporting data_required. An earlier draft named "financial
      // information" as the chief gap from a hardcoded fallback, and kept
      // saying so after the company supplied its financials and the real gap
      // moved to the green project.
      const biggestGap = [...ready.criteria]
        .map((c) => ({ name: c.name, missing: c.weight - c.assessable }))
        .filter((c) => c.missing > 0)
        .sort((a, b) => b.missing - a.missing)[0] || null;
      return `<div class="esg-pathway__step${calculated ? '' : ' esg-pathway__step--reserved'}">
        <span class="esg-pathway__n">04</span>
        <span class="esg-pathway__name">Green Finance Readiness</span>
        <span class="esg-pathway__value${calculated ? ' esg-num' : ''}">${calculated
    ? esc(Math.round(ready.score))
    : esc(READINESS_WORD[ready.status] || 'Not configured')}</span>
        <span class="esg-pathway__note">${calculated
    ? `Every criterion in the model could be assessed. A readiness assessment, never a financing approval.`
    : `${esc(ready.earned)} of ${esc(ready.assessable)} assessable points earned. ${esc(gap)} of
       ${esc(ready.maximum)} points cannot be assessed yet${biggestGap ? `, chiefly ${esc(biggestGap.name)}` : ''}.`}</span>
      </div>`;
    })();

    // ── 5 · THE PATHWAY ─────────────────────────────────────────────────────
    // ESG → improvement → green opportunity → finance readiness, as one object.
    // The last step is RESERVED: there is no readiness engine in this platform,
    // so a figure here would be invented. It says so.
    const pathwaySection = `<section class="esg-section">
      <div class="esg-section__head">
        <h2 class="esg-section__title">Where this leads</h2>
        <span class="esg-section__note">A readiness assessment, never a financing approval</span>
      </div>
      <div class="esg-pathway">
        <div class="esg-pathway__step">
          <span class="esg-pathway__n">01</span>
          <span class="esg-pathway__name">ESG position</span>
          <span class="esg-pathway__value esg-num">${overall ? esc(Math.round(overall.score_0_100)) : '—'}</span>
          <span class="esg-pathway__note">${overall ? esc(`Band ${overall.band_code}`) : 'Not scored yet'}</span>
        </div>
        <div class="esg-pathway__step">
          <span class="esg-pathway__n">02</span>
          <span class="esg-pathway__name">Improvements identified</span>
          <span class="esg-pathway__value esg-num">${esc(recs.length)}</span>
          <span class="esg-pathway__note">${recs.length ? 'Each with the points it is costing you' : 'None yet — the roadmap is written when the score is'}</span>
        </div>
        <div class="esg-pathway__step">
          <span class="esg-pathway__n">03</span>
          <span class="esg-pathway__name">Green projects defined</span>
          <span class="esg-pathway__value esg-num">${esc(green.projects)}</span>
          <span class="esg-pathway__note">${green.projects
    ? 'A project is what a lender is actually told about'
    : 'A lender asks about a project, not a score'}</span>
        </div>
        ${readinessStep}
      </div>
      <div class="esg-row">
        <a class="btn btn-outline" href="/green-finance">Open Green Finance</a>
        <a class="btn btn-outline" href="/green-finance/opportunities">AI suggestions</a>
      </div>
    </section>`;

    // ── 6 · STRATEGICALLY RESERVED ──────────────────────────────────────────
    // Named, positioned, and explicitly not operational. No score, no bar, no
    // percentage — SustNET publishes no methodology mapping company activity to
    // its pillars, and no certification scheme, so any number here would be
    // this product inventing one.
    const reservedSection = `<section class="esg-section">
      <div class="esg-section__head">
        <h2 class="esg-section__title">Reserved for what comes next</h2>
        <span class="esg-section__note">Defined, and deliberately not yet operational</span>
      </div>
      <div class="esg-stack">
        <div class="esg-reserved">
          <span class="esg-reserved__mark" aria-hidden="true">${icon('journey')}</span>
          <div>
            <h3 class="esg-reserved__title">SustNET Impact</h3>
            <p class="esg-reserved__body">Your company will be able to explore its contribution to
              SustNET&rsquo;s four mission pillars once the applicable impact methodology is configured.
              Until one is published, this platform will not claim a contribution level.</p>
          </div>
          <span class="esg-reserved__status">Methodology required</span>
          <div class="esg-pillars-named">
            ${SUSTNET_PILLARS.map((p) => `<span class="esg-pillar-name">${esc(p)}</span>`).join('')}
          </div>
        </div>
        <div class="esg-reserved">
          <span class="esg-reserved__mark" aria-hidden="true">${icon('governance')}</span>
          <div>
            <h3 class="esg-reserved__title">SustNET ESG Certification</h3>
            <p class="esg-reserved__body">Certification pathways will become available when the
              applicable SustNET certification criteria are configured. This platform assesses; it does
              not certify, and it will not render a certificate or a progress figure toward one.</p>
          </div>
          <span class="esg-reserved__status">Certification framework required</span>
        </div>
      </div>
    </section>`;

    /* THE READING ORDER, AND WHAT RUN 68 MOVED.
       Greeting and period · position and the one next action · the four
       summary figures · the full open list · where the score comes from ·
       what the platform sees · where this leads · what is reserved · what is
       deliberately absent.

       The metric row sits BELOW the hero and above the list, which is the
       only place it can go without becoming the thing P4 deleted: above the
       hero it would be four numbers competing with the position, and below
       the list it would be a footnote nobody reaches. */
    const body = `<div class="esg-page">
      ${pageHead}
      ${hero}
      ${metricsSection}
      ${actionSection}
      ${positionSection}
      ${insightSection}
      ${pathwaySection}
      ${reservedSection}
      <section class="esg-section">
        <div class="esg-section__head">
          <h2 class="esg-section__title">What is deliberately not on this page</h2>
          <span class="esg-section__note">Absent, and said out loud</span>
        </div>
        <div class="esg-card"><div class="esg-card__body">
          ${emptyState('uninstrumented', {
    title: 'No industry comparison',
    body: 'Nothing writes a peer cohort and no industry group is recorded, so there is no industry to '
        + 'compare you against — it is not switched on rather than empty. Even once it exists, a '
        + 'percentile must never be computable back to one competitor’s score, so it needs opt-in '
        + 'and a minimum cohort size before it could be shown at all.' })}
          <div class="esg-rec"><span class="esg-rec__head">No AI confidence percentage</span>
            <p class="esg-rec__text">There is deliberately no confidence column. What exists is stronger:
              a verbatim quote checked against the document, or the proposal is discarded before you see it.</p></div>
          <!-- P9 CHANGED WHAT THIS CARD SAYS, AND NOT WHAT IT ADMITS.
               There is still no consultation module: no availability, no
               booking, no record, no fee. What P9 added is the platform's
               account of WHY it might be worth talking to somebody — six
               configured situations tested against this company's own rows,
               each printing the threshold it crossed. /consultation opens that
               account and books nothing, which is why the link is a real
               destination rather than the dead control §4.3c bans. -->
          <div class="esg-rec"><span class="esg-rec__head">No expert consultation booking</span>
            <p class="esg-rec__text">Still not built — no availability, no booking, no record of a
              session. What the platform can now do is say whether anything in your own data
              suggests a conversation would help, and show you the rule it used.
              <a href="/consultation">See what it noticed</a>.</p></div>
        </div></div>
      </section>
    </div>`;

    res.send(layout('Dashboard', body, req.user, '/dashboard'));
  } catch (err) { next(err); }
});

// ── Company profile ────────────────────────────────────────────────────────
/** The profile form, rendered for both GET and the POST error path.
 *
 *  `opts.values` is what the user just typed. On the error path it is rendered
 *  INSTEAD of the stored row, because re-reading the database would hand back
 *  the old values and quietly discard the edit the user is trying to correct. */
/* THE THREE GRIDS, IN ONE PLACE.
 *
 * They were written twice — once as <option> labels and, from P8's profile
 * summary, once more as a display value — and two hand-kept copies of a label
 * is how a dropdown ends up saying something the summary below it does not.
 *
 * It also fixes a live defect the migration surfaced: the Sabah option carried
 * a hand-written `&amp;` in its label, and opt() escapes what it is given, so
 * the dropdown rendered the literal text "Sabah &amp; Labuan (SESB)". The
 * ampersand is a plain character here and esc() is the only thing that touches
 * it. Order is the order the options are offered in. */
const GRID_OPTIONS = Object.freeze([
  ['peninsular', 'Peninsular Malaysia (TNB)'],
  ['sabah', 'Sabah & Labuan (SESB)'],
  ['sarawak', 'Sarawak (Sarawak Energy)'],
]);
const GRID_LABEL = Object.freeze(Object.fromEntries(GRID_OPTIONS));

async function renderCompanyForm(req, res, next, opts = {}) {
  try {
    const { rows } = await query(
      `SELECT id, name, ssm_number, msic_code, industry_label, employee_count,
              annual_revenue_myr, state, grid_region, esg_maturity
         FROM esg_companies WHERE id = $1`, [companyIdOf(req)]);
    const c = { ...(rows[0] || {}), ...(opts.values || {}) };
    const err = opts.error || null;
    const opt = (v, cur, label) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(label)}</option>`;
    // aria-describedby + aria-invalid so the message is announced with the
    // field rather than only being visible next to it.
    const fieldError = (name) => (err && err.field === name
      ? `<span id="${esc(name)}-error" class="field-error" role="alert">${esc(err.message)}</span>` : '');
    const invalid = (name) => (err && err.field === name
      ? ` class="input-error" aria-invalid="true" aria-describedby="${esc(name)}-error"` : '');

    const banner = err
      ? `<div class="alert alert-warning" role="alert"><div class="alert-body">
           <strong>Your profile was not saved.</strong> ${esc(err.message)}
           Everything else you entered is still here.</div></div>`
      : (req.query.saved
        ? `<div class="alert alert-success" role="status" aria-live="polite">
             <div class="alert-body"><strong>Profile saved.</strong></div></div>` : '');

    /* ═══════════════════════════════════════════════════════════════════════
       P8 CLEANUP · THE COMPANY PROFILE, ON THE ESG DESIGN LAYER
       ─────────────────────────────────────────────────────────────────────
       The form itself is UNCHANGED — same six fields, same names, same
       `required`, same POST target, same per-field error wiring and the same
       aria-describedby / aria-invalid pairing. Nothing about editing, saving,
       validation, permissions or the API moved. What changed is the page it
       sits on: a bare `<form class="card">` with a page-length column of
       inputs, no heading, and no statement of what any of it is for.

       WHAT THE SECOND SECTION IS, AND WHY IT IS NOT A NEW FIELD.
       esg_companies has three columns — industry_label, state and esg_maturity
       — that are READ in three places and WRITTEN in none:
         · GET /api/company returns them (always null)
         · this route SELECTs them and discarded them
         · opportunityService puts all three into the AI opportunity prompt,
           where they render as "Industry: unknown", "State: unknown" and
           "Self-reported ESG maturity: unknown" on every scan ever run
       That is the same shape counted-tables-have-writers-test.js exists to
       catch, one level down: a column with readers and no writer. P8 does NOT
       add form fields for them — that is a functional change and this is a
       visual migration — but it stops the page pretending they do not exist.
       They render as §20's ABSENT facts, naming what consumes them and saying
       plainly that nothing on this platform records them. See the report. */

    // Every stored column, what it feeds, and whether anything can write it.
    // `writable: false` is a statement about the PLATFORM, not about this
    // company — which is why those rows say "nothing records this" rather than
    // "you have not filled this in".
    // `text: true` marks a value that is a NAME rather than a figure, so it
    // renders at body size instead of in 20px display type — see §20's
    // .esg-fact--text. The three writable figures keep the display treatment.
    const PROFILE = [
      { label: 'Company name', value: c.name, text: true, from: 'Shown on every screen and in the top bar', writable: true },
      { label: 'SSM registration number', value: c.ssm_number, text: true, from: 'Self-declared · unique across the platform', writable: true },
      { label: 'MSIC code', value: c.msic_code, from: 'Sent to the AI opportunity scan as an industry code', writable: true },
      { label: 'Employees', value: c.employee_count, from: 'Sent to the AI scan as a band, never as a headcount', writable: true },
      { label: 'Annual revenue', value: c.annual_revenue_myr === null || c.annual_revenue_myr === undefined
        ? null : `RM ${Number(c.annual_revenue_myr).toLocaleString('en-MY')}`,
      from: 'Scored by the finance readiness model', writable: true },
      { label: 'Electricity grid', value: GRID_LABEL[c.grid_region] || null, text: true,
        from: 'Required for every Scope 2 calculation', writable: true },
      { label: 'Industry', value: c.industry_label, text: true,
        from: 'Read by the AI opportunity scan · nothing on this platform records it, so it reads "unknown" on every scan', writable: false },
      { label: 'State', value: c.state, text: true,
        from: 'Read by the AI opportunity scan · nothing on this platform records it', writable: false },
      { label: 'ESG maturity', value: c.esg_maturity, text: true,
        from: 'Read by the AI opportunity scan · nothing on this platform records it', writable: false },
    ];
    const recorded = PROFILE.filter((f) => f.writable && f.value !== null && f.value !== undefined && f.value !== '').length;
    const editable = PROFILE.filter((f) => f.writable).length;

    res.send(layout('Company Profile', `
      <div class="esg-page">
        <header class="esg-page-header esg-enter">
          <div class="esg-page-header__text">
            <h2 class="esg-h1">Company profile</h2>
            <p class="esg-page-header__intro">The facts every other screen is computed against.
              The electricity grid decides your Scope 2 figure, revenue is scored by the finance
              readiness model, and the rest is what the AI scan is told about you.</p>
          </div>
        </header>

        ${banner}

        <section class="esg-section esg-enter" style="--esg-i:1">
          <div class="esg-section__head">
            <h3 class="esg-section__title">Your company details</h3>
            <span class="esg-section__note"><span class="esg-num">${esc(recorded)} of ${esc(editable)}</span> recorded</span>
          </div>
          <form class="esg-card" method="post" action="/company">
            <div class="esg-card__body">
              <div class="esg-form-grid">
                <div class="form-group"><label for="name">Company name</label>
                  <input id="name" name="name" value="${esc(c.name || '')}" required></div>
                <div class="form-group"><label for="ssm_number">SSM registration number</label>
                  <input id="ssm_number" name="ssm_number" value="${esc(c.ssm_number || '')}"${invalid('ssm_number')}>
                  ${fieldError('ssm_number')}</div>
                <div class="form-group"><label for="msic_code">MSIC code</label>
                  <input id="msic_code" name="msic_code" value="${esc(c.msic_code || '')}"></div>
                <div class="form-group"><label for="employee_count">Number of employees</label>
                  <input id="employee_count" name="employee_count" type="number" min="0" value="${esc(c.employee_count ?? '')}"></div>
                <div class="form-group"><label for="annual_revenue_myr">Annual revenue (RM)</label>
                  <input id="annual_revenue_myr" name="annual_revenue_myr" type="number" min="0" step="0.01" value="${esc(c.annual_revenue_myr ?? '')}"></div>
                <div class="form-group"><label for="grid_region">Electricity grid</label>
                  <select id="grid_region" name="grid_region" required>
                    <option value="">Select…</option>
                    ${GRID_OPTIONS.map(([v, label]) => opt(v, c.grid_region, label)).join('')}
                  </select>
                  <!-- .esg-small, not .text-muted: the master's utility renders at
                       11.67px, which is under §3's 12px floor and was the smallest
                       text on this page. -->
                  <span class="esg-small">Required for Scope 2. The three grids differ by up to
                    3.7x, so this cannot be defaulted.</span></div>
              </div>
            </div>
            <div class="esg-card__footer">
              <button class="btn btn-primary" type="submit">Save</button>
            </div>
          </form>
        </section>

        <section class="esg-section esg-enter" style="--esg-i:2">
          <div class="esg-section__head">
            <h3 class="esg-section__title">What this profile feeds</h3>
            <span class="esg-section__note">Every value, and what reads it</span>
          </div>
          <div class="esg-facts">
            ${PROFILE.map((f) => {
    const missing = f.value === null || f.value === undefined || f.value === '';
    return `<div class="esg-fact${missing ? ' esg-fact--absent' : ''}${f.text ? ' esg-fact--text' : ''}">
              <span class="esg-fact__label">${esc(f.label)}</span>
              <span class="esg-fact__value">${missing
    ? (f.writable ? 'Not recorded yet' : 'Nothing records this')
    : esc(f.value)}</span>
              <span class="esg-fact__from">${esc(f.from)}</span>
            </div>`;
  }).join('')}
          </div>
          <p class="esg-small esg-prose">Industry, state and ESG maturity are read by the AI
            opportunity scan and there is no field on this platform that writes them, so the scan
            is told &ldquo;unknown&rdquo; for all three every time it runs. That is a gap in the
            product, not something you have failed to fill in.</p>
        </section>
      </div>`, req.user, '/company'));
  } catch (e) { next(e); }
}

router.get('/company', (req, res, next) => renderCompanyForm(req, res, next));

// A UNIQUE violation here is a PERSON MAKING A NORMAL MISTAKE, not a fault.
// It was reaching the generic error handler, which replaces the whole page —
// so the user lost every value they had typed, was told only "Something went
// wrong", and was given no route back and no clue which field was at fault.
// (In development that handler also printed the raw Postgres text, constraint
// name included; production already substituted a generic sentence, so the
// disclosure was dev-only. The lost work was not.)
//
// Mapped by CONSTRAINT NAME rather than by parsing the message: the message is
// English prose Postgres is free to reword, the constraint name is schema.
const COMPANY_FIELD_ERRORS = {
  uq_esg_companies_ssm: {
    field: 'ssm_number',
    message: 'This SSM registration number is already registered to another company. '
           + 'Check the number, or contact us if you believe this is your company.',
  },
};

router.post('/company', async (req, res, next) => {
  const b = req.body;
  try {
    const grid = ['peninsular', 'sabah', 'sarawak'].includes(b.grid_region) ? b.grid_region : null;
    await query(
      `UPDATE esg_companies SET name=$2, ssm_number=NULLIF($3,''), msic_code=NULLIF($4,''),
              employee_count=$5, annual_revenue_myr=$6, grid_region=$7
        WHERE id=$1`,
      [companyIdOf(req), String(b.name || '').trim(), String(b.ssm_number || '').trim(),
       String(b.msic_code || '').trim(), num(b.employee_count), num(b.annual_revenue_myr), grid]);
    res.redirect('/company?saved=1');
  } catch (err) {
    // 23505 = unique_violation. Anything else is a genuine fault and still goes
    // to the error handler — this catch narrows one known case, it does not
    // swallow the class.
    const mapped = err && err.code === '23505' && COMPANY_FIELD_ERRORS[err.constraint];
    if (!mapped) return next(err);
    return renderCompanyForm(req, res, next, { error: mapped, values: b });
  }
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
    /* MEASURED ON PRODUCTION AT 390px, and this page was not in P8's audit list
       — which is how it stayed broken while the migrated twelve were verified.
       Two separate causes, both clipping inside .app-layout's overflow: hidden:

       1. THE FORM. A flex row whose .form-group children size to their content,
          and the framework <select> is as wide as its longest option — "Simplified
          ESG Disclosure Guide v2 · 38 questions". A flex item cannot shrink below
          its intrinsic width without help, so label and select reached 414px in a
          390px viewport. .form-grid's tracks are minmax(240px, 1fr): the track is
          sized by the GRID, not by the select, so §17's max-width: 100% on the
          control finally has a containing block to resolve against. Same fix the
          company profile already uses, and that page measures clean at 390.
       2. THE TABLE. .table-wrap again (D1) — it reached 442px with no scroll and
          no gesture, so the Open button was simply unreachable on a phone. */
    const list = rows.length ? `
      <div class="esg-table-scroll" tabindex="0" role="region" aria-label="Your assessments">
        <table class="esg-table esg-table--stack">
          <thead><tr><th>Year</th><th>Framework</th><th>Status</th><th>Score</th><th></th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td data-label="Year" class="esg-td-nowrap esg-num">${esc(r.reporting_year)}</td>
            <td data-label="Framework">${esc(frameworkLabel(r.framework_code, r.framework_version))}</td>
            <td data-label="Status"><span class="esg-astate esg-astate--${
  r.status === 'scored' ? 'verified' : 'declared'}">${esc(r.status)}</span></td>
            <td data-label="Score" class="esg-td-num">${r.overall === null || r.overall === undefined
    ? '<span class="esg-meta">Not scored</span>' : esc(r.overall)}</td>
            <td data-label=""><a class="btn btn-outline" href="/assessment/${esc(r.id)}">Open</a></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`
      : emptyState('instrumented_but_empty', {
        title: 'No assessments yet',
        body: 'Scoring is switched on and working — there is nothing to score until an assessment '
            + 'exists. Choose a framework above to start one.' });

    res.send(layout('ESG Assessment', `
      <div class="esg-page">
        <header class="esg-page-header esg-enter">
          <div class="esg-page-header__text">
            <h2 class="esg-h1">ESG Assessment</h2>
            <p class="esg-page-header__intro">One assessment per reporting year, scored against the
              framework you choose when you create it.</p>
          </div>
        </header>

        <section class="esg-card esg-enter" style="--esg-i:1">
          <div class="esg-card__header">
            <h3 class="esg-card__title">Start an assessment</h3>
            <span class="esg-card__meta">The framework is stamped at creation</span>
          </div>
          <div class="esg-card__body esg-stack">
            <div class="esg-form-grid">
              <div class="form-group"><label for="framework_id">Framework</label>
                <select id="framework_id" name="framework_id" form="new-assessment" required>
                  <option value="">— choose a framework —</option>
                  ${frameworkChoices.map((fw) => `<option value="${esc(fw.id)}">${
  esc(frameworkLabel(fw.code, fw.version))} · ${esc(fw.n)} questions</option>`).join('')}
                </select></div>
              <div class="form-group"><label for="year">Reporting year</label>
                <input id="year" name="reporting_year" type="number" min="2015" max="2100"
                       value="${new Date().getFullYear() - 1}" form="new-assessment" required></div>
            </div>
            <p class="esg-small esg-prose">The framework is stamped on the assessment when it is
              created and does not change afterwards — that is what stops a later switch from
              rescoring answers you have already given.</p>
          </div>
          <div class="esg-card__footer">
            <form id="new-assessment" method="post" action="/assessment">
              <button class="btn btn-primary" type="submit">Create</button>
            </form>
          </div>
        </section>

        <section class="esg-section esg-enter" style="--esg-i:2">
          <div class="esg-section__head">
            <h3 class="esg-section__title">Your assessments</h3>
            <span class="esg-section__note">${rows.length
    ? `${esc(rows.length)} on file, most recent year first` : 'None yet'}</span>
          </div>
          ${list}
        </section>
      </div>`, req.user, '/assessment'));
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

    const [{ rows: inds }, { rows: resp }, { rows: props }] = await Promise.all([
      query(`SELECT id, code, pillar, tier, question_en, guidance_en, response_type, unit,
                    weight, allows_na, mapping_status, line_items
               FROM esg_indicators WHERE framework_id = $1 AND is_active ORDER BY pillar, sort_order`,
            [a[0].framework_id]),
      // document_id added in P6: it is the only marker distinguishing an answer
      // a person accepted from a document from one they typed, and the page now
      // says which is which.
      query(`SELECT indicator_id, option_code, value_numeric, value_text, value_json, is_na,
                    evidence_tier, document_id
               FROM esg_responses WHERE assessment_id = $1`, [req.params.id]),
      // What the platform proposed for THIS assessment, and what happened to it.
      // Joined to esg_documents for the filename and, load-bearing, for the
      // company predicate — an extraction row carries no company_id of its own.
      query(`SELECT e.id, e.indicator_id, e.proposed_option_code, e.evidence_quote, e.page_no,
                    e.quote_verified, e.status, e.model, e.reviewed_at,
                    e.document_id, d.filename
               FROM esg_document_extractions e
               JOIN esg_documents d ON d.id = e.document_id
              WHERE e.assessment_id = $1 AND d.company_id = $2 AND e.status <> 'auto_rejected'
              ORDER BY e.created_at`, [req.params.id, cid]),
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

    /* ═══════════════════════════════════════════════════════════════════════
       THE ASSESSMENT AS A VERIFICATION WORKFLOW                         (P6)
       ─────────────────────────────────────────────────────────────────────
       AI PROPOSES · A PERSON VERIFIES, and the page makes both halves visible.

       Every state below is DERIVED from a real shape in the database. Nothing
       is stored as a status field, so a badge cannot drift from the fact:

         missing      no esg_responses row for this indicator
         na           the row has is_na
         review       a pending esg_document_extractions row exists
         documented   the row carries a document_id (only acceptProposal sets
                      one) or evidence_tier='documented'
         verified     evidence_tier='verified' — third-party, above documented
         declared     answered with no evidence attached
         dismissed    every proposal for it was rejected by a person

       THERE IS NO CONFIDENCE PERCENTAGE, and that is deliberate rather than
       missing. esg_document_extractions carries no numeric column at all —
       test/layer2-test.js asserts it does not exist, because a numeric column
       is the first path by which a model-authored figure could reach a company.
       What the extractor produces instead is STRONGER than a confidence score:
       `quote_verified` records whether the quoted sentence was actually located
       in the document's own extracted text, and acceptProposal REFUSES a
       proposal whose quote was never found. A percentage would be the model
       marking its own homework; this is the platform checking it.
       ═════════════════════════════════════════════════════════════════════ */

    const proposalsByIndicator = new Map();
    for (const x of props) {
      if (!proposalsByIndicator.has(x.indicator_id)) proposalsByIndicator.set(x.indicator_id, []);
      proposalsByIndicator.get(x.indicator_id).push(x);
    }
    const pendingOf = (id) => (proposalsByIndicator.get(id) || []).filter((x) => x.status === 'pending');
    const reviewedOf = (id) => (proposalsByIndicator.get(id) || []).filter((x) => x.status === 'accepted' || x.status === 'rejected');

    const isAnswered = (r) => Boolean(r && (r.option_code != null || r.value_numeric != null
      || (r.value_text != null && r.value_text !== '') || r.is_na
      || (r.value_json && Object.keys(r.value_json).length)));

    function answerState(i) {
      const r = byInd[i.id];
      if (pendingOf(i.id).length) return 'review';
      if (!isAnswered(r)) {
        return (proposalsByIndicator.get(i.id) || []).some((x) => x.status === 'rejected')
          ? 'dismissed' : 'missing';
      }
      if (r.is_na) return 'na';
      if (r.evidence_tier === 'verified') return 'verified';
      if (r.document_id || r.evidence_tier === 'documented') return 'documented';
      return 'declared';
    }

    const STATE_WORD = Object.freeze({
      review:     'Needs your review',
      missing:    'Not answered',
      dismissed:  'Proposal dismissed',
      na:         'Not applicable',
      verified:   'Third-party verified',
      documented: 'Verified from a document',
      declared:   'Self-declared',
    });

    const stateChip = (state) => `<span class="esg-astate esg-astate--${esc(state)}">${esc(STATE_WORD[state])}</span>`;

    // Human-readable option codes. The stored code IS the answer; this only
    // decides how it reads to a person, and an unknown code shows itself rather
    // than being dropped.
    const OPTION_WORD = Object.freeze({
      yes: 'Yes', no: 'No', partial: 'Partially',
      0: 'Level 0', 1: 'Level 1', 2: 'Level 2', 3: 'Level 3', 4: 'Level 4',
    });
    const optionWord = (code) => (code == null ? '—' : (OPTION_WORD[code] !== undefined ? OPTION_WORD[code] : code));

    /** One proposal, inside the question it answers.
     *
     *  The accept and dismiss controls are `form=` references to forms rendered
     *  OUTSIDE the assessment form at the end of the page. Nesting a form inside
     *  a form is invalid HTML and the inner one is dropped by the parser, so the
     *  buttons would have silently submitted the whole assessment instead. */
    const proposalBlock = (i, x) => `
      <div class="esg-proposal">
        <div class="esg-proposal__head">
          <span class="esg-proposal__label">The platform proposes</span>
          <span class="esg-proposal__answer">${esc(optionWord(x.proposed_option_code))}</span>
          ${stateChip('review')}
        </div>
        <blockquote class="esg-quote">${esc(x.evidence_quote)}
          <cite class="esg-quote__cite">${esc(x.filename)}${x.page_no ? `, page ${esc(x.page_no)}` : ''}</cite>
        </blockquote>
        <details class="esg-evidence">
          <summary>Why it proposed this</summary>
          <div class="esg-evidence__body">
            <span class="esg-evidence__k">Source</span>
            <span class="esg-evidence__v"><a href="/documents/${esc(x.document_id)}">${esc(x.filename)}</a>${
  x.page_no ? `, page ${esc(x.page_no)}` : ''}</span>
            <span class="esg-evidence__k">Quote</span>
            <span class="esg-evidence__v">${x.quote_verified
    ? 'Located in this document&rsquo;s own extracted text. A proposal whose quote cannot be found is discarded before you see it, so there is no confidence percentage here — the quote either checks out or the proposal does not exist.'
    : 'NOT located in the document. This proposal cannot be accepted.'}</span>
            <span class="esg-evidence__k">Proposed by</span>
            <span class="esg-evidence__v">${esc(x.model || 'the extraction service')} — a proposal only. Accepting it is what writes your answer, and it is recorded against your name.</span>
            <span class="esg-evidence__k">On accept</span>
            <span class="esg-evidence__v">The answer becomes <strong>${esc(optionWord(x.proposed_option_code))}</strong> at evidence tier <strong>documented</strong>, which earns 85% of the available points instead of 60%.</span>
          </div>
        </details>
        <div class="esg-proposal__actions">
          ${x.quote_verified
    ? `<button class="btn btn-sm btn-primary" type="submit" form="accept-${esc(x.id)}">Accept this answer</button>`
    : '<span class="esg-astate esg-astate--dismissed">Quote not found — cannot be accepted</span>'}
          <button class="btn btn-sm btn-outline" type="submit" form="reject-${esc(x.id)}">Dismiss</button>
        </div>
      </div>`;

    // The out-of-form review actions, one pair per pending proposal.
    const reviewForms = props.filter((x) => x.status === 'pending').map((x) => `
      <form id="accept-${esc(x.id)}" method="post" action="/extractions/${esc(x.id)}/accept" hidden>
        <input type="hidden" name="next" value="/assessment/${esc(a[0].id)}">
      </form>
      <form id="reject-${esc(x.id)}" method="post" action="/extractions/${esc(x.id)}/reject" hidden>
        <input type="hidden" name="next" value="/assessment/${esc(a[0].id)}">
        <input type="hidden" name="reason" value="Dismissed from the assessment">
      </form>`).join('');

    const PILLAR_TITLE = Object.freeze({ E: 'Environmental', S: 'Social', G: 'Governance' });

    const section = (p) => {
      const list = inds.filter((i) => i.pillar === p);
      if (!list.length) return '';
      const states = list.map(answerState);
      const n = (s) => states.filter((x) => x === s).length;
      const evidenced = n('documented') + n('verified');
      const answered = list.length - n('missing') - n('review') - n('dismissed');
      const pct = list.length ? Math.round((answered / list.length) * 100) : 0;

      return `<section class="esg-stack-tight" style="margin-bottom:24px">
        <div class="esg-pillar-head">
          <h3 class="esg-pillar-head__name">${esc(PILLAR_TITLE[p] || p)}</h3>
          <div class="esg-pillar-head__states">
            <span class="esg-count esg-count--verified"><span class="esg-count__n">${esc(evidenced)}</span>
              <span class="esg-count__label">evidenced</span></span>
            ${n('review') ? `<span class="esg-count esg-count--review"><span class="esg-count__n">${esc(n('review'))}</span>
              <span class="esg-count__label">need review</span></span>` : ''}
            ${n('missing') ? `<span class="esg-count esg-count--missing"><span class="esg-count__n">${esc(n('missing'))}</span>
              <span class="esg-count__label">not answered</span></span>` : ''}
            ${n('na') ? `<span class="esg-count esg-count--na"><span class="esg-count__n">${esc(n('na'))}</span>
              <span class="esg-count__label">not applicable</span></span>` : ''}
          </div>
          <span class="esg-pillar-head__bar esg-progress" role="img"
                aria-label="${esc(answered)} of ${esc(list.length)} answered">
            <span class="esg-progress__fill" style="width:${esc(pct)}%"></span></span>
        </div>
        ${list.map((i) => {
    const r = byInd[i.id] || {};
    const state = answerState(i);
    const pend = pendingOf(i.id);
    const done = reviewedOf(i.id);
    return `<div class="esg-q${state === 'review' ? ' esg-q--review' : ''}" id="q-${esc(i.code)}">
          <div class="esg-q__head">
            <span class="esg-q__code">${esc(i.code)}</span>
            <span class="esg-q__text">${esc(i.question_en)}</span>
            ${stateChip(state)}
            ${i.mapping_status ? `<span class="esg-q__map" title="${esc({
    draft: 'Platform-authored wording, not yet reconciled against the official framework document',
    official: 'Verbatim from the publisher&rsquo;s own document',
    reconciled: 'Platform-authored, checked against the official framework document',
  }[i.mapping_status] || i.mapping_status)}">${esc(i.mapping_status)}</span>` : ''}
          </div>
          ${i.guidance_en ? `<p class="esg-q__guide">${esc(i.guidance_en)}</p>` : ''}
          <!-- P9 · THE TWO CONTEXTUAL ASKS.
               Not "Chat with AI". Two specific questions about THIS disclosure,
               each a plain link to a page that renders one answer server-side.
               No JavaScript, no spinner, no chat box — and one model call per
               deliberate click rather than thirty-nine on page load.
               The copilot is given the question and its configured guidance and
               nothing else: no score, no points, no answer of yours. Every
               digit it emits is stripped, because it was handed no figures. -->
          <div class="esg-copilot__asks">
            <a class="btn btn-outline"
               href="/explain?intent=explain_requirement&amp;subject=${esc(i.id)}&amp;back=${encodeURIComponent(`/assessment/${a[0].id}#q-${i.code}`)}"
               >Explain this requirement</a>
            <a class="btn btn-outline"
               href="/explain?intent=evidence_for&amp;subject=${esc(i.id)}&amp;back=${encodeURIComponent(`/assessment/${a[0].id}#q-${i.code}`)}"
               >What evidence can I provide?</a>
          </div>
          ${pend.map((x) => proposalBlock(i, x)).join('')}
          <div class="esg-q__controls">
            <div class="esg-q__control">
              <label for="o_${esc(i.id)}">Your answer</label>
              ${field(i)}
            </div>
            <div class="esg-q__control">
              <label for="e_${esc(i.id)}">Evidence level</label>
              <select id="e_${esc(i.id)}" name="e_${esc(i.id)}">
                <option value="self_declared"${r.evidence_tier === 'self_declared' || !r.evidence_tier ? ' selected' : ''}>Self-declared</option>
                <option value="documented"${r.evidence_tier === 'documented' ? ' selected' : ''}>Documented</option>
                <option value="verified"${r.evidence_tier === 'verified' ? ' selected' : ''}>Third-party verified</option>
              </select>
            </div>
            ${i.allows_na ? `<label class="esg-q__na">
              <input type="checkbox" name="na_${esc(i.id)}"${r.is_na ? ' checked' : ''}> Not applicable</label>` : '<span></span>'}
          </div>
          ${done.length ? `<details class="esg-evidence">
            <summary>${esc(done.length)} proposal${done.length === 1 ? '' : 's'} already reviewed</summary>
            <div class="esg-evidence__body">
              ${done.map((x) => `<span class="esg-evidence__k">${esc(x.status === 'accepted' ? 'Accepted' : 'Dismissed')}</span>
                <span class="esg-evidence__v">${esc(optionWord(x.proposed_option_code))} — from ${esc(x.filename)}${
  x.page_no ? `, page ${esc(x.page_no)}` : ''}${x.reviewed_at ? `, reviewed ${esc(dayOf(x.reviewed_at))}` : ''}</span>`).join('')}
            </div>
          </details>` : ''}
        </div>`;
  }).join('')}
      </section>`;
    };

    // ── The queue, stated once at the top ───────────────────────────────────
    const allStates = inds.map(answerState);
    const totalReview = allStates.filter((s) => s === 'review').length;
    const totalMissing = allStates.filter((s) => s === 'missing').length;
    const totalEvidenced = allStates.filter((s) => s === 'documented' || s === 'verified').length;
    const firstReview = inds.find((i) => answerState(i) === 'review');

    const queue = totalReview > 0 ? `
      <div class="esg-next">
        <span class="esg-next__label">Review queue</span>
        <h2 class="esg-next__title">${esc(totalReview)} answer${totalReview === 1 ? '' : 's'} the platform prepared for you</h2>
        <p class="esg-next__why">Each one quotes the sentence it came from, in a document you
          uploaded. Nothing it read has changed your assessment — accepting is what does that, and
          the answer is then recorded against your name.</p>
        <div class="esg-next__actions">
          <a class="btn btn-primary" href="#q-${esc(firstReview.code)}">Go to the first one</a>
          <a class="btn btn-outline" href="/documents">See the documents they came from</a>
        </div>
      </div>` : `
      <div class="esg-ai esg-ai--${props.length ? 'done' : 'empty'}">
        <span class="esg-ai__dot" style="color:var(--${props.length ? 'esg-done' : 'esg-blocked'})" aria-hidden="true"></span>
        <div class="esg-ai__body">
          <p class="esg-ai__title">${props.length
    ? 'Every proposal has been reviewed'
    : 'Nothing has been proposed for this assessment'}</p>
          <p class="esg-ai__detail">${props.length
    ? `${esc(props.length)} were put to you and none is outstanding. That is a measured result — the queue is empty rather than switched off.`
    : 'The platform reads documents you upload and proposes answers with the sentence it found them in. It has not proposed anything for this assessment yet.'}</p>
        </div>
      </div>`;

    res.send(layout(`Assessment ${a[0].reporting_year}`, `
      <div class="esg-page">
        <div class="esg-section__head">
          <h2 class="esg-section__title">${esc(frameworkLabel(a[0].framework_code, a[0].framework_version))}</h2>
          <span class="esg-section__note">${esc(totalEvidenced)} of ${esc(inds.length)} evidenced${
  totalMissing ? ` · ${esc(totalMissing)} not answered` : ''}</span>
        </div>

        ${queue}

        <div class="esg-ai esg-ai--idle">
          <span class="esg-ai__dot" style="color:var(--border-2)" aria-hidden="true"></span>
          <div class="esg-ai__body">
            <p class="esg-ai__title">How this is scored</p>
            <p class="esg-ai__detail">An answer marked <strong>self-declared</strong> earns 60% of the
              available points, <strong>documented</strong> 85%, <strong>third-party verified</strong> 100%.
              A screening that awards full marks for unevidenced self-assessment is worth nothing to
              the bank or buyer reading it, so attaching a document you already hold is the cheapest
              way to raise your score.</p>
          </div>
        </div>

        <form method="post" action="/assessment/${esc(a[0].id)}">
          ${section('E')}${section('S')}${section('G')}
          <div class="esg-row">
            <button class="btn btn-primary" type="submit" name="action" value="submit">Save and calculate the score</button>
            <button class="btn btn-outline" type="submit" name="action" value="save">Save without scoring</button>
          </div>
        </form>
        ${reviewForms}
      </div>`, req.user, '/assessment'));
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

    /* P8 · ONTO THE DESIGN LAYER, AND OFF .table-wrap.
       This is the table D1 was written about: at 390px it measured 464px
       inside a 354px box, so the kg CO2e column — the value the page exists to
       show — sat off-screen with no gesture that could reveal it. §5's
       .esg-table-scroll is the component that fixes it, and this page was
       still not using it. The 🤖 on the import button and the four inline
       `style=` attributes went at the same time. */
    const table = entries.length ? `
      <div class="esg-table-scroll" tabindex="0" role="region" aria-label="Carbon entries">
        <table class="esg-table esg-table--stack">
          <thead><tr>
            <th>Period</th><th>Scope</th><th>Activity</th><th>Factor</th><th class="esg-td-num">kg CO2e</th>
          </tr></thead>
          <tbody>${entries.map((e) => `<tr${e.is_provisional ? ' class="esg-row-caution"' : ''}>
            <td data-label="Period" class="esg-td-nowrap">${esc(dayOf(e.period_start))} → ${esc(dayOf(e.period_end))}</td>
            <td data-label="Scope">Scope ${esc(e.scope)}</td>
            <td data-label="Activity" class="esg-num">${esc(e.activity_amount)} ${esc(e.activity_unit)}</td>
            <td data-label="Factor"><span class="esg-small esg-num">${esc(e.factor_value_used)} · v${esc(e.factor_version_used)}</span>${
  e.is_provisional ? ' <span class="esg-astate esg-astate--missing">Provisional</span>' : ''}</td>
            <td data-label="kg CO2e" class="esg-td-num"><strong>${esc(e.kg_co2e)}</strong></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`
      : emptyState('instrumented_but_empty', {
        title: 'No carbon entries yet',
        body: 'The engine is switched on and working — nobody has recorded an activity for it to '
            + 'compute against.' });

    res.send(layout('Carbon', `
      <div class="esg-page">
        <header class="esg-page-header esg-enter">
          <div class="esg-page-header__text">
            <h2 class="esg-h1">Carbon</h2>
            <p class="esg-page-header__intro">Every figure here is your own activity multiplied by a
              stamped emission factor. Nothing is estimated, and an entry whose factor is not yet
              sourced says so on its own row.</p>
          </div>
          ${grid ? `<div class="esg-page-header__action">
            <a class="btn btn-outline" href="/carbon/import">Bulk import from Excel</a>
          </div>` : ''}
        </header>

        ${!grid ? `<div class="esg-ai esg-ai--idle">
          <span class="esg-ai__dot" style="color:var(--esg-caution)" aria-hidden="true"></span>
          <div class="esg-ai__body">
            <p class="esg-ai__title">Set your electricity grid first</p>
            <p class="esg-ai__detail">Scope 2 cannot be calculated without it — Malaysia has three
              grids and their factors differ by a factor of 3.7.
              <a href="/company">Open the company profile</a>.</p>
          </div></div>` : `
        <section class="esg-card esg-enter" style="--esg-i:1">
          <div class="esg-card__header">
            <h3 class="esg-card__title">Add an entry</h3>
            <span class="esg-card__meta">Activity in, kg CO2e out</span>
          </div>
          <div class="esg-card__body esg-stack">
            <form method="post" action="/carbon" class="esg-row esg-row-controls">
              <div class="form-group"><label for="kind">Type</label>
                <select id="kind" name="kind">
                  <option value="electricity">Electricity (Scope 2)</option>
                  <option value="FUEL_DIESEL">Diesel (Scope 1)</option>
                  <option value="FUEL_PETROL">Petrol (Scope 1)</option>
                </select></div>
              <div class="form-group"><label for="amount">Amount</label>
                <input id="amount" name="amount" type="number" step="any" min="0" required></div>
              <div class="form-group"><label for="period_start">From</label>
                <input id="period_start" name="period_start" type="date" required></div>
              <div class="form-group"><label for="period_end">To</label>
                <input id="period_end" name="period_end" type="date" required></div>
              <button class="btn btn-primary" type="submit">Add</button>
            </form>
            <p class="esg-small esg-prose">Diesel and petrol factors are placeholders pending a
              sourced Malaysian figure. Entries using them are stored and shown, and marked
              provisional — never presented as verified.</p>
          </div>
        </section>`}

        <section class="esg-section esg-enter" style="--esg-i:2">
          <div class="esg-section__head">
            <h3 class="esg-section__title">Recorded activity</h3>
            <span class="esg-section__note">${entries.length
    ? `${esc(entries.length)} entr${entries.length === 1 ? 'y' : 'ies'}, most recent first`
    : 'Nothing recorded yet'}</span>
          </div>
          ${table}
        </section>
      </div>`, req.user, '/carbon'));
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
    /* P8 CLEANUP · THE SEARCH AND ITS RESULTS, ON THE ESG LAYER.
       The form was a three-property inline `style=` flex row and the results a
       bare <table>. The table is the one that mattered: it is five columns of
       registry metadata and it was rendering with no scroll container at all,
       so on a phone it was the same silent-clipping shape as §5's D1. */
    const body = status.state === 'populated'
      ? `<form method="get" class="esg-row esg-row-controls">
           <div class="form-group">
             <label for="verra-q">Search the registry mirror</label>
             <input id="verra-q" name="q" value="${esc(q)}" placeholder="Project, country or methodology">
           </div>
           <button class="btn btn-primary">Search</button>
         </form>
         ${q ? (results.length ? `
            <div class="esg-table-scroll" tabindex="0" role="region" aria-label="Registry mirror search results">
              <table class="esg-table esg-table--stack">
                <thead><tr><th>ID</th><th>Name</th><th>Country</th><th>Methodology</th><th>Status</th></tr></thead>
                <tbody>${results.map((r) => `<tr>
                  <td data-label="ID" class="esg-td-nowrap">${esc(r.verra_project_id)}</td>
                  <td data-label="Name">${esc(r.name)}</td>
                  <td data-label="Country">${esc(r.country)}</td>
                  <td data-label="Methodology" class="esg-td-nowrap">${esc(r.methodology_code)}</td>
                  <td data-label="Status">${esc(r.status)}</td>
                </tr>`).join('')}</tbody>
              </table>
            </div>
            <p class="esg-small esg-prose">Records mirrored from a public carbon crediting registry.
              Metadata and links only.</p>`
    : emptyState('zero', { title: 'No matches', body: `Nothing in the mirror matches "${q}".` })) : ''}`
      : emptyState(status.state, {
        title: status.state === 'uninstrumented' ? 'Registry mirror is not switched on' : 'Registry mirror is empty',
        body: status.state === 'uninstrumented'
          ? 'Registry ingest has not been configured, so nothing writes to this table yet. See the deployment notes for the environment variables it needs.'
          : 'Ingest is configured and working — the sync has not run yet or returned no records.' });

    /* ═══════════════════════════════════════════════════════════════════════
       P8 CLEANUP · GOVERNANCE, ON THE ESG DESIGN LAYER
       ─────────────────────────────────────────────────────────────────────
       This was the last page still built entirely from master components, and
       it was not a cosmetic gap — four measured defects, all of which the ESG
       layer already had the component to prevent:

       1. SIX PADDING-COLLAPSED CARDS. `.card` fails OPEN (§4's D5): it carries
          no padding and expects `.card-body` to supply it. Not one card here
          had one, so every one measured `padding: 0px` and its text sat on the
          border. .esg-card fails CLOSED — a bare one is padded.
       2. EVERY BULLET DRAWN OUTSIDE ITS BOX. The master narrows `ul` to
          `margin: 0; padding: 0` and leaves `list-style: disc`, so a disc
          marker is painted outside the content box — in the card's padding, or
          clipped by it. Five lists on this page. §23 fixes it in .esg-prose.
       3. PROSE AT 1140px, about 145 characters a line. `p` has
          `max-width: none`; .esg-prose caps at --esg-measure.
       4. THE STAGE TABLE CLIPPED AT 390px. Measured 419px inside a 390px
          viewport, inside the master's `.table-wrap { overflow: hidden }` —
          and the column lost was "Status here", which is the only column the
          table exists to show. That is D1's data-loss shape exactly.

       NOTHING THIS PAGE SAYS HAS CHANGED. Every sentence, every list item and
       every stage is the wording it had; what changed is the container it sits
       in. The one addition is the third registry fact, and it publishes a value
       the service already computes and this page was discarding — see below.
       ═══════════════════════════════════════════════════════════════════════ */

    // The stage ladder is DATA now rather than five hand-written rows, because
    // the status word and the state class have to agree and two of them
    // disagreeing is exactly the kind of thing nobody re-reads.
    const STAGES = [
      { n: 1, what: 'Self-assessment against the framework', who: 'The company', ours: true },
      { n: 2, what: 'Evidence attached and reviewed by a person', who: 'The company', ours: true },
      { n: 3, what: 'Independent verification of the disclosures', who: 'An external assurance provider', ours: false },
      { n: 4, what: 'Certification against a published standard', who: 'A certification body', ours: false },
      { n: 5, what: 'Investor or customer due diligence', who: 'The counterparty', ours: false },
    ];

    res.send(layout('Governance & Recognition', `
      <div class="esg-page">
        <header class="esg-page-header esg-enter">
          <div class="esg-page-header__text">
            <h2 class="esg-h1">Governance &amp; Recognition</h2>
            <p class="esg-page-header__intro">Who owns this platform, what it is for, and — the
              part that matters when a bank or a buyer asks — exactly how far it goes and where
              it stops.</p>
          </div>
        </header>

        <section class="esg-section esg-enter" style="--esg-i:1">
          <div class="esg-section__head">
            <h3 class="esg-section__title">Registration and ownership</h3>
            <span class="esg-section__note">SMEs Sustainable Entrepreneur Organisation</span>
          </div>
          <div class="esg-card"><div class="esg-card__body esg-prose">
            <p><strong>Registration.</strong> The Malaysia SMEs ESG e-Reporting System is
              registered under the SMEs Sustainable Entrepreneur Organisation (SSEO) as the
              official platform for participating SME organisations and ESG reporting
              initiatives.</p>
            <p><strong>Platform owner.</strong> SMEs Sustainable Entrepreneur Organisation (SSEO).
              SSEO owns the assessment framework this platform runs on and is the body that
              revises it — a new version is issued as a new framework record, never an edit
              to the one companies have already been scored against.</p>
            <p class="esg-small">Scores carry the framework version, the weighting version and
              the engine version that produced them, so any result on this platform can be traced
              back to the exact rules in force when it was calculated.</p>
          </div></div>
        </section>

        <section class="esg-section esg-enter" style="--esg-i:2">
          <div class="esg-section__head">
            <h3 class="esg-section__title">Where this platform sits</h3>
            <span class="esg-section__note">A starting point, never an endorsement</span>
          </div>
          <div class="esg-card"><div class="esg-card__body esg-stack">
            <p class="esg-body esg-prose">This platform produces a
              <strong>self-declared assessment supported by evidence</strong>. It is a starting
              point, not an endorsement, and it deliberately stops before the steps that require
              an independent party.</p>
            <div class="esg-table-scroll" tabindex="0" role="region" aria-label="How far this platform goes">
              <table class="esg-table esg-table--stack">
                <thead><tr><th>Stage</th><th>Who does it</th><th>Status here</th></tr></thead>
                <tbody>${STAGES.map((s) => `<tr>
                  <td data-label="Stage">${esc(s.n)} · ${esc(s.what)}</td>
                  <td data-label="Who does it">${esc(s.who)}</td>
                  <td data-label="Status here"><span class="esg-astate esg-astate--${s.ours ? 'verified' : 'na'}">${
  s.ours ? 'This platform' : 'Not part of this platform'}</span></td>
                </tr>`).join('')}</tbody>
              </table>
            </div>
            <p class="esg-small esg-prose">A score here does not certify anything and is not a
              substitute for stages 3 to 5. It is designed to make those stages cheaper by having
              the evidence already organised against the disclosures a counterparty will ask for.</p>
          </div></div>
        </section>

        <section class="esg-section esg-enter" style="--esg-i:3">
          <div class="esg-section__head">
            <h3 class="esg-section__title">What the platform is for</h3>
            <span class="esg-section__note">Stated by SSEO · not an inventory of what is built</span>
          </div>
          <div class="esg-grid esg-grid-2">
            <div class="esg-card">
              <div class="esg-card__header"><h4 class="esg-card__title">Purpose</h4></div>
              <div class="esg-card__body esg-prose">
                <p class="esg-small">The platform aims to:</p>
                <ul>
                  <li>Accelerate ESG adoption among Malaysian SMEs.</li>
                  <li>Simplify ESG reporting through a user-friendly digital system.</li>
                  <li>Enhance ESG readiness for local and international supply chains.</li>
                  <li>Support access to sustainable finance and ESG-linked opportunities.</li>
                  <li>Strengthen SME competitiveness through improved governance and sustainability
                      practices.</li>
                </ul>
              </div>
            </div>

            <!-- OBJECTIVES ARE NOT A FEATURE LIST.
                 Two of the eight — peer benchmarking and report generation — describe
                 capability that renders an uninstrumented empty state today. They are
                 what the source document calls objectives, so they are rendered as
                 objectives: a prose block of its own, carrying no control, no badge and
                 no link to a working screen. A reader who mistakes this for an inventory
                 of what is built has been misled by the page, not by the list. Do not
                 put a button in this card.
                 P8 note: it moved into an .esg-card beside Purpose and gained no
                 control, no chip and no link in the process. The rule above is
                 unchanged and still binding. -->
            <div class="esg-card">
              <div class="esg-card__header"><h4 class="esg-card__title">Platform objectives</h4></div>
              <div class="esg-card__body esg-prose">
                <p class="esg-small">Stated by SSEO for the system as a whole. This is what the
                  platform is for — not a description of what this screen does. Where a capability
                  is not built yet, the page for it says so in its own words.</p>
                <p class="esg-small">The system supports SMEs to:</p>
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
            </div>
          </div>
        </section>

        <section class="esg-section esg-enter" style="--esg-i:4">
          <div class="esg-section__head">
            <h3 class="esg-section__title">Who is involved, and what it is meant to achieve</h3>
          </div>
          <div class="esg-grid esg-grid-2">
            <div class="esg-card">
              <div class="esg-card__header"><h4 class="esg-card__title">Stakeholder ecosystem</h4></div>
              <div class="esg-card__body esg-prose">
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
            </div>
            <div class="esg-card">
              <div class="esg-card__header"><h4 class="esg-card__title">Expected outcomes</h4></div>
              <div class="esg-card__body esg-prose">
                <ul>
                  <li>Increase ESG adoption among Malaysian SMEs.</li>
                  <li>Improve supply-chain sustainability readiness.</li>
                  <li>Enhance transparency and governance.</li>
                  <li>Enable access to green financing and investment opportunities.</li>
                  <li>Support Malaysia&rsquo;s ESG and Sustainable Development Goals (SDGs) agenda.</li>
                  <li>Build a nationally recognised digital ESG reporting ecosystem for SMEs.</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section class="esg-section esg-enter" style="--esg-i:5">
          <div class="esg-section__head">
            <h3 class="esg-section__title">Carbon Crediting Registry</h3>
            <span class="esg-section__note">Public reference · feeds no score</span>
          </div>

          <div class="esg-ai esg-ai--idle">
            <span class="esg-ai__dot" style="color:var(--esg-info)" aria-hidden="true"></span>
            <div class="esg-ai__body">
              <p class="esg-ai__title">What this is, and what it is not</p>
              <p class="esg-ai__detail">A local mirror of a public carbon-crediting registry, for
                carbon-credit lookup. That registry certifies individual carbon <em>projects</em>
                and issues tradable carbon units — it does not rate companies on E, S and G, so
                nothing here feeds your ESG score. The scoring engine refuses to score against it
                by design.</p>
              <p class="esg-ai__detail">Projects are ingested. Methodology records and credit
                issuances are <em>not</em> — nothing writes those tables, so this page shows no
                count for them rather than a zero that would read as &ldquo;none exist&rdquo;.</p>
            </div>
          </div>

          <!-- THE THIRD FACT IS NOT A NEW CLAIM. verraService.mirrorStatus()
               already returns methodologies_state: 'uninstrumented', and this
               page was computing it and throwing it away — so a reader saw two
               tiles and no indication that a third thing exists at all. It
               renders as §20's ABSENT fact, which states what is missing and
               why; it is still not a count, which is what the note above
               requires. -->
          <div class="esg-facts">
            <div class="esg-fact esg-fact--verified">
              <span class="esg-fact__label">Projects mirrored</span>
              <span class="esg-fact__value esg-num">${esc(status.projects)}</span>
              <span class="esg-fact__from">Ingested from the public registry</span>
            </div>
            <div class="esg-fact${status.last_fetch ? '' : ' esg-fact--absent'}">
              <span class="esg-fact__label">Last fetch</span>
              <span class="esg-fact__value esg-num">${status.last_fetch ? esc(dayOf(status.last_fetch)) : 'Never run'}</span>
              <span class="esg-fact__from">${status.last_fetch
    ? 'The most recent successful sync' : 'No sync has completed on this deployment'}</span>
            </div>
            <div class="esg-fact esg-fact--absent">
              <span class="esg-fact__label">Methodologies mirrored</span>
              <span class="esg-fact__value">Not mirrored</span>
              <span class="esg-fact__from">Nothing ingests them, so there is no number that could
                be true — not a count of zero</span>
            </div>
          </div>

          ${body}
        </section>
      </div>`, req.user, '/governance'));
  } catch (err) { next(err); }
});

// ── Reports & documents (sprint 2 surfaces, honestly labelled) ─────────────
/* ═══════════════════════════════════════════════════════════════════════════
   REPORTING READINESS                                             (Run 63/P9)
   ───────────────────────────────────────────────────────────────────────────
   THERE IS STILL NO REPORT GENERATOR, AND P9 DID NOT BUILD ONE.

   What this page replaced was a single uninstrumented empty state that said
   the gap was visible. It was — and it was also the only answer this product
   gave to "what would go in a report", which is a question an SME asks the
   week before they need one.

   So the page now answers the OTHER half, which is genuinely answerable: if a
   report were assembled today, what would be in it, what would be missing, and
   what could not be in it at all. Eleven sections in three states, from
   reportReadiness.js. The generator's absence is the FIRST thing on the page
   rather than a footnote, and there is no button anywhere on it that produces
   a file — §4.3c, and the reason the old page existed in the first place.
   ═══════════════════════════════════════════════════════════════════════════ */
router.get('/reports', async (req, res, next) => {
  try {
    const companyId = companyIdOf(req);
    const live = await journey.loadLiveAssessment(companyId);
    const r = await reportReadiness.assess(companyId, live ? live.id : null);

    const STATE_CLASS = { available: 'verified', missing: 'missing', not_configured: 'na' };

    const notBuilt = `
      <div class="esg-reserved">
        <span class="esg-reserved__mark" aria-hidden="true">${icon('frameworks')}</span>
        <div>
          <h3 class="esg-reserved__title">Nothing on this platform produces a report file</h3>
          <p class="esg-reserved__body">${esc(r.generator.detail)}</p>
        </div>
        <span class="esg-reserved__status">Generator not built</span>
      </div>`;

    const section = (s, i) => `
      <div class="esg-fact${s.state === 'available' ? ' esg-fact--verified' : ' esg-fact--absent'} esg-fact--text"
           style="--esg-i:${esc(i)}">
        <span class="esg-fact__label">${esc(s.name)}</span>
        <span class="esg-fact__value">
          <span class="esg-astate esg-astate--${esc(STATE_CLASS[s.state])}">${esc(reportReadiness.STATE_WORD[s.state])}</span>
          ${s.count !== null ? `<span class="esg-num">${esc(s.count)}</span> ${esc(s.unit || '')}` : ''}
        </span>
        <span class="esg-fact__from">${esc(s.what)}${s.why ? ` ${esc(s.why)}` : ''}</span>
      </div>`;

    const available = r.sections.filter((s) => s.state === 'available');
    const missing = r.sections.filter((s) => s.state === 'missing');
    const impossible = r.sections.filter((s) => s.state === 'not_configured');

    const group = (title, note, list, idx) => (list.length ? `
      <section class="esg-section esg-enter" style="--esg-i:${idx}">
        <div class="esg-section__head">
          <h3 class="esg-section__title">${esc(title)}</h3>
          <span class="esg-section__note">${esc(note)}</span>
        </div>
        <div class="esg-facts">${list.map(section).join('')}</div>
      </section>` : '');

    res.send(layout('Reporting readiness', `
      <div class="esg-page">
        <header class="esg-page-header esg-enter">
          <div class="esg-page-header__text">
            <h2 class="esg-h1">Reporting readiness</h2>
            <p class="esg-page-header__intro">What an ESG report could be assembled from today,
              what is not there yet, and the three sections this platform cannot produce for any
              company. Assembling the document itself is not built, and this page will not offer
              a button that produces a stub.</p>
          </div>
        </header>

        <section class="esg-section esg-enter" style="--esg-i:1">
          <div class="esg-stack">${notBuilt}</div>
        </section>

        <section class="esg-section esg-enter" style="--esg-i:2">
          <div class="esg-section__head">
            <h3 class="esg-section__title">Where you stand</h3>
            <span class="esg-section__note">Eleven sections a report would have</span>
          </div>
          <div class="esg-facts">
            <div class="esg-fact">
              <span class="esg-fact__label">Available</span>
              <span class="esg-fact__value esg-num">${esc(r.counts.available)}</span>
              <span class="esg-fact__from">Rows exist and the count is real</span>
            </div>
            <div class="esg-fact${r.counts.missing ? ' esg-fact--absent' : ''}">
              <span class="esg-fact__label">Nothing recorded</span>
              <span class="esg-fact__value esg-num">${esc(r.counts.missing)}</span>
              <span class="esg-fact__from">The platform can hold these and you have none yet</span>
            </div>
            <div class="esg-fact esg-fact--absent">
              <span class="esg-fact__label">Not configured</span>
              <span class="esg-fact__value esg-num">${esc(r.counts.not_configured)}</span>
              <span class="esg-fact__from">This platform cannot produce these for anyone</span>
            </div>
          </div>
        </section>

        ${group('What a report could draw on today', 'Every count names the table it came from', available, 3)}
        ${group('What is not there yet', 'An empty account, and you can change it', missing, 4)}
        ${group('What cannot be in a report at all', 'Not your data — a capability nobody has published', impossible, 5)}

        <section class="esg-section esg-enter" style="--esg-i:6">
          <div class="esg-section__head">
            <h3 class="esg-section__title">Why there is no download button</h3>
            <span class="esg-section__note">A stated decision, not an oversight</span>
          </div>
          <div class="esg-card"><div class="esg-card__body">
            <div class="esg-rec"><span class="esg-rec__head">A stub would be worse than nothing</span>
              <p class="esg-rec__text">A button that produced a thin PDF would make you believe the
                capability exists, and you would stop looking for the real one. The material above
                is genuinely there and can be read on the screens it lives on; what is missing is
                the thing that turns it into a document.</p></div>
            <div class="esg-rec"><span class="esg-rec__head">The hard part is not the file format</span>
              <p class="esg-rec__text">It is deciding how a report labels a self-declared answer next
                to a documented one, an expected benefit next to a measured one, and a provisional
                emission factor next to a sourced one. This platform keeps those apart everywhere
                else; a report that flattened them would be a weaker document than the data behind
                it.</p></div>
          </div></div>
        </section>
      </div>`, req.user, '/reports'));
  } catch (err) { next(err); }
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
 *  would imply measured completion that nothing here measures.
 *
 *  P10 MOVED IT OFF THE MASTER'S BARE .card. That card FAILS OPEN — D5 in the
 *  ESG layer's own header — and it measured 0px padding on all six pages that
 *  render this helper, so every scope list sat flush against a bordered box.
 *  They were the last six surfaces still on pre-P8 markup, and they are all in
 *  the navigation.
 *
 *  Nothing here says anything new: same title, same items, same statement that
 *  it is a scope and not a claim. Only the components changed. */
const scope = (title, items) => `
  <section class="esg-section esg-enter" style="--esg-i:2">
    <div class="esg-section__head">
      <h3 class="esg-section__title">${esc(title)}</h3>
      <span class="esg-section__note">A scope statement, not a claim that any of it works</span>
    </div>
    <div class="esg-card"><div class="esg-card__body">
      <ul class="esg-prose">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
    </div></div>
  </section>`;

/** NOT BUILT AT ALL — and P10 says so with the product's own vocabulary.
 *
 *  This rendered the master's .coming-soon with a 🚧 emoji. P8 removed emoji
 *  everywhere it looked, as the strongest "generated template" signal in the
 *  interface; it did not look here, so four navigable pages kept theirs.
 *
 *  §10's .esg-reserved is the component this product already uses for a
 *  capability that is defined and deliberately not operational — the dashboard
 *  renders SustNET and Certification through it. A page that is not built is
 *  the same fact about a whole destination, so it gets the same treatment and
 *  the same drawn glyph. The words are unchanged. */
const comingSoon = (title, body, phase) => `
  <section class="esg-section esg-enter">
    <div class="esg-reserved">
      <span class="esg-reserved__mark" aria-hidden="true">${icon('future')}</span>
      <div>
        <h3 class="esg-reserved__title">${esc(title)}</h3>
        <p class="esg-reserved__body">${esc(body)}</p>
      </div>
      <span class="esg-reserved__status">Not built</span>
      ${phase ? `<p class="esg-small esg-prose">${esc(phase)}</p>` : ''}
    </div>
  </section>`;

// ── Frameworks — the real one ──────────────────────────────────────────────
router.get('/frameworks', (req, res) => {
  const { PROVENANCE: p, COUNTS: c } = sedg;

  /* THE TIER IS A WORD IN ITS OWN COLUMN, not a coloured badge.
     It was green / blue / amber for Basic / Intermediate / Advanced. The
     original audit's finding about this product was that amber alone carried
     FIVE unrelated meanings, and a colour a user cannot learn is not carrying
     information — a tier ladder in a column headed "Tier", with all three
     values visible at once, is read from the word. Dropping the badge also
     removes 38 instances of the master's 11px .badge from a page whose type
     scale P8 otherwise fixed. */

  const pillars = sedg.grouped().map((g, gi) => `
    <section class="esg-section esg-enter" style="--esg-i:${gi + 2}">
      <div class="esg-section__head">
        <h3 class="esg-section__title">${esc(g.pillarName)}</h3>
        <span class="esg-section__note">${esc(g.topics.reduce((n, t) => n + t.disclosures.length, 0))} disclosures</span>
      </div>
      <div class="esg-card"><div class="esg-card__body esg-stack-loose">
        ${g.topics.map((t) => `
          <div class="esg-stack-tight">
            <h4 class="esg-h3">${esc(t.topic)}</h4>
            <div class="esg-table-scroll" tabindex="0" role="region" aria-label="${esc(t.topic)} disclosures">
              <table class="esg-table esg-table--stack">
                <thead><tr><th>Code</th><th>Tier</th><th>Disclosure</th><th>Unit</th></tr></thead>
                <tbody>
                  ${t.disclosures.map((d) => `<tr>
                    <td data-label="Code" class="esg-td-nowrap">${esc(d.code)}${d.newInV2
    ? ' <span class="esg-q__map">new in v2</span>' : ''}</td>
                    <td data-label="Tier">${esc(d.tier)}</td>
                    <td data-label="Disclosure">${esc(d.text)}</td>
                    <td data-label="Unit">${esc(d.unit)}</td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>`).join('')}
      </div></div>
    </section>`).join('');

  const others = `
    <section class="esg-section esg-enter" style="--esg-i:8">
      <div class="esg-section__head">
        <h3 class="esg-section__title">Other frameworks</h3>
        <span class="esg-section__note">Named so the gap is visible</span>
      </div>
      <div class="esg-card"><div class="esg-card__body esg-stack">
        <p class="esg-small esg-prose">None of these is loaded, mapped or scored.</p>
        <div class="esg-table-scroll" tabindex="0" role="region" aria-label="Other frameworks">
          <table class="esg-table esg-table--stack">
            <thead><tr><th>Framework</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>
              ${sedg.OTHER_FRAMEWORKS.map((f) => `<tr>
                <td data-label="Framework">${esc(f.name)}</td>
                <td data-label="Status"><span class="esg-astate esg-astate--na">Not loaded</span></td>
                <td data-label="Note">${esc(f.note)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div></div>
    </section>`;

  res.send(layout('Frameworks', `
    <div class="esg-page">
    <header class="esg-page-header esg-enter">
      <div class="esg-page-header__text">
        <h2 class="esg-h1">Frameworks</h2>
        <p class="esg-page-header__intro">The official published disclosure set this platform is
          reconciled against, and an honest account of what it does and does not implement.</p>
      </div>
    </header>

    <section class="esg-section esg-enter" style="--esg-i:1">
      <div class="esg-section__head">
        <h3 class="esg-section__title">${esc(p.document)}</h3>
        <span class="esg-section__note">Published ${esc(p.published)}</span>
      </div>
      <div class="esg-card"><div class="esg-card__body esg-stack">
        <div class="esg-prose">
          <p><strong>Publisher.</strong> ${esc(p.publisher)}, ${esc(p.publisherNote)}.</p>
          <p><strong>Source.</strong> <a href="${esc(p.pdf)}" rel="noreferrer noopener" target="_blank">${esc(p.pdf)}</a></p>
        </div>
        <!-- §20's facts, not .stat-card. Three counts of one published document,
             each with what it counts stated under it. -->
        <div class="esg-facts">
          <div class="esg-fact">
            <span class="esg-fact__label">Disclosures</span>
            <span class="esg-fact__value esg-num">${esc(c.total)}</span>
            <span class="esg-fact__from">In the published set</span>
          </div>
          <div class="esg-fact">
            <span class="esg-fact__label">E / S / G</span>
            <span class="esg-fact__value esg-num">${esc(c.pillars.E)} / ${esc(c.pillars.S)} / ${esc(c.pillars.G)}</span>
            <span class="esg-fact__from">Split by pillar</span>
          </div>
          <div class="esg-fact">
            <span class="esg-fact__label">Basic / Inter. / Adv.</span>
            <span class="esg-fact__value esg-num">${esc(c.tiers.Basic)} / ${esc(c.tiers.Intermediate)} / ${esc(c.tiers.Advanced)}</span>
            <span class="esg-fact__from">Split by tier</span>
          </div>
        </div>
        <p class="esg-small esg-prose">${esc(p.countNote)}</p>
      </div></div>
    </section>

    <!-- .alert-body ADDED IN P9, AND IT IS NOT COSMETIC.
         The master's .alert is display:flex, so its children are flex ITEMS
         IN A ROW. This block put a badge and two long paragraphs directly
         inside it, which is fine at desktop and collapses at phone width:
         MEASURED at 360px, the badge took its width first and the first
         paragraph was squeezed into a 74px column whose right edge landed at
         391 — clipped by .app-main's own overflow: hidden, with no scrollbar
         and no gesture to recover it. The whole "what this platform claims,
         precisely" statement, which is the most carefully worded paragraph in
         the product, was unreadable on a phone.

         .alert-body is the master's own wrapper for exactly this and the
         company-profile banner in this same file already uses it. Nothing
         about the master changed; this block was simply not using it. Found by
         the 360px viewport P9 added to the visual probe — it is not a P9
         surface and the defect predates this run. -->
    <div class="alert">
      <div class="alert-body">
      <span class="esg-astate esg-astate--missing">SEDG-ALIGNED (DRAFT)</span>
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
    </div>

    ${pillars}
    ${others}
    </div>`, req.user, '/frameworks'));
});

// ── Analytics — table exists, nothing writes to it ─────────────────────────
router.get('/analytics', (req, res) => {
  res.send(layout('Analytics', `
    <div class="esg-page">
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
      ])}</div>
  `, req.user, '/analytics'));
});

// ── KPIs — table exists, nothing writes to it ──────────────────────────────
router.get('/kpis', (req, res) => {
  res.send(layout('KPIs', `
    <div class="esg-page">
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
      ])}</div>
  `, req.user, '/kpis'));
});

// ── AI Assistant — not built as a standalone surface ───────────────────────
// The AI layer itself IS real and reachable today: `generateRecommendations`
// runs on the assessment result and every call is logged to
// esg_ai_interactions. What does not exist is a conversational assistant, so
// this is coming-soon rather than uninstrumented — and it says where the
// working AI actually is, rather than implying there is none.
router.get('/assistant', (req, res) => {
  res.send(layout('AI Assistant', `
    <div class="esg-page">
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
      ])}</div>
  `, req.user, '/assistant'));
});

// ── Workflow — not built ───────────────────────────────────────────────────
router.get('/workflow', (req, res) => {
  res.send(layout('Workflow', `
    <div class="esg-page">
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
      ])}</div>
  `, req.user, '/workflow'));
});

// ── Users & Roles — not built ──────────────────────────────────────────────
router.get('/users', (req, res) => {
  res.send(layout('Users & Roles', `
    <div class="esg-page">
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
      ])}</div>
  `, req.user, '/users'));
});

// ── Integrations — not built ───────────────────────────────────────────────
router.get('/integrations', (req, res) => {
  res.send(layout('Integrations', `
    <div class="esg-page">
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
      ])}</div>
  `, req.user, '/integrations'));
});


// ── The design-system reference ────────────────────────────────────────────
//
// NOT A FEATURE, and deliberately not in the navigation: this is the surface
// the ESG layer is DEVELOPED and INSPECTED against. Every component in
// public/css/esg-system.css appears here once, with real ESG content rather
// than "Lorem" — a swatch page proves a colour, a page built from the product's
// own sentences proves the component holds the product's own text.
//
// Withheld in production. A style reference is not something an SME owner has
// any use for, and a route that exists only for us should not be reachable by
// them. It 404s there through the normal handler, which is the same answer any
// unknown path gets.
router.get('/design-system', (req, res, next) => {
  if (process.env.NODE_ENV === 'production') return next();

  const card = (title, meta, body) => `
    <section class="esg-card">
      <div class="esg-card__header">
        <h2 class="esg-card__title">${esc(title)}</h2>
        ${meta ? `<span class="esg-card__meta">${esc(meta)}</span>` : ''}
      </div>
      <div class="esg-card__body">${body}</div>
    </section>`;

  const scaleRow = (token, label) => `
    <div class="esg-row esg-row-between" style="border-bottom:1px solid var(--border);padding:8px 0">
      <span style="font-size:var(--${token})">${esc(label)}</span>
      <span class="esg-meta">--${esc(token)}</span>
    </div>`;

  res.send(layout('Design system', `
    <div class="esg-stack-loose esg-stack">

      <header class="esg-card">
        <h1 class="esg-display">The ESG design system</h1>
        <p class="esg-body-2 esg-prose">
          The local layer that sits on top of the shared Modus design system. It adds only what
          the master does not provide — a spacing scale, a type scale, a reading measure, a card
          that cannot collapse, a table that cannot clip — and never edits the master. Every
          component below is rendered by the same stylesheet the application loads.
        </p>
      </header>

      ${card('Type scale', 'D3 — the master ships none', `
        <div class="esg-prose-wide">
          ${scaleRow('esg-text-4xl', 'The score, and nothing else')}
          ${scaleRow('esg-text-3xl', 'Page display')}
          ${scaleRow('esg-text-2xl', 'Section heading')}
          ${scaleRow('esg-text-xl', 'Card heading')}
          ${scaleRow('esg-text-lg', 'Card title')}
          ${scaleRow('esg-text-md', 'Body — the default')}
          ${scaleRow('esg-text-sm', 'Supporting text')}
          ${scaleRow('esg-text-xs', 'Labels and table headers')}
          ${scaleRow('esg-text-2xs', 'Provenance and legal only')}
        </div>
        <p class="esg-small" style="margin-top:16px">
          The floor is 11px and 11px is reserved for provenance. The audit found 48 elements below
          12px on the dashboard alone, and card titles rendering smaller than the body they headed.
        </p>`)}

      ${card('Reading measure', 'D4 — the master ships none', `
        <p class="esg-body esg-prose">
          This paragraph is capped at <code>--esg-measure</code>, 68 characters. The audit measured
          explanatory text on Green Finance running to 145 characters per line and dashboard copy to
          138. A line that long loses the reader on the return sweep, and no amount of type styling
          repairs it.
        </p>
        <p class="esg-small" style="margin-top:12px">Wide, scanned content uses --esg-measure-wide (92ch) instead.</p>`)}

      ${card('Card composition', 'D5 — the master card fails open', `
        <div class="esg-stack">
          <div class="esg-card">
            <h3 class="esg-h3">A bare card</h3>
            <p class="esg-body-2 esg-prose">No header, no body wrapper — and still padded. The
            master's <code>.card</code> would render this text one pixel from its border, which is
            what 30 of 37 cards in this app currently do.</p>
          </div>
          <div class="esg-card">
            <div class="esg-card__header">
              <h3 class="esg-card__title">A composed card</h3>
              <span class="esg-card__meta">header · body · footer</span>
            </div>
            <div class="esg-card__body">
              <p class="esg-body-2 esg-prose">The card yields its padding to the parts. The two
              cards above cannot touch: an adjacent-sibling margin makes the measured 0px gap
              impossible.</p>
            </div>
            <div class="esg-card__footer"><span class="esg-small">Footer</span></div>
          </div>
        </div>`)}

      ${card('Table', 'D1 — the master clips with no scroll', `
        <div class="esg-table-scroll" tabindex="0" role="region" aria-label="Example emissions table">
          <table class="esg-table esg-table--stack">
            <thead><tr>
              <th>Period</th><th>Scope</th><th>Activity</th><th>Factor</th><th class="esg-td-num">kg CO2e</th>
            </tr></thead>
            <tbody>
              <tr>
                <td data-label="Period" class="esg-td-nowrap">Oct – Dec 2025</td>
                <td data-label="Scope">Scope 2</td>
                <td data-label="Activity" class="esg-td-num">42,600 kWh</td>
                <td data-label="Factor">0.74 · v2022-2024</td>
                <td data-label="kg CO2e" class="esg-td-num">31,524</td>
              </tr>
              <tr class="esg-row-caution">
                <td data-label="Period" class="esg-td-nowrap">Jul – Dec 2025</td>
                <td data-label="Scope">Scope 1</td>
                <td data-label="Activity" class="esg-td-num">3,350 litre</td>
                <td data-label="Factor">2.68 · placeholder <span class="esg-chip esg-chip--caution">provisional</span></td>
                <td data-label="kg CO2e" class="esg-td-num">8,978</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="esg-small" style="margin-top:12px">
          Scrolls horizontally, is focusable so a keyboard can scroll it, and below 640px each row
          becomes a labelled block with nothing off-screen. The period is a period, not a
          <code>Date.toString()</code>.
        </p>`)}

      ${card('ESG score', 'the product’s central output', `
        <div class="esg-score">
          ${scoreRing(68, null, 'ESG score 68 out of 100', { size: 'hero', den: 100 })}
          <div class="esg-score__band">
            <span class="esg-chip esg-chip--done">A · Established</span>
            <span class="esg-score__bandname">Established</span>
            <span class="esg-score__basis">39 of 40 indicators answered, 1 not applicable. Computed by the scoring engine at weighting version 1.0.</span>
          </div>
        </div>
        <div class="esg-pillars" style="margin-top:24px">
          <div class="esg-pillar">
            <div class="esg-pillar__head"><span class="esg-pillar__name">Environmental</span><span class="esg-pillar__value esg-num">59</span></div>
            <span class="esg-progress"><span class="esg-progress__fill" style="width:59%"></span></span>
            <span class="esg-pillar__basis">13 of 14 answered · 1 N/A</span>
          </div>
          <div class="esg-pillar">
            <div class="esg-pillar__head"><span class="esg-pillar__name">Social</span><span class="esg-pillar__value esg-num">71</span></div>
            <span class="esg-progress"><span class="esg-progress__fill" style="width:71%"></span></span>
            <span class="esg-pillar__basis">13 of 13 answered</span>
          </div>
          <div class="esg-pillar">
            <div class="esg-pillar__head"><span class="esg-pillar__name">Governance</span><span class="esg-pillar__value esg-num">76</span></div>
            <span class="esg-progress"><span class="esg-progress__fill" style="width:76%"></span></span>
            <span class="esg-pillar__basis">13 of 13 answered</span>
          </div>
        </div>`)}

      ${card('Journey stages', 'four states that cannot look alike', `
        <div class="esg-stage esg-stage--done">
          <span class="esg-stage__node" aria-hidden="true">✓</span>
          <div>
            <h3 class="esg-stage__title">Answer the assessment <span class="esg-chip esg-chip--done">Done</span></h3>
            <p class="esg-stage__why">Every indicator the framework asks for, minus the ones marked not applicable.</p>
          </div>
        </div>
        <div class="esg-stage esg-stage--current">
          <span class="esg-stage__node" aria-hidden="true"></span>
          <div>
            <h3 class="esg-stage__title">Review what it proposed <span class="esg-chip esg-chip--current">Next</span></h3>
            <p class="esg-stage__why">A proposal is a proposal until a person accepts it. Nothing an AI read out of a PDF raises your score on its own.</p>
          </div>
        </div>
        <div class="esg-stage esg-stage--next">
          <span class="esg-stage__node" aria-hidden="true"></span>
          <div>
            <h3 class="esg-stage__title">Define a green project</h3>
            <details class="esg-stage__more"><summary>Why this matters</summary>
              <p class="esg-stage__why">A project is what a lender is actually told about, in the vocabulary a Malaysian bank's credit paper uses.</p>
            </details>
          </div>
        </div>
        <div class="esg-stage esg-stage--blocked">
          <span class="esg-stage__node" aria-hidden="true"></span>
          <div>
            <h3 class="esg-stage__title">Certification <span class="esg-chip esg-chip--blocked">Blocked</span></h3>
            <p class="esg-stage__why">No SustNET ESG certification scheme is published. This platform assesses; it does not certify.</p>
          </div>
        </div>`)}

      ${card('AI states', 'five facts that must never render alike', `
        <div class="esg-stack-tight">
          <div class="esg-ai esg-ai--idle">
            <span class="esg-ai__dot" style="color:var(--esg-blocked)" aria-hidden="true"></span>
            <div class="esg-ai__body"><p class="esg-ai__title">Not run yet</p>
            <p class="esg-ai__detail">The suggestion scan has not been started for this company.</p></div>
          </div>
          <div class="esg-ai esg-ai--running">
            <span class="esg-ai__spinner" aria-hidden="true"></span>
            <div class="esg-ai__body"><p class="esg-ai__title">Scanning</p>
            <p class="esg-ai__detail">It runs in the background. This page will show what it proposed once it finishes.</p></div>
          </div>
          <div class="esg-ai esg-ai--done">
            <span class="esg-ai__dot" style="color:var(--esg-done)" aria-hidden="true"></span>
            <div class="esg-ai__body"><p class="esg-ai__title">Three suggestions to review</p>
            <p class="esg-ai__detail">A suggestion is a suggestion until you accept it.</p></div>
          </div>
          <div class="esg-ai esg-ai--empty">
            <span class="esg-ai__dot" style="color:var(--esg-blocked)" aria-hidden="true"></span>
            <div class="esg-ai__body"><p class="esg-ai__title">Ran, and proposed nothing</p>
            <p class="esg-ai__detail">The run is switched on and working. It found nothing for this company — which is a result, not an absence.</p></div>
          </div>
          <div class="esg-ai esg-ai--failed">
            <span class="esg-ai__dot" style="color:var(--esg-problem)" aria-hidden="true"></span>
            <div class="esg-ai__body"><p class="esg-ai__title">The run did not complete</p>
            <p class="esg-ai__detail">Nothing below is missing because your company has no options — the analysis itself did not run.</p></div>
          </div>
          <div class="esg-skeleton" style="height:44px"></div>
        </div>`)}

      ${card('Status colour', 'one meaning per colour', `
        <div class="esg-row">
          <span class="esg-chip esg-chip--done">Done</span>
          <span class="esg-chip esg-chip--current">In progress</span>
          <span class="esg-chip esg-chip--blocked">Blocked</span>
          <span class="esg-chip esg-chip--caution">Provisional</span>
          <span class="esg-chip esg-chip--problem">Needs you</span>
          <span class="esg-chip esg-chip--info">Reference</span>
        </div>
        <p class="esg-small esg-prose" style="margin-top:16px">
          The audit found amber carrying five unrelated meanings — draft, provisional, Advanced tier,
          Unclear availability and out-of-scope. Each slot above names a meaning, not a colour, and
          resolves to a master token, so the palette stays the master's and only the mapping is ours.
        </p>`)}

      ${card('Green finance readiness', 'structure only — P6 decides the wording', `
        <div class="esg-readiness">
          <span class="esg-chip esg-chip--caution">Not yet</span>
          <div>
            <h3 class="esg-readiness__verdict">Two things stand between you and a green facility</h3>
            <p class="esg-readiness__why">Readiness is measured against what an institution asks for, not against your score. Nothing here has been checked with any lender.</p>
            <ul class="esg-readiness__gaps">
              <li class="esg-readiness__gap"><span class="esg-chip esg-chip--problem">Missing</span> A defined project with a baseline</li>
              <li class="esg-readiness__gap"><span class="esg-chip esg-chip--caution">Provisional</span> Two carbon entries use an unverified factor</li>
            </ul>
          </div>
        </div>`)}

      ${card('Scope ladder', 'where this platform stops', `
        <div class="esg-ladder">
          <div class="esg-ladder__step esg-ladder__step--ours">
            <span class="esg-ladder__n">1</span>
            <div><div class="esg-ladder__what">Self-assessment against the framework</div><div class="esg-ladder__who">The company</div></div>
            <span class="esg-chip esg-chip--done">This platform</span>
          </div>
          <div class="esg-ladder__step esg-ladder__step--ours">
            <span class="esg-ladder__n">2</span>
            <div><div class="esg-ladder__what">Evidence attached and reviewed by a person</div><div class="esg-ladder__who">The company</div></div>
            <span class="esg-chip esg-chip--done">This platform</span>
          </div>
          <div class="esg-ladder__step esg-ladder__step--not-ours">
            <span class="esg-ladder__n">3</span>
            <div><div class="esg-ladder__what">Independent verification of the disclosures</div><div class="esg-ladder__who">An external assurance provider</div></div>
            <span class="esg-chip esg-chip--blocked">Not here</span>
          </div>
          <div class="esg-ladder__step esg-ladder__step--not-ours">
            <span class="esg-ladder__n">4</span>
            <div><div class="esg-ladder__what">Certification against a published standard</div><div class="esg-ladder__who">A certification body</div></div>
            <span class="esg-chip esg-chip--blocked">Not here</span>
          </div>
        </div>`)}

      ${card('Mobile navigation', 'no destination may be dropped', `
        <p class="esg-body-2 esg-prose">At 768px the shared shell hides the sidebar for a five-item
        bar, and eleven destinations became unreachable. The sheet below is built on
        <code>&lt;details&gt;</code>, so every destination stays reachable with no client-side
        JavaScript. P3 wires the shell to it.</p>
        <details class="esg-nav-more" style="margin-top:16px">
          <summary><span aria-hidden="true">≡</span> More</summary>
          <div class="esg-nav-sheet">
            <div class="esg-nav-sheet__group">Assess</div>
            <a class="esg-nav-sheet__link" href="/journey">ESG Journey</a>
            <a class="esg-nav-sheet__link" href="/carbon">Carbon</a>
            <div class="esg-nav-sheet__group">Finance</div>
            <a class="esg-nav-sheet__link" href="/green-finance" aria-current="page">Green Finance</a>
            <div class="esg-nav-sheet__group">Intelligence</div>
            <a class="esg-nav-sheet__link esg-nav-sheet__link--unbuilt" href="/analytics">Analytics</a>
            <a class="esg-nav-sheet__link esg-nav-sheet__link--unbuilt" href="/kpis">KPIs</a>
          </div>
        </details>`)}

    </div>`, req.user, ''));
});


module.exports = router;
