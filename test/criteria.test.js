import { describe, it, expect } from 'vitest';
import { evaluateListing, matchesRequired, reasonLabel, MS_PER_DAY } from '../src/core/criteria.js';
import { parseRate } from '../src/core/parse-rate.js';
import { DEFAULTS } from '../src/core/settings.js';

/** Fixed clock: these tests must not depend on when they run. */
const NOW = Date.parse('2026-08-17T12:00:00Z');

function listing({
  title = 'Virtual Assistant',
  rate = '$800/month',
  jobType = 'full-time',
  ageDays = 1,
} = {}) {
  return {
    facts: { title, rateText: rate, jobType, postedAt: NOW - ageDays * MS_PER_DAY },
    parsed: parseRate(rate),
  };
}

function judge(input, overrides = {}) {
  return evaluateListing({ ...input, settings: { ...DEFAULTS, ...overrides }, now: NOW });
}

describe('rate threshold', () => {
  it('hides a listing below the threshold', () => {
    const verdict = judge(listing({ rate: '$240/month' }));
    expect(verdict.hide).toBe(true);
    expect(verdict.reason).toBe('below-threshold');
  });

  it('keeps a listing above the threshold', () => {
    expect(judge(listing({ rate: '$800/month' })).hide).toBe(false);
  });
});

describe('listings with no usable rate', () => {
  const noRate = listing({ rate: 'TBD' });
  // States an hour we cannot attach to the amount, so it stays unread.
  const unclear = listing({ rate: '225$ plus bonuses 5.63 hr' });

  it('keeps them by default', () => {
    expect(judge(noRate).hide).toBe(false);
    expect(judge(unclear).hide).toBe(false);
  });

  it('reports why they could not be judged', () => {
    expect(judge(noRate).reason).toBe('no-rate');
    expect(judge(unclear).reason).toBe('unclear-rate');
  });

  it('hides missing rates when asked to, and only those', () => {
    expect(judge(noRate, { hideNoRate: true }).hide).toBe(true);
    expect(judge(unclear, { hideNoRate: true }).hide).toBe(false);
  });

  it('hides unreadable rates when asked to, and only those', () => {
    expect(judge(unclear, { hideUnclearRate: true }).hide).toBe(true);
    expect(judge(noRate, { hideUnclearRate: true }).hide).toBe(false);
  });

  it('treats an empty rate field as no rate', () => {
    const empty = {
      facts: { title: 'X', rateText: null, jobType: 'any', postedAt: NOW },
      parsed: null,
    };
    expect(judge(empty, { hideNoRate: true }).hide).toBe(true);
  });
});

describe('per-task work', () => {
  const cases = [
    '$1-$5 per approved comment',
    '$10 per 100 images',
    '$6/lead',
    '$3 per minute of finished video',
    '$150 AUD fixed price',
  ];

  for (const rate of cases) {
    it(`recognises ${JSON.stringify(rate)} as per-task`, () => {
      expect(parseRate(rate).taskBased).toBe(true);
      expect(judge(listing({ rate })).reason).toBe('task-based');
    });

    it(`keeps ${JSON.stringify(rate)} by default, hides it on request`, () => {
      expect(judge(listing({ rate })).hide).toBe(false);
      expect(judge(listing({ rate }), { hideTaskBased: true }).hide).toBe(true);
    });
  }

  it('a gig minimum hides a gig fee below it and keeps one at or above', () => {
    // A bare fee on a gig is the fee for the whole job (like OLJ "SALARY: 250").
    const gig = { rate: '$250', jobType: 'gig' };
    // No minimum -> shown.
    expect(judge(listing(gig)).hide).toBe(false);
    expect(judge(listing(gig)).reason).toBe('task-based');
    // $250 fee, minimum $300 -> hidden.
    expect(judge(listing(gig), { minFixedFeeUsd: 300 }).hide).toBe(true);
    // $250 fee, minimum $100 -> still shown.
    expect(judge(listing(gig), { minFixedFeeUsd: 100 }).hide).toBe(false);
  });

  it('does not mistake a real salary for per-task work', () => {
    expect(parseRate('$1,200/month').taskBased).toBe(false);
    expect(parseRate('$15/hour').taskBased).toBe(false);
    expect(parseRate('30,000 php to 70,000 php monthly').taskBased).toBe(false);
  });

  it('is not fooled by the "per" inside "experience"', () => {
    expect(parseRate('$600 - $900 based on experience').taskBased).toBe(false);
    expect(parseRate('$12-$18 Depending on experience').taskBased).toBe(false);
  });
});

describe('job type', () => {
  it('hides a ticked type', () => {
    const verdict = judge(listing({ jobType: 'part-time' }), { hiddenJobTypes: ['part-time'] });
    expect(verdict.hide).toBe(true);
    expect(verdict.reason).toBe('job-type');
  });

  it('leaves unticked types alone', () => {
    expect(judge(listing({ jobType: 'full-time' }), { hiddenJobTypes: ['part-time'] }).hide).toBe(
      false,
    );
  });

  it('never hides a listing whose type it could not read', () => {
    expect(judge(listing({ jobType: null }), { hiddenJobTypes: ['part-time', 'any'] }).hide).toBe(
      false,
    );
  });
});

describe('age', () => {
  it('is off by default', () => {
    expect(judge(listing({ ageDays: 900 })).hide).toBe(false);
  });

  it('hides listings older than the limit', () => {
    const verdict = judge(listing({ ageDays: 45 }), { maxAgeDays: 30 });
    expect(verdict.hide).toBe(true);
    expect(verdict.reason).toBe('too-old');
    expect(verdict.extra.ageDays).toBe(45);
  });

  it('keeps listings inside the limit', () => {
    expect(judge(listing({ ageDays: 10 }), { maxAgeDays: 30 }).hide).toBe(false);
  });

  it('never hides a listing with no readable date', () => {
    const undated = {
      facts: { title: 'X', rateText: '$800/month', jobType: 'any', postedAt: null },
      parsed: parseRate('$800/month'),
    };
    expect(judge(undated, { maxAgeDays: 1 }).hide).toBe(false);
  });
});

describe('title keywords', () => {
  it('hides a matching title, case-insensitively', () => {
    const verdict = judge(listing({ title: 'B2B Appointment Setter & Cold Caller' }), {
      excludeKeywords: ['appointment setter'],
    });
    expect(verdict.hide).toBe(true);
    expect(verdict.reason).toBe('keyword');
    expect(verdict.extra.keyword).toBe('appointment setter');
  });

  it('leaves non-matching titles alone', () => {
    expect(
      judge(listing({ title: 'Graphic Designer' }), { excludeKeywords: ['appointment setter'] })
        .hide,
    ).toBe(false);
  });

  it('ignores blank entries', () => {
    expect(judge(listing({ title: 'Anything' }), { excludeKeywords: ['', '  '] }).hide).toBe(false);
  });
});

describe('required skills, matched in the page', () => {
  function withSkills(skills, title = 'Virtual Assistant') {
    return {
      facts: { title, rateText: '$800/month', jobType: 'full-time', postedAt: NOW, skills },
      parsed: parseRate('$800/month'),
    };
  }

  it('is off when the list is empty', () => {
    expect(judge(withSkills(['Real Estate'])).hide).toBe(false);
  });

  it('keeps a listing whose skill chip matches', () => {
    const verdict = judge(withSkills(['Property Management', 'Real Estate']), {
      requiredSkills: ['real estate'],
    });
    expect(verdict.hide).toBe(false);
  });

  it('hides a listing that matches none of them', () => {
    const verdict = judge(withSkills(['Video Editing']), { requiredSkills: ['real estate'] });
    expect(verdict.hide).toBe(true);
    expect(verdict.reason).toBe('no-skill-match');
  });

  it('also matches against the title', () => {
    const verdict = judge(withSkills([], 'Senior Bookkeeping Specialist'), {
      requiredSkills: ['bookkeeping'],
    });
    expect(verdict.hide).toBe(false);
  });

  it('matches any one of several terms', () => {
    const required = { requiredSkills: ['real estate', 'data entry'] };
    expect(judge(withSkills(['Data Entry']), required).hide).toBe(false);
    expect(judge(withSkills(['Graphic Design']), required).hide).toBe(true);
  });

  it('hides a listing with no skills when a match is required', () => {
    expect(judge(withSkills([]), { requiredSkills: ['real estate'] }).hide).toBe(true);
  });
});

describe('search terms as a filter', () => {
  function card(title, text) {
    return {
      facts: {
        title,
        rateText: '$800/month',
        jobType: 'full-time',
        postedAt: NOW,
        skills: [],
        searchText: (text ?? title).toLowerCase(),
      },
      parsed: parseRate('$800/month'),
    };
  }

  it('is off when no terms are set', () => {
    expect(judge(card('Graphic Designer')).hide).toBe(false);
  });

  it('hides a listing unrelated to every term', () => {
    // Otherwise the page's own listings sit above the search results and it
    // looks as though searching did nothing.
    const verdict = judge(card('Graphic Designer'), {
      searchKeywords: ['engineer', 'developer'],
    });
    expect(verdict.hide).toBe(true);
    expect(verdict.reason).toBe('not-in-search');
  });

  it('keeps a listing matching any one term', () => {
    const terms = { searchKeywords: ['engineer', 'developer'] };
    expect(judge(card('DevOps Engineer'), terms).hide).toBe(false);
    expect(judge(card('Backend Developer'), terms).hide).toBe(false);
  });

  it('matches the description, as the site does', () => {
    // The title says nothing about engineering; the body does.
    const verdict = judge(
      card('AI/Integrations Specialist', 'AI/Integrations Specialist - senior engineer wanted'),
      { searchKeywords: ['engineer'] },
    );
    expect(verdict.hide).toBe(false);
  });

  it('keeps a listing the site returned for the term, whatever the card says', () => {
    /*
     * The card is an excerpt; the site searches the whole post. Measured on
     * jobkeyword=claude: thirty results returned, and not one of the thirty
     * cards containing the word - so re-testing the excerpt hid every hit and
     * the search looked broken.
     *
     * A card the site returned for a term IS a match for that term. The local
     * text test only has a say over cards the search did not bring back.
     */
    const hit = card('Full Stack Developer', 'full stack developer wanted');
    hit.facts.searchHit = true;

    expect(judge(hit, { searchKeywords: ['claude'] }).hide).toBe(false);
  });

  it('still hides an unrelated listing the search did not return', () => {
    const other = card('Graphic Designer');
    other.facts.searchHit = false;

    expect(judge(other, { searchKeywords: ['claude'] }).reason).toBe('not-in-search');
  });
});

describe('precedence', () => {
  it('reports the certain rule ahead of the parsed one', () => {
    // Both would hide this listing; the stated job type is the surer fact.
    const verdict = judge(listing({ rate: '$100/month', jobType: 'gig' }), {
      hiddenJobTypes: ['gig'],
    });
    expect(verdict.reason).toBe('job-type');
  });

  it('hides nothing at all while disabled', () => {
    const verdict = judge(listing({ rate: '$100/month', jobType: 'gig' }), {
      enabled: false,
      hiddenJobTypes: ['gig'],
      hideNoRate: true,
      maxAgeDays: 1,
    });
    expect(verdict.hide).toBe(false);
    expect(verdict.reason).toBe('disabled');
  });
});

describe('reasonLabel', () => {
  it('names the job type', () => {
    expect(reasonLabel('job-type', { jobType: 'part-time' })).toBe('Part Time');
  });

  it('states the age', () => {
    expect(reasonLabel('too-old', {}, { ageDays: 45 })).toBe('45d old');
  });

  it('quotes the keyword', () => {
    expect(reasonLabel('keyword', {}, { keyword: 'cold call' })).toBe('matched "cold call"');
  });

  it('describes the rate problems', () => {
    expect(reasonLabel('no-rate', {})).toBe('not stated');
    // Open rather than absent - a distinction the stub has to keep.
    expect(reasonLabel('negotiable', {})).toBe('negotiable');
    expect(reasonLabel('unclear-rate', {})).toBe('rate unclear');
    expect(reasonLabel('task-based', {})).toBe('per-task rate');
  });
});

describe('reposts', () => {
  const repostOf = (jobKey, of, size = 2) => new Map([[jobKey, { of, size }]]);

  function copy(jobKey, extra = {}) {
    const base = listing(extra);
    return { ...base, facts: { ...base.facts, jobKey } };
  }

  it('hides a listing the page already showed', () => {
    const verdict = judge({ ...copy('b'), reposts: repostOf('b', 'a') });

    expect(verdict.hide).toBe(true);
    expect(verdict.reason).toBe('repost');
  });

  it('leaves the copy being kept alone', () => {
    expect(judge({ ...copy('a'), reposts: repostOf('b', 'a') }).hide).toBe(false);
  });

  it('can be switched off', () => {
    const verdict = judge({ ...copy('b'), reposts: repostOf('b', 'a') }, { hideReposts: false });
    expect(verdict.hide).toBe(false);
  });

  it('still applies every rate rule to the copy that is kept', () => {
    // The point of keeping the first copy rather than skipping the group: a
    // repost must never smuggle an underpaid job past the threshold.
    const verdict = judge(
      { ...copy('a', { rate: '$240/month' }), reposts: repostOf('b', 'a') },
      { thresholdUsdPerMonth: 500 },
    );

    expect(verdict.reason).toBe('below-threshold');
  });

  it('is outranked by a decision you made by hand', () => {
    const verdict = judge({
      ...copy('b'),
      reposts: repostOf('b', 'a'),
      dismissed: new Set(['b']),
    });

    expect(verdict.reason).toBe('dismissed');
  });

  it('says which copy it is', () => {
    expect(reasonLabel('repost', {}, { copies: 2 })).toBe('posted twice');
    expect(reasonLabel('repost', {}, { copies: 8 })).toBe('1 of 8 copies');
  });

  it('is inert when nothing was detected', () => {
    expect(judge(copy('b')).hide).toBe(false);
    expect(judge({ ...copy('b'), reposts: new Map() }).hide).toBe(false);
  });
});

describe('experience level', () => {
  function withText(searchText, extra = {}) {
    const base = listing(extra);
    return { ...base, facts: { ...base.facts, searchText } };
  }

  it('does nothing by default', () => {
    expect(judge(withText('3+ years experience required')).hide).toBe(false);
  });

  it('keeps only beginner-friendly listings under the strict setting', () => {
    const filter = { experienceFilter: 'beginner' };

    expect(judge(withText('no experience needed, we will train'), filter).hide).toBe(false);

    const unclear = judge(withText('make banners for our store'), filter);
    expect(unclear.hide).toBe(true);
    expect(unclear.reason).toBe('experience');
    expect(reasonLabel('experience', {}, unclear.extra)).toBe('not beginner-friendly');

    const experienced = judge(withText('at least 2 years experience'), filter);
    expect(experienced.hide).toBe(true);
    expect(reasonLabel('experience', {}, experienced.extra)).toBe('experienced');
  });

  it('hides only experienced-only listings under the lenient setting', () => {
    const filter = { experienceFilter: 'not-experienced' };

    expect(judge(withText('make banners for our store'), filter).hide).toBe(false);
    expect(judge(withText('no experience needed'), filter).hide).toBe(false);
    expect(judge(withText('3+ years of experience required'), filter).reason).toBe('experience');
  });

  it('still applies the rate rule to what it keeps', () => {
    const verdict = judge(
      withText('we will train you', { rate: '$240/month' }),
      { experienceFilter: 'beginner' },
    );
    expect(verdict.reason).toBe('below-threshold');
  });
});

describe('blocked employers', () => {
  const book = new Map([['acme corp', { name: 'Acme Corp', blocked: true, note: '' }]]);

  function from(employer) {
    const base = listing();
    return { ...base, facts: { ...base.facts, employer } };
  }

  it('hides every listing from a blocked employer, however it is spelled', () => {
    const verdict = judge({ ...from('ACME  Corp'), book });
    expect(verdict.hide).toBe(true);
    expect(verdict.reason).toBe('blocked-employer');
    expect(reasonLabel('blocked-employer', {}, {})).toBe('blocked employer');
  });

  it('leaves other employers and nameless listings alone', () => {
    expect(judge({ ...from('Beta Ltd'), book }).hide).toBe(false);
    expect(judge({ ...from(null), book }).hide).toBe(false);
    expect(judge({ ...from('Acme Corp') }).hide).toBe(false);
  });

  it('can be switched off', () => {
    expect(judge({ ...from('Acme Corp'), book }, { hideBlockedEmployers: false }).hide).toBe(false);
  });

  it('is outranked by a dismissal, and outranks a repost', () => {
    const base = from('Acme Corp');
    const withKey = { ...base, facts: { ...base.facts, jobKey: 'k' } };
    expect(judge({ ...withKey, book, dismissed: new Set(['k']) }).reason).toBe('dismissed');
    expect(
      judge({ ...withKey, book, reposts: new Map([['k', { of: 'j', size: 2 }]]) }).reason,
    ).toBe('blocked-employer');
  });
});

describe('the follow-up view', () => {
  const DAY = MS_PER_DAY;
  function applied(key, daysAgo, status = 'applied') {
    return new Map([[key, { status, appliedAt: NOW - daysAgo * DAY, updatedAt: NOW, title: '', url: '' }]]);
  }
  function withKey(key) {
    const base = listing();
    return { ...base, facts: { ...base.facts, jobKey: key } };
  }

  it('narrows to applications that have waited long enough', () => {
    const view = { onlyFollowUps: true, followUpDays: 7 };
    expect(judge({ ...withKey('k'), applications: applied('k', 9) }, view).hide).toBe(false);

    const fresh = judge({ ...withKey('k'), applications: applied('k', 2) }, view);
    expect(fresh.hide).toBe(true);
    expect(fresh.reason).toBe('not-follow-up');
    expect(reasonLabel('not-follow-up', {}, {})).toBe('not due');

    expect(judge({ ...withKey('k'), applications: applied('k', 30, 'interviewing') }, view).hide).toBe(true);
    expect(judge(withKey('k'), view).hide).toBe(true);
  });

  it('is off by default', () => {
    expect(judge(withKey('k')).hide).toBe(false);
  });
});

describe('hide viewed', () => {
  const facts = { title: 'VA', rateText: '$800/month', jobType: 'full-time', postedAt: NOW, jobKey: '123' };
  const input = { facts, parsed: parseRate('$800/month') };

  it('hides an opened job only when the toggle is on', () => {
    const off = evaluateListing({ ...input, settings: DEFAULTS, now: NOW, viewed: new Set(['123']) });
    expect(off.hide).toBe(false);

    const on = evaluateListing({
      ...input,
      settings: { ...DEFAULTS, hideViewed: true },
      now: NOW,
      viewed: new Set(['123']),
    });
    expect(on.hide).toBe(true);
    expect(on.reason).toBe('viewed');
  });

  it('does not hide a job you have not opened', () => {
    const verdict = evaluateListing({
      ...input,
      settings: { ...DEFAULTS, hideViewed: true },
      now: NOW,
      viewed: new Set(['999']),
    });
    expect(verdict.hide).toBe(false);
  });

  it('lets a more specific reason win over viewed', () => {
    // Applied is more informative than "you looked at it".
    const verdict = evaluateListing({
      ...input,
      settings: { ...DEFAULTS, hideViewed: true, hideApplied: true },
      now: NOW,
      viewed: new Set(['123']),
      applications: new Map([['123', { status: 'applied' }]]),
    });
    expect(verdict.reason).toBe('applied');
  });

  it('labels the stub', () => {
    expect(reasonLabel('viewed', {})).toBe('already viewed');
  });
});

describe('shift filter', () => {
  const facts = {
    title: 'VA',
    rateText: '$800/month',
    jobType: 'full-time',
    postedAt: NOW,
    jobKey: '1',
    searchText: 'must work US hours, night shift',
  };
  const parsed = parseRate('$800/month');

  it('does nothing when set to any', () => {
    expect(evaluateListing({ facts, parsed, settings: DEFAULTS, now: NOW }).hide).toBe(false);
  });

  it('hides a clear night post when the user wants days', () => {
    const v = evaluateListing({ facts, parsed, settings: { ...DEFAULTS, shiftFilter: 'day' }, now: NOW });
    expect(v.hide).toBe(true);
    expect(v.reason).toBe('shift');
  });

  it('never hides a post that does not state a shift', () => {
    const quiet = { ...facts, searchText: 'data entry virtual assistant' };
    expect(evaluateListing({ facts: quiet, parsed, settings: { ...DEFAULTS, shiftFilter: 'day' }, now: NOW }).hide).toBe(false);
  });
});

describe('matchesRequired, the rule the skills cloud must count with', () => {
  /*
   * The cloud used to tally each listing's parsed skills while the filter also
   * read the title, so a job titled for a skill it never listed passed the
   * filter uncounted. On a live page the chip promised 22 and produced 23.
   * These pin the title behaviour so a future tidy-up cannot quietly drop it
   * and reopen the gap.
   */
  it('matches a skill the listing declares', () => {
    expect(matchesRequired({ title: 'Virtual Assistant', skills: ['Facebook Ads'] }, ['Facebook Ads'])).toBe(true);
  });

  it('matches a skill that only appears in the title', () => {
    expect(matchesRequired({ title: 'Facebook Ads Specialist', skills: [] }, ['Facebook Ads'])).toBe(true);
  });

  it('is case insensitive on both sides', () => {
    expect(matchesRequired({ title: 'FACEBOOK ADS specialist', skills: [] }, ['facebook ads'])).toBe(true);
    expect(matchesRequired({ title: 'x', skills: ['Video Editing'] }, ['VIDEO EDITING'])).toBe(true);
  });

  it('matches when any one of several is present', () => {
    expect(matchesRequired({ title: 'x', skills: ['SEO'] }, ['Copywriting', 'SEO'])).toBe(true);
  });

  it('does not match what is absent', () => {
    expect(matchesRequired({ title: 'Virtual Assistant', skills: ['Data Entry'] }, ['Facebook Ads'])).toBe(false);
  });

  it('survives a listing with no skills at all', () => {
    expect(matchesRequired({ title: 'Virtual Assistant' }, ['Facebook Ads'])).toBe(false);
    expect(matchesRequired({ title: 'Facebook Ads Buyer' }, ['Facebook Ads'])).toBe(true);
  });

  it('ignores an empty required term rather than matching everything', () => {
    expect(matchesRequired({ title: 'Anything', skills: ['X'] }, [''])).toBe(false);
  });
});
