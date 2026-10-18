/**
 * Marking your own terms in the listing text.
 *
 * A merged page is hundreds of excerpts that all look alike. Seeing *why* a
 * listing matched - the word you searched for, the skill you required - is the
 * difference between reading a card and scanning it.
 *
 * Done with the CSS Custom Highlight API rather than by wrapping matches in
 * <mark>. Wrapping would mean splitting the site's own text nodes and putting
 * them back on restore, which is exactly the kind of edit this extension avoids
 * making to a page it does not own. Highlights are painted from Range objects
 * held outside the DOM: nothing is inserted, nothing is split, and clearing
 * them leaves the page byte-identical to how the site rendered it.
 *
 * Supported since Chrome 105. Where it is missing this does nothing at all,
 * which is the right failure for something purely decorative.
 */

const HIGHLIGHT_NAME = 'ojrf-term';

/** The API, or null where it does not exist. */
function registry() {
  return typeof CSS !== 'undefined' && CSS.highlights ? CSS.highlights : null;
}

/**
 * Terms worth marking, longest first.
 *
 * Longest first so "virtual assistant" wins over "assistant" and the longer
 * phrase is not broken into two adjacent highlights.
 *
 * One-character terms are dropped: marking every "a" in a paragraph is noise
 * that makes the real matches harder to see, not easier.
 */
export function highlightTerms(...lists) {
  const terms = new Set();

  for (const list of lists) {
    for (const entry of list ?? []) {
      const term = String(entry ?? '')
        .trim()
        .toLowerCase();
      if (term.length > 1) terms.add(term);
    }
  }

  return [...terms].sort((a, b) => b.length - a.length);
}

/**
 * Every text node under an element, in document order.
 *
 * Our own injected nodes are skipped: highlighting the word "developer" inside
 * one of our chips would be marking our output rather than the site's.
 */
function textNodesUnder(root, doc) {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeValue.trim().length === 0) return NodeFilter.FILTER_REJECT;
      return node.parentElement?.closest('.ojrf-ui, [class*="ojrf-chip"], [class*="ojrf-badge"]')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
  return nodes;
}

/** Ranges covering every occurrence of any term within one element. */
function rangesIn(element, terms, doc) {
  const ranges = [];

  for (const node of textNodesUnder(element, doc)) {
    const haystack = node.nodeValue.toLowerCase();
    // Where a match already covers, so a shorter term nested inside a longer
    // one does not paint a second overlapping range.
    const taken = [];

    for (const term of terms) {
      let from = haystack.indexOf(term);

      while (from !== -1) {
        const to = from + term.length;
        const overlaps = taken.some(([start, end]) => from < end && to > start);

        if (!overlaps) {
          const range = doc.createRange();
          range.setStart(node, from);
          range.setEnd(node, to);
          ranges.push(range);
          taken.push([from, to]);
        }

        from = haystack.indexOf(term, from + 1);
      }
    }
  }

  return ranges;
}

/**
 * Paint every occurrence of these terms across these elements.
 *
 * @param {Element[]} elements the description blocks to search
 * @param {string[]} terms already lowercased, longest first
 * @returns {number} how many occurrences were marked
 */
export function applyHighlights(elements, terms, doc = document) {
  const highlights = registry();
  if (!highlights) return 0;

  if (!terms || terms.length === 0 || !elements || elements.length === 0) {
    clearHighlights();
    return 0;
  }

  const ranges = [];
  for (const element of elements) {
    if (element) ranges.push(...rangesIn(element, terms, doc));
  }

  if (ranges.length === 0) {
    clearHighlights();
    return 0;
  }

  highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
  return ranges.length;
}

/** Stop painting. The page was never modified, so there is nothing to undo. */
export function clearHighlights() {
  registry()?.delete(HIGHLIGHT_NAME);
}
