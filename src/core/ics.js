/**
 * A single calendar event as an .ics file.
 *
 * The tracker keeps a "next action" date per application - an interview, a task,
 * a nudge to send something. This turns one into a file any calendar app can
 * import, so a local reminder can leave the extension without any server, email
 * or account. Pure: it formats text, it does not save or send anything.
 */

function pad(n) {
  return String(n).padStart(2, '0');
}

/** An epoch, as an ICS UTC timestamp: YYYYMMDDTHHMMSSZ. */
function toIcsDate(epochMs) {
  const d = new Date(epochMs);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Escape the characters that would otherwise break an ICS text value. */
function esc(value) {
  return String(value ?? '')
    .replace(/([,;\\])/g, '\\$1')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Build a one-event calendar.
 *
 * @param {{title: string, at: number, url?: string, description?: string,
 *   durationMinutes?: number, uid?: string, dtstamp?: number}} event
 * @returns {string|null} the .ics text, or null when `at` is not a real time
 */
export function toIcsEvent({ title, at, url = '', description = '', durationMinutes = 30, uid, dtstamp } = {}) {
  if (!Number.isFinite(at)) return null;
  const start = toIcsDate(at);
  const end = toIcsDate(at + durationMinutes * 60000);
  const stamp = Number.isFinite(dtstamp) ? toIcsDate(dtstamp) : start;
  const id = uid || `${at}-onlinejobs-rate-filter`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OljExtension//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${id}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${esc(title || 'Job follow-up')}`,
    ...(description ? [`DESCRIPTION:${esc(description)}`] : []),
    ...(url ? [`URL:${esc(url)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

/** A safe filename for a saved event. */
export function icsFilename(title) {
  const slug = String(title || 'job')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'job';
  return `${slug}.ics`;
}
