import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadJobTags,
  setJobTags,
  toggleJobTag,
  replaceJobTags,
  clearJobTags,
  sanitizeJobTags,
  cleanTagList,
  allTags,
  tagCounts,
  renameTagEverywhere,
  deleteTagEverywhere,
  MAX_TAGS_PER_JOB,
} from '../src/core/job-tags.js';

const STORAGE_KEY = 'ojRateFilterJobTags';

function installStorage(initial) {
  const store = initial === undefined ? {} : { [STORAGE_KEY]: initial };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => (store[key] === undefined ? {} : { [key]: store[key] }),
        set: async (patch) => Object.assign(store, patch),
      },
    },
  };
  return store;
}

beforeEach(() => {
  delete globalThis.chrome;
});

describe('cleanTagList', () => {
  it('trims, de-dupes case-insensitively, and caps', () => {
    expect(cleanTagList([' VA ', 'va', 'Day Shift'])).toEqual(['VA', 'Day Shift']);
    const many = Array.from({ length: MAX_TAGS_PER_JOB + 5 }, (_, i) => `t${i}`);
    expect(cleanTagList(many).length).toBe(MAX_TAGS_PER_JOB);
  });

  it('is empty for non-arrays', () => {
    expect(cleanTagList('nope')).toEqual([]);
  });
});

describe('sanitizeJobTags', () => {
  it('drops jobs with no usable tags', () => {
    const map = sanitizeJobTags({ a: ['x'], b: [], c: '  ' });
    expect([...map.keys()]).toEqual(['a']);
  });
});

describe('setJobTags / toggleJobTag', () => {
  it('sets and reads a tag list', async () => {
    installStorage();
    await setJobTags('123', ['High Priority', 'VA']);
    expect((await loadJobTags()).get('123')).toEqual(['High Priority', 'VA']);
  });

  it('empty list removes the entry', async () => {
    installStorage();
    await setJobTags('123', ['VA']);
    await setJobTags('123', []);
    expect((await loadJobTags()).has('123')).toBe(false);
  });

  it('toggles a tag on and off', async () => {
    installStorage();
    await toggleJobTag('123', 'VA');
    expect((await loadJobTags()).get('123')).toEqual(['VA']);
    await toggleJobTag('123', 'va');
    expect((await loadJobTags()).has('123')).toBe(false);
  });
});

describe('allTags', () => {
  it('lists every distinct tag, sorted', () => {
    const map = new Map([
      ['a', ['VA', 'Day Shift']],
      ['b', ['va', 'Urgent']],
    ]);
    expect(allTags(map)).toEqual(['Day Shift', 'Urgent', 'VA']);
  });
});

describe('replaceJobTags / clearJobTags', () => {
  it('replaces and clears', async () => {
    installStorage();
    await setJobTags('123', ['VA']);
    await replaceJobTags({ '999': ['Restored'] });
    const map = await loadJobTags();
    expect(map.has('123')).toBe(false);
    expect(map.get('999')).toEqual(['Restored']);
    await clearJobTags();
    expect((await loadJobTags()).size).toBe(0);
  });
});

describe('addJobTag', () => {
  it('adds a new tag but never removes an existing one', async () => {
    installStorage();
    const { addJobTag } = await import('../src/core/job-tags.js');
    await addJobTag('123', 'VA');
    await addJobTag('123', 'va'); // duplicate (case-insensitive) → no-op, not a delete
    expect((await loadJobTags()).get('123')).toEqual(['VA']);
    await addJobTag('123', 'Day Shift');
    expect((await loadJobTags()).get('123')).toEqual(['VA', 'Day Shift']);
  });

  it('declines to add past the cap', async () => {
    installStorage();
    const { addJobTag } = await import('../src/core/job-tags.js');
    await setJobTags('123', Array.from({ length: MAX_TAGS_PER_JOB }, (_, i) => `t${i}`));
    await addJobTag('123', 'one-too-many');
    expect((await loadJobTags()).get('123').length).toBe(MAX_TAGS_PER_JOB);
  });
});

describe('serialized writes (no lost updates)', () => {
  it('keeps every tag from concurrent adds', async () => {
    installStorage();
    const { addJobTag } = await import('../src/core/job-tags.js');
    // Fire five adds at once. Without a write queue, each reads the same empty
    // list and the last set clobbers the rest, leaving one tag.
    await Promise.all(['a', 'b', 'c', 'd', 'e'].map((t) => addJobTag('123', t)));
    expect((await loadJobTags()).get('123').sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('removeJobTag', () => {
  it('removes a tag once and is a no-op the second time (idempotent)', async () => {
    installStorage();
    const { removeJobTag } = await import('../src/core/job-tags.js');
    await setJobTags('123', ['VA', 'Day Shift']);
    await removeJobTag('123', 'va'); // case-insensitive
    expect((await loadJobTags()).get('123')).toEqual(['Day Shift']);
    // A repeat must not re-add it (the toggle bug).
    await removeJobTag('123', 'VA');
    expect((await loadJobTags()).get('123')).toEqual(['Day Shift']);
  });

  it('drops the entry when the last tag goes', async () => {
    installStorage();
    const { removeJobTag } = await import('../src/core/job-tags.js');
    await setJobTags('123', ['Only']);
    await removeJobTag('123', 'Only');
    expect((await loadJobTags()).has('123')).toBe(false);
  });
});

describe('tagCounts', () => {
  it('counts how many jobs wear each tag, most-used first', () => {
    const map = new Map([
      ['a', ['React', 'VA']],
      ['b', ['react', 'Urgent']],
      ['c', ['VA']],
    ]);
    expect(tagCounts(map)).toEqual([
      { tag: 'React', count: 2 },
      { tag: 'VA', count: 2 },
      { tag: 'Urgent', count: 1 },
    ]);
  });
});

describe('renameTagEverywhere', () => {
  it('renames a tag on every job that has it', async () => {
    installStorage();
    await setJobTags('a', ['React', 'VA']);
    await setJobTags('b', ['react']);
    await renameTagEverywhere('React', 'Frontend');
    const map = await loadJobTags();
    expect(map.get('a')).toEqual(['Frontend', 'VA']);
    expect(map.get('b')).toEqual(['Frontend']);
  });

  it('merges into an existing tag without duplicating', async () => {
    installStorage();
    await setJobTags('a', ['Urgent', 'Now']);
    await renameTagEverywhere('Now', 'Urgent');
    expect((await loadJobTags()).get('a')).toEqual(['Urgent']);
  });

  it('is a no-op when nothing wears the old tag', async () => {
    installStorage();
    await setJobTags('a', ['React']);
    await renameTagEverywhere('Missing', 'X');
    expect((await loadJobTags()).get('a')).toEqual(['React']);
  });
});

describe('deleteTagEverywhere', () => {
  it('removes a tag from every job and drops emptied entries', async () => {
    installStorage();
    await setJobTags('a', ['React', 'VA']);
    await setJobTags('b', ['react']);
    await deleteTagEverywhere('React');
    const map = await loadJobTags();
    expect(map.get('a')).toEqual(['VA']);
    expect(map.has('b')).toBe(false);
  });
});
