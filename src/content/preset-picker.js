/**
 * The preset picker: a grid of cards, grouped, behind one button.
 *
 * The palette lists presets as text lines, which is fine once you know what
 * they are and useless when you do not. What a preset actually offers is a
 * vocabulary and a floor - a dozen search terms you would never have typed, and
 * a rate that reflects that niche rather than the site as a whole. None of that
 * fits on one line, so it gets a card.
 *
 * Applying one overwrites the filters you are using, which is a big enough
 * change that the card says exactly what it will do before you click it.
 *
 * The whole lifecycle lives here rather than only in the options page: you
 * decide a preset needs a different word while you are looking at the results
 * it produced, not later in a settings tab. So the modal carries a level menu,
 * an editor, and the copy / edit / delete actions - and the options page keeps
 * the same store, so either surface sees the other's work.
 *
 * Only the static chrome is set through innerHTML. Every preset string - names,
 * notes, search terms - is written with textContent, because a preset is user
 * data and one of them will eventually contain a stray angle bracket.
 */

import { PRESETS } from '../core/presets.js';
import {
  PRESET_LEVELS,
  presetGroups,
  hiddenCount,
  duplicateOf,
  overrideOf,
  blankPreset,
} from '../core/user-presets.js';

const ROOT_ID = 'ojrf-presets';
const OPEN_CLASS = 'ojrf-presets-open';

/** "$1,000/mo · 12 search terms · 2 excluded" - the whole preset in one line. */
function summarise(preset) {
  const filters = preset.filters ?? {};
  const parts = [];

  if (Number.isFinite(filters.thresholdUsdPerMonth)) {
    parts.push(`$${filters.thresholdUsdPerMonth.toLocaleString('en-US')}/mo`);
  }

  const terms = filters.searchKeywords?.length ?? 0;
  if (terms > 0) parts.push(`${terms} search term${terms === 1 ? '' : 's'}`);

  const excluded = filters.excludeKeywords?.length ?? 0;
  if (excluded > 0) parts.push(`${excluded} excluded`);

  return parts.join(' · ');
}

/** A small labelled chip, used for "measured", the level band, and "edited". */
function tag(doc, text, title = '', extraClass = '') {
  const node = doc.createElement('span');
  node.className = `ojrf-preset-tag${extraClass ? ` ${extraClass}` : ''}`;
  node.textContent = text;
  if (title) node.title = title;
  return node;
}

function card(preset, doc, actions) {
  const item = doc.createElement('li');
  item.className = 'ojrf-preset-card';

  const name = doc.createElement('h4');
  name.className = 'ojrf-preset-name';
  name.textContent = preset.name;
  item.appendChild(name);

  // Said on the card rather than in a footnote: a threshold presented as
  // evidence should be evidence, and half of these are starting points.
  if (preset.measured) {
    name.appendChild(
      tag(doc, 'measured', 'This floor came from measuring live listings, not from an estimate'),
    );
  }
  if (preset.level && preset.level !== 'any') {
    name.appendChild(tag(doc, preset.level, 'The experience band this preset aims at'));
  }
  if (preset.overridden) {
    name.appendChild(tag(doc, 'edited', 'Your edit of a shipped preset. Revert brings it back'));
  }

  const hint = doc.createElement('p');
  hint.className = 'ojrf-preset-hint';
  hint.textContent = preset.hint ?? '';
  item.appendChild(hint);

  const facts = doc.createElement('p');
  facts.className = 'ojrf-preset-facts';
  facts.textContent = summarise(preset);
  item.appendChild(facts);

  // The terms are the actual product. Showing a few is the difference between
  // "a filter" and "the words employers here really use".
  const terms = preset.filters?.searchKeywords ?? [];
  if (terms.length > 0) {
    const chips = doc.createElement('div');
    chips.className = 'ojrf-preset-terms';

    for (const term of terms.slice(0, 5)) {
      const chip = doc.createElement('span');
      chip.className = 'ojrf-preset-term';
      chip.textContent = term;
      chips.appendChild(chip);
    }

    if (terms.length > 5) {
      const more = doc.createElement('span');
      more.className = 'ojrf-preset-term ojrf-preset-more';
      more.textContent = `+${terms.length - 5}`;
      more.title = terms.join(', ');
      chips.appendChild(more);
    }

    item.appendChild(chips);
  }

  // Apply is the whole point of the card, so it keeps the width; everything
  // else lives behind the kebab to its right rather than competing with it.
  const row = doc.createElement('div');
  row.className = 'ojrf-preset-actions';

  const apply = doc.createElement('button');
  apply.type = 'button';
  apply.className = 'ojrf-preset-apply';
  apply.textContent = 'Use this';
  apply.addEventListener('click', () => actions.onApply(preset));
  row.appendChild(apply);

  row.appendChild(kebab(preset, doc, actions));
  item.appendChild(row);
  return item;
}

/**
 * The per-card menu.
 *
 * One open at a time, closed by a click anywhere else or by Escape. Edit and
 * Copy read differently on purpose: Edit shadows a shipped preset in its own
 * slot, Copy makes a separate one of yours. Hide is not Delete - a shipped
 * preset cannot be deleted, and hiding is reversible from the menu bar.
 */
function kebab(preset, doc, actions) {
  const wrap = doc.createElement('div');
  wrap.className = 'ojrf-preset-kebab-wrap';

  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'ojrf-preset-kebab';
  button.title = 'More actions';
  button.setAttribute('aria-label', `More actions for ${preset.name}`);
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.textContent = '⋮';
  wrap.appendChild(button);

  const menu = doc.createElement('div');
  menu.className = 'ojrf-preset-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  wrap.appendChild(menu);

  const close = () => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };

  const entry = (label, handler, extraClass = '') => {
    const option = doc.createElement('button');
    option.type = 'button';
    option.setAttribute('role', 'menuitem');
    option.className = `ojrf-preset-menu-item${extraClass ? ` ${extraClass}` : ''}`;
    option.textContent = label;
    option.addEventListener('click', () => {
      close();
      handler();
    });
    menu.appendChild(option);
  };

  entry('Edit', () => actions.onEdit(preset));
  entry('Copy', () => actions.onCopy(preset));
  entry(preset.hidden ? 'Show' : 'Hide', () => actions.onToggleHidden(preset));
  if (preset.owned) {
    entry(
      preset.overridden ? 'Revert to shipped' : 'Delete',
      () => actions.onDelete(preset),
      'ojrf-preset-menu-danger',
    );
  }

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const opening = menu.hidden;
    // Only one menu open at a time, so the modal never has two competing popups.
    for (const other of doc.querySelectorAll('.ojrf-preset-menu')) other.hidden = true;
    for (const other of doc.querySelectorAll('.ojrf-preset-kebab')) {
      other.setAttribute('aria-expanded', 'false');
    }
    menu.hidden = !opening;
    button.setAttribute('aria-expanded', String(opening));
  });

  return wrap;
}

/** A labelled input row for the editor. */
function editorField(doc, label, value, placeholder, { number = false } = {}) {
  const wrap = doc.createElement('label');
  wrap.className = 'ojrf-preset-field';

  const text = doc.createElement('span');
  text.textContent = label;
  wrap.appendChild(text);

  const input = doc.createElement('input');
  input.type = number ? 'number' : 'text';
  if (number) input.min = '0';
  input.className = 'ojrf-preset-input';
  input.value = value ?? '';
  input.placeholder = placeholder ?? '';
  wrap.appendChild(input);

  return { wrap, input };
}

/**
 * The editor, built fresh each time it opens.
 *
 * Reads straight off its own inputs on save rather than keeping a mirror of
 * them in state: the form is small, it lives for one edit, and a second copy of
 * the truth is the thing that goes stale.
 */
function editor(draft, doc, { onSave, onCancel }) {
  const panel = doc.createElement('div');
  panel.className = 'ojrf-preset-editor';

  const title = doc.createElement('h4');
  title.className = 'ojrf-preset-editor-title';
  title.textContent =
    draft.source === 'override' ? `Editing “${draft.name}”` : draft.name || 'New preset';
  panel.appendChild(title);

  if (draft.source === 'override') {
    const note = doc.createElement('p');
    note.className = 'ojrf-preset-editor-note';
    note.textContent =
      'This shadows the shipped preset of the same name. Revert brings the original back.';
    panel.appendChild(note);
  }

  const name = editorField(doc, 'Name', draft.name, 'What you would call this search');
  const hint = editorField(doc, 'Note', draft.hint, 'Who it is for, or what to watch for');
  const floor = editorField(doc, 'Rate floor (USD/mo)', draft.filters.thresholdUsdPerMonth, '0', {
    number: true,
  });
  const terms = editorField(
    doc,
    'Search terms',
    (draft.filters.searchKeywords ?? []).join(', '),
    'n8n, make.com, workflow automation',
  );
  const exclude = editorField(
    doc,
    'Exclude',
    (draft.filters.excludeKeywords ?? []).join(', '),
    'commission only, unpaid',
  );

  // The name is the only thing a preset cannot do without, so it is the only
  // one marked - and Save is disabled rather than the form throwing at you.
  name.wrap.querySelector('span').appendChild(tag(doc, '*', 'Required', 'ojrf-preset-req'));

  const grid = doc.createElement('div');
  grid.className = 'ojrf-preset-editor-grid';
  for (const field of [name, hint, floor, terms, exclude]) grid.appendChild(field.wrap);
  panel.appendChild(grid);

  // Level, as the same pill row the menu uses, so the control means one thing.
  const levelRow = doc.createElement('div');
  levelRow.className = 'ojrf-preset-field';
  const levelLabel = doc.createElement('span');
  levelLabel.textContent = 'Level';
  levelRow.appendChild(levelLabel);

  const pills = doc.createElement('div');
  pills.className = 'ojrf-preset-levels';
  let chosenLevel = draft.level ?? 'any';

  for (const band of PRESET_LEVELS) {
    const pill = doc.createElement('button');
    pill.type = 'button';
    pill.className = `ojrf-preset-level${band.value === chosenLevel ? ' is-on' : ''}`;
    pill.textContent = band.label;
    pill.addEventListener('click', () => {
      chosenLevel = band.value;
      for (const other of pills.children) other.classList.remove('is-on');
      pill.classList.add('is-on');
    });
    pills.appendChild(pill);
  }

  levelRow.appendChild(pills);
  panel.appendChild(levelRow);

  const actions = doc.createElement('div');
  actions.className = 'ojrf-preset-editor-actions';

  const save = doc.createElement('button');
  save.type = 'button';
  save.className = 'ojrf-preset-apply';
  save.textContent = 'Save preset';

  const list = (value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

  const syncSave = () => {
    save.disabled = name.input.value.trim().length === 0;
  };
  name.input.addEventListener('input', syncSave);
  syncSave();

  save.addEventListener('click', () => {
    onSave({
      ...draft,
      name: name.input.value,
      hint: hint.input.value,
      level: chosenLevel,
      filters: {
        ...draft.filters,
        thresholdUsdPerMonth: Number(floor.input.value) || 0,
        searchKeywords: list(terms.input.value),
        excludeKeywords: list(exclude.input.value),
      },
    });
  });

  const cancel = doc.createElement('button');
  cancel.type = 'button';
  cancel.className = 'ojrf-preset-minor';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', onCancel);

  actions.appendChild(save);
  actions.appendChild(cancel);
  panel.appendChild(actions);

  // Straight into the name: every path here ends in typing one.
  setTimeout(() => name.input.focus(), 0);

  return panel;
}

function build(doc, onSaveCurrent) {
  const root = doc.createElement('div');
  root.id = ROOT_ID;
  root.className = 'ojrf-ui';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Search presets');
  root.hidden = true;

  root.innerHTML = `
    <div class="ojrf-presets-backdrop"></div>
    <div class="ojrf-presets-panel">
      <div class="ojrf-presets-head">
        <div>
          <h3>Start from a preset</h3>
          <p>Mostly these are vocabulary — the words employers here actually use, and a
             rate floor for that kind of work rather than for the site as a whole.</p>
        </div>
        <button type="button" class="ojrf-presets-close" aria-label="Close">&times;</button>
      </div>
      <div class="ojrf-presets-menu">
        <div class="ojrf-preset-levels" role="group" aria-label="Filter by level"></div>
        <button type="button" class="ojrf-presets-new">+ New preset</button>
      </div>
      <div class="ojrf-presets-body"></div>
      <div class="ojrf-presets-foot">
        <span>Applying one replaces the filters you are using now.</span>
        <button type="button" class="ojrf-presets-save">Save mine first…</button>
      </div>
    </div>`;

  root.querySelector('.ojrf-presets-save').addEventListener('click', onSaveCurrent);
  return root;
}

/**
 * @param {object} hooks
 * @param {Function} hooks.onApply given the chosen preset
 * @param {Function} hooks.onSaveCurrent offered because applying is destructive
 * @param {Function} [hooks.getUserPresets]
 * @param {Function} [hooks.onSavePreset] persist one, resolving with the new list
 * @param {Function} [hooks.onDeletePreset] remove one by id, resolving likewise
 */
export function createPresetPicker(
  {
    onApply,
    onSaveCurrent,
    getUserPresets = () => [],
    getHiddenPresets = () => [],
    onSavePreset = async () => [],
    onDeletePreset = async () => [],
    onToggleHidden = async () => [],
  },
  doc = document,
) {
  const root = () => doc.getElementById(ROOT_ID);
  let lastFocused = null;
  /** Which band the menu is filtering by. */
  let level = 'any';
  /** The preset being edited, or null when the grid is showing. */
  let draft = null;
  /** Our own copy of the list, so an edit shows before storage round-trips. */
  let presets = [];
  /** Names you have hidden, and whether the menu is currently revealing them. */
  let hidden = [];
  let showHidden = false;

  function close() {
    const node = root();
    if (!node || node.hidden) return;

    node.hidden = true;
    doc.documentElement.classList.remove(OPEN_CLASS);
    draft = null;
    if (lastFocused && doc.contains(lastFocused)) lastFocused.focus();
    lastFocused = null;
  }

  const applyPreset = (preset) => {
    // Closed first: the page behind is about to re-filter, and watching that
    // happen is the confirmation that the click worked.
    close();
    onApply(preset);
  };

  const actions = {
    onApply: applyPreset,
    onEdit: (preset) => {
      // A shipped preset is edited through an override; one of yours directly.
      draft = preset.owned ? { ...preset } : overrideOf(preset);
      render();
    },
    onCopy: (preset) => {
      draft = duplicateOf(preset, presets);
      render();
    },
    onDelete: async (preset) => {
      presets = await onDeletePreset(preset.id);
      render();
    },
    onToggleHidden: async (preset) => {
      hidden = await onToggleHidden(preset.name);
      render();
    },
  };

  /** Paint the menu, then either the editor or the grid. */
  function render() {
    const node = root();
    if (!node) return;

    const menu = node.querySelector('.ojrf-preset-levels');
    menu.textContent = '';
    for (const band of PRESET_LEVELS) {
      const pill = doc.createElement('button');
      pill.type = 'button';
      pill.className = `ojrf-preset-level${band.value === level ? ' is-on' : ''}`;
      pill.textContent = band.label;
      pill.addEventListener('click', () => {
        level = band.value;
        render();
      });
      menu.appendChild(pill);
    }

    // Only offered once something is actually hidden - an always-present toggle
    // for a list nobody has curated is noise.
    const buried = hiddenCount(presets, PRESETS, hidden);
    if (buried > 0) {
      const toggle = doc.createElement('button');
      toggle.type = 'button';
      toggle.className = `ojrf-preset-level${showHidden ? ' is-on' : ''}`;
      toggle.textContent = showHidden ? `Hiding ${buried}` : `Show ${buried} hidden`;
      toggle.title = 'Hidden presets stay out of the way until you ask for them';
      toggle.addEventListener('click', () => {
        showHidden = !showHidden;
        render();
      });
      menu.appendChild(toggle);
    }

    const body = node.querySelector('.ojrf-presets-body');
    body.textContent = '';

    if (draft) {
      body.appendChild(
        editor(draft, doc, {
          onSave: async (next) => {
            presets = await onSavePreset(next);
            draft = null;
            render();
          },
          onCancel: () => {
            draft = null;
            render();
          },
        }),
      );
      return;
    }

    const groups = presetGroups(presets, PRESETS, level, { hidden, showHidden });

    if (groups.length === 0) {
      const empty = doc.createElement('p');
      empty.className = 'ojrf-preset-empty';
      empty.textContent = 'No presets at this level.';
      body.appendChild(empty);
      return;
    }

    for (const { group, presets: shown } of groups) {
      const heading = doc.createElement('h5');
      heading.className = 'ojrf-preset-group';
      heading.textContent = group;
      body.appendChild(heading);

      const list = doc.createElement('ul');
      list.className = 'ojrf-preset-grid';
      for (const preset of shown) list.appendChild(card(preset, doc, actions));
      body.appendChild(list);
    }
  }

  function ensureRoot() {
    const existing = root();
    if (existing) return existing;

    const node = build(doc, () => {
      close();
      onSaveCurrent();
    });

    doc.body.appendChild(node);

    // A menu that outlives the click that dismissed it is a menu you fight.
    node.addEventListener('mousedown', (event) => {
      if (event.target.closest?.('.ojrf-preset-kebab-wrap')) return;
      for (const menu of node.querySelectorAll('.ojrf-preset-menu')) menu.hidden = true;
      for (const kebabButton of node.querySelectorAll('.ojrf-preset-kebab')) {
        kebabButton.setAttribute('aria-expanded', 'false');
      }
    });

    node.querySelector('.ojrf-presets-backdrop').addEventListener('mousedown', close);
    node.querySelector('.ojrf-presets-close').addEventListener('click', close);
    node.querySelector('.ojrf-presets-new').addEventListener('click', () => {
      draft = blankPreset(presets);
      render();
    });

    return node;
  }

  function open() {
    const node = ensureRoot();
    lastFocused = doc.activeElement;

    // Re-read each time, so a preset made in the options page is here.
    presets = getUserPresets();
    hidden = getHiddenPresets();
    draft = null;
    showHidden = false;
    render();

    node.hidden = false;
    doc.documentElement.classList.add(OPEN_CLASS);
    node.querySelector('.ojrf-presets-close')?.focus();
  }

  // A dialog you cannot dismiss with Escape is a trap, wherever focus ended up.
  // Escape backs out of the editor first: losing a half-typed preset because
  // you wanted to close a form is the wrong order of operations.
  doc.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    const node = root();
    if (!node || node.hidden) return;

    // An open kebab is the innermost thing, so it goes first.
    const openMenu = node.querySelector('.ojrf-preset-menu:not([hidden])');
    if (openMenu) {
      event.preventDefault();
      openMenu.hidden = true;
      node
        .querySelectorAll('.ojrf-preset-kebab')
        .forEach((b) => b.setAttribute('aria-expanded', 'false'));
      return;
    }

    event.preventDefault();
    if (draft) {
      draft = null;
      render();
      return;
    }
    close();
  });

  return { open, close, toggle: () => (root()?.hidden === false ? close() : open()) };
}
