'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   HOW AN ACTION, A GAP AND A ROADMAP STEP LOOK                    (Run 63/P9)
   ───────────────────────────────────────────────────────────────────────────
   ONE definition each, used by /dashboard and /improvement — and, for the gap
   card, by the assessment result too.

   This is the same decision journeyView.js records for stages and missions,
   for the same reason: two renderings of one set of facts is how the two end
   up disagreeing, and a user sees a thing marked URGENT on one page and
   RECOMMENDED on another before we do.

   NO NEW CSS IS INVENTED HERE. Every class comes from §26, §27 or §28 of
   public/css/esg-system.css, plus the master's .btn — all grepped for before
   they were written. A class that merely LOOKS like a design-system class
   fails silently; CSS never warns.

   NOTHING IS DECIDED HERE. The state, the words, the count and the basis all
   arrive already computed by actionCenter, gapAnalysis or roadmapService. This
   file chooses markup and nothing else, which is why it can be read against
   the services without holding both in your head.
   ═══════════════════════════════════════════════════════════════════════════ */

const { esc } = require('./layout');
const { STATE_WORD, STATE_MEANING, STATES } = require('../services/actionCenter');
const { STEP_WORD, LINK_WORD } = require('../services/roadmapService');
const { KIND } = require('../services/gapAnalysis');

/* ── THE ACTION CARD ──────────────────────────────────────────────────────
   §26. Four parts in the order a person asks, plus the basis.

   THE CTA IS RENDERED ONLY WHEN IT LEADS SOMEWHERE. §4.3c bans a dead
   control, and actionCenter already refuses to build an action with no href —
   so this cannot render one, and if the service is ever loosened this still
   cannot. Two guards on one rule, deliberately: the one in the service is
   about the data and the one here is about the DOM.

   A COMPLETED ACTION KEEPS ITS CTA. "Revisit this stage" is a real
   destination, and hiding it would make a finished stage the one thing on the
   page a user cannot open. */
function actionCard(a, i = 0) {
  const need = a.requirement
    ? `<p class="esg-action__need">${esc(a.requirement)}</p>` : '';
  const gain = a.opportunity
    ? `<p class="esg-action__gain">${esc(a.opportunity)}</p>` : '';
  const cta = a.href && a.cta
    ? `<div class="esg-action__cta">
         <a class="btn ${a.state === 'urgent' || a.state === 'priority' ? 'btn-primary' : 'btn-outline'}"
            href="${esc(a.href)}">${esc(a.cta)}</a>
       </div>`
    : '';
  return `<article class="esg-action esg-action--${esc(a.state)}" style="--esg-i:${esc(i)}">
    <div class="esg-action__head">
      <span class="esg-action__state">${esc(STATE_WORD[a.state] || a.state)}</span>
      <h3 class="esg-action__what">${esc(a.what)}</h3>
    </div>
    <p class="esg-action__why">${esc(a.why)}</p>
    ${need}
    ${gain}
    ${cta}
    <p class="esg-action__basis">${esc(a.basis)}</p>
  </article>`;
}

/** The seven states, defined once, in the service's own words.
 *
 *  `only` narrows it to the states actually present on the page — a legend
 *  explaining four states nobody can see is noise, and a legend that omits one
 *  the reader IS looking at is worse. */
function legend(only = null) {
  const list = only ? STATES.filter((s) => only.includes(s)) : STATES;
  return `<dl class="esg-legend">
    ${list.map((s) => `<div class="esg-legend__item">
      <dt class="esg-legend__term">${esc(STATE_WORD[s])}</dt>
      <dd class="esg-legend__def">${esc(STATE_MEANING[s])}</dd>
    </div>`).join('')}
  </dl>`;
}

/* ── THE GAP CARD ─────────────────────────────────────────────────────────
   §27. Five questions, five answers, as a definition list so the questions are
   announced with their answers rather than being five unlabelled paragraphs.

   THE FIVE TERMS ARE FIXED and every one always renders, including the two
   where the honest answer is that the platform does not know. Dropping a term
   because its answer is "nothing is configured" is how a gap quietly stops
   admitting what it cannot tell you. */
const GAP_KIND_STATE = Object.freeze({
  [KIND.UNANSWERED]:  'missing',
  [KIND.UNEVIDENCED]: 'declared',
  [KIND.PARTIAL]:     'review',
});

function gapCard(g, i = 0) {
  const answer = (q, a, unknown = false) => `
    <div>
      <dt class="esg-gap__q">${esc(q)}</dt>
      <dd class="esg-gap__a${unknown ? ' esg-gap__a--unknown' : ''}">${esc(a)}</dd>
    </div>`;

  // The AI's sentence, when one was written at score time. It is labelled as
  // the model's and it sits BELOW the engine's own account, never instead of
  // it — the number above it is the scoring engine's and the sentence is not.
  const narrative = g.narrative
    ? `<div>
         <dt class="esg-gap__q">What the AI wrote about this</dt>
         <dd class="esg-gap__a">${esc(g.narrative)}
           <span class="esg-small">${g.narrative_source === 'ai_phrasing'
    ? 'Written by the model around the engine’s figure. The figure is not the model’s.'
    : 'The model was unavailable, so this is the platform’s own deterministic sentence.'}</span>
         </dd>
       </div>`
    : '';

  return `<article class="esg-gap" style="--esg-i:${esc(i)}">
    <div class="esg-gap__head">
      ${g.code ? `<span class="esg-gap__code">${esc(g.code)}</span>` : ''}
      <h3 class="esg-gap__question">${esc(g.question || 'This disclosure is no longer on the framework')}</h3>
      ${g.points_missed === null ? '' : `<span class="esg-gap__points">${esc(g.points_missed)}</span>`}
    </div>
    <div class="esg-row">
      <span class="esg-astate esg-astate--${esc(GAP_KIND_STATE[g.kind] || 'missing')}">${esc(g.kind_label)}</span>
      <span class="esg-chip esg-chip--${g.priority === 'high' ? 'problem' : (g.priority === 'medium' ? 'caution' : 'info')}">${esc(g.priority)} priority</span>
      <span class="esg-small">${esc(g.pillar_name)}</span>
      ${g.mapping_status === 'draft'
    ? '<span class="esg-astate esg-astate--review">Draft mapping</span>' : ''}
    </div>
    <dl class="esg-gap__answers">
      ${answer('What is missing', g.what)}
      ${answer('Why it matters', g.why)}
      ${answer('What would resolve it', g.evidence.text, !g.evidence.configured)}
      ${answer('What to do', g.action)}
      ${answer('Who should act', g.who, true)}
      ${narrative}
    </dl>
    <div class="esg-gap__foot">
      <!-- .btn-sm WAS HERE AND WAS WRONG (measured in the P9 audit). The
           master sets .btn-sm to 5px padding at 12px type, which renders 24px
           tall — under the probe's 28px desktop floor and well under a
           comfortable target. It is the right component for a control inside a
           dense table row and the wrong one for the single action of a card
           that occupies half a screen. Full .btn, as everywhere else in the
           product; the master gives it 44px on a phone for free. -->
      <a class="btn btn-outline" href="${esc(g.href)}">${esc(g.action)}</a>
    </div>
  </article>`;
}

/* ── THE ROADMAP ──────────────────────────────────────────────────────────
   §28. Ten rungs, each stating what joins it to the one above.

   THE LINK LINE IS NOT DECORATION AND IS NOT OPTIONAL. It is the component's
   whole reason to exist: without it the ladder asserts causation with a line,
   which is the invention the directive bans. It is omitted on the FIRST rung
   only, because there is nothing above it to be joined to. */
function roadmapStep(s, i, total) {
  const link = i === 0 ? '' : `<p class="esg-roadmap__link">${esc(LINK_WORD[s.link])}</p>`;
  const caveat = s.detail ? `<p class="esg-roadmap__caveat">${esc(s.detail)}</p>` : '';
  const cta = s.cta && s.href
    ? `<div class="esg-action__cta"><a class="btn btn-outline" href="${esc(s.href)}">${esc(s.cta)}</a></div>`
    : '';
  return `<li class="esg-roadmap__step esg-roadmap__step--${esc(s.state)} esg-roadmap__step--${esc(s.link)}" style="--esg-i:${esc(i)}">
    ${link}
    <div class="esg-roadmap__head">
      <span class="esg-roadmap__n">${esc(String(i + 1).padStart(2, '0'))} / ${esc(String(total).padStart(2, '0'))}</span>
      <h3 class="esg-roadmap__name">${esc(s.name)}</h3>
      <span class="esg-chip esg-chip--${s.state === 'completed' ? 'done'
    : s.state === 'in_progress' || s.state === 'ready_for_review' ? 'current'
      : s.state === 'waiting' ? 'caution' : 'blocked'}">${esc(STEP_WORD[s.state])}</span>
    </div>
    <p class="esg-roadmap__what">${esc(s.what)}</p>
    ${caveat}
    ${cta}
  </li>`;
}

function roadmap(steps) {
  return `<ol class="esg-roadmap">
    ${steps.map((s, i) => roadmapStep(s, i, steps.length)).join('')}
  </ol>`;
}

/* ── THE COPILOT ANSWER ───────────────────────────────────────────────────
   §29. Rendered server-side from an answer that already exists — there is no
   client-side streaming, no placeholder and no spinner, because the answer is
   fetched on a request the user made and the page does not render until it is
   back or has failed to a template. */
function copilotAnswer(a) {
  return `<div class="esg-copilot esg-copilot--${esc(a.mode)}">
    <p class="esg-copilot__label">${a.mode === 'ai' ? 'Written by the ESG copilot' : 'The platform’s own answer'}</p>
    <p class="esg-copilot__text">${esc(a.text)}</p>
    <p class="esg-copilot__basis">${esc(a.basis)}</p>
  </div>`;
}

module.exports = { actionCard, legend, gapCard, roadmap, roadmapStep, copilotAnswer, GAP_KIND_STATE };
