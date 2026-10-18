/**
 * How you have shaped the board: what the lanes are called, which you hid, the
 * order you put them in, any lanes you added yourself, and the card colours you
 * saved.
 *
 * The canonical stages are fixed - an application's status is always one of the
 * built-in values (or a custom lane you made), so a record written today still
 * reads tomorrow. This store only changes how the board *presents* things: a
 * renamed lane keeps its value and its cards, a hidden lane is folded away, a
 * reordered lane just moves. So you can bend the board to your own steps without
 * the data underneath drifting.
 *
 * chrome.storage.local, like every other preference the board leans on.
 */

import { createQueue } from './queue.js';

const STORAGE_KEY = 'ojRateFilterBoardConfig';

/** All writes to this store run one at a time, so none clobbers another. */
const writes = createQueue();

/** A lane name longer than this is not a name. */
export const MAX_LABEL_LENGTH = 40;
/** A lane you have hand-ordered past this is not a lane you are reading. */
export const MAX_CARD_ORDER = 300;

/** Guards so a runaway config can't grow without bound. */
const MAX_CUSTOM_COLUMNS = 12;
const MAX_PALETTE = 24;

const HEX = /^#[0-9a-fA-F]{6}$/;

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

/** A lane/status value: a short, storage-safe token. */
function cleanValue(raw) {
  const v = String(raw ?? '').trim();
  return v.length > 0 && v.length <= 60 ? v : '';
}

function cleanLabel(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_LENGTH);
}

function uniqueValues(list) {
  return [...new Set(list.map(cleanValue).filter((v) => v.length > 0))];
}

/** Coerce whatever storage held into a config every caller can trust. */
export function sanitizeBoardConfig(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  const labels = {};
  if (input.labels && typeof input.labels === 'object') {
    for (const [value, label] of Object.entries(input.labels)) {
      const key = cleanValue(value);
      const text = cleanLabel(label);
      if (key.length > 0 && text.length > 0) labels[key] = text;
    }
  }

  const hidden = Array.isArray(input.hidden) ? uniqueValues(input.hidden) : [];
  const order = Array.isArray(input.order) ? uniqueValues(input.order) : [];

  const columns = [];
  if (Array.isArray(input.columns)) {
    const seen = new Set();
    for (const col of input.columns) {
      if (!col || typeof col !== 'object') continue;
      const value = cleanValue(col.value);
      const label = cleanLabel(col.label);
      if (!value || !label || seen.has(value)) continue;
      seen.add(value);
      columns.push({ value, label });
      if (columns.length >= MAX_CUSTOM_COLUMNS) break;
    }
  }

  /*
   * The order you dragged cards into, per lane.
   *
   * Kept as a plain list of job keys rather than a rank on each card: a lane is
   * a sequence, and storing it as one means a reorder is a single write instead
   * of renumbering everything after the card that moved. Keys for cards that
   * have since left the lane are harmless - the board only reads keys it still
   * has, and dropping them here would fight with a card being dragged away and
   * back.
   */
  const cardOrder = {};
  if (input.cardOrder && typeof input.cardOrder === 'object' && !Array.isArray(input.cardOrder)) {
    for (const [lane, keys] of Object.entries(input.cardOrder)) {
      const value = cleanValue(lane);
      if (!value || !Array.isArray(keys)) continue;
      const clean = [...new Set(keys.map((k) => String(k ?? '').trim()).filter(Boolean))].slice(
        0,
        MAX_CARD_ORDER,
      );
      if (clean.length > 0) cardOrder[value] = clean;
    }
  }

  const palette = Array.isArray(input.palette)
    ? [...new Set(input.palette.map((c) => String(c).trim().toLowerCase()).filter((c) => HEX.test(c)))].slice(0, MAX_PALETTE)
    : [];

  return { labels, hidden, order, columns, palette, cardOrder };
}

/** @returns {Promise<{labels: object, hidden: string[], order: string[], columns: Array<{value:string,label:string}>, palette: string[], cardOrder: Record<string, string[]>}>} */
export async function loadBoardConfig() {
  if (!hasStorage()) return sanitizeBoardConfig(null);
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeBoardConfig(stored?.[STORAGE_KEY]);
}

async function write(next) {
  const clean = sanitizeBoardConfig(next);
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: clean });
  return clean;
}

/** Rename a lane. An empty label clears the override, restoring the default. */
export function setStageLabel(value, label) {
  return writes(async () => {
    const config = await loadBoardConfig();
    const labels = { ...config.labels };
    const text = cleanLabel(label);
    if (text.length === 0) delete labels[value];
    else labels[value] = text;
    return write({ ...config, labels });
  });
}

/** Hide or show a lane. Hiding never touches the cards in it. */
export function setStageHidden(value, hidden) {
  return writes(async () => {
    const config = await loadBoardConfig();
    const set = new Set(config.hidden);
    if (hidden) set.add(value);
    else set.delete(value);
    return write({ ...config, hidden: [...set] });
  });
}

/** Set the left-to-right lane order. Values not listed keep their default place. */
export function setStageOrder(order) {
  return writes(async () => {
    const config = await loadBoardConfig();
    return write({ ...config, order: uniqueValues(Array.isArray(order) ? order : []) });
  });
}

/**
 * Add a lane of your own. Its value is namespaced (`custom-…`) so it can never
 * collide with a built-in stage. Returns the new column's value, or null if the
 * label was empty or the ceiling was hit.
 */
export function addCustomColumn(label) {
  return writes(async () => {
    const config = await loadBoardConfig();
    const text = cleanLabel(label);
    if (!text || config.columns.length >= MAX_CUSTOM_COLUMNS) return { value: null };
    const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const base = `custom-${slug}`;
    const taken = new Set(config.columns.map((c) => c.value));
    let value = base;
    let n = 2;
    while (taken.has(value) || value === 'custom-') value = `${base}-${n++}`;
    const columns = [...config.columns, { value, label: text }];
    await write({ ...config, columns });
    return { value };
  }).then((r) => r.value);
}

/**
 * Remove a custom lane, clearing any label/hidden/order it left behind. Built-in
 * stages are untouched (they are not in `columns`).
 */
export function removeCustomColumn(value) {
  return writes(async () => {
    const config = await loadBoardConfig();
    const columns = config.columns.filter((c) => c.value !== value);
    const labels = { ...config.labels };
    delete labels[value];
    const hidden = config.hidden.filter((v) => v !== value);
    const order = config.order.filter((v) => v !== value);
    return write({ ...config, columns, labels, hidden, order });
  });
}

/** Save a custom card colour to the reusable palette. */
export function addPaletteColor(hex) {
  return writes(async () => {
    const config = await loadBoardConfig();
    const c = String(hex ?? '').trim().toLowerCase();
    if (!HEX.test(c) || config.palette.includes(c)) return config;
    return write({ ...config, palette: [...config.palette, c].slice(0, MAX_PALETTE) });
  });
}

/** Drop a colour from the reusable palette. */
export function removePaletteColor(hex) {
  return writes(async () => {
    const config = await loadBoardConfig();
    const c = String(hex ?? '').trim().toLowerCase();
    return write({ ...config, palette: config.palette.filter((p) => p !== c) });
  });
}

/** Back to the default names, every lane shown, in default order. */
export function resetBoardConfig() {
  return writes(async () => write(sanitizeBoardConfig(null)));
}

/** Replace the whole config, for a restore. */
export function replaceBoardConfig(raw) {
  return writes(async () => write(raw));
}

/**
 * Apply the config to the default lanes, producing the lanes to render: each
 * with its shown name, whether it is folded away, and whether it is a custom
 * lane you can delete. Custom lanes are appended; the saved order is applied
 * last. Pure, so the board can render straight from it.
 *
 * @param {object} config
 * @param {Array<{value: string, label: string}>} base default lanes, in order
 * @returns {Array<{value: string, label: string, defaultLabel: string, hidden: boolean, custom: boolean}>}
 */
export function columnsFor(config, base) {
  const { labels, hidden, order, columns } = sanitizeBoardConfig(config);
  const hiddenSet = new Set(hidden);
  const orderIndex = new Map(order.map((v, i) => [v, i]));

  const merged = [...base, ...columns.map((c) => ({ value: c.value, label: c.label, custom: true }))];
  const seen = new Set();
  const lanes = [];
  for (const lane of merged) {
    if (seen.has(lane.value)) continue;
    seen.add(lane.value);
    lanes.push(lane);
  }

  return lanes
    .map((lane, index) => ({
      value: lane.value,
      label: labels[lane.value] || lane.label,
      defaultLabel: lane.label,
      hidden: hiddenSet.has(lane.value),
      custom: Boolean(lane.custom),
      index,
    }))
    .sort((a, b) => {
      const ai = orderIndex.has(a.value) ? orderIndex.get(a.value) : Infinity;
      const bi = orderIndex.has(b.value) ? orderIndex.get(b.value) : Infinity;
      return ai !== bi ? ai - bi : a.index - b.index;
    })
    .map(({ index, ...lane }) => lane);
}

/** Subscribe to changes from anywhere - another tab, or a reset elsewhere. */
export function onBoardConfigChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    callback(sanitizeBoardConfig(changes[STORAGE_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/**
 * Remember the order you dragged a lane's cards into.
 *
 * The whole sequence is written at once, because that is what a reorder
 * produces - and because a per-card index would need every later card
 * rewritten each time one moved.
 */
export async function setCardOrder(lane, keys) {
  const config = await loadBoardConfig();
  const value = cleanValue(lane);
  if (!value) return config;

  const next = { ...config.cardOrder };
  const clean = [...new Set((keys ?? []).map((k) => String(k ?? '').trim()).filter(Boolean))];

  if (clean.length > 0) next[value] = clean.slice(0, MAX_CARD_ORDER);
  else delete next[value];

  return write({ ...config, cardOrder: next });
}
