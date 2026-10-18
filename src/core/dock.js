/**
 * The dock: one catalogue, one shell, many little apps.
 *
 * The tracker used to be a lone floating button. Then a time tracker wanted a
 * home, and world clocks, and a pomodoro - and each one would have needed its
 * own launcher, its own modal, its own escape handling and its own place to
 * live. That is three copies of the same plumbing before you have written a
 * single clock.
 *
 * So instead: a catalogue of widgets, and a shell that can open any of them. A
 * widget declares what it is called, what it looks like, and how it opens -
 * nothing else. Adding one means adding an entry here and a component to the
 * options bundle; the dock, the modal, the sizing, the keyboard handling and
 * the settings UI all follow from the descriptor without being touched.
 *
 * Three kinds of opening, because not everything we own is a local page:
 *   view  - a React view in our own bundle, framed over the job site
 *   page  - an extension page, opened in a tab (settings)
 *   link  - a page on the website, opened in a tab (the paid ops tools)
 *
 * The dock's own arrangement lives in chrome.storage.sync, so it follows you
 * between machines the way the rest of the settings do.
 */

export const DOCK_KEY = 'ojRateFilterDock';

/** Where the dock can sit. Bottom is the default; the sides suit tall screens. */
export const DOCK_EDGES = ['bottom', 'left', 'right'];

/** The ops tools live behind the subscription; everything else is free. */
export const TIERS = { FREE: 'free', OPS: 'ops' };

/**
 * Every widget we know how to open, free and paid alike.
 *
 * `view` widgets name a React view id; the shell frames
 * `dist/options/index.html?view=<id>`. `size` is a hint the shell reads: the
 * board wants the whole window, a clock does not.
 *
 * `icon` is a name in core/icons.js, not a drawing. It used to be the SVG path
 * data inline, which made this file the sixth place in the codebase drawing its
 * own icons at its own stroke width. A name means the dock, the settings list
 * and anything else that shows a widget all get the same shape for free.
 */
export const WIDGETS = [
  {
    id: 'board',
    label: 'Tracker',
    hint: 'Your application board',
    kind: 'view',
    size: 'full',
    tier: TIERS.FREE,
    icon: 'board',
  },
  {
    id: 'saved',
    label: 'Saved',
    hint: 'Jobs you kept for later',
    kind: 'view',
    size: 'large',
    tier: TIERS.FREE,
    icon: 'saved',
  },
  {
    id: 'timer',
    label: 'Time',
    hint: 'Track hours against a client',
    kind: 'view',
    size: 'large',
    tier: TIERS.FREE,
    icon: 'timer',
  },
  {
    id: 'pomodoro',
    label: 'Focus',
    hint: 'Pomodoro timer',
    kind: 'view',
    size: 'small',
    tier: TIERS.FREE,
    icon: 'pomodoro',
  },
  {
    id: 'clocks',
    label: 'Clocks',
    hint: 'What time it is for your clients',
    kind: 'view',
    size: 'small',
    tier: TIERS.FREE,
    icon: 'clocks',
  },
  {
    id: 'snippets',
    label: 'Snippets',
    hint: 'Your saved blocks of text',
    kind: 'view',
    size: 'large',
    tier: TIERS.FREE,
    icon: 'snippets',
  },
  {
    id: 'calculator',
    label: 'Rates',
    hint: 'What a rate is worth',
    kind: 'view',
    size: 'small',
    tier: TIERS.FREE,
    icon: 'calculator',
  },
  {
    id: 'settings',
    label: 'Settings',
    hint: 'All of OljExtension',
    kind: 'page',
    page: 'dist/options/index.html',
    tier: TIERS.FREE,
    icon: 'settings',
  },

  // The paid side. Same descriptor, different kind: these are real pages on the
  // website, so the dock opens them in a tab rather than framing them.
  {
    id: 'invoices',
    label: 'Invoices',
    hint: 'Bill a client',
    kind: 'link',
    path: '/dashboard/invoices',
    tier: TIERS.OPS,
    icon: 'invoices',
  },
  {
    id: 'contracts',
    label: 'Contracts',
    hint: 'Agreements and signatures',
    kind: 'link',
    path: '/dashboard/contracts',
    tier: TIERS.OPS,
    icon: 'contracts',
  },
  {
    id: 'clients',
    label: 'Clients',
    hint: 'Your client book',
    kind: 'link',
    path: '/dashboard/clients',
    tier: TIERS.OPS,
    icon: 'clients',
  },
  {
    id: 'timesheet',
    label: 'Timesheet',
    hint: 'Billable hours, invoiced',
    kind: 'link',
    path: '/dashboard/timesheet',
    tier: TIERS.OPS,
    icon: 'timesheet',
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    hint: 'A PDF an employer can keep',
    kind: 'link',
    path: '/dashboard/portfolio',
    tier: TIERS.OPS,
    icon: 'portfolio',
  },
  {
    id: 'income',
    label: 'Income',
    hint: 'What came in',
    kind: 'link',
    path: '/dashboard/income',
    tier: TIERS.OPS,
    icon: 'income',
  },
  {
    id: 'expenses',
    label: 'Expenses',
    hint: 'What went out',
    kind: 'link',
    path: '/dashboard/expenses',
    tier: TIERS.OPS,
    icon: 'expenses',
  },
  {
    id: 'earnings',
    label: 'Earnings',
    hint: 'The two put together',
    kind: 'link',
    path: '/dashboard/earnings',
    tier: TIERS.OPS,
    icon: 'earnings',
  },
];

const BY_ID = new Map(WIDGETS.map((widget) => [widget.id, widget]));

/** The catalogue entry for an id, or null - callers must cope with unknown ids. */
export function findWidget(id) {
  return BY_ID.get(String(id ?? '')) ?? null;
}

/** Widget ids that are framed over the page rather than opened in a tab. */
export const VIEW_IDS = WIDGETS.filter((w) => w.kind === 'view').map((w) => w.id);

/**
 * What the dock shows out of the box.
 *
 * The free tools you reach for while job-hunting, and nothing else. The ops
 * tools are in the catalogue but off by default: showing eight locked icons to
 * someone who has not subscribed is a shop window, not a dock.
 */
export const DEFAULT_ORDER = [
  'board',
  'saved',
  'snippets',
  'timer',
  'pomodoro',
  'clocks',
  // The rate calculator was declared free, given a label and a hint, and then
  // left out of this list - so it shipped and appeared for nobody. It belongs
  // here more than most: converting a rate is the one thing you do while
  // reading the board rather than after it.
  'calculator',
  'settings',
];

export const DEFAULT_DOCK = Object.freeze({
  enabled: true,
  /**
   * Right edge, not bottom-centre.
   *
   * Bottom-centre is the nicer-looking default and it was the wrong one. OLJ
   * centres its results column, so a dock pinned to the middle of the bottom
   * edge sits permanently on top of a job listing - covering a strip of one
   * card and swallowing clicks meant for it. Measured on a live search page it
   * was covering "Office Adminstrator for Medical Office - $700/mo".
   *
   * The right edge never crosses a centred column, and it is where a floating
   * utility usually lives, so it reads as a tool rather than as something in
   * the way. Anyone who prefers the macOS look can still drag it back; this
   * only decides where it starts.
   */
  edge: 'right',
  /** Position along that edge, 0-1. Half way is the middle. */
  offset: 0.5,
  order: DEFAULT_ORDER,
  labels: true,
});

function clamp01(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

/**
 * Coerce whatever storage held into a dock we can render.
 *
 * Unknown ids are dropped rather than kept, so a widget we remove in a later
 * version does not leave a hole in everyone's dock. Duplicates collapse. An
 * empty order is allowed - that is a reader who hid everything, not a bug.
 */
export function sanitizeDock(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const order = [];
  const list = Array.isArray(source.order) ? source.order : DEFAULT_ORDER;
  for (const entry of list) {
    const id = String(entry ?? '');
    if (!BY_ID.has(id) || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  return {
    enabled: source.enabled !== false,
    edge: DOCK_EDGES.includes(source.edge) ? source.edge : DEFAULT_DOCK.edge,
    offset: clamp01(source.offset, DEFAULT_DOCK.offset),
    order,
    labels: source.labels !== false,
  };
}

/** The descriptors the dock should draw, in order. */
export function dockItems(dock) {
  return sanitizeDock(dock)
    .order.map((id) => BY_ID.get(id))
    .filter(Boolean);
}

/** Is this widget currently in the dock? */
export function isDocked(dock, id) {
  return sanitizeDock(dock).order.includes(String(id));
}

/** Add a widget to the dock, or take it out again. Returns a new dock. */
export function toggleDockWidget(dock, id) {
  const clean = sanitizeDock(dock);
  const key = String(id);
  if (!BY_ID.has(key)) return clean;
  const order = clean.order.includes(key)
    ? clean.order.filter((entry) => entry !== key)
    : [...clean.order, key];
  return { ...clean, order };
}

/**
 * Shuffle one widget along by `delta` places, clamped at both ends.
 *
 * Clamping rather than wrapping: dragging the first icon left should do
 * nothing, not fling it to the far end of the dock.
 */
export function moveDockWidget(dock, id, delta) {
  const clean = sanitizeDock(dock);
  const from = clean.order.indexOf(String(id));
  if (from < 0 || !Number.isFinite(delta) || delta === 0) return clean;
  const to = Math.min(clean.order.length - 1, Math.max(0, from + Math.trunc(delta)));
  if (to === from) return clean;
  const order = [...clean.order];
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  return { ...clean, order };
}

/** Where a `link` widget points, given wherever the site is running. */
export function widgetUrl(widget, apiBase) {
  if (!widget || widget.kind !== 'link') return null;
  return `${String(apiBase ?? '').replace(/\/+$/, '')}${widget.path}`;
}

/** Is this one of the paid tools? Drives the little lock on the icon. */
export function isLocked(widget, { subscribed = false } = {}) {
  return Boolean(widget) && widget.tier === TIERS.OPS && !subscribed;
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.sync);
}

export async function loadDock() {
  if (!hasStorage()) return sanitizeDock(null);
  const stored = await chrome.storage.sync.get(DOCK_KEY);
  return sanitizeDock(stored?.[DOCK_KEY]);
}

export async function saveDock(patch) {
  if (!hasStorage()) return sanitizeDock(patch);
  const current = await loadDock();
  const next = sanitizeDock({ ...current, ...patch });
  await chrome.storage.sync.set({ [DOCK_KEY]: next });
  return next;
}

/** Subscribe to dock changes from anywhere - the settings page, another tab. */
export function onDockChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
  const listener = (changes, area) => {
    if (area !== 'sync' || !changes[DOCK_KEY]) return;
    callback(sanitizeDock(changes[DOCK_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
