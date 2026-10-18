// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  findField,
  readJobPage,
  renderBar,
  readEmployerName,
  readEmployerId,
  readContacts,
  clearJobPage,
} from '../src/content/job-page.js';
import { parseRate } from '../src/core/parse-rate.js';
import { decide, formatUsdPerMonth } from '../src/core/normalize.js';
import { DEFAULTS } from '../src/core/settings.js';

/**
 * The job page's own field markup, copied from a live page: four <dl> blocks,
 * each a heading and a paragraph. Note it says "WAGE / SALARY", not "Salary" -
 * which is why the lookup matches on heading text rather than on a class.
 */
function jobPage({ salary = '$900-$1000 USD', type = 'Full Time' } = {}) {
  return `
    <h1 class="job__title" data-jobid="1686694">Demand Generation Manager</h1>
    <div class="card job-post">
      <div class="card-body"><div class="row">
        <div class="col-lg-3"><dl class="row no-gutters">
          <dt><img src="/images/icon-work.jpg"></dt>
          <dd><h3 class="fs-12 mb-0">TYPE OF WORK</h3><p class="fs-18"> ${type} </p></dd>
        </dl></div>
        <div class="col-lg-3"><dl class="row no-gutters">
          <dt><img src="/images/icon-money.jpg"></dt>
          <dd><h3 class="fs-12 mb-0">WAGE / SALARY</h3><p class="fs-18"> ${salary} </p></dd>
        </dl></div>
        <div class="col-lg-3"><dl class="row no-gutters">
          <dt><img src="/images/clock.png"></dt>
          <dd><h3 class="fs-12 mb-0">HOURS PER WEEK</h3><p class="fs-18"> TBD </p></dd>
        </dl></div>
      </div></div>
    </div>`;
}

const rateValue = () => readJobPage(document).rateValue;

beforeEach(() => {
  document.body.innerHTML = jobPage();
});

describe('findField', () => {
  it('finds a field by its visible heading', () => {
    expect(findField(document, /wage|salary/i).querySelector('p').textContent.trim()).toBe(
      '$900-$1000 USD',
    );
  });

  it('returns null for a heading the page does not have', () => {
    expect(findField(document, /equity/i)).toBeNull();
  });
});

describe('readJobPage', () => {
  it('reads the rate, the job type and the title', () => {
    const job = readJobPage(document);

    expect(job.found).toBe(true);
    expect(job.rateText).toBe('$900-$1000 USD');
    expect(job.jobTypeLabel).toBe('Full Time');
    expect(job.title).toBe('Demand Generation Manager');
  });

  it('reports the job type as the slug the rest of the extension uses', () => {
    // It decides how a bare rate is read, so the job page and the results list
    // have to agree about it.
    expect(readJobPage(document).jobType).toBe('full-time');

    document.body.innerHTML = jobPage({ type: 'Gig' });
    expect(readJobPage(document).jobType).toBe('gig');
  });

  it('reads the live gig that exposed the hourly bug as a fixed fee', () => {
    document.body.innerHTML = jobPage({ salary: '60.00', type: 'Gig' });
    const job = readJobPage(document);
    const verdict = decide(parseRate(job.rateText), DEFAULTS, { jobType: job.jobType });

    expect(verdict.reason).toBe('fixed-fee');
    expect(verdict.fixedFeeUsd).toBe(60);
    expect(verdict.usdPerMonth).toBeNull();
  });

  it('does not mistake the hours field for the rate', () => {
    // Both can say TBD; only one of them is the salary.
    expect(readJobPage(document).rateText).not.toBe('TBD');
  });

  it('reports a page it does not recognise rather than guessing', () => {
    document.body.innerHTML = '<h1>Something else</h1>';
    const job = readJobPage(document);

    expect(job.found).toBe(false);
    expect(job.rateText).toBeNull();
  });

  it('hands the parser a string it already understands', () => {
    // The whole point of the page: the parser is reused unchanged.
    document.body.innerHTML = jobPage({ salary: 'PHP 20-25K /month' });
    // Peso rate stated, so the shipped one can move without touching this.
    const settings = { ...DEFAULTS, fxPhpPerUsd: 60 };
    const verdict = decide(parseRate(readJobPage(document).rateText), settings);

    expect(formatUsdPerMonth(verdict.usdPerMonth)).toBe('$417/mo');
  });
});

describe('renderBar', () => {
  const page = () => readJobPage(document);

  it('adds one strip of ours after the facts card, leaving the card untouched', () => {
    const before = document.querySelector('.card.job-post').outerHTML;
    const bar = renderBar(page(), { chips: [{ text: '~$950/mo', tone: 'ok', kind: 'rate' }], actions: [] });

    expect(bar).not.toBeNull();
    expect(bar.previousElementSibling).toBe(document.querySelector('.card.job-post'));
    expect(document.querySelector('.card.job-post').outerHTML).toBe(before);
    expect(bar.querySelector('.ojrf-badge').textContent).toBe('~$950/mo');
  });

  it('rebuilds in place rather than stacking', () => {
    renderBar(page(), { chips: [{ text: 'a', kind: 'level' }], actions: [] });
    renderBar(page(), { chips: [{ text: 'b', kind: 'level' }], actions: [] });
    expect(document.querySelectorAll('.ojrf-job-bar')).toHaveLength(1);
    expect(document.querySelector('.ojrf-job-bar').textContent).toContain('b');
    expect(document.querySelector('.ojrf-job-bar').textContent).not.toContain('a');
  });

  it('draws the actions it is given, and wires their handlers', () => {
    const onClick = vi.fn();
    renderBar(page(), {
      chips: [],
      actions: [{ label: 'Dismiss this job', onClick, pressed: false }],
    });
    const button = document.querySelector('.ojrf-job-bar button');
    expect(button.textContent).toBe('Dismiss this job');
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is removed by clearJobPage', () => {
    renderBar(page(), { chips: [{ text: 'x', kind: 'level' }], actions: [] });
    clearJobPage();
    expect(document.querySelector('.ojrf-job-bar')).toBeNull();
  });

  it('does nothing when the facts card is missing', () => {
    document.body.innerHTML = '<h1>Lonely</h1>';
    expect(renderBar(readJobPage(document), { chips: [], actions: [] })).toBeNull();
  });
});

describe('readEmployerName', () => {
  it('reads the employer heading above the title, when signed in', () => {
    document.body.innerHTML =
      '<h3 class="fs-24 job__logo">  GodSounds, Inc. </h3>' + jobPage();
    expect(readEmployerName(document)).toBe('GodSounds, Inc.');
  });

  it('is null when the page does not name one', () => {
    expect(readEmployerName(document)).toBeNull();
    document.body.innerHTML = '<h3 class="job__logo"><img src="x.png"></h3>' + jobPage();
    expect(readEmployerName(document)).toBeNull();
  });
});

describe('readContacts and copy chips', () => {
  it('reads addresses and the subject line out of the description', () => {
    document.body.innerHTML =
      jobPage() +
      '<p id="job-description">HOW TO APPLY: Email ari@godsounds.com with the subject line "New VA Applicant". Thanks.</p>';
    expect(readContacts(document)).toEqual({ emails: ['ari@godsounds.com'], subject: 'New VA Applicant' });
  });

  it('is empty without a description', () => {
    expect(readContacts(document)).toEqual({ emails: [], subject: null });
  });

  it('renders a clickable chip when a chip has an onClick, and an icon on an action', () => {
    const onClick = vi.fn();
    renderBar(readJobPage(document), {
      chips: [{ kind: 'email', text: 'a@b.co', onClick }],
      actions: [{ label: 'Copy row', icon: 'copy', onClick: () => {} }],
    });
    const chipNode = document.querySelector('.ojrf-chip-button');
    expect(chipNode.getAttribute('role')).toBe('button');
    chipNode.click();
    expect(onClick).toHaveBeenCalledWith(chipNode);
    const button = document.querySelector('.ojrf-job-bar button');
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button.textContent).toBe('Copy row');
  });

  it('draws an icon-only action with its words kept for the tooltip and screen reader', () => {
    renderBar(readJobPage(document), {
      chips: [],
      actions: [{ label: 'Copy row', title: 'as a spreadsheet row', icon: 'copy', iconOnly: true, onClick: () => {} }],
    });
    const button = document.querySelector('.ojrf-job-bar button');
    expect(button.classList.contains('ojrf-job-icon')).toBe(true);
    expect(button.textContent).toBe('');
    expect(button.getAttribute('aria-label')).toBe('Copy row');
    expect(button.title).toBe('Copy row — as a spreadsheet row');
  });
});

describe('readEmployerId', () => {
  it('reads the numeric id the page embeds in its report script', () => {
    document.body.innerHTML =
      jobPage() +
      '<script>$(document).ready(function(){ const jobId = 1711008; const employerId = 966063; });</script>';
    expect(readEmployerId(document)).toBe('966063');
  });

  it('is null when the page has none', () => {
    expect(readEmployerId(document)).toBeNull();
  });
});
