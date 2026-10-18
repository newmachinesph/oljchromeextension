import { describe, it, expect } from 'vitest';
import {
  FOLLOW_UP_DAYS_DEFAULT,
  MS_PER_DAY,
  isDue,
  dueFollowUps,
  describeWaiting,
} from '../src/core/follow-ups.js';
import { badgeText } from '../src/core/badge.js';

const NOW = Date.parse('2026-08-20T12:00:00Z');
const daysAgo = (n) => NOW - n * MS_PER_DAY;

function app(overrides) {
  return {
    status: 'applied',
    appliedAt: daysAgo(10),
    updatedAt: daysAgo(10),
    title: 'Virtual Assistant',
    url: '/jobseekers/job/va-1',
    ...overrides,
  };
}

describe('isDue', () => {
  it('is due once the wait reaches the threshold, and not before', () => {
    expect(isDue(app({ appliedAt: daysAgo(7) }), NOW, 7)).toBe(true);
    expect(isDue(app({ appliedAt: daysAgo(6.9) }), NOW, 7)).toBe(false);
    expect(isDue(app({ appliedAt: daysAgo(30) }), NOW, 7)).toBe(true);
  });

  it('only waits on applications nobody has answered', () => {
    for (const status of ['interviewing', 'offer', 'rejected']) {
      expect(isDue(app({ status, appliedAt: daysAgo(30) }), NOW, 7)).toBe(false);
    }
  });

  it('restarts the clock when you followed up', () => {
    const followed = app({ appliedAt: daysAgo(20), followedUpAt: daysAgo(3) });
    expect(isDue(followed, NOW, 7)).toBe(false);
    expect(isDue({ ...followed, followedUpAt: daysAgo(8) }, NOW, 7)).toBe(true);
  });

  it('uses the default threshold when none is given', () => {
    expect(FOLLOW_UP_DAYS_DEFAULT).toBe(7);
    expect(isDue(app({ appliedAt: daysAgo(7) }), NOW)).toBe(true);
  });

  it('is never due for junk', () => {
    expect(isDue(null, NOW, 7)).toBe(false);
    expect(isDue({ status: 'applied', appliedAt: NaN }, NOW, 7)).toBe(false);
  });
});

describe('dueFollowUps', () => {
  it('lists the due ones, oldest wait first, with how long', () => {
    const applications = new Map([
      ['b', app({ appliedAt: daysAgo(9), title: 'B' })],
      ['c', app({ appliedAt: daysAgo(2), title: 'C' })],
      ['a', app({ appliedAt: daysAgo(14), title: 'A' })],
      ['d', app({ status: 'rejected', appliedAt: daysAgo(40), title: 'D' })],
      ['e', app({ appliedAt: daysAgo(30), followedUpAt: daysAgo(1), title: 'E' })],
    ]);

    const due = dueFollowUps(applications, NOW, 7);
    expect(due.map((entry) => entry.key)).toEqual(['a', 'b']);
    expect(due[0]).toMatchObject({ title: 'A', url: '/jobseekers/job/va-1', daysWaiting: 14 });
    expect(due[0].followedUp).toBe(false);
  });

  it('counts the wait from the follow-up when there was one', () => {
    const applications = new Map([['e', app({ appliedAt: daysAgo(30), followedUpAt: daysAgo(9) })]]);
    const [entry] = dueFollowUps(applications, NOW, 7);
    expect(entry.daysWaiting).toBe(9);
    expect(entry.followedUp).toBe(true);
  });

  it('is empty for nothing', () => {
    expect(dueFollowUps(new Map(), NOW, 7)).toEqual([]);
    expect(dueFollowUps(null, NOW, 7)).toEqual([]);
  });
});

describe('describeWaiting', () => {
  it('says how long, and whether you already nudged', () => {
    expect(describeWaiting({ daysWaiting: 9, followedUp: false })).toBe('applied 9d ago, no reply');
    expect(describeWaiting({ daysWaiting: 3, followedUp: true })).toBe('followed up 3d ago, no reply');
    expect(describeWaiting({ daysWaiting: 1, followedUp: false })).toBe('applied 1d ago, no reply');
  });
});

describe('badgeText', () => {
  it('is empty at zero and a number otherwise', () => {
    expect(badgeText(0, 0)).toBe('');
    expect(badgeText(3, 0)).toBe('3');
    expect(badgeText(3, 4)).toBe('7');
    expect(badgeText(0, 12)).toBe('12');
  });

  it('caps what the icon can show', () => {
    expect(badgeText(100, 0)).toBe('99+');
    expect(badgeText(50, 50)).toBe('99+');
  });

  it('treats junk as zero', () => {
    expect(badgeText(undefined, null)).toBe('');
    expect(badgeText(-2, 'x')).toBe('');
  });
});
