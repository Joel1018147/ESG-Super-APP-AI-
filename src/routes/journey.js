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
   to fold is that a mission is a stage's predicate with an XP price on it —
   the same predicate, evaluated by the same function. Two pages would render
   one set of facts under two headings, and the day the two renderings drift is
   the day a user sees a completed mission under an unfinished stage. It also
   keeps BOTTOM_NAV_KEYS untouched, which is a decision and not a side effect.

   NO NEW CSS. Every class here comes from §50 of the master stylesheet, which
   Run 50 fanned out to all thirteen paths and Run 51 synced into this repo at
   md5 8b92094c. A per-repo edit to the design system is a §1 defect, and a
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

const DAY_MS = 24 * 3600 * 1000;

/** §50 gives three state classes and no fourth. A blocked node deliberately
 *  carries none of them: it is not pending, and dressing it as pending is the
 *  error this whole run is about. */
const NODE_CLASS = Object.freeze({
  completed: 'journey-node is-done',
  in_progress: 'journey-node is-active',
  pending: 'journey-node is-pending',
  blocked: 'journey-node',
});

/** The text half of every state. §50's own header says it: a done node says
 *  "Done", a mission at 3 of 8 says "3 of 8". A green ring that says nothing is
 *  not an accessible progress indicator. */
function stateWords(s) {
  if (s.state === 'completed') return 'Done';
  if (s.state === 'blocked') return 'Blocked';
  if (s.total > 1) return `${s.done} of ${s.total}`;
  return s.state === 'in_progress' ? 'In progress' : 'Not started yet';
}

function stageNode(s) {
  const blocked = s.state === 'blocked';
  const badge = blocked
    ? '<span class="milestone-badge is-locked">Blocked</span>'
    : `<span class="milestone-badge${s.state === 'completed' ? ' is-earned' : ''}">${esc(stateWords(s))}</span>`;
  const reason = blocked
    ? `<p class="text-sm">${esc(s.blocked_reason || 'No reason recorded.')}</p>`
    : '';
  const ratio = (!blocked && s.total > 1)
    ? `<div class="mission-progress"><span style="width:${Math.round((s.done / s.total) * 100)}%"></span></div>`
    : '';
  return `<div class="${NODE_CLASS[s.state]}">
    <div>
      <div class="journey-node-label">${esc(s.label_en)} ${badge}</div>
      <div class="journey-node-meta">${esc(s.group_code)} · ${esc(stateWords(s))}</div>
      ${s.description_en ? `<p class="text-sm">${esc(s.description_en)}</p>` : ''}
      ${reason}
      ${ratio}
    </div>
  </div>`;
}

/* The only inline style in this file is a computed WIDTH on a progress bar,
   which is a data value and not a theme choice — the same shape as §50's
   `--score` on .score-ring. No inline colour, spacing or typography: the gaps
   come from the shell's `.grid`, which is layout geometry and not a token. */
function missionCard(m, deep) {
  const pct = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
  return `<div class="mission-card${deep ? ' mission-card--deep' : ''}${m.state === 'completed' ? ' is-complete' : ''}">
    <div class="mission-title">${esc(m.label_en)}</div>
    <div class="mission-meta">${esc(stateWords(m))} · ${esc(m.xp_award)} XP</div>
    ${m.description_en ? `<p class="text-sm">${esc(m.description_en)}</p>` : ''}
    <div class="mission-progress"><span style="width:${pct}%"></span></div>
  </div>`;
}

router.get('/journey', wrap(async (req, res) => {
  const companyId = companyIdOf(req);
  const { stages, missions, levels } = await journey.loadDefinitions();

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
  const xp = journey.computeXp(facts, missions, levels);

  // The clock lives HERE and not in the engine: computeXp stays pure, and the
  // week filter applies to each award's own source-row timestamp.
  const weekXp = journey.xpSince(xp.awards, new Date(Date.now() - 7 * DAY_MS).toISOString());

  const pct = xp.max_xp > 0 ? Math.round((xp.total / xp.max_xp) * 100) : 0;
  const active = j.stages.find((s) => s.stage_code === j.active_stage_code) || null;
  const activeMissions = active ? m.missions.filter((x) => x.stage_code === active.stage_code) : [];

  const milestones = m.missions.map((x) => `<span class="milestone-badge${
    x.state === 'completed' ? ' is-earned' : ' is-locked'}">${esc(x.label_en)} · ${esc(x.xp_award)} XP</span>`).join(' ');

  res.send(layout('ESG Journey', `
    <h2 class="page-title">Your ESG journey</h2>

    <div class="alert alert-info" role="alert" aria-live="polite"><div class="alert-body">
      <strong>Nothing on this page is a stored counter.</strong> Every figure here is worked out
      from rows you can go and look at — a profile field you filled in, a document you uploaded, an
      answer you gave. Delete one of those and the figure goes down, because there is nowhere else
      it is kept.
    </div></div>

    <div class="stat-grid reveal">
      <div class="stat-card stat-card--glow">
        <div class="stat-label">Experience</div>
        <div class="stat-value">${esc(xp.total)}</div>
        <div class="stat-sub">of ${esc(xp.max_xp)} available · <span class="level-chip">Level ${esc(xp.level)} · ${esc(xp.label)}</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Earned in the last 7 days</div>
        <div class="stat-value">${esc(weekXp)}</div>
        <div class="stat-sub">counted from each source row's own date</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Stages done</div>
        <div class="stat-value">${esc(j.counts.completed)}</div>
        <div class="stat-sub">${esc(j.counts.in_progress)} in progress ·
          ${esc(j.counts.pending)} to come · ${esc(j.counts.blocked)} blocked</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Missions complete</div>
        <div class="stat-value">${esc(m.completed)}</div>
        <div class="stat-sub">of ${esc(m.total)}</div>
      </div>
    </div>

    <div class="card reveal">
      <h3 class="section-title">Level ${esc(xp.level)} · ${esc(xp.label)}</h3>
      <div class="xp-bar"><span style="width:${pct}%"></span></div>
      <p class="text-sm">${esc(xp.total)} XP of ${esc(xp.max_xp)}. ${xp.next_level_min_xp === null
    ? 'This is the highest level in the ladder.'
    : `Next level at ${esc(xp.next_level_min_xp)} XP.`}</p>
      <p class="text-muted text-sm">The level names are a choice this product made. They are not a
         rating, nobody outside this platform defines them, and your ESG band — which is a rating —
         is a completely separate thing computed by the scoring engine.</p>
    </div>

    ${active ? `<div class="card reveal">
      <h3 class="section-title">What to do next</h3>
      <p><strong>${esc(active.label_en)}</strong>${active.description_en ? ` — ${esc(active.description_en)}` : ''}</p>
      ${activeMissions.length
    ? `<div class="grid">${activeMissions.map((x) => missionCard(x, true)).join('')}</div>`
    : emptyState('instrumented_but_empty', {
      title: 'No mission on this stage',
      body: 'This stage carries no mission, so there is no XP attached to it. The stage still has to happen.' })}
    </div>` : `<div class="card reveal">
      <h3 class="section-title">What to do next</h3>
      ${emptyState('zero', {
    title: 'Nothing is waiting on you',
    body: 'Every stage that can be reached today is done. The remaining ones are blocked, and each says why.' })}
    </div>`}

    <h3 class="section-title">The journey</h3>
    <div class="card reveal">
      <div class="journey"><div class="journey-rail">
        ${j.stages.map(stageNode).join('')}
      </div></div>
    </div>

    <h3 class="section-title">Missions</h3>
    <div class="card reveal">
      <p class="text-muted text-sm">Every mission is the same fact its stage is measured on, with an
         XP price attached. There is no separate mission to complete and nothing to claim — doing the
         work is what completes it.</p>
      <p>${milestones}</p>
      <div class="grid">${m.missions.map((x) => missionCard(x, false)).join('')}</div>
    </div>

    <h3 class="section-title">Not built, and why</h3>
    <div class="card">
      <p class="text-sm">There is deliberately <strong>no leaderboard</strong> here. A cross-company
         leaderboard exposes one company's ESG progress to another, an SME's score is commercially
         sensitive, and a safe version needs opt-in, anonymised handles and a minimum cohort size.
         That is a commercial decision nobody has made, so the feature does not exist rather than
         existing in a form that leaks.</p>
      <p class="text-sm">There are <strong>no rewards</strong> either. XP buys nothing, and saying so
         is more honest than a screen implying it might.</p>
    </div>

    <script>
    /* §50's .reveal RESTS VISIBLE and is hidden only under [data-reveal="on"],
       which is set here AFTER confirming there is an IntersectionObserver to
       turn it back on again. If this script never runs, never loads, or throws,
       the content is simply visible. The opposite arrangement — hide in CSS,
       reveal in JS — makes the page depend on a script it cannot check, and
       fails silently to exactly the users least able to report it. */
    (function () {
      if (!('IntersectionObserver' in window)) return;
      var nodes = document.querySelectorAll('.reveal');
      if (!nodes.length) return;
      document.documentElement.setAttribute('data-reveal', 'on');
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        });
      }, { rootMargin: '0px 0px -40px 0px' });
      nodes.forEach(function (n) { io.observe(n); });
    })();
    </script>`, req.user, NAV));
}));

module.exports = router;
