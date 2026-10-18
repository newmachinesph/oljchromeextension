/**
 * Keyboard triage: move through the visible listings and act on the one in
 * focus without reaching for the mouse.
 *
 * Focus is a class on the card and nothing more - no node moves, no site
 * handler is touched, and switching the extension off takes the ring with it.
 * The bindings only fire when the reader is not typing, holds no modifier,
 * and neither the palette nor the modal is open; each of those owns the
 * keyboard while it is up.
 */

import { nextIndex } from '../core/key-nav.js';
import { isTyping } from './typing.js';

const FOCUS_CLASS = 'ojrf-focused';

/**
 * @param {object} options
 * @param {Document} options.doc
 * @param {() => object[]} options.visibleRecords listing records still on screen,
 *   in page order - the triage only ever steps through these
 * @param {() => boolean} options.isBlocked true while something else owns the keys
 * @param {{open, dismiss, apply, note, block, help}} options.actions each takes
 *   the focused record; help takes nothing
 * @returns {{refresh: () => void, destroy: () => void}}
 */
export function createKeyboardTriage({ doc = document, visibleRecords, isBlocked, actions }) {
  /** The focused card's element, or null. Held by element rather than index
   *  so a render that reorders or hides cards cannot move the ring silently. */
  let focused = null;

  function paint(next) {
    if (focused && focused !== next) focused.classList.remove(FOCUS_CLASS);
    focused = next;
    if (focused) {
      focused.classList.add(FOCUS_CLASS);
      focused.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function currentRecord() {
    if (!focused) return null;
    return visibleRecords().find((record) => record.element === focused) ?? null;
  }

  function step(delta) {
    const records = visibleRecords();
    const current = records.findIndex((record) => record.element === focused);
    const index = nextIndex(records.length, current, delta);
    paint(index === -1 ? null : records[index].element);
  }

  /**
   * After a render: if the focused card was hidden, move on to the next one
   * still showing rather than leaving a ring on a collapsed stub.
   */
  function refresh() {
    if (!focused) return;
    const records = visibleRecords();
    if (records.some((record) => record.element === focused)) return;

    // The list no longer holds it; pick the first visible card after where it
    // sat in document order, or the first overall.
    const after = records.find(
      (record) =>
        focused.compareDocumentPosition(record.element) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    paint(after?.element ?? records[0]?.element ?? null);
  }

  function act(run) {
    const record = currentRecord();
    if (record) run(record);
  }

  function onKeyDown(event) {
    if (event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTyping(event.target)) return;
    if (isBlocked?.()) return;

    switch (event.key) {
      case 'j':
        step(1);
        break;
      case 'k':
        step(-1);
        break;
      case 'Enter':
      case 'o':
        act(actions.open);
        break;
      case 'd':
        act(actions.dismiss);
        break;
      case 'a':
        act(actions.apply);
        break;
      case 'n':
        act(actions.note);
        break;
      case 'b':
        act(actions.block);
        break;
      case '?':
        actions.help?.();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  // Capture, like the palette, so the site's own handlers never see a key we
  // acted on; bubbling keys we ignored pass through untouched.
  doc.addEventListener('keydown', onKeyDown, true);

  return {
    refresh,
    destroy() {
      doc.removeEventListener('keydown', onKeyDown, true);
      paint(null);
    },
  };
}
