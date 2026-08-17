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

   WHY NEITHER .is-earned NOR .is-locked APPEARS HERE. Both are §50 modifiers
   and both fail §6's 4.5:1 rule, measured with test/lib/contrast.js rather
   than guessed:

     .milestone-badge.is-earned   1.2:1 light  — --accent-contrast is #ffffff
                                                 over a pale --accent-light, so
                                                 it is white on near-white
     .milestone-badge.is-locked   ~3.2:1       — opacity 0.6 over an already
                                                 quiet pair
     .milestone-badge (resting)   7.06 / 4.97  — passes both themes
     .badge.badge-gray            6.76 / 5.71  — passes both themes

   Both modifiers need a master fix and a thirteen-path fan-out. That is its
   own run, not a line in this one.
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

function missionCard(m, opts = {}) {
  const classes = ['mission-card'];
  if (opts.deep) classes.push('mission-card--deep');
  if (m.state === 'completed') classes.push('is-complete');
  return `<div class="${classes.join(' ')}">
    <div class="mission-title">${esc(m.label_en)}</div>
    <div class="mission-meta">${esc(stateWords(m))} · ${esc(m.xp_award)} XP</div>
    ${m.description_en ? `<p class="text-sm">${esc(m.description_en)}</p>` : ''}
    ${progressBar(m.done, m.total)}
  </div>`;
}

/** The XP chrome: a level chip, a bar and the numbers as TEXT. The text is not
 *  a caption on the bar — it is the answer, and the bar is the picture of it.
 *  §3.4 rule 4: if a figure animates, the final value is in the DOM before any
 *  script runs. Nothing here needs a script at all. */
function xpBlock(xp, weekXp) {
  const pct = xp.max_xp > 0 ? Math.round((xp.total / xp.max_xp) * 100) : 0;
  return `<div class="card-body">
    <p><span class="level-chip">Level ${esc(xp.level)} · ${esc(xp.label)}</span></p>
    <div class="xp-bar"><span style="width:${pct}%"></span></div>
    <p class="text-sm">${esc(xp.total)} XP of ${esc(xp.max_xp)} available${
  weekXp > 0 ? ` · ${esc(weekXp)} earned in the last 7 days` : ''}. ${xp.next_level_min_xp === null
    ? 'This is the highest level in the ladder.'
    : `Next level at ${esc(xp.next_level_min_xp)} XP.`}</p>
    <p class="text-sm">The level names are a choice this product made. They are not a rating, and
       your ESG band — which is one — is computed separately by the scoring engine.</p>
  </div>`;
}

module.exports = { NODE_CLASS, stateWords, stageNode, rail, missionCard, xpBlock, progressBar };
