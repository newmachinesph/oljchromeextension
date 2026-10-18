import { describe, it, expect } from 'vitest';
import {
  BACKUP_VERSION,
  backupFilename,
  buildBackup,
  toBackupJson,
  readBackup,
  describeBackup,
  applicationsToTabDelimited,
} from '../src/core/backup.js';
import { DEFAULTS } from '../src/core/settings.js';
import { DEFAULT_DOCK } from '../src/core/dock.js';
import { EXPORT_COLUMNS } from '../src/core/job-export.js';

const applications = new Map([
  ['1711036', { status: 'applied', appliedAt: 1000, updatedAt: 1000, title: 'Editor', url: '/a' }],
  ['1711090', { status: 'offer', appliedAt: 2000, updatedAt: 3000, title: 'Analyst', url: '/b' }],
]);

const parts = {
  settings: { thresholdUsdPerMonth: 900 },
  about: { name: 'Maria Santos', email: 'maria@example.com' },
  profiles: [{ id: 'p1', label: 'VA', headline: 'Admin VA', body: 'Years of things', isDefault: true }],
  applications,
  dismissed: new Set(['1710974']),
  expired: new Set(['1361538']),
  now: Date.parse('2026-08-18T06:10:12Z'),
};

describe('buildBackup', () => {
  it('stamps the file so a reader can tell it is ours', () => {
    const backup = buildBackup(parts);
    expect(backup.format).toBe('onlinejobs-rate-filter');
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.exportedAt).toBe('2026-08-18T06:10:12.000Z');
  });

  it('carries all five stores', () => {
    const backup = buildBackup(parts);
    expect(backup.settings.thresholdUsdPerMonth).toBe(900);
    expect(backup.about.name).toBe('Maria Santos');
    expect(backup.profiles[0].label).toBe('VA');
    expect(Object.keys(backup.applications)).toHaveLength(2);
    expect(backup.dismissed).toEqual(['1710974']);
    expect(backup.expired).toEqual(['1361538']);
  });

  it('turns Maps and Sets into things JSON can hold', () => {
    const json = JSON.parse(toBackupJson(parts));
    expect(json.applications['1711036'].status).toBe('applied');
    expect(Array.isArray(json.dismissed)).toBe(true);
  });

  it('produces a usable file even with nothing to save', () => {
    const backup = buildBackup();
    expect(backup.settings).toEqual(DEFAULTS);
    expect(backup.applications).toEqual({});
    expect(backup.dismissed).toEqual([]);
  });

  it('names the file by the day it was taken', () => {
    expect(backupFilename(Date.parse('2026-08-18T06:10:12Z'))).toBe(
      'onlinejobs-rate-filter-2026-08-18.json',
    );
  });
});

describe('readBackup', () => {
  const round = (overrides = {}) =>
    readBackup(JSON.stringify({ ...buildBackup(parts), ...overrides }));

  it('round-trips what buildBackup wrote', () => {
    const result = round();
    expect(result.ok).toBe(true);
    expect(result.data.settings.thresholdUsdPerMonth).toBe(900);
    expect(result.data.about.name).toBe('Maria Santos');
    expect(result.data.profiles[0].label).toBe('VA');
    expect(result.data.applications.size).toBe(2);
    expect(result.data.dismissed).toEqual(['1710974']);
  });

  it('refuses text that is not JSON', () => {
    const result = readBackup('not json at all');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not valid JSON/i);
  });

  it("refuses another application's JSON rather than wiping five stores", () => {
    const result = readBackup('{"some":"other file"}');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not written by this extension/i);
  });

  it('refuses a backup from a newer version', () => {
    const result = round({ version: BACKUP_VERSION + 1 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/newer version/i);
  });

  it('accepts a backup taken before a section existed', () => {
    // A version-1 file has no About and no profiles; it restores empty rather
    // than being rejected as malformed.
    const result = readBackup(
      JSON.stringify({ format: 'onlinejobs-rate-filter', version: 1, settings: {} }),
    );
    expect(result.ok).toBe(true);
    expect(result.data.about.name).toBe('');
    expect(result.data.profiles).toEqual([]);
    expect(result.data.applications.size).toBe(0);
  });

  it('sanitises what it reads, since a backup is a file people can edit', () => {
    const result = round({
      settings: { thresholdUsdPerMonth: 999999999, sortBy: 'by-vibes' },
      dismissed: ['ok', '', null, 'ok'],
      applications: { good: { status: 'ghosted' } },
    });

    expect(result.data.settings.thresholdUsdPerMonth).toBe(100000);
    expect(result.data.settings.sortBy).toBe('site');
    expect(result.data.dismissed).toEqual(['ok']);
    expect(result.data.applications.get('good').status).toBe('applied');
  });

  it('takes an object as readily as a string', () => {
    expect(readBackup(buildBackup(parts)).ok).toBe(true);
  });
});

describe('describeBackup', () => {
  it('says what a restore would bring in', () => {
    const { data } = readBackup(toBackupJson(parts));
    const summary = describeBackup(data);

    expect(summary).toContain('1 profile');
    expect(summary).toContain('2 applications');
    expect(summary).toContain('1 dismissed');
    expect(summary).toContain('1 no longer posted');
  });

  it('counts only settings that differ from the defaults', () => {
    const { data } = readBackup(toBackupJson({ ...parts, settings: {} }));
    expect(describeBackup(data)).toContain('0 settings changed');
  });

  it('says nothing about profiles when there are none', () => {
    const { data } = readBackup(toBackupJson({ ...parts, about: {}, profiles: [] }));
    expect(describeBackup(data)).not.toMatch(/profile/);
  });

  it('migrates a version-2 file (single profile) into About and one profile', () => {
    const v2 = {
      format: 'onlinejobs-rate-filter',
      version: 2,
      settings: {},
      profile: { name: 'Ana', email: 'ana@example.com', resume: 'r', headline: 'h', experience: [], targetRoles: [] },
    };
    const result = readBackup(JSON.stringify(v2));
    expect(result.ok).toBe(true);
    expect(result.data.about.name).toBe('Ana');
    expect(result.data.profiles).toHaveLength(1);
    expect(result.data.profiles[0].label).toBe('My profile');
  });
});

describe('applicationsToTabDelimited', () => {
  it('lists the most recent application first', () => {
    const [, first, second] = applicationsToTabDelimited(applications).split('\n');
    expect(first.startsWith('Analyst\t')).toBe(true);
    expect(second.startsWith('Editor\t')).toBe(true);
  });

  it('uses the same columns a single job copies as', () => {
    const [header] = applicationsToTabDelimited(applications).split('\n');
    expect(header).toBe(EXPORT_COLUMNS.join('\t'));
  });

  it('writes the status in words, not as a code', () => {
    const [, first] = applicationsToTabDelimited(applications).split('\n');
    expect(first.split('\t')[7]).toBe('Offer');
  });

  it('still returns a header when there is nothing to list', () => {
    expect(applicationsToTabDelimited(new Map())).toBe(EXPORT_COLUMNS.join('\t'));
    expect(applicationsToTabDelimited(null)).toBe(EXPORT_COLUMNS.join('\t'));
  });
});

describe('the employer book travels in a backup', () => {
  it('is written and read back', () => {
    const book = new Map([['acme', { name: 'Acme', blocked: true, note: 'x', newAccount: null, censored: null, seenAt: null, updatedAt: 1 }]]);
    const text = toBackupJson(buildBackup({ employerBook: book }));
    const result = readBackup(text);
    expect(result.ok).toBe(true);
    expect(result.data.employerBook.get('acme').blocked).toBe(true);
    expect(describeBackup(result.data)).toContain('1 employer noted or blocked');
  });

  it('restores a version-1 file with an empty book', () => {
    const result = readBackup(JSON.stringify({ format: 'onlinejobs-rate-filter', version: 1, settings: {} }));
    expect(result.ok).toBe(true);
    expect(result.data.employerBook.size).toBe(0);
  });
});

describe('version 4 stores (saved, viewed, notes, tags)', () => {
  it('round-trips the four new stores', () => {
    const backup = buildBackup({
      saved: new Map([['1', { savedAt: 5, title: 'VA', url: '/a', employer: 'Acme', usdPerMonth: 650 }]]),
      viewed: new Set(['9', '10']),
      jobNotes: new Map([['1', { text: 'confirm salary', updatedAt: 7 }]]),
      jobTags: new Map([['1', ['High Priority', 'VA']]]),
    });
    const result = readBackup(JSON.stringify(backup));
    expect(result.ok).toBe(true);
    expect(result.data.saved.get('1').title).toBe('VA');
    expect([...result.data.viewed].sort()).toEqual(['10', '9']);
    expect(result.data.jobNotes.get('1').text).toBe('confirm salary');
    expect(result.data.jobTags.get('1')).toEqual(['High Priority', 'VA']);
  });

  it('restores an older file that has none of them, empty', () => {
    const result = readBackup(
      JSON.stringify({ format: 'onlinejobs-rate-filter', version: 3, settings: {} }),
    );
    expect(result.ok).toBe(true);
    expect(result.data.saved.size).toBe(0);
    expect(result.data.viewed.length).toBe(0);
    expect(result.data.jobNotes.size).toBe(0);
    expect(result.data.jobTags.size).toBe(0);
  });

  it('names saved, notes and tags in the restore summary', () => {
    const backup = buildBackup({
      saved: new Map([['1', { savedAt: 5, title: 'VA' }]]),
      jobNotes: new Map([['1', { text: 'x', updatedAt: 1 }]]),
      jobTags: new Map([['1', ['VA']]]),
    });
    const { data } = readBackup(JSON.stringify(backup));
    const summary = describeBackup(data);
    expect(summary).toContain('1 saved');
    expect(summary).toContain('1 job note');
    expect(summary).toContain('1 tagged');
  });
});

describe('version 5 board config', () => {
  it('round-trips the board config and restores older files empty', () => {
    const backup = buildBackup({ boardConfig: { labels: { applied: 'Sent' }, hidden: ['offer'] } });
    const result = readBackup(JSON.stringify(backup));
    expect(result.ok).toBe(true);
    expect(result.data.boardConfig).toEqual({
      labels: { applied: 'Sent' },
      hidden: ['offer'],
      order: [],
      columns: [],
      palette: [],
      // Added with drag-to-reorder; a backup written before it restores empty.
      cardOrder: {},
    });

    const older = readBackup(
      JSON.stringify({ format: 'onlinejobs-rate-filter', version: 4, settings: {} }),
    );
    expect(older.data.boardConfig).toEqual({
      labels: {},
      hidden: [],
      order: [],
      columns: [],
      palette: [],
      cardOrder: {},
    });
  });
});

describe('version 6 job colours', () => {
  it('round-trips card colours and restores older files empty', () => {
    const backup = buildBackup({ jobColors: new Map([['job-1', '#ff0000']]) });
    const result = readBackup(JSON.stringify(backup));
    expect(result.ok).toBe(true);
    expect(result.data.jobColors.get('job-1')).toBe('#ff0000');

    const older = readBackup(
      JSON.stringify({ format: 'onlinejobs-rate-filter', version: 5, settings: {} }),
    );
    expect(older.data.jobColors.size).toBe(0);
  });
});

describe('version 7 tag colours', () => {
  it('round-trips tag colours and restores older files empty', () => {
    const backup = buildBackup({ tagColors: new Map([['urgent', '#ff0000']]) });
    const result = readBackup(JSON.stringify(backup));
    expect(result.ok).toBe(true);
    expect(result.data.tagColors.get('urgent')).toBe('#ff0000');

    const older = readBackup(
      JSON.stringify({ format: 'onlinejobs-rate-filter', version: 6, settings: {} }),
    );
    expect(older.data.tagColors.size).toBe(0);
  });
});

describe('version 8 snippets', () => {
  it('round-trips snippets and restores older files empty', () => {
    const backup = buildBackup({ snippets: [{ id: 'a', title: 'Intro', body: 'Hi' }] });
    const result = readBackup(JSON.stringify(backup));
    expect(result.ok).toBe(true);
    expect(result.data.snippets).toEqual([{ id: 'a', title: 'Intro', body: 'Hi' }]);

    const older = readBackup(
      JSON.stringify({ format: 'onlinejobs-rate-filter', version: 7, settings: {} }),
    );
    expect(older.data.snippets).toEqual([]);
  });
});

describe('version 9: presets, drafts and the resume link', () => {
  /*
   * User presets shipped without ever being added here, which meant a preset
   * you wrote yourself survived nothing - the one category of data a backup
   * exists for. Drafts cost credits to produce, so losing them to a reinstall
   * is losing something you paid for.
   */
  it('round-trips everything version 9 added', () => {
    const backup = buildBackup({
      userPresets: [{ id: 'p1', name: 'Mine', filters: { searchKeywords: ['n8n'] } }],
      hiddenPresets: ['Development', 'Development', ''],
      drafts: { job1: { text: 'Dear employer', updatedAt: 1_700_000_000_000 } },
      resumeUrl: 'https://www.onlinejobs.ph/resume/abc.pdf',
    });

    const result = readBackup(JSON.stringify(backup));
    expect(result.ok).toBe(true);

    expect(result.data.userPresets).toHaveLength(1);
    expect(result.data.userPresets[0].name).toBe('Mine');
    // Deduped and emptied entries dropped on the way through.
    expect(result.data.hiddenPresets).toEqual(['Development']);
    expect(result.data.drafts.size).toBe(1);
    expect(result.data.resumeUrl).toBe('https://www.onlinejobs.ph/resume/abc.pdf');
  });

  it('restores an older file with all four empty rather than refusing it', () => {
    const older = readBackup(
      JSON.stringify({ format: 'onlinejobs-rate-filter', version: 8, settings: {} }),
    );

    expect(older.ok).toBe(true);
    expect(older.data.userPresets).toEqual([]);
    expect(older.data.hiddenPresets).toEqual([]);
    expect(older.data.drafts.size).toBe(0);
    expect(older.data.resumeUrl).toBe('');
  });

  it('still refuses a file from a newer version', () => {
    const newer = readBackup(
      JSON.stringify({ format: 'onlinejobs-rate-filter', version: 99, settings: {} }),
    );
    expect(newer.ok).toBe(false);
  });

  it('keeps learned data out: it rebuilds itself and would only bloat the file', () => {
    const backup = buildBackup({});
    for (const key of ['benchmark', 'history', 'visits', 'employers']) {
      expect(backup).not.toHaveProperty(key);
    }
  });
});

describe('version 10: the dock and its mini apps', () => {
  /*
   * The dock's arrangement is a preference and would only be an annoyance to
   * lose. The logged hours are not: they are what you bill against, and the
   * one thing in this release that would genuinely hurt to reinstall away.
   */
  it('round-trips everything version 10 added', () => {
    const backup = buildBackup({
      dock: { edge: 'left', offset: 0.25, order: ['timer', 'board'] },
      clocks: [{ id: 'c1', label: 'Denver', timeZone: 'America/Denver' }],
      pomodoro: {
        config: { focusMinutes: 50 },
        log: [{ day: '2026-08-23', focusCount: 3, focusMinutes: 150 }],
      },
      time: {
        entries: [
          {
            id: 't1',
            label: 'Edit reel',
            client: 'Bold Heart',
            startedAt: 1_787_000_000_000,
            endedAt: 1_787_003_600_000,
            rateUsd: 8,
          },
        ],
      },
    });

    expect(backup.version).toBe(10);

    const result = readBackup(JSON.stringify(backup));
    expect(result.ok).toBe(true);

    expect(result.data.dock).toMatchObject({ edge: 'left', offset: 0.25 });
    expect(result.data.dock.order).toEqual(['timer', 'board']);
    expect(result.data.clocks).toHaveLength(1);
    expect(result.data.clocks[0].timeZone).toBe('America/Denver');
    expect(result.data.pomodoro.config.focusMinutes).toBe(50);
    expect(result.data.pomodoro.log[0].focusCount).toBe(3);
    expect(result.data.time.entries).toHaveLength(1);
    expect(result.data.time.entries[0].rateUsd).toBe(8);
  });

  it('restores a version-9 file with the defaults rather than refusing it', () => {
    const older = readBackup(
      JSON.stringify({ format: 'onlinejobs-rate-filter', version: 9, settings: {} }),
    );

    expect(older.ok).toBe(true);
    // Each sanitiser turns a missing section into what a fresh install has -
    // the default dock, no clocks stored, an idle timer and an empty log.
    expect(older.data.dock.edge).toBe(DEFAULT_DOCK.edge);
    expect(older.data.clocks).toEqual([]);
    expect(older.data.pomodoro.run.phase).toBe('idle');
    expect(older.data.time.entries).toEqual([]);
    expect(older.data.time.running).toBeNull();
  });

  it('counts logged hours in the summary, so a restore says what it will bring', () => {
    const result = readBackup(
      JSON.stringify(
        buildBackup({
          time: { entries: [{ id: 't1', startedAt: 1_787_000_000_000, endedAt: 1_787_003_600_000 }] },
        }),
      ),
    );
    expect(describeBackup(result.data)).toContain('1 time entry');
  });
});
