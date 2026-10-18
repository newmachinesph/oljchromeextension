/**
 * The dock - a row of little apps, over the job site.
 *
 * A floating button worked while there was one thing behind it. There are
 * seven now, so they get the arrangement everyone already knows: a rounded bar
 * of icons, pinned to an edge, that grows the icon under the pointer and names
 * it. Nobody has to be taught what a dock is.
 *
 * Two rules keep it out of the way. It is draggable - to either side, or along
 * the bottom - because the right-hand corner of a job board is where the site's
 * own chat widget lives, and no fixed position is right for everyone. And it is
 * appended to <body>, outside any framework's root, so a re-render on the v2
 * app cannot take it with it.
 *
 * It knows nothing about any particular widget: it draws whatever the catalogue
 * in core/dock.js lists, and hands clicks to the shell. Adding a mini app never
 * touches this file.
 */

import {
  dockItems,
  loadDock,
  saveDock,
  onDockChanged,
  isLocked,
  widgetUrl,
  sanitizeDock,
} from '../core/dock.js';
import { API_BASE } from '../core/account.js';
import { iconMarkup } from '../core/icons.js';

const DOCK_ID = 'ojrf-dock';

/** Under this many pixels the pointer is treated as having clicked, not grabbed. */
const DRAG_SLOP = 4;

/* The lock corner on a paid tool. Its own size and weight, so it reads as a
   badge on the icon rather than a second icon beside it. */
const LOCK_SVG = iconMarkup('lock-badge', { size: 10, stroke: 2.4, className: 'ojrf-dock-lock' });

/**
 * Put the dock on the page and keep it in step with its settings.
 *
 * Idempotent by id, so a caller may re-run it on every mutation without
 * stacking docks or replacing the one you are about to click.
 *
 * @param {{toggle: Function, current: Function}} shell the widget shell
 * @param {Document} [doc]
 * @returns {HTMLElement} the dock, whether it was just made or already there
 */
export function mountDock(shell, doc = document) {
  const existing = doc.getElementById(DOCK_ID);
  if (existing) return existing;

  const root = doc.createElement('div');
  root.id = DOCK_ID;
  root.className = 'ojrf-ui';
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', 'OljExtension');
  root.hidden = true;
  doc.body.appendChild(root);

  let dock = sanitizeDock(null);

  function place() {
    root.dataset.edge = dock.edge;
    root.classList.toggle('ojrf-dock-labels', dock.labels);
    // The offset is a fraction of the free axis, so the dock keeps its relative
    // spot when the window is resized rather than sliding off the edge.
    const percent = `${(dock.offset * 100).toFixed(2)}%`;
    if (dock.edge === 'bottom') {
      root.style.left = percent;
      root.style.top = '';
      root.style.transform = 'translateX(-50%)';
    } else {
      root.style.top = percent;
      root.style.left = '';
      root.style.transform = 'translateY(-50%)';
    }
  }

  function activate(widget) {
    if (widget.kind === 'view') {
      shell.toggle(widget);
      paint();
      return;
    }
    const href =
      widget.kind === 'page' ? chrome.runtime.getURL(widget.page) : widgetUrl(widget, API_BASE);
    if (!href) return;
    // A content script has no tabs permission, so this goes through the page's
    // own window rather than chrome.tabs - noopener because it is a new origin.
    doc.defaultView.open(href, '_blank', 'noopener');
  }

  function paint() {
    const open = shell.current?.() ?? null;
    // A minimised widget is still running, so its icon stays lit - but dimmer,
    // the way a docked app that is not frontmost still shows its pip.
    const minimised = shell.state?.() === 'min';
    for (const button of root.querySelectorAll('.ojrf-dock-item')) {
      const isOpen = button.dataset.widget === open;
      button.classList.toggle('is-open', isOpen);
      button.classList.toggle('is-minimised', isOpen && minimised);
    }
  }

  function draw() {
    const items = dockItems(dock);
    root.hidden = !dock.enabled || items.length === 0;
    root.textContent = '';

    let previousTier = null;
    for (const widget of items) {
      // A hairline between the free tools and the paid ones, the way a dock
      // separates apps from the trash. Only when both kinds are present.
      if (previousTier && widget.tier !== previousTier) {
        const rule = doc.createElement('span');
        rule.className = 'ojrf-dock-rule';
        rule.setAttribute('aria-hidden', 'true');
        root.appendChild(rule);
      }
      previousTier = widget.tier;

      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'ojrf-dock-item';
      button.dataset.widget = widget.id;
      const locked = isLocked(widget, { subscribed: false });
      const name = locked ? `${widget.label} — subscription` : widget.label;
      button.title = `${name}\n${widget.hint}`;
      button.setAttribute('aria-label', name);
      button.innerHTML =
        `${iconMarkup(widget.icon, { size: 22, stroke: 1.9 })}` +
        `<span class="ojrf-dock-name">${widget.label}</span>` +
        (widget.tier === 'ops' ? LOCK_SVG : '');
      button.addEventListener('click', (event) => {
        // A drag that ended on this button is not a click on it.
        if (root.dataset.dragged === 'yes') {
          event.preventDefault();
          return;
        }
        activate(widget);
      });
      root.appendChild(button);
    }

    const grip = doc.createElement('span');
    grip.className = 'ojrf-dock-grip';
    grip.title = 'Drag to move the dock';
    grip.setAttribute('aria-hidden', 'true');
    root.appendChild(grip);

    place();
    paint();
  }

  /**
   * Dragging: pick the nearest edge, then the position along it.
   *
   * Nearest-edge rather than free positioning, because a dock floating in the
   * middle of a page is a panel, not a dock - and because snapping means the
   * reader never has to be precise to get a tidy result.
   */
  function startDrag(event) {
    if (event.button !== 0) return;
    const view = doc.defaultView;
    const from = { x: event.clientX, y: event.clientY };
    root.dataset.dragged = 'no';
    root.classList.add('is-dragging');

    const move = (moveEvent) => {
      const dx = moveEvent.clientX - from.x;
      const dy = moveEvent.clientY - from.y;
      if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
      root.dataset.dragged = 'yes';

      const w = view.innerWidth || 1;
      const h = view.innerHeight || 1;
      const x = moveEvent.clientX;
      const y = moveEvent.clientY;

      // Distance to each candidate edge; the smallest wins.
      const edge = Math.min(x, w - x) < h - y ? (x < w - x ? 'left' : 'right') : 'bottom';
      dock = { ...dock, edge, offset: edge === 'bottom' ? x / w : y / h };
      place();
    };

    const up = () => {
      view.removeEventListener('pointermove', move);
      view.removeEventListener('pointerup', up);
      root.classList.remove('is-dragging');
      if (root.dataset.dragged === 'yes') saveDock({ edge: dock.edge, offset: dock.offset });
      // Let the click that follows a real drag be swallowed, then forget it.
      view.setTimeout(() => {
        root.dataset.dragged = 'no';
      }, 0);
    };

    view.addEventListener('pointermove', move);
    view.addEventListener('pointerup', up);
  }

  root.addEventListener('pointerdown', (event) => {
    // Only the grip starts a drag; the icons are buttons and must stay clickable.
    if (event.target.closest('.ojrf-dock-grip')) startDrag(event);
  });

  // The window can change without the dock being touched - minimised from its
  // own title bar, or closed with Escape - so the icons follow it rather than
  // only being repainted on the click that started it.
  shell.onChange?.(paint);

  loadDock().then((stored) => {
    dock = stored;
    draw();
  });

  onDockChanged((next) => {
    dock = next;
    draw();
  });

  return root;
}

/*
 * No removeDock().
 *
 * Its predecessor had one, for the master switch - but the switch reloads every
 * OnlineJobs.ph tab in both directions (see content.js), so nothing ever called
 * it. An exported teardown that no caller uses is a promise the module does not
 * keep: the next reader assumes something tears the dock down, and writes code
 * that depends on it. Turning the dock off is `enabled: false` in the dock
 * settings, which draw() already honours.
 */

export { DOCK_ID };
