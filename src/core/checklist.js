/**
 * Checklists inside a job's note.
 *
 * A note is just text, but a line written like `- [ ] send portfolio` reads as
 * a task. This turns those lines into things you can tick off: parse them out,
 * and flip one without disturbing the rest of the note. Markdown's own checkbox
 * syntax, so the raw note stays readable anywhere and nothing new is stored -
 * the note text itself is the checklist.
 */

/** A note line that is a checklist item: `- [ ] label` or `- [x] label`. */
const ITEM = /^(\s*)-\s\[( |x|X)\]\s?(.*)$/;

/**
 * The checklist items in a note, each tied to the note line it came from.
 * @returns {Array<{index: number, checked: boolean, label: string}>}
 */
export function parseChecklist(text) {
  const items = [];
  String(text ?? '').split('\n').forEach((line, index) => {
    const m = ITEM.exec(line);
    if (m) items.push({ index, checked: m[2].toLowerCase() === 'x', label: m[3].trim() });
  });
  return items;
}

/** Whether a note has any checklist items at all. */
export function hasChecklist(text) {
  return parseChecklist(text).length > 0;
}

/**
 * Flip the checkbox on one note line, leaving every other line untouched.
 * Returns the note unchanged if that line is not a checklist item.
 */
export function toggleChecklistItem(text, lineIndex) {
  const lines = String(text ?? '').split('\n');
  const line = lines[lineIndex];
  if (line === undefined) return String(text ?? '');
  const m = ITEM.exec(line);
  if (!m) return String(text ?? '');
  const nextMark = m[2].toLowerCase() === 'x' ? ' ' : 'x';
  lines[lineIndex] = `${m[1]}- [${nextMark}] ${m[3]}`;
  return lines.join('\n');
}

/** How many items are done, for a "2 / 5" progress hint. */
export function checklistProgress(text) {
  const items = parseChecklist(text);
  return { done: items.filter((i) => i.checked).length, total: items.length };
}
