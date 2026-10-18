import { describe, it, expect } from 'vitest';
import {
  summarize,
  byWeek,
  byRateBand,
  RATE_BANDS,
  weekStart,
  daysToReply,
  isStale,
  velocity,
} from '../src/core/funnel.js';

const NOW = Date.parse('2026-08-20T12:00:00Z'); // a Thursday
const DAY = 86400000;

function app(overrides) {
  return {
    status: 'applied',
    appliedAt: NOW - 3 * DAY,
    updatedAt: NOW - 3 * DAY,
    title: 'x',
    url: '/x',
    usdPerMonth: null,
    followedUpAt: null,
    ...overrides,
  };
}

describe('daysToReply', () => {
  it('measures applied -> first reply from the history trail', () => {
    const record = app({
      status: 'replied',
      history: [
        { status: 'applied', at: NOW - 10 * DAY },
        { status: 'replied', at: NOW - 7 * DAY },
      ],
    });
    expect(daysToReply(record)).toBe(3);
  });

  it('is null when there is no reply yet', () => {
    const record = app({ status: 'applied', history: [{ status: 'applied', at: NOW - 5 * DAY }] });
    expect(daysToReply(record)).toBeNull();
  });
});

describe('isStale', () => {
  it('flags an applied job past the threshold, not a fresh or replied one', () => {
    expect(isStale(app({ status: 'applied', updatedAt: NOW - 20 * DAY }), NOW, 14)).toBe(true);
    expect(isStale(app({ status: 'applied', updatedAt: NOW - 3 * DAY }), NOW, 14)).toBe(false);
    expect(isStale(app({ status: 'replied', updatedAt: NOW - 20 * DAY }), NOW, 14)).toBe(false);
    expect(isStale(app({ status: 'preparing', updatedAt: NOW - 20 * DAY }), NOW, 14)).toBe(false);
  });
});

describe('velocity', () => {
  it('summarises reply speed and lists stale applications', () => {
    const apps = new Map([
      ['a', app({ status: 'replied', history: [{ status: 'applied', at: NOW - 10 * DAY }, { status: 'replied', at: NOW - 8 * DAY }] })],
      ['b', app({ status: 'replied', history: [{ status: 'applied', at: NOW - 10 * DAY }, { status: 'replied', at: NOW - 6 * DAY }] })],
      ['c', app({ status: 'applied', updatedAt: NOW - 30 * DAY, title: 'Stale one' })],
    ]);
    const v = velocity(apps, NOW, 14);
    expect(v.replied).toBe(2);
    expect(v.avgDaysToReply).toBe(3); // (2 + 4) / 2
    expect(v.medianDaysToReply).toBe(3);
    expect(v.stale).toHaveLength(1);
    expect(v.stale[0].title).toBe('Stale one');
    expect(v.stale[0].days).toBe(30);
  });

  it('is empty-safe', () => {
    const v = velocity(new Map(), NOW);
    expect(v).toEqual({ replied: 0, avgDaysToReply: null, medianDaysToReply: null, stale: [] });
  });
});

describe('summarize', () => {
  it('is empty for nothing, with no rate to report', () => {
    expect(summarize(new Map())).toEqual({
      total: 0,
      submitted: 0,
      byStatus: {
        preparing: 0,
        applied: 0,
        replied: 0,
        interviewing: 0,
        offer: 0,
        hired: 0,
        rejected: 0,
      },
      responseRate: null,
    });
    expect(summarize(null).total).toBe(0);
  });

  it('counts each status and treats a reply as any employer answer', () => {
    const applications = new Map([
      ['a', app()],
      ['b', app({ status: 'interviewing' })],
      ['c', app({ status: 'offer' })],
      ['d', app({ status: 'rejected' })],
    ]);
    const result = summarize(applications);
    expect(result.total).toBe(4);
    expect(result.submitted).toBe(4);
    expect(result.byStatus).toMatchObject({ applied: 1, interviewing: 1, offer: 1, rejected: 1 });
    // Three of four applied jobs got an answer.
    expect(result.responseRate).toBe(0.75);
  });

  it('excludes preparing jobs from the submitted count and response rate', () => {
    const applications = new Map([
      ['a', app({ status: 'preparing' })],
      ['b', app({ status: 'applied' })],
      ['c', app({ status: 'replied' })],
    ]);
    const result = summarize(applications);
    expect(result.total).toBe(3);
    // Only b and c were actually sent.
    expect(result.submitted).toBe(2);
    // One reply (c) out of two submitted.
    expect(result.responseRate).toBe(0.5);
    expect(result.byStatus.preparing).toBe(1);
  });
});

describe('weekStart', () => {
  it('lands on Monday 00:00 UTC', () => {
    expect(new Date(weekStart(NOW)).toISOString()).toBe('2026-08-17T00:00:00.000Z');
    // A Sunday belongs to the week that began the previous Monday.
    expect(new Date(weekStart(Date.parse('2026-08-16T23:59:00Z'))).toISOString()).toBe(
      '2026-08-10T00:00:00.000Z',
    );
    // Monday at midnight starts its own week.
    expect(new Date(weekStart(Date.parse('2026-08-17T00:00:00Z'))).toISOString()).toBe(
      '2026-08-17T00:00:00.000Z',
    );
  });
});

describe('byWeek', () => {
  it('gives one row per week, oldest first, even when empty', () => {
    const rows = byWeek(new Map(), NOW, 3);
    expect(rows.map((r) => r.weekStart)).toEqual(['2026-08-03', '2026-08-10', '2026-08-17']);
    expect(rows.every((r) => r.applied === 0 && r.replies === 0)).toBe(true);
  });

  it('puts an application in the week it was made and a reply in the week it moved', () => {
    const applications = new Map([
      // Applied Sunday night, answered this week.
      ['a', app({ status: 'interviewing', appliedAt: Date.parse('2026-08-16T23:59:00Z'), updatedAt: NOW })],
      // Applied Monday midnight, no reply.
      ['b', app({ appliedAt: Date.parse('2026-08-17T00:00:00Z'), updatedAt: NOW })],
      // Too old for the window.
      ['c', app({ appliedAt: NOW - 40 * DAY, updatedAt: NOW - 40 * DAY })],
    ]);
    const rows = byWeek(applications, NOW, 2);
    expect(rows).toEqual([
      { weekStart: '2026-08-10', applied: 1, replies: 0 },
      { weekStart: '2026-08-17', applied: 1, replies: 1 },
    ]);
  });

  it('does not count a status move that is not a reply', () => {
    const applications = new Map([['a', app({ status: 'applied', appliedAt: NOW - DAY, updatedAt: NOW })]]);
    expect(byWeek(applications, NOW, 1)[0].replies).toBe(0);
  });
});

describe('byRateBand', () => {
  it('labels the bands', () => {
    expect(RATE_BANDS.map((b) => b.label)).toEqual([
      'under $300',
      '$300–499',
      '$500–799',
      '$800–1,199',
      '$1,200–1,999',
      '$2,000 and up',
    ]);
  });

  it('groups by the figure recorded, skipping records without one', () => {
    const applications = new Map([
      ['a', app({ usdPerMonth: 250 })],
      ['b', app({ usdPerMonth: 450, status: 'rejected' })],
      ['c', app({ usdPerMonth: 499.99, status: 'interviewing' })],
      ['d', app({ usdPerMonth: 2000, status: 'offer' })],
      ['e', app()], // no rate: in the funnel, not in a band
    ]);
    const rows = byRateBand(applications);
    expect(rows.map((r) => [r.label, r.total, r.replies, r.responseRate])).toEqual([
      ['under $300', 1, 0, 0],
      ['$300–499', 2, 2, 1],
      ['$2,000 and up', 1, 1, 1],
    ]);
  });

  it('is empty when nothing carries a rate', () => {
    expect(byRateBand(new Map([['e', app()]]))).toEqual([]);
    expect(byRateBand(null)).toEqual([]);
  });
});
