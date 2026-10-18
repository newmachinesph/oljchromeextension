/**
 * AI insights on a job, for a credit each.
 *
 * Five reads of one posting - should I apply, how well do I fit, red flags,
 * how to apply, a summary - each a paid call to /api/analyze. The plumbing is
 * the draft panel's: the token lives in the service worker, the job and the
 * chosen profile are the same ones a draft uses, and a failure refunds server
 * side so a button that errors never costs a credit.
 *
 * This writes nothing to the site and applies to nothing; it reads the posting
 * you are already looking at and hands back structured judgement.
 */

import { loadAuth, requestAnalysis, requestCheckout } from '../core/account.js';
import { loadAbout } from '../core/about.js';
import { loadProfiles, defaultProfile, buildDraftProfile } from '../core/profiles.js';

const LENSES = [
  { id: 'should-apply', label: 'Should I apply?' },
  { id: 'fit', label: 'Job fit' },
  { id: 'red-flags', label: 'Red flags' },
  { id: 'requirements', label: 'How to apply' },
  { id: 'summary', label: 'Summary' },
];

const MAX_DESCRIPTION = 12_000;

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function list(doc, items, className = 'ojrf-ai-list') {
  const ul = doc.createElement('ul');
  ul.className = className;
  for (const item of items) ul.appendChild(el(doc, 'li', null, item));
  return ul;
}

function absoluteUrl(url) {
  try {
    return /^https?:\/\//i.test(url) ? url : new URL(url, location.origin).href;
  } catch {
    return location.href;
  }
}

/**
 * @param {object} deps
 * @param {Document} [deps.doc]
 * @param {() => void} [deps.openOptions]  send the user to sign in / add a profile
 * @param {(credits: number) => void} [deps.onCredits]
 * @param {(body: object) => Promise<{lens, analysis, credits, model}>} [deps.request]
 */
export function createAnalysisPanel(deps = {}) {
  const doc = deps.doc ?? (typeof document !== 'undefined' ? document : undefined);
  const openOptions = deps.openOptions ?? (() => {});
  const onCredits = deps.onCredits ?? (() => {});
  const request = deps.request ?? requestAnalysis;

  let job = null;
  let resultEl = null;
  let busy = false;
  let counter = 0;

  function setResult(node) {
    if (!resultEl) return;
    resultEl.textContent = '';
    if (node) resultEl.appendChild(node);
  }

  function spinner(label) {
    const p = el(doc, 'p', 'ojrf-draft-note');
    p.innerHTML = `<span class="ojrf-spinner"></span> ${label}`;
    return p;
  }

  async function run(lens) {
    if (busy || !job) return;
    busy = true;
    setResult(spinner('Reading the job…'));

    try {
      const auth = await loadAuth();
      if (!auth) {
        const p = el(doc, 'div', 'ojrf-ai-msg');
        p.appendChild(el(doc, 'span', null, 'Sign in to use AI insights. '));
        const link = el(doc, 'button', 'ojrf-draft-linkbtn', 'Open account');
        link.type = 'button';
        link.addEventListener('click', openOptions);
        p.appendChild(link);
        setResult(p);
        return;
      }

      const [about, profiles] = await Promise.all([loadAbout(), loadProfiles()]);
      const profile = defaultProfile(profiles);
      if (!profile) {
        const p = el(doc, 'div', 'ojrf-ai-msg');
        p.appendChild(el(doc, 'span', null, 'Add a profile first so the AI knows who you are. '));
        const link = el(doc, 'button', 'ojrf-draft-linkbtn', 'Open profile');
        link.type = 'button';
        link.addEventListener('click', openOptions);
        p.appendChild(link);
        setResult(p);
        return;
      }

      const body = {
        lens,
        job: {
          url: absoluteUrl(job.url),
          title: String(job.title ?? '').slice(0, 200),
          employer: String(job.employer ?? '').slice(0, 120) || undefined,
          rateText: String(job.rateText ?? '').slice(0, 80) || undefined,
          description: String(job.description ?? '').slice(0, MAX_DESCRIPTION),
        },
        profile: buildDraftProfile(about, profile),
        idempotencyKey: `${job.jobKey || 'job'}:${lens}:${(counter += 1)}:${Date.now()}`,
      };

      setResult(spinner('Thinking…'));
      const result = await request(body);
      if (Number.isFinite(result.credits)) onCredits(result.credits);
      setResult(renderAnalysis(doc, lens, result.analysis ?? {}));
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
    }
  }

  /** An error line, with a Buy-credits button when the reason is no credits. */
  function showError(error) {
    const wrap = el(doc, 'div', 'ojrf-ai-msg');
    wrap.appendChild(el(doc, 'p', 'ojrf-ai-error', errorMessage(error)));
    if (error?.status === 402) wrap.appendChild(buyButton());
    setResult(wrap);
  }

  function buyButton(label = 'Buy 20 credits (₱99)') {
    const btn = el(doc, 'button', 'ojrf-ai-buy', label);
    btn.type = 'button';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Opening checkout…';
      try {
        const { checkoutUrl } = await requestCheckout();
        if (checkoutUrl) window.open(checkoutUrl, '_blank', 'noopener');
        else showError({ status: 502 });
      } catch (error) {
        showError(error);
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    });
    return btn;
  }

  function mount({ panelHost, job: forJob }) {
    if (!doc || !panelHost) return;
    job = forJob;
    const wrap = el(doc, 'div', 'ojrf-ai-panel');

    const head = el(doc, 'div', 'ojrf-ai-head');
    head.appendChild(el(doc, 'span', 'ojrf-ai-title', 'AI insights'));
    const right = el(doc, 'span', 'ojrf-ai-headright');
    right.appendChild(el(doc, 'span', 'ojrf-ai-cost', '1 credit or BYOK'));
    right.appendChild(buyButton('Buy credits'));
    head.appendChild(right);
    wrap.appendChild(head);

    const row = el(doc, 'div', 'ojrf-ai-lenses');
    for (const lens of LENSES) {
      const btn = el(doc, 'button', 'ojrf-ai-lens', lens.label);
      btn.type = 'button';
      btn.addEventListener('click', () => run(lens.id));
      row.appendChild(btn);
    }
    wrap.appendChild(row);

    resultEl = el(doc, 'div', 'ojrf-ai-result');
    wrap.appendChild(resultEl);

    panelHost.appendChild(wrap);
  }

  return { mount };
}

/** Human wording for a failed request, from the status the panel was thrown. */
function errorMessage(error) {
  const status = error?.status;
  const code = error?.body?.error;
  if (status === 401) return 'Please sign in again.';
  if (status === 402) return "You're out of credits. Top up to keep using AI insights.";
  if (status === 429) return "You've hit today's AI limit. Try again tomorrow.";
  if (status === 502 || code === 'model_failed') {
    return error?.body?.billing === 'byok'
      ? 'The AI could not answer. Check your provider key and model in the dashboard.'
      : 'The AI could not answer — your credit was refunded.';
  }
  if (status === 0 || code === 'unreachable') return 'Could not reach the service. Is it running?';
  return 'Something went wrong.';
}

/** Turn one lens's normalised analysis into DOM. Kept together so a new lens is
   one case, not a scattered change. */
function renderAnalysis(doc, lens, a) {
  const box = el(doc, 'div', 'ojrf-ai-analysis');

  if (lens === 'should-apply') {
    const verdict = a.verdict === 'apply' ? 'Apply' : a.verdict === 'skip' ? 'Skip' : 'Maybe';
    const badge = el(doc, 'span', `ojrf-ai-verdict ojrf-ai-verdict-${a.verdict ?? 'maybe'}`, verdict);
    const head = el(doc, 'div', 'ojrf-ai-verdict-row');
    head.appendChild(badge);
    if (Number.isFinite(a.confidence)) head.appendChild(el(doc, 'span', 'ojrf-ai-conf', `${a.confidence}% sure`));
    box.appendChild(head);
    if (Array.isArray(a.reasons) && a.reasons.length) box.appendChild(list(doc, a.reasons));
    if (a.caution) box.appendChild(el(doc, 'p', 'ojrf-ai-caution', `⚠ ${a.caution}`));
    return box;
  }

  if (lens === 'fit') {
    const score = Number(a.score) || 0;
    const bar = el(doc, 'div', 'ojrf-ai-scorebar');
    const fill = el(doc, 'div', 'ojrf-ai-scorefill');
    fill.style.width = `${score}%`;
    bar.appendChild(fill);
    const row = el(doc, 'div', 'ojrf-ai-score-row');
    row.appendChild(el(doc, 'span', 'ojrf-ai-score', `${score}%`));
    row.appendChild(el(doc, 'span', null, 'fit'));
    box.appendChild(row);
    box.appendChild(bar);
    if (a.summary) box.appendChild(el(doc, 'p', 'ojrf-ai-note', a.summary));
    if (Array.isArray(a.strengths) && a.strengths.length) {
      box.appendChild(el(doc, 'div', 'ojrf-ai-sub', 'Strengths'));
      box.appendChild(list(doc, a.strengths, 'ojrf-ai-list ojrf-ai-good'));
    }
    if (Array.isArray(a.gaps) && a.gaps.length) {
      box.appendChild(el(doc, 'div', 'ojrf-ai-sub', 'Gaps'));
      box.appendChild(list(doc, a.gaps, 'ojrf-ai-list ojrf-ai-bad'));
    }
    return box;
  }

  if (lens === 'red-flags') {
    const risk = a.risk ?? 'low';
    box.appendChild(el(doc, 'span', `ojrf-ai-risk ojrf-ai-risk-${risk}`, `${risk} risk`));
    if (Array.isArray(a.flags) && a.flags.length) {
      const ul = doc.createElement('ul');
      ul.className = 'ojrf-ai-list ojrf-ai-bad';
      for (const flag of a.flags) {
        const li = el(doc, 'li');
        li.appendChild(el(doc, 'strong', null, flag.label));
        if (flag.why) li.appendChild(el(doc, 'span', null, ` — ${flag.why}`));
        ul.appendChild(li);
      }
      box.appendChild(ul);
    } else {
      box.appendChild(el(doc, 'p', 'ojrf-ai-note', 'Nothing obvious to flag.'));
    }
    return box;
  }

  if (lens === 'requirements') {
    if (a.subject) {
      const p = el(doc, 'p', 'ojrf-ai-note');
      p.appendChild(el(doc, 'strong', null, 'Subject line: '));
      p.appendChild(el(doc, 'span', null, a.subject));
      box.appendChild(p);
    }
    const section = (label, items) => {
      if (!Array.isArray(items) || !items.length) return;
      box.appendChild(el(doc, 'div', 'ojrf-ai-sub', label));
      box.appendChild(list(doc, items));
    };
    section('Must include', a.mustInclude);
    section('Questions to answer', a.questions);
    section('Steps', a.steps);
    if (!box.childNodes.length) box.appendChild(el(doc, 'p', 'ojrf-ai-note', 'No special instructions found.'));
    return box;
  }

  // summary
  if (a.tldr) box.appendChild(el(doc, 'p', 'ojrf-ai-note', a.tldr));
  if (a.schedule) box.appendChild(el(doc, 'p', 'ojrf-ai-note', `Schedule: ${a.schedule}`));
  if (Array.isArray(a.responsibilities) && a.responsibilities.length) {
    box.appendChild(el(doc, 'div', 'ojrf-ai-sub', 'Responsibilities'));
    box.appendChild(list(doc, a.responsibilities));
  }
  if (Array.isArray(a.requirements) && a.requirements.length) {
    box.appendChild(el(doc, 'div', 'ojrf-ai-sub', 'Requirements'));
    box.appendChild(list(doc, a.requirements));
  }
  return box;
}
