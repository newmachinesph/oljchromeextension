/**
 * The little bit of markdown that employers actually type.
 *
 * Job descriptions on this site are plain text, but a fair number of employers
 * paste markdown into the box: `## Requirements`, `- must have`, `**Salary**`.
 * The site renders none of it, so you read the punctuation instead of the
 * structure. This turns that punctuation back into structure.
 *
 * Deliberately not a markdown parser. It handles headings, bullets, numbered
 * items and bold - the four things that show up - and leaves everything else as
 * literal text. A real parser would be more correct and much easier to get
 * wrong, and the failure mode here has to be "looks like it always did", never
 * "swallowed a line".
 *
 * Returns a structure, never a string of HTML. The modal builds DOM nodes from
 * this with textContent, because the source is a remote document and none of it
 * is ours - see job-modal.js. Nothing here may ever be handed to innerHTML.
 */

/** A line that is only dashes/underscores/asterisks is a rule, not a bullet. */
const RULE_RE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*)$/;
/** "- item", "* item", "• item". Two spaces of indent still counts. */
const BULLET_RE = /^\s{0,4}([-*•])\s+(.+)$/;
/** "1. item", "2) item". */
const NUMBER_RE = /^\s{0,4}(\d{1,2})[.)]\s+(.+)$/;
/** An employer's "Requirements:" line, used as a heading when it stands alone. */
const LABEL_RE = /^\s*([A-Z][^:\n]{2,40}):\s*$/;

/**
 * Split a line into plain and bold runs.
 *
 * `**bold**` and `__bold__`. Unmatched markers stay literal, which is the point
 * - a lone `**` in "2**3" must not eat the rest of the paragraph.
 *
 * @returns {{text: string, bold: boolean}[]}
 */
export function splitBold(line) {
  const runs = [];
  const re = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g;
  let last = 0;
  let match;

  while ((match = re.exec(line)) !== null) {
    if (match.index > last) runs.push({ text: line.slice(last, match.index), bold: false });
    runs.push({ text: match[2], bold: true });
    last = match.index + match[0].length;
  }

  if (last < line.length) runs.push({ text: line.slice(last), bold: false });
  return runs.length > 0 ? runs : [{ text: line, bold: false }];
}

/** Strip the markers a heading may still carry ("## Role ##"). */
function cleanHeading(text) {
  return text.replace(/\s*#+\s*$/, '').trim();
}

/**
 * Group lines into blocks.
 *
 * @param {string} text the description exactly as the page gave it
 * @returns {({type: 'heading'|'para'|'rule', text?: string, level?: number}
 *          |{type: 'list', ordered: boolean, items: string[]})[]}
 */
export function parseBlocks(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];

  /** Paragraph lines waiting to be flushed as one block. */
  let para = [];
  /** The open list, if the previous line started one. */
  let list = null;

  const flushPara = () => {
    if (para.length === 0) return;
    blocks.push({ type: 'para', text: para.join(' ').trim() });
    para = [];
  };

  const flushList = () => {
    if (list === null) return;
    blocks.push(list);
    list = null;
  };

  const flush = () => {
    flushPara();
    flushList();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim() === '') {
      flush();
      continue;
    }

    if (RULE_RE.test(line)) {
      flush();
      blocks.push({ type: 'rule' });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flush();
      const body = cleanHeading(heading[2]);
      // "###" with nothing after it is decoration, not a heading.
      if (body) blocks.push({ type: 'heading', level: heading[1].length, text: body });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    const numbered = bullet ? null : NUMBER_RE.exec(line);

    if (bullet || numbered) {
      flushPara();
      const ordered = Boolean(numbered);
      // A change of list kind starts a new list rather than mixing markers.
      if (list === null || list.ordered !== ordered) {
        flushList();
        list = { type: 'list', ordered, items: [] };
      }
      list.items.push((bullet ? bullet[2] : numbered[2]).trim());
      continue;
    }

    flushList();

    // "Requirements:" alone on its line reads as a heading, and employers write
    // far more of those than they write "## Requirements".
    const label = LABEL_RE.exec(line);
    if (label && para.length === 0) {
      blocks.push({ type: 'heading', level: 3, text: label[1].trim() });
      continue;
    }

    para.push(line.trim());
  }

  flush();
  return blocks;
}

/**
 * Is there enough structure here to be worth reformatting?
 *
 * Plain prose gains nothing and should be left as the site wrote it; this keeps
 * the setting from turning ordinary paragraphs into a single styled blob.
 */
export function looksLikeMarkdown(text) {
  const blocks = parseBlocks(text);
  return blocks.some((block) => block.type === 'heading' || block.type === 'list');
}
