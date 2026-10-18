import { describe, it, expect } from 'vitest';
import {
  LEVELS,
  EXPERIENCE_FILTERS,
  judgeExperience,
  describeLevel,
  passesExperienceFilter,
} from '../src/core/experience-level.js';

const beginner = [
  ['Virtual Assistant', 'No experience needed, we will train you'],
  ['Data Entry Specialist', 'Fresh graduates welcome'],
  ['Chat Support', 'newbies welcome, training provided'],
  ['Data Entry', 'Looking for someone reliable'], // entry role in the title
  ['VA', 'Entry level position, willing to learn is enough'],
  ['Appointment Setter', 'We will teach you everything'],
  ['General Virtual Assistant', 'no prior experience required'],
];

const experienced = [
  ['Virtual Assistant', 'At least 2 years experience with Shopify'],
  ['Senior Bookkeeper', 'QuickBooks'],
  ['Amazon PPC Manager', '3+ years of experience required'],
  ['Video Editor', 'Send your portfolio and case studies'],
  ['Lead Generation VA', 'experienced only, not for beginners'],
  ['Data Entry', 'minimum 1 yr exp, willing to learn'], // years beats willing
  ['Social Media VA', 'must have 2-3 years experience managing ads'],
  ['Facebook Ads Specialist', 'proven track record of ROAS'],
  ['Bookkeeper', 'Xero certified preferred'],
];

const unclear = [
  ['Graphic Designer', 'Make banners for our store'],
  ['Project Coordinator', '2 years contract, renewable'], // years not about experience
  ['Admin Assistant', 'Report to the senior manager daily'], // seniority only in the title
  ['Writer', ''],
  ['', ''],
];

describe('judgeExperience', () => {
  it.each(beginner)('reads "%s / %s" as beginner-friendly', (title, text) => {
    const verdict = judgeExperience(title, text);
    expect(verdict.level).toBe(LEVELS.BEGINNER);
    expect(verdict.matched.length).toBeGreaterThan(0);
    expect(verdict.why.length).toBeGreaterThan(0);
  });

  it.each(experienced)('reads "%s / %s" as experienced', (title, text) => {
    const verdict = judgeExperience(title, text);
    expect(verdict.level).toBe(LEVELS.EXPERIENCED);
    expect(verdict.matched.length).toBeGreaterThan(0);
  });

  it.each(unclear)('says nothing about "%s / %s"', (title, text) => {
    const verdict = judgeExperience(title, text);
    expect(verdict.level).toBe(LEVELS.UNCLEAR);
    expect(verdict.matched).toEqual([]);
    expect(verdict.why).toBe('');
  });

  it('treats the title as part of the text for phrases', () => {
    expect(judgeExperience('No experience needed VA', '').level).toBe(LEVELS.BEGINNER);
  });

  it('does not read a zero-year requirement as experience', () => {
    expect(judgeExperience('VA', '0 years experience is fine').level).toBe(LEVELS.UNCLEAR);
  });

  it('survives junk input', () => {
    expect(judgeExperience(null, undefined).level).toBe(LEVELS.UNCLEAR);
    expect(judgeExperience(42, {}).level).toBe(LEVELS.UNCLEAR);
  });
});

describe('describeLevel', () => {
  it('names the two decided levels and nothing for unclear', () => {
    expect(describeLevel(LEVELS.BEGINNER)).toBe('Beginner-friendly');
    expect(describeLevel(LEVELS.EXPERIENCED)).toBe('Experienced');
    expect(describeLevel(LEVELS.UNCLEAR)).toBe('');
    expect(describeLevel('nonsense')).toBe('');
  });
});

describe('passesExperienceFilter', () => {
  it('lets everything through on "all"', () => {
    for (const level of Object.values(LEVELS)) {
      expect(passesExperienceFilter(level, 'all')).toBe(true);
    }
  });

  it('narrows to beginner-friendly only, hiding unclear too', () => {
    expect(passesExperienceFilter(LEVELS.BEGINNER, 'beginner')).toBe(true);
    expect(passesExperienceFilter(LEVELS.UNCLEAR, 'beginner')).toBe(false);
    expect(passesExperienceFilter(LEVELS.EXPERIENCED, 'beginner')).toBe(false);
  });

  it('hides only the experienced-only under "not-experienced"', () => {
    expect(passesExperienceFilter(LEVELS.BEGINNER, 'not-experienced')).toBe(true);
    expect(passesExperienceFilter(LEVELS.UNCLEAR, 'not-experienced')).toBe(true);
    expect(passesExperienceFilter(LEVELS.EXPERIENCED, 'not-experienced')).toBe(false);
  });

  it('treats an unknown filter as "all"', () => {
    expect(passesExperienceFilter(LEVELS.EXPERIENCED, 'whatever')).toBe(true);
  });
});

describe('EXPERIENCE_FILTERS', () => {
  it('offers the three settings in order', () => {
    expect(EXPERIENCE_FILTERS.map((f) => f.value)).toEqual(['all', 'beginner', 'not-experienced']);
  });
});
