/**
 * One window, any widget - built on WinBox.
 *
 * The board overlay used to be a modal that knew it was the board: its title
 * was hard-coded, its iframe pointed at one url, its size was one size. Adding
 * a clock would have meant a second copy of the same forty lines - and a third
 * for the timer, and a fourth for the pomodoro.
 *
 * This is that overlay with the board taken out of it, and with the window
 * itself handed to a library. WinBox (Apache-2.0, ~11KB, no dependencies) does
 * the part that is genuinely fiddly and that we had no business hand-rolling:
 * dragging by the title bar, resizing from any edge, minimise, maximise, and
 * the stacking that follows. It also hosts an iframe natively via `url`, which
 * is exactly the architecture we already had.
 *
 * What stays ours is the contract: a widget is an entry in core/dock.js and a
 * React view, and this module turns one into a window. The public API here -
 * open, close, toggle, current, state - is unchanged from the hand-rolled
 * version, so the dock never learned that anything underneath it moved.
 *
 * Windows are kept once made, one per widget, hidden rather than destroyed.
 * Reopening the board is then instant and does not throw away a lane you were
 * mid-drag on - and the pomodoro does not restart because you looked away.
 */

import { findWidget } from '../core/dock.js';
import { iconMarkup } from '../core/icons.js';

/** The message a framed view posts when Escape should close it from inside. */
export const CLOSE_MESSAGE = 'ojrf-widget-close';

/** The older board-only message, still accepted so nothing breaks mid-upgrade. */
const LEGACY_CLOSE_MESSAGE = 'ojrf-board-close';

/** Window states, reported by `state()`. */
export const STATES = { NORMAL: 'normal', MIN: 'min', MAX: 'max' };

/** Above everything the job site draws, and above the dock. */
const Z_INDEX = 2147483000;

/**
 * WinBox's own control icons are white PNG-ish data URIs baked into its CSS,
 * which is right for its dark default header and invisible on our light one.
 * These replace them with the same Lucide set everything else here draws from,
 * so the window chrome matches the dock and the job cards.
 */
const CONTROL_ICONS = {
  'wb-min': 'minus',
  'wb-max': 'square',
  'wb-full': 'expand',
  'wb-close': 'cross',
};

/** Ink, not white: these sit on a light title bar. */
const CONTROL_COLOR = '#5c6b7f';

/**
 * One icon as a CSS background-image.
 *
 * Base64, not `;utf8,` with percent-encoding: that form is non-standard and
 * Chrome silently declines to paint it, which shows up as a title bar with
 * four invisible buttons on it - present, clickable, and completely blank.
 */
function controlImage(name) {
  const svg = iconMarkup(name, { size: 16, stroke: 2 })
    .replace(/currentColor/g, CONTROL_COLOR)
    /*
     * The namespace matters here and nowhere else.
     *
     * Inline in a page, the HTML parser infers the SVG namespace, so
     * core/icons.js leaves it off. A background-image is parsed as a standalone
     * document, where it is required - and without it Chrome declines to paint,
     * with no error: four buttons that are present, clickable and invisible.
     */
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  return `url("data:image/svg+xml;base64,${btoa(svg)}")`;
}

/** A class of our own on every window, so our CSS can reach inside WinBox's. */
export const WINDOW_CLASS = 'ojrf-winbox';

/**
 * Where a widget's window opens, by the descriptor's size hint.
 *
 * A percentage rather than pixels so a small clock is small on any screen. The
 * board asks for the lot: it is a place you go, not something you glance at.
 */
const GEOMETRY = {
  full: { width: '100%', height: '100%', x: 'center', y: 'center' },
  large: { width: '860px', height: '78%', x: 'center', y: 'center' },
  small: { width: '400px', height: '560px', x: 'right', y: 'center' },
};

/**
 * WinBox is loaded on demand.
 *
 * Nothing about the job page needs a window manager until something is opened,
 * and a content script that eagerly parses 30KB on every search page is a cost
 * paid by everyone for a feature used by some. Cached after the first open.
 */
let winboxPromise = null;
function loadWinBox() {
  if (!winboxPromise) {
    winboxPromise = import(chrome.runtime.getURL('vendor/winbox/winbox.js')).then(
      (module) => module.default,
    );
  }
  return winboxPromise;
}

/**
 * Build the shell for a document, lazily.
 *
 * @param {Document} [doc]
 * @returns {{open, close, toggle, current, state, minimize, maximize, restore, onChange, destroy}}
 */
export function createWidgetShell(doc = document, { WinBox: injected } = {}) {
  /** @type {Map<string, object>} one WinBox per widget, kept warm. */
  const windows = new Map();
  const listeners = new Set();
  let openId = null;
  let windowState = STATES.NORMAL;
  let lastFocused = null;

  function announce() {
    for (const listener of listeners) listener({ id: openId, state: windowState });
  }

  function setState(next) {
    if (windowState === next) return;
    windowState = next;
    announce();
  }

  function onMessage(event) {
    const type = event.data?.type;
    if (type !== CLOSE_MESSAGE && type !== LEGACY_CLOSE_MESSAGE) return;
    // Only our own extension frames may close a window; a job page could
    // otherwise postMessage its way into dismissing whatever you had open.
    if (!String(event.origin).startsWith('chrome-extension://')) return;
    for (const [id, box] of windows) {
      const frame = box.body?.querySelector('iframe');
      if (frame && event.source === frame.contentWindow) {
        if (id === openId) close();
        else box.hide();
        return;
      }
    }
  }

  doc.defaultView.addEventListener('message', onMessage);

  async function windowFor(widget) {
    const existing = windows.get(widget.id);
    if (existing) return existing;

    // Injected in tests, where there is no chrome-extension:// url to import
    // from; everywhere else it is fetched once and cached.
    const WinBox = injected ?? (await loadWinBox());
    const geometry = GEOMETRY[widget.size] ?? GEOMETRY.large;
    const box = new WinBox({
      title: widget.label,
      url: `${chrome.runtime.getURL('dist/options/index.html')}?view=${encodeURIComponent(widget.id)}`,
      class: [WINDOW_CLASS, `ojrf-winbox-${widget.id}`],
      index: Z_INDEX,
      ...geometry,
      /*
       * Closing hides, it does not destroy.
       *
       * Returning true from onclose cancels WinBox's teardown, so the iframe
       * and everything in it survives - a half-written note on a board card,
       * a running pomodoro. `close()` below calls hide() directly; this guard
       * catches the library's own close button, which we cannot intercept.
       */
      onclose: (force) => {
        // A forced close is teardown - the tab is going, or destroy() was
        // called - and must be allowed through, or the window leaks.
        if (force) {
          windows.delete(widget.id);
          return false;
        }
        if (openId === widget.id) {
          openId = null;
          setState(STATES.NORMAL);
          announce();
          handBackFocus();
        }
        box.hide();
        return true;
      },
      onminimize: () => setState(STATES.MIN),
      onmaximize: () => setState(STATES.MAX),
      onrestore: () => setState(STATES.NORMAL),
      onfocus: () => {
        openId = widget.id;
        announce();
      },
    });

    paintControls(box);
    windows.set(widget.id, box);
    return box;
  }

  /**
   * Swap the library's control glyphs for ours.
   *
   * Done per window rather than in the stylesheet because the images are data
   * URIs built from core/icons.js - keeping them in JS means there is still
   * exactly one place icons come from, which is the whole point of that module.
   */
  function paintControls(box) {
    for (const [className, icon] of Object.entries(CONTROL_ICONS)) {
      const button = box.dom?.querySelector(`.${className}`);
      if (!button) continue;
      button.style.backgroundImage = controlImage(icon);
      button.style.backgroundSize = '15px auto';
      button.style.backgroundPosition = 'center';
    }
  }

  function handBackFocus() {
    if (lastFocused && doc.contains(lastFocused)) lastFocused.focus();
    lastFocused = null;
  }

  /**
   * Show one widget.
   *
   * Takes a descriptor or an id, so callers may pass either without looking
   * anything up. A widget that is not framed - a link, or the settings page -
   * is not this shell's business and is ignored rather than half-opened.
   *
   * Async because the library is fetched on first use; callers that do not
   * care may ignore the promise, which is what the dock does.
   */
  async function open(widgetOrId) {
    const widget = typeof widgetOrId === 'string' ? findWidget(widgetOrId) : widgetOrId;
    if (!widget || widget.kind !== 'view') return null;

    // Where focus was, so closing can hand it back rather than stranding a
    // keyboard user on the covered page.
    if (!openId) lastFocused = doc.activeElement;

    const box = await windowFor(widget);
    box.show();
    box.focus();
    // A window put away while minimised should come back the size it was, not
    // still collapsed into the corner.
    if (windowState === STATES.MIN) box.restore();

    openId = widget.id;
    setState(box.max ? STATES.MAX : STATES.NORMAL);
    announce();
    return box;
  }

  /** Put the current window away, keeping everything inside it alive. */
  function close() {
    if (!openId) return;
    windows.get(openId)?.hide();
    openId = null;
    windowState = STATES.NORMAL;
    handBackFocus();
    announce();
  }

  /**
   * What the dock icon does.
   *
   * Clicking the icon of the widget already showing puts it away. Clicking the
   * icon of one that is minimised brings it back instead - it is already "put
   * away", and closing from there would end the session for a click that meant
   * the opposite.
   */
  function toggle(widgetOrId) {
    const id = typeof widgetOrId === 'string' ? widgetOrId : widgetOrId?.id;
    if (openId && openId === id) {
      if (windowState === STATES.MIN) restore();
      else close();
      return Promise.resolve(null);
    }
    return open(widgetOrId);
  }

  function minimize() {
    if (openId) windows.get(openId)?.minimize();
  }

  function maximize() {
    if (openId) windows.get(openId)?.maximize();
  }

  function restore() {
    if (openId) windows.get(openId)?.restore();
  }

  /** Which widget is showing, or null. The dock reads this to light an icon. */
  function current() {
    return openId;
  }

  /** The window state, so the dock can show a minimised widget differently. */
  function state() {
    return openId ? windowState : STATES.NORMAL;
  }

  /** Subscribe to window changes; returns the unsubscribe. */
  function onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function destroy() {
    doc.defaultView.removeEventListener('message', onMessage);
    for (const box of windows.values()) box.close(true);
    windows.clear();
    listeners.clear();
    openId = null;
    windowState = STATES.NORMAL;
  }

  return {
    open,
    close,
    toggle,
    current,
    state,
    minimize,
    maximize,
    restore,
    onChange,
    destroy,
  };
}
