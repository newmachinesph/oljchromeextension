import { describe, it, expect } from 'vitest';
import { toIcsEvent, icsFilename } from '../src/core/ics.js';

const AT = Date.parse('2026-08-25T09:30:00Z');

describe('toIcsEvent', () => {
  it('builds a one-event calendar with UTC times', () => {
    const ics = toIcsEvent({ title: 'Interview', at: AT, durationMinutes: 30, dtstamp: AT });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('SUMMARY:Interview');
    expect(ics).toContain('DTSTART:20260825T093000Z');
    expect(ics).toContain('DTEND:20260825T100000Z');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics.includes('\r\n')).toBe(true);
  });

  it('escapes commas, semicolons and newlines in text', () => {
    const ics = toIcsEvent({ title: 'Call: Acme, Inc; ping', at: AT, description: 'line1\nline2' });
    expect(ics).toContain('SUMMARY:Call: Acme\\, Inc\\; ping');
    expect(ics).toContain('DESCRIPTION:line1\\nline2');
  });

  it('returns null when the time is not real', () => {
    expect(toIcsEvent({ title: 'x', at: NaN })).toBeNull();
    expect(toIcsEvent({ title: 'x' })).toBeNull();
  });

  it('adds URL only when given', () => {
    expect(toIcsEvent({ title: 'x', at: AT })).not.toContain('URL:');
    expect(toIcsEvent({ title: 'x', at: AT, url: 'https://a/b' })).toContain('URL:https://a/b');
  });
});

describe('icsFilename', () => {
  it('slugs the title safely', () => {
    expect(icsFilename('Interview: Acme Corp!')).toBe('interview-acme-corp.ics');
    expect(icsFilename('')).toBe('job.ics');
  });
});
