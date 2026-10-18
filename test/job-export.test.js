import { describe, it, expect } from 'vitest';
import {
  EXPORT_COLUMNS,
  toRow,
  toTabDelimited,
  toCsv,
  readSubjectInstruction,
} from '../src/core/job-export.js';

const job = {
  title: 'Social Media Video Editor',
  employer: 'Bold Heart Media',
  rateText: '$8-$10/hour',
  usdPerMonth: 1600,
  jobType: 'Part Time',
  hoursPerWeek: '8',
  postedAt: Date.parse('2026-08-18T06:08:54Z'),
  status: 'applied',
  url: 'https://www.onlinejobs.ph/jobseekers/job/x-1711083',
};

describe('toRow', () => {
  it('produces one value per column, in order', () => {
    const row = toRow(job);
    expect(row).toHaveLength(EXPORT_COLUMNS.length);
    expect(row[0]).toBe('Social Media Video Editor');
    expect(row[1]).toBe('Bold Heart Media');
    expect(row[3]).toBe('1600');
  });

  it('writes the date without the time, which is noise in a spreadsheet', () => {
    expect(toRow(job)[6]).toBe('2026-08-18');
  });

  it('leaves a missing figure blank rather than printing NaN', () => {
    expect(toRow({ ...job, usdPerMonth: null })[3]).toBe('');
    expect(toRow({ ...job, postedAt: null })[6]).toBe('');
  });

  it('rounds rather than exporting fractions of a dollar', () => {
    expect(toRow({ ...job, usdPerMonth: 1599.6 })[3]).toBe('1600');
  });

  it('copes with an empty job', () => {
    expect(toRow()).toEqual(EXPORT_COLUMNS.map(() => ''));
    expect(toRow({})).toHaveLength(EXPORT_COLUMNS.length);
  });
});

describe('toTabDelimited', () => {
  it('leads with a header row', () => {
    const [first] = toTabDelimited(job).split('\n');
    expect(first).toBe(EXPORT_COLUMNS.join('\t'));
  });

  it('can be asked for the values alone', () => {
    const lines = toTabDelimited(job, { header: false }).split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith('Social Media Video Editor\t')).toBe(true);
  });

  it('takes many jobs as easily as one', () => {
    expect(toTabDelimited([job, job]).split('\n')).toHaveLength(3);
  });

  it('flattens a value that would otherwise break the row', () => {
    // A tab or a newline inside a cell would spill into the next column or the
    // next row, which is worse than losing the line break.
    const messy = { ...job, title: 'Editor\tPart\nTime' };
    const [, row] = toTabDelimited(messy).split('\n');

    expect(row.split('\t')).toHaveLength(EXPORT_COLUMNS.length);
    expect(row.startsWith('Editor Part Time\t')).toBe(true);
  });
});

describe('readSubjectInstruction', () => {
  it('reads a subject stated after a colon', () => {
    expect(readSubjectInstruction('Please apply. Subject line: Rockstar VA 2026')).toBe(
      'Rockstar VA 2026',
    );
  });

  it('reads a quoted word the employer wants used', () => {
    expect(readSubjectInstruction('Put "BANANA" in the subject so I know you read this')).toBe(
      'BANANA',
    );
    expect(readSubjectInstruction("Please type 'GREEN APPLE' as the subject.")).toBe('GREEN APPLE');
  });

  it('reads "should be" phrasing', () => {
    expect(readSubjectInstruction('Your subject line should be I Love Design')).toBe(
      'I Love Design',
    );
  });

  it('stops at the end of the sentence', () => {
    expect(readSubjectInstruction('Subject: Video Editor. Then attach your reel.')).toBe(
      'Video Editor',
    );
  });

  it('says nothing when the employer asked for nothing', () => {
    // Conservative on purpose: being told to use a subject line nobody asked
    // for is worse than not being told at all.
    expect(readSubjectInstruction('You will be the subject matter expert.')).toBeNull();
    expect(readSubjectInstruction('We discuss many subjects in our team.')).toBeNull();
    expect(readSubjectInstruction('A normal description with no instruction.')).toBeNull();
  });

  it('handles nothing at all', () => {
    expect(readSubjectInstruction(null)).toBeNull();
    expect(readSubjectInstruction('')).toBeNull();
    expect(readSubjectInstruction('   ')).toBeNull();
  });

  it('does not return a one-character scrap', () => {
    expect(readSubjectInstruction('subject: x')).toBeNull();
  });
});

describe('readSubjectInstruction, the quoted-after form', () => {
  it('reads the quoted subject when the quotes alone carry it', () => {
    expect(
      readSubjectInstruction(
        'HOW TO APPLY: Email ari@godsounds.com with the subject line "New VA Applicant - $2/hour". In your email, include:',
      ),
    ).toBe('New VA Applicant - $2/hour');
  });

  it('still refuses ordinary prose about a subject', () => {
    expect(readSubjectInstruction('We will discuss the subject line later')).toBeNull();
  });
});

describe('toCsv', () => {
  it('quotes only the fields that need it', () => {
    const csv = toCsv([{ title: 'Writer, senior', employer: 'Acme' }], { bom: false });
    const [, row] = csv.split('\r\n');
    expect(row.startsWith('"Writer, senior",Acme')).toBe(true);
  });

  it('doubles an embedded quote, per RFC 4180', () => {
    const csv = toCsv([{ title: 'The "best" VA' }], { bom: false });
    expect(csv).toContain('"The ""best"" VA"');
  });

  it('never lets a newline break a row', () => {
    /*
     * The quoting handles a newline, but it never sees one: toRow flattens
     * tabs and line breaks to a space before either writer runs. That is the
     * better answer - a quoted newline is legal CSV that still renders as a
     * ragged row in half the tools people actually open these in.
     */
    const csv = toCsv([{ title: 'Line\nbreak' }], { bom: false });
    expect(csv.split('\r\n')).toHaveLength(2);
    expect(csv).toContain('Line break');
  });

  it('joins rows with CRLF, which is what Excel on Windows needs', () => {
    const csv = toCsv([{ title: 'a' }, { title: 'b' }], { bom: false });
    expect(csv.split('\r\n')).toHaveLength(3);
  });

  it('leads with a BOM so Excel reads it as UTF-8', () => {
    // Without it, "Señor" arrives as mojibake in a column of employer names.
    expect(toCsv([{ employer: 'Señor Data' }]).charCodeAt(0)).toBe(0xfeff);
    expect(toCsv([], { bom: false }).charCodeAt(0)).not.toBe(0xfeff);
  });

  it('writes the header even with nothing to export', () => {
    expect(toCsv([], { bom: false })).toBe(EXPORT_COLUMNS.join(','));
  });

  it('carries the same columns as the tab-delimited export', () => {
    const job = { title: 'VA', employer: 'Acme', usdPerMonth: 900, url: 'https://x' };
    const csvCells = toCsv([job], { bom: false }).split('\r\n')[1].split(',');
    const tsvCells = toTabDelimited([job]).split('\n')[1].split('\t');
    expect(csvCells).toHaveLength(tsvCells.length);
  });
});
