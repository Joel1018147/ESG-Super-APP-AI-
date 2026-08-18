'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   THE JOURNEY PAGE                                                 (Run 52)
   ───────────────────────────────────────────────────────────────────────────
   The page half only. Every JSON endpoint for this module lives in
   routes/api.js under the existing `/api` mount — recurring-bugs-checklist.md
   #17: `requireAuth`'s `/api/` prefix test is only as good as its premise, and
   a JSON route served from a router mounted at `/` gets the 302 meant for a
   page navigation, after which the caller parses the login page as JSON and
   reports the feature as unavailable.

   MISSIONS ARE ON THIS PAGE RATHER THAN ON A SECOND ONE, and the nav therefore
   gains ONE entry rather than two. The brief left the choice open; the reason
   to fold is that a mission IS a stage's predicate under another name — the
   same predicate, evaluated by the same function. Two pages would render
   one set of facts under two headings, and the day the two renderings drift is
   the day a user sees a completed mission under an unfinished stage. It also
   keeps BOTTOM_NAV_KEYS untouched, which is a decision and not a side effect.

   NO NEW CSS. Every class here comes from §50 of the master stylesheet, which
   Run 50 fanned out to all thirteen paths and Run 51 synced into this repo at
   md5 8b92094c — Run 54 moved that to 5785b26f. A per-repo edit is a §1
   defect, and a
   class that merely LOOKS like a design-system class fails silently — CSS
   never warns. Every class below was grepped out of that file before it was
   written here.

   THE FOUR STATES RENDER DIFFERENTLY, AND `blocked` IS THE ONE THAT MATTERS.
   §50 ships .is-done / .is-active / .is-pending and no blocked modifier, so a
   blocked node carries NO state class — which is a visibly different node — and
   a locked milestone badge, and the reason in words. Colour is never the
   difference on its own (§6): every state also says what it is.
   ═══════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const { layout, esc, emptyState } = require('../utils/layout');
const journey = require('../services/journeyEngine');

const router = express.Router();

// Express 4 hangs a request forever on an unhandled rejection instead of
// 500-ing, which reads as a network fault and logs nothing worth reading.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const NAV = '/journey';
const companyIdOf = (req) => req.user && req.user.company_id;

// The rail and the nodes are rendered by utils/journeyView.js. They used to
// live here, and then the dashboard needed
// the same rail — two renderings of one set of four states is how the two end
// up disagreeing, and a user would see a stage marked done on one page and in
// progress on the other before we did.
const view = require('../utils/journeyView');

const { stateWords, stageNode, STAGE_LINK, STAGE_CTA, pad2 } = view;

router.get('/journey', wrap(async (req, res) => {
  const companyId = companyIdOf(req);
  const { stages, missions } = await journey.loadDefinitions();

  if (!stages.length) {
    // UNINSTRUMENTED, not empty. The journey is DEFINED in seed.sql; no rows
    // means the seed did not run, which is a deployment fault and not a company
    // that has done nothing.
    return res.send(layout('ESG Journey',
      emptyState('uninstrumented', {
        title: 'The journey has not been set up',
        body: 'No stage is defined on this deployment, so there is nothing to show your position '
            + 'against. This is a configuration gap, not an empty account.' }),
      req.user, NAV));
  }

  const facts = await journey.gatherFacts(companyId);
  const j = journey.computeJourney(facts, stages);
  const m = journey.computeMissions(facts, missions);

  /* ── P8 REMOVED THE XP CHROME FROM THIS PAGE, NOT THE XP ENGINE ──────────
     This page carried it in four places: "60 XP on completion" in the tally,
     "Level 3 · Sapling · 250 of 570 XP" under the next move, "250 XP of 570,
     140 this week" and "Level 3 · Sapling, next at 360 XP" in the strip.

     P8's directive rules points, levels and ladders out as the metaphor — the
     product is a MISSION PROGRESSION, and a level name beside a real financing
     readiness figure reads as a different and smaller product. Everything the
     four lines said that was TRUE is still said, in mission and stage terms,
     because that is what the user is actually progressing through.

     computeXp, xpSince, esg_missions.xp_award and GET /api/xp are untouched
     and still derive from committed rows; journey-test.js still asserts that
     deleting a source row lowers the total. What this page stopped doing is
     RENDERING it, which is why `levels` is no longer destructured here. */

  const active = j.stages.find((s) => s.stage_code === j.active_stage_code) || null;
  const activeMissions = active ? m.missions.filter((x) => x.stage_code === active.stage_code) : [];

  /* ═════════════════════════════════════════════════════════════════════════
     THE MISSION MAP                                                     (P5)
     ───────────────────────────────────────────────────────────────────────
     ONE REPRESENTATION. The page used to render the same thirteen stages three
     times — a rail, a chip row, and a set of mission cards — so a reader met
     each stage three times and none of them led. There is now one spine, cut
     into ARCS, with the current mission raised above it.

     THE ARCS ARE DATA. `group_code` is on the stage row; nothing here decides
     which arc a stage belongs to, and a fourteenth stage in a new group appears
     under its own heading with no code change. ARC_LABEL only supplies English
     for a code, and an unknown code falls through to the code itself rather
     than being dropped.
     ═════════════════════════════════════════════════════════════════════════ */

  const ARC_LABEL = Object.freeze({
    assess:   'Understand and assess',
    evidence: 'Evidence and verification',
    improve:  'Improve',
    finance:  'Green opportunity and finance',
    expert:   'Expert support',
    certify:  'Recognition',
  });

  // ONE ARC PER GROUP, ordered by where that group FIRST appears in the
  // engine's stage order; stages keep the engine's order inside their arc.
  //
  // A contiguous walk was the first attempt and it rendered "Understand and
  // assess" TWICE — the seeded order interleaves the groups (profile, then
  // three evidence stages, then three more assess stages), so an arc that
  // resumes later opened a second heading with the same name. Two identical
  // headings on one page read as a bug whatever the data says.
  //
  // The stage's own position in the journey is still stated, above, on the
  // current mission — this changes how the map is GROUPED, never what any
  // stage is or what order the engine works in.
  const arcIndex = new Map();
  const arcs = [];
  for (const s of j.stages) {
    if (!arcIndex.has(s.group_code)) {
      arcIndex.set(s.group_code, arcs.length);
      arcs.push({ code: s.group_code, stages: [] });
    }
    arcs[arcIndex.get(s.group_code)].stages.push(s);
  }

  const arcBlock = (arc) => {
    const done = arc.stages.filter((s) => s.state === 'completed').length;
    const open = arc.stages.filter((s) => s.state !== 'blocked').length;
    const allBlocked = open === 0;
    const pct = open > 0 ? Math.round((done / open) * 100) : 0;
    return `<div class="esg-arc${allBlocked ? ' esg-arc--reserved' : ''}">
      <span class="esg-arc__name">${esc(ARC_LABEL[arc.code] || arc.code)}</span>
      <span class="esg-arc__count">${allBlocked
    ? `${esc(arc.stages.length)} reserved`
    : `${esc(done)} of ${esc(open)} done${arc.stages.length > open
      ? ` · ${esc(arc.stages.length - open)} blocked` : ''}`}</span>
      ${allBlocked ? '' : `<span class="esg-arc__bar esg-progress"><span class="esg-progress__fill" style="width:${esc(pct)}%"></span></span>`}
    </div>
    ${arc.stages.map((s) => stageNode(s)).join('')}`;
  };

  // ── The current mission ─────────────────────────────────────────────────
  // Dominant, and carrying the one action that advances it. The stage index is
  // its position in the engine's own order, so the number on this page and the
  // number in the rail can never disagree.
  const activeIndex = active ? j.stages.indexOf(active) + 1 : null;
  const missionTally = (x) => `
    <div class="esg-tally">
      <div class="esg-tally__item">
        <span class="esg-tally__value">${esc(x.done)}</span>
        <span class="esg-tally__label">done</span>
      </div>
      <div class="esg-tally__item${x.total - x.done > 0 ? ' esg-tally__item--attention' : ''}">
        <span class="esg-tally__value">${esc(Math.max(0, x.total - x.done))}</span>
        <span class="esg-tally__label">still to do</span>
      </div>
    </div>`;

  const currentMission = active ? `
    <section class="esg-mission-now esg-enter">
      <div>
        <span class="esg-mission-now__index">Mission ${esc(pad2(activeIndex))} of ${esc(j.total_stages)} · ${esc(stateWords(active))}</span>
        <h2 class="esg-mission-now__name">${esc(active.label_en)}</h2>
        <p class="esg-mission-now__why">${esc(active.description_en || '')}</p>
        ${activeMissions.length ? activeMissions.map(missionTally).join('') : ''}
      </div>
      <div class="esg-next">
        <span class="esg-next__label">Your next move</span>
        <h3 class="esg-next__title">${esc(STAGE_CTA[active.stage_code] || 'Continue this mission')}</h3>
        <p class="esg-next__why">${activeMissions.length
    ? esc(activeMissions[0].description_en || '')
    : 'This stage carries no mission, so there is no XP attached to it. The stage still has to happen.'}</p>
        <div class="esg-next__actions">
          <a class="btn btn-primary" href="${esc(STAGE_LINK[active.stage_code] || '/journey')}">${
  esc(STAGE_CTA[active.stage_code] || 'Continue')}</a>
        </div>
        <span class="esg-meta">Mission ${esc(pad2(activeIndex))} of ${esc(j.total_stages)} · ${
  esc(j.counts.completed)} stage${j.counts.completed === 1 ? '' : 's'} behind you</span>
      </div>
    </section>`
    : `<section class="esg-mission-now esg-enter">
        <div>
          <span class="esg-mission-now__index">No open mission</span>
          <h2 class="esg-mission-now__name">Nothing is waiting on you</h2>
          <p class="esg-mission-now__why">Every stage that can be reached today is done. The
            remaining ones are blocked on something outside this platform, and each one says what.</p>
        </div>
        <div class="esg-next">
          <span class="esg-next__label">Where to look next</span>
          <h3 class="esg-next__title">Read the reserved stages</h3>
          <p class="esg-next__why">They are defined and deliberately not operational. Each names the
            precondition that would open it.</p>
          <div class="esg-next__actions"><a class="btn btn-outline" href="/dashboard">Back to the dashboard</a></div>
        </div>
      </section>`;

  // ── The quiet strip ─────────────────────────────────────────────────────
  // Four equal stat tiles became one row of figures in P5. P8 replaced the two
  // XP figures with the third real unit of progression on this page: the PHASE.
  // The arcs are already grouped above, so this is the same arithmetic the map
  // renders and cannot disagree with it — a phase is complete when every stage
  // in it that can be reached is done, and a phase with nothing reachable is
  // reserved rather than 0%, exactly as the arc heading says.
  const phasesOpen = arcs.filter((arc) => arc.stages.some((s) => s.state !== 'blocked'));
  const phasesDone = phasesOpen.filter((arc) => arc.stages
    .filter((s) => s.state !== 'blocked')
    .every((s) => s.state === 'completed'));
  const phasesReserved = arcs.length - phasesOpen.length;

  /* §18.1's stagger. --esg-i is an INDEX, in the same class of inline value as
     §50's --score on .score-ring and the computed width on a progress bar: it
     is data, not a theme choice, and nothing about colour, spacing or type is
     being written from a route. The four blocks of this page arrive 60ms
     apart, which is the only thing a staggered entrance can say — that they
     are in an order. */
  const strip = `<div class="esg-strip esg-enter" style="--esg-i:1">
    <span class="esg-strip__item"><span class="esg-strip__value">${esc(j.counts.completed)} / ${esc(j.total_stages)}</span>
      <span class="esg-strip__label">stages done${j.counts.blocked ? `, ${esc(j.counts.blocked)} blocked` : ''}</span></span>
    <span class="esg-strip__item"><span class="esg-strip__value">${esc(m.completed)} / ${esc(m.total)}</span>
      <span class="esg-strip__label">missions complete</span></span>
    <span class="esg-strip__item"><span class="esg-strip__value">${esc(phasesDone.length)} / ${esc(phasesOpen.length)}</span>
      <span class="esg-strip__label">phases complete${phasesReserved > 0 ? `, ${esc(phasesReserved)} reserved` : ''}</span></span>
  </div>`;

  res.send(layout('ESG Journey', `
    <div class="esg-page">
      ${currentMission}
      ${strip}

      <section class="esg-section esg-enter" style="--esg-i:2">
        <div class="esg-section__head">
          <h2 class="esg-section__title">The mission map</h2>
          <span class="esg-section__note">Grouped by phase · the mission number above is its position in the journey</span>
        </div>
        <div class="esg-card"><div class="esg-card__body">
          <div class="journey"><div class="journey-rail esg-map">
            ${arcs.map(arcBlock).join('')}
          </div></div>
        </div></div>
      </section>

      <section class="esg-section esg-enter" style="--esg-i:3">
        <div class="esg-section__head">
          <h2 class="esg-section__title">What this journey does not do</h2>
          <span class="esg-section__note">Absent, and said out loud</span>
        </div>
        <div class="esg-card"><div class="esg-card__body">
          <div class="esg-rec"><span class="esg-rec__head">No leaderboard</span>
            <p class="esg-rec__text">A cross-company leaderboard exposes one company&rsquo;s ESG progress
              to another, an SME&rsquo;s score is commercially sensitive, and a safe version needs opt-in,
              anonymised handles and a minimum cohort size. That is a commercial decision nobody has
              made, so the feature does not exist rather than existing in a form that leaks.</p></div>
          <div class="esg-rec"><span class="esg-rec__head">No points, levels or rewards</span>
            <p class="esg-rec__text">This journey is a sequence of real missions, not a score you
              accumulate. There are no points to earn, no level to reach and nothing a completed
              mission buys, because a number that buys nothing implies it might. The one rating this
              product publishes is your ESG band, and the scoring engine computes it from your own
              answers.</p></div>
          <div class="esg-rec"><span class="esg-rec__head">No stored counters</span>
            <p class="esg-rec__text">Nothing on this page is a number someone incremented. Delete a
              document or an answer and the figure goes down, because there is nowhere else it is kept.</p></div>
        </div></div>
      </section>
    </div>`, req.user, NAV));
    /* The .reveal observer used to live here. It is in the shell now — one
       definition, so a second page cannot ship a copy that drifts. */
}));

module.exports = router;
