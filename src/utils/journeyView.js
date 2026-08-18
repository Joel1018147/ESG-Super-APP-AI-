'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   HOW A STAGE AND A MISSION LOOK                                   (Run 53)
   ───────────────────────────────────────────────────────────────────────────
   ONE definition, used by /journey and by /dashboard. Two renderings of the
   same four states is how the two end up disagreeing, and a user would see
   that before we did — a stage marked done on one page and in progress on the
   other is worse than either being wrong on its own.

   NO NEW CSS. Every class here is §50 of the master stylesheet, grepped for
   before it was written. Durations and easings are the §50 tokens; nothing in
   this file names a colour, a size or a duration.

   THE FOUR STATES RENDER DIFFERENTLY AND EACH SAYS WHICH IT IS. §50 ships
   .is-done / .is-active / .is-pending and no blocked modifier, so a blocked
   node carries NO state class — a visibly different node — plus a grey badge
   and the reason in words. §6: state is never colour alone.

   WHY NEITHER .is-earned NOR .is-locked APPEARS HERE — AND WHAT CHANGED.
   Run 53 measured both against §6's 4.5:1 rule with test/lib/contrast.js and
   found both failing, so neither was used:

     .milestone-badge.is-earned   1.2:1 light  — --accent-contrast is #ffffff
                                                 over a pale --accent-light, so
                                                 it was white on near-white
     .milestone-badge.is-locked   ~3.2:1       — opacity 0.6 over an already
                                                 quiet pair
     .milestone-badge (resting)   7.06 / 4.97  — passed both themes
     .badge.badge-gray            6.76 / 5.71  — passed both themes

   RUN 54 FIXED .is-earned in the master and fanned it out: it now pairs
   --accent-text with --accent-bg and measures 5.08 light / 5.28 dark, so it is
   available to any page that wants it. It is still not used HERE, and now for
   a design reason rather than a contrast one — a rail where every completed
   node is accent-tinted turns the whole spine one colour, and §6's "state is
   never colour alone" is carried by the word, not the tint. .is-locked is
   still unfixed: opacity 0.6 over a quiet pair remains below 4.5:1, and this
   file's four states do not include "locked" anyway.
   ═══════════════════════════════════════════════════════════════════════════ */

const { esc } = require('./layout');

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

/** A computed WIDTH is the only inline style this module emits. It is a data
 *  value and not a theme choice — the same shape as §50's own `--score` on
 *  .score-ring, which that section documents as the way to drive a ring. */
function progressBar(done, total) {
  const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;
  return `<div class="mission-progress"><span style="width:${pct}%"></span></div>`;
}

function stageNode(s, opts = {}) {
  const blocked = s.state === 'blocked';
  const badge = blocked
    ? '<span class="badge badge-gray">Blocked</span>'
    : `<span class="milestone-badge">${esc(stateWords(s))}</span>`;
  const reason = blocked
    ? `<p class="text-sm">${esc(s.blocked_reason || 'No reason recorded.')}</p>`
    : '';
  const description = (opts.compact || !s.description_en)
    ? '' : `<p class="text-sm">${esc(s.description_en)}</p>`;
  const ratio = (!blocked && s.total > 1) ? progressBar(s.done, s.total) : '';
  return `<div class="${NODE_CLASS[s.state]}">
    <div>
      <div class="journey-node-label">${esc(s.label_en)} ${badge}</div>
      <div class="journey-node-meta">${esc(s.group_code)} · ${esc(stateWords(s))}</div>
      ${description}
      ${reason}
      ${ratio}
    </div>
  </div>`;
}

/** The rail. `.journey` supplies the spine, `.journey-rail` the stack, and the
 *  nodes sit on it — that nesting is what §50's ::before offset is calculated
 *  against, so it is not decorative. */
function rail(stages, opts = {}) {
  return `<div class="journey"><div class="journey-rail">
    ${stages.map((s) => stageNode(s, opts)).join('')}
  </div></div>`;
}

/* missionCard() and xpBlock() WERE HERE, AND P8 DELETED THEM.
   Both were already unreachable — P5 replaced the card grid with the arc map
   and the P5 report listed them as an available cleanup pass — and both
   rendered the chrome P8's directive rules out: a level chip, an XP bar, and a
   per-card "· 60 XP". Leaving a dead renderer for a metaphor the product has
   decided against is how it comes back, so it is gone rather than commented.

   Nothing about the ENGINE changed: computeXp, xpSince, esg_missions.xp_award
   and GET /api/xp are untouched and still derive from committed rows, and
   test/journey-test.js still asserts that deleting a source row lowers the
   total. What was removed is the presentation of it, in one file. */


/* ── WHERE A STAGE IS ACTUALLY DONE ────────────────────────────────────────
   The dashboard's next action and the journey's current mission both link
   here, so the two cannot send a user to different screens for the same stage.
   It lives beside stateWords() because it is the same kind of fact: how a
   stage is PRESENTED, not what it means.

   An unlisted code falls back to /journey, which is always correct if never
   specific — a stage with no destination yet is a stage you read about. */
const STAGE_LINK = Object.freeze({
  COMPANY_PROFILE:     '/company',
  DOCUMENTS_UPLOADED:  '/documents',
  EXTRACTION_RUN:      '/documents',
  PROPOSALS_REVIEWED:  '/documents',
  ASSESSMENT_ANSWERED: '/assessment',
  ASSESSMENT_SCORED:   '/assessment',
  CARBON_DATA:         '/carbon',
  RECOMMENDATIONS:     '/assessment',
  GREEN_PROJECT:       '/green-finance/projects',
  CARBON_BASELINE:     '/green-finance/projects',
});
const STAGE_CTA = Object.freeze({
  COMPANY_PROFILE:     'Complete your profile',
  DOCUMENTS_UPLOADED:  'Upload a document',
  EXTRACTION_RUN:      'Open evidence',
  PROPOSALS_REVIEWED:  'Review the proposals',
  ASSESSMENT_ANSWERED: 'Answer the assessment',
  ASSESSMENT_SCORED:   'Calculate the score',
  CARBON_DATA:         'Add carbon data',
  RECOMMENDATIONS:     'Read the roadmap',
  GREEN_PROJECT:       'Define a project',
  CARBON_BASELINE:     'Compute the baseline',
});

/** Two digits, so a rail of thirteen stages does not jump between 9 and 10. */
const pad2 = (n) => String(n).padStart(2, '0');

module.exports = { NODE_CLASS, STAGE_LINK, STAGE_CTA, pad2, stateWords, stageNode, rail, progressBar };
