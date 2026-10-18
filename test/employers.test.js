import { describe, it, expect } from 'vitest';
import {
  employerKey,
  titleKey,
  groupByEmployer,
  employerCounts,
  findReposts,
  describeEmployer,
} from '../src/core/employers.js';

/** Shorthand for a listing, since only three fields matter here. */
const job = (jobKey, employer, title) => ({ jobKey, employer, title });

describe('employerKey', () => {
  it('reads one employer written three ways as one employer', () => {
    expect(employerKey('Young Publisher')).toBe(employerKey('young publisher '));
    expect(employerKey('Build with Allie')).toBe(employerKey('Build  With   Allie!'));
  });

  it('has nothing to say about a missing name', () => {
    expect(employerKey(null)).toBe('');
    expect(employerKey('   ')).toBe('');
    expect(employerKey('•')).toBe('');
  });
});

describe('titleKey', () => {
  it('ignores case, punctuation and spacing', () => {
    expect(titleKey('Instagram Admin')).toBe(titleKey('  instagram   ADMIN!! '));
  });

  it('treats a reposted role with the pay nudged as the same role', () => {
    // Employers do exactly this - same job, figure moved.
    expect(titleKey('CLIENT ACTIVATION MANAGER - $900 p/m + Bonuses')).toBe(
      titleKey('CLIENT ACTIVATION MANAGER - $1,200 p/m + Bonuses'),
    );
  });

  it('handles the live title verbatim', () => {
    // Captured from the results page, em dash and all.
    const a = 'EXECUTIVE ASSISTANT (Sales Ops) — $1,000–$1,500 USD PER MONTH';
    const b = 'EXECUTIVE ASSISTANT (Sales Ops) — $1,200–$1,800 USD PER MONTH';

    expect(titleKey(a)).toBe(titleKey(b));
    expect(titleKey(a)).toContain('executive assistant');
  });

  it('keeps genuinely different roles apart', () => {
    expect(titleKey('Instagram Admin')).not.toBe(titleKey('Instagram Manager'));
  });
});

describe('groupByEmployer', () => {
  it("gathers an employer's listings under one key", () => {
    const groups = groupByEmployer([
      job('a', 'Young Publisher', 'One'),
      job('b', 'young publisher', 'Two'),
      job('c', 'Someone Else', 'Three'),
    ]);

    expect(groups.size).toBe(2);
    expect(groups.get(employerKey('Young Publisher')).jobKeys).toEqual(['a', 'b']);
  });

  it('shows the name the way the card wrote it', () => {
    const groups = groupByEmployer([job('a', 'Young Publisher', 'One')]);
    expect(groups.get(employerKey('young publisher')).name).toBe('Young Publisher');
  });

  it('skips listings that name nobody', () => {
    // 54 of 180 live listings had no employer - absence is normal, not an error.
    expect(groupByEmployer([job('a', null, 'One'), job('b', '', 'Two')]).size).toBe(0);
  });

  it('copes with nothing at all', () => {
    expect(groupByEmployer(null).size).toBe(0);
    expect(groupByEmployer([]).size).toBe(0);
  });
});

describe('employerCounts', () => {
  it("gives every listing its employer's tally", () => {
    const counts = employerCounts([
      job('a', 'Young Publisher', 'One'),
      job('b', 'Young Publisher', 'Two'),
      job('c', 'Solo Poster', 'Three'),
    ]);

    expect(counts.get('a')).toEqual({ name: 'Young Publisher', count: 2 });
    expect(counts.get('b').count).toBe(2);
    expect(counts.get('c').count).toBe(1);
  });

  it('has no entry for a listing that names nobody', () => {
    expect(employerCounts([job('a', null, 'One')]).has('a')).toBe(false);
  });
});

describe('findReposts', () => {
  it('finds the same role posted twice by one employer', () => {
    const reposts = findReposts([
      job('a', 'Young Publisher', 'EXECUTIVE ASSISTANT (Sales Ops)'),
      job('b', 'Young Publisher', 'Executive Assistant (Sales Ops)!'),
    ]);

    expect(reposts.get('b')).toEqual({ of: 'a', size: 2 });
  });

  it('keeps the first and marks the rest', () => {
    // The site's own ordering, so the copy kept is the one it ranked highest.
    const reposts = findReposts([
      job('a', 'Gary Maze', 'GHL + SEO + N8N automation VA WANTED'),
      job('b', 'Gary Maze', 'GHL + SEO + N8N automation VA WANTED'),
      job('c', 'Gary Maze', 'GHL + SEO + N8N automation VA WANTED'),
    ]);

    expect(reposts.has('a')).toBe(false);
    expect([...reposts.keys()]).toEqual(['b', 'c']);
  });

  it('tells every copy the full size of its group, not the size when it was seen', () => {
    const reposts = findReposts([
      job('a', 'Gary Maze', 'Same Role'),
      job('b', 'Gary Maze', 'Same Role'),
      job('c', 'Gary Maze', 'Same Role'),
    ]);

    expect(reposts.get('b').size).toBe(3);
    expect(reposts.get('c').size).toBe(3);
  });

  it('leaves two different roles from one employer alone', () => {
    const reposts = findReposts([
      job('a', 'Glam Agency', 'Instagram Admin'),
      job('b', 'Glam Agency', 'Instagram Manager'),
    ]);

    expect(reposts.size).toBe(0);
  });

  it('leaves one title shared by two employers alone', () => {
    // Live case: "construction estimator" from two unrelated posters. Hiding a
    // job that was never a duplicate costs more than showing one that is.
    const reposts = findReposts([
      job('a', 'Tim', 'Construction Estimator'),
      job('b', 'Other Builder', 'Construction Estimator'),
    ]);

    expect(reposts.size).toBe(0);
  });

  it('never matches on a missing employer', () => {
    const reposts = findReposts([
      job('a', null, 'Virtual Assistant'),
      job('b', null, 'Virtual Assistant'),
    ]);

    expect(reposts.size).toBe(0);
  });

  it('never matches on an empty title', () => {
    const reposts = findReposts([job('a', 'Someone', ''), job('b', 'Someone', null)]);
    expect(reposts.size).toBe(0);
  });

  it('copes with nothing at all', () => {
    expect(findReposts(null).size).toBe(0);
    expect(findReposts([]).size).toBe(0);
  });
});

describe('describeEmployer', () => {
  it('says how many, and who', () => {
    const words = describeEmployer({ name: 'Young Publisher', count: 8 });

    expect(words).toContain('8 jobs');
    expect(words).toContain('Young Publisher');
  });

  it('says nothing about an employer who posted once', () => {
    expect(describeEmployer({ name: 'Solo', count: 1 })).toBe('');
    expect(describeEmployer(null)).toBe('');
  });
});

describe('placeholder employer names', () => {
  it('count as no employer at all, so anonymous posters are never grouped together', () => {
    for (const name of ['Not Given', 'not given', 'N/A', 'n/a', 'NA', 'None', '-', '—', 'Confidential', 'Anonymous', 'Unknown', 'Private']) {
      expect(employerKey(name)).toBe('');
    }
    expect(employerKey('Not Given Media')).not.toBe('');
  });

  it('keeps two anonymous listings with the same title apart', () => {
    const listings = [
      { jobKey: 'a', employer: 'Not Given', title: 'Virtual Assistant' },
      { jobKey: 'b', employer: 'Not Given', title: 'Virtual Assistant' },
    ];
    expect(findReposts(listings).size).toBe(0);
    expect(employerCounts(listings).size).toBe(0);
  });
});
