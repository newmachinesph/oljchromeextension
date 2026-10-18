/**
 * The command palette: one key, type a few letters, do the thing.
 *
 * Ctrl+K, or Cmd+K on a Mac - the shortcut Linear, Slack and VS Code all use,
 * so it is already in most people's fingers.
 *
 * Two kinds of entry share one list. Commands change the filter; jobs open in
 * the modal. Keeping them together is the point: you should not have to decide
 * which kind of thing you are looking for before you start typing.
 */

import { rank } from '../core/palette.js';
import { isTyping } from './typing.js';

const ROOT_ID = 'ojrf-palette';
const OPEN_CLASS = 'ojrf-palette-open';

/** Typing into the page's own search must not open ours on top of it. */
function build(doc) {
  const root = doc.createElement('div');
  root.id = ROOT_ID;
  root.className = 'ojrf-ui';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Command palette');
  root.hidden = true;

  root.innerHTML = `
    <div class="ojrf-palette-backdrop"></div>
    <div class="ojrf-palette-panel">
      <input class="ojrf-palette-input" type="text" spellcheck="false"
             placeholder="Search jobs, or type a command…" aria-label="Search jobs or commands" />
      <ul class="ojrf-palette-list" role="listbox"></ul>
      <div class="ojrf-palette-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
        <span><kbd>↵</kbd> run</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </div>`;

  return root;
}

/**
 * @param {object} hooks
 * @param {Function} hooks.getEntries returns [{label, hint, kind, run}] fresh
 *   each time it opens, so the list always reflects the page as it is now
 */
export function createPalette({ getEntries }, doc = document) {
  let entries = [];
  let shown = [];
  let active = 0;
  let lastFocused = null;

  const root = () => doc.getElementById(ROOT_ID);

  function close() {
    const node = root();
    if (!node || node.hidden) return;

    node.hidden = true;
    doc.documentElement.classList.remove(OPEN_CLASS);
    if (lastFocused && doc.contains(lastFocused)) lastFocused.focus();
    lastFocused = null;
  }

  function paint() {
    const list = root().querySelector('.ojrf-palette-list');
    list.textContent = '';

    if (shown.length === 0) {
      const empty = doc.createElement('li');
      empty.className = 'ojrf-palette-empty';
      empty.textContent = 'Nothing matches that.';
      list.appendChild(empty);
      return;
    }

    shown.forEach((entry, index) => {
      const item = doc.createElement('li');
      item.className = index === active ? 'ojrf-palette-item ojrf-on' : 'ojrf-palette-item';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === active));

      const label = doc.createElement('span');
      label.className = 'ojrf-palette-label';
      label.textContent = entry.label;
      item.appendChild(label);

      if (entry.hint) {
        const hint = doc.createElement('span');
        hint.className = 'ojrf-palette-hint';
        hint.textContent = entry.hint;
        item.appendChild(hint);
      }

      const kind = doc.createElement('span');
      kind.className = 'ojrf-palette-kind';
      kind.textContent = entry.kind ?? '';
      item.appendChild(kind);

      // Mousedown, not click: a click would land after the input lost focus.
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        choose(index);
      });

      list.appendChild(item);
    });

    list.children[active]?.scrollIntoView({ block: 'nearest' });
  }

  function filter(query) {
    shown = rank(entries, query);
    active = 0;
    paint();
  }

  function choose(index) {
    const entry = shown[index];
    if (!entry) return;

    // Closed first: a command that opens the modal should not have to fight
    // this panel for focus.
    close();
    entry.run?.();
  }

  function ensureRoot() {
    let node = root();
    if (node) return node;

    node = build(doc);
    doc.body.appendChild(node);
    node.querySelector('.ojrf-palette-backdrop').addEventListener('mousedown', close);

    const input = node.querySelector('.ojrf-palette-input');
    input.addEventListener('input', () => filter(input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
        event.preventDefault();
        active = shown.length === 0 ? 0 : (active + 1) % shown.length;
        paint();
      } else if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
        event.preventDefault();
        active = shown.length === 0 ? 0 : (active - 1 + shown.length) % shown.length;
        paint();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        choose(active);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });

    return node;
  }

  function open(query = '') {
    const node = ensureRoot();
    lastFocused = doc.activeElement;

    // Gathered on every open, so the list always reflects the page as it is now
    // rather than as it was when the extension started.
    entries = getEntries();

    // Usually empty; the "?" key opens it already narrowed to the shortcuts.
    const input = node.querySelector('.ojrf-palette-input');
    input.value = query;
    filter(query);

    node.hidden = false;
    doc.documentElement.classList.add(OPEN_CLASS);
    input.focus();
  }

  function toggle() {
    const node = root();
    if (node && !node.hidden) close();
    else open();
  }

  doc.addEventListener(
    'keydown',
    (event) => {
      // Escape closes it from anywhere, not only from the input. Focus can end
      // up elsewhere - a click on the panel, an extension stealing it - and a
      // dialog you cannot dismiss with Escape is a trap.
      if (event.key === 'Escape') {
        const node = root();
        if (node && !node.hidden) {
          event.preventDefault();
          close();
        }
        return;
      }

      // Ctrl+K, or Cmd+K on a Mac.
      if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        toggle();
        return;
      }

      // A bare "/" opens it too, the way search boxes have worked for decades -
      // but never while you are typing into something.
      if (event.key === '/' && !isTyping(event.target) && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        open();
      }
    },
    true,
  );

  function isOpen() {
    const node = root();
    return Boolean(node && !node.hidden);
  }

  return { open, close, toggle, isOpen };
}
