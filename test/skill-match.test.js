import { describe, it, expect } from 'vitest';
import { matchSkills } from '../src/core/skill-match.js';

const POST = 'Looking for a VA skilled in React and Google Workspace. Notion a plus.';

describe('matchSkills', () => {
  it('splits skills into matched and missing', () => {
    const r = matchSkills(POST, ['React', 'Notion', 'Photoshop']);
    expect(r.matched).toEqual(['React', 'Notion']);
    expect(r.missing).toEqual(['Photoshop']);
    expect(r.total).toBe(3);
    expect(r.score).toBeCloseTo(2 / 3);
  });

  it('matches multi-word skills and is case-insensitive', () => {
    expect(matchSkills(POST, ['google workspace']).matched).toEqual(['google workspace']);
  });

  it('does not match a skill inside a larger word', () => {
    expect(matchSkills('We build reactors', ['React']).matched).toEqual([]);
  });

  it('dedupes skills case-insensitively', () => {
    const r = matchSkills(POST, ['React', 'react']);
    expect(r.total).toBe(1);
    expect(r.matched).toEqual(['React']);
  });

  it('returns a null score when no skills are listed', () => {
    expect(matchSkills(POST, [])).toEqual({ matched: [], missing: [], total: 0, score: null });
  });
});
