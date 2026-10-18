/**
 * Turning a listing into something you can paste elsewhere.
 *
 * Tab-delimited rather than CSV on purpose: pasting tab-separated text into
 * Google Sheets or Excel splits it into columns with no import dialogue and no
 * quoting rules to get wrong. The cost is that tabs and newlines cannot appear
 * inside a value, so they are flattened to spaces - which for a job title, a
 * rate and a URL costs nothing.
 */

export const EXPORT_COLUMNS = Object.freeze([
  'Title',
  'Employer',
  'Rate as listed',
  'Rate USD/month',
  'Job type',
  'Hours per week',
  'Posted',
  'Status',
  'URL',
]);

/**
 * Flatten one value so it cannot break the row it sits in.
 *
 * A description pasted into a cell would otherwise spill across rows, which is
 * worse than losing its line breaks.
 */
function cell(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\t\r\n]+/g, ' ').trim();
}

/** ISO date only - the time of day is noise in a spreadsheet. */
function isoDate(epochMs) {
  if (!Number.isFinite(epochMs)) return '';
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * @param {object} job {title, employer, rateText, usdPerMonth, jobType,
 *   hoursPerWeek, postedAt, status, url}
 * @returns {string[]} one value per EXPORT_COLUMNS entry
 */
export function toRow(job = {}) {
  return [
    cell(job.title),
    cell(job.employer),
    cell(job.rateText),
    Number.isFinite(job.usdPerMonth) ? String(Math.round(job.usdPerMonth)) : '',
    cell(job.jobType),
    cell(job.hoursPerWeek),
    isoDate(job.postedAt),
    cell(job.status),
    cell(job.url),
  ];
}

/**
 * @param {object|object[]} jobs one job or many
 * @param {{header?: boolean}} options
 * @returns {string} tab-delimited, newline-separated
 */
export function toTabDelimited(jobs, { header = true } = {}) {
  const rows = (Array.isArray(jobs) ? jobs : [jobs]).map(toRow);
  const lines = header ? [EXPORT_COLUMNS, ...rows] : rows;
  return lines.map((row) => row.join('\t')).join('\n');
}

/** Shorter than this is a scrap of punctuation, not an instruction. */
const MIN_SUBJECT = 2;

/**
 * The subject line an employer demanded, if they demanded one.
 *
 * Some postings hide an instruction in the description - "put BANANA in the
 * subject line" - specifically to see who read it. Missing one is a wasted
 * application, so it is worth surfacing even though it is rare: none of the
 * eight live jobs sampled while building this had one.
 *
 * Deliberately conservative. Every pattern needs either a colon or quotes, so
 * ordinary prose mentioning the word "subject" does not produce a false
 * instruction - being told to use a subject line nobody asked for is worse than
 * not being told at all.
 *
 * @returns {string|null}
 */
export function readSubjectInstruction(text) {
  const source = String(text ?? '').replace(/\s+/g, ' ');
  if (source.length === 0) return null;

  const patterns = [
    // "subject line: Rockstar VA"
    /\bsubject(?:\s*line)?\s*:\s*["'“”]?([^"'“”\n|]{2,80}?)\s*(?:[.|]|$)/i,
    // 'put "BANANA" in the subject'
    /\b(?:put|use|type|write|include|begin|start)\s+(?:the\s+word\s+)?["'“”]([^"'“”\n]{2,80})["'“”]\s*(?:in|as|for|at)\b[^.]{0,30}\bsubject/i,
    // "subject line should be Rockstar VA"
    /\bsubject(?:\s*line)?\s+(?:should|must)\s+(?:be|say|read)\s*["'“”]?([^"'“”\n.]{2,80})/i,
    // 'with the subject line "New VA Applicant - $2/hour"' - the quotes alone
    // carry the instruction, with no colon or verb. Seen verbatim on a live
    // posting; the three patterns above all missed it.
    /\bsubject(?:\s*line)?\s+(?:of\s+)?["'“”]([^"'“”\n]{2,80})["'“”]/i,
  ];

  for (const pattern of patterns) {
    const found = pattern.exec(source)?.[1]?.trim();
    // Checked after trimming, not by the pattern's own length bound: a leading
    // space counts toward that bound, so "subject: x" would otherwise pass as
    // the two-character " x".
    if (found && found.length >= MIN_SUBJECT) return found;
  }

  return null;
}

/**
 * The same rows as CSV, for anything that will not open a .tsv.
 *
 * RFC 4180 quoting: a field holding a comma, a quote or a newline is wrapped in
 * double quotes and any embedded quote is doubled. Rows join with CRLF, because
 * Excel on Windows treats a bare LF as one long line - and the audience here is
 * on Windows more often than not.
 *
 * The leading BOM is what makes Excel read it as UTF-8 rather than as the local
 * code page, which is the difference between "Señor" and "SeAtilde-or" in a
 * column of employer names.
 */
const NEEDS_QUOTING = /[",\r\n]/;

function csvCell(value) {
  const text = String(value ?? '');
  return NEEDS_QUOTING.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(jobs = [], { bom = true } = {}) {
  const lines = [EXPORT_COLUMNS.map(csvCell).join(',')];
  for (const job of jobs) lines.push(toRow(job).map(csvCell).join(','));

  return `${bom ? '\uFEFF' : ''}${lines.join('\r\n')}`;
}
