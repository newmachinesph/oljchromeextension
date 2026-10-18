/**
 * Collapsing and restoring listings.
 *
 * Hard rule: never remove a page node. Collapsing adds a class and inserts a
 * sibling stub; expanding undoes exactly that. Turning the extension off must
 * leave the page as the site rendered it.
 */

const HIDDEN_CLASS = 'ojrf-hidden';
const STUB_CLASS = 'ojrf-stub';
const PART_HIDDEN_CLASS = 'ojrf-part-hidden';

const GROUP_ID = 'ojrf-hidden-group';
const GROUP_OPEN_CLASS = 'ojrf-group-open';

/** element -> stub node, so we can always find our own insertion again. */
const stubs = new WeakMap();

/**
 * stub -> what its button should do, looked up at click time rather than bound
 * at build time. A stub is reused across passes and the rule that hid its
 * listing can change between them: a dismissed listing needs its button to
 * un-dismiss, where every other stub only needs to expand for this visit.
 */
const showActions = new WeakMap();

/**
 * Where collapsed stubs are gathered.
 *
 * Only stubs move - they are ours. The hidden listing itself stays exactly where
 * the site put it (it is display:none, so its position is invisible anyway),
 * which keeps "switch the filter off and the page is untouched" true by
 * construction.
 */
let groupHost = null;
let groupPosition = 'inline';

/**
 * Whether the gathered block is open. Kept in memory rather than in settings:
 * it is a transient "let me look at what was hidden" gesture, not a preference,
 * and it should survive re-filtering without surviving a page load.
 */
let groupOpen = false;

export function configureGrouping({ container, position }) {
  groupHost = container ?? null;
  groupPosition = position ?? 'inline';
  // Neither of these keeps a block: 'inline' never had one, and 'off' wants
  // nothing left behind at all.
  if (groupPosition === 'inline' || groupPosition === 'off') removeGroup();
}

function removeGroup() {
  document.getElementById(GROUP_ID)?.remove();
}

function ensureGroup() {
  if (groupPosition === 'inline' || !groupHost) return null;

  let group = document.getElementById(GROUP_ID);
  if (!group) {
    group = document.createElement('div');
    group.id = GROUP_ID;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ojrf-group-toggle';
    toggle.innerHTML =
      '<span class="ojrf-group-caret" aria-hidden="true"></span>' +
      '<span class="ojrf-group-heading"></span>';
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      setGroupOpen(!groupOpen);
    });

    const list = document.createElement('div');
    list.className = 'ojrf-group-list';

    group.append(toggle, list);
    applyGroupOpenState(group);
  }

  // Re-assert the position on every pass: the setting may have changed, and the
  // site may have re-rendered around us.
  if (groupPosition === 'top') {
    // The control bar also lives at the top of this container; sit just below it.
    const bar = groupHost.querySelector(':scope > #ojrf-bar');
    const anchor = bar ? bar.nextSibling : groupHost.firstChild;
    if (group.parentElement !== groupHost || group.previousElementSibling !== bar) {
      groupHost.insertBefore(group, anchor);
    }
  } else if (group.parentElement !== groupHost || groupHost.lastChild !== group) {
    groupHost.appendChild(group);
  }

  return group;
}

function applyGroupOpenState(group) {
  group.classList.toggle(GROUP_OPEN_CLASS, groupOpen);
  const toggle = group.querySelector('.ojrf-group-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', String(groupOpen));
}

/** Open or close the whole block at once, independently of each stub. */
export function setGroupOpen(open) {
  groupOpen = Boolean(open);
  const group = document.getElementById(GROUP_ID);
  if (group) applyGroupOpenState(group);
}

export function setGroupHeading(text) {
  const heading = document.getElementById(GROUP_ID)?.querySelector('.ojrf-group-heading');
  if (heading) heading.textContent = text;
}

function buildStub(listing, rateLabel) {
  const stub = document.createElement('div');
  stub.className = STUB_CLASS;

  const title = document.createElement('span');
  title.className = 'ojrf-stub-title';
  title.textContent = listing.title;

  const rate = document.createElement('span');
  rate.className = 'ojrf-stub-rate';
  rate.textContent = rateLabel;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ojrf-stub-show';
  button.textContent = 'show';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    (showActions.get(stub) ?? expand)(listing);
  });

  stub.append(title, rate, button);
  return stub;
}

/**
 * @param {object} listing   a scanned listing record
 * @param {string} rateLabel what to print on the stub
 * @param {string} reason    which rule hid it
 * @param {Function} [onShow] what the stub's button does; defaults to expanding
 *   it for this visit only
 */
export function collapse(listing, rateLabel, reason, onShow) {
  const { element } = listing;

  /*
   * 'off' means gone, not summarised.
   *
   * A stub is a small kindness for someone who wants to double-check what the
   * filter took - and an irritation for someone who has already decided and
   * just wants the list shorter. So this leaves nothing behind: no stub to
   * build, none to keep in step with a changing reason, and no block heading
   * counting things the reader asked not to see. The count stays on the
   * control bar, which is where they can still find it.
   */
  if (groupPosition === 'off') {
    const existing = stubs.get(element);
    if (existing) {
      existing.remove();
      stubs.delete(element);
    }
    element.classList.add(HIDDEN_CLASS);
    return;
  }

  // Already collapsed: refresh the label rather than returning early. The rule
  // that hides a listing can change between passes, and a stub still showing
  // the previous reason is worse than no stub at all.
  const stub = stubs.get(element) ?? buildStub(listing, rateLabel);
  stub.querySelector('.ojrf-stub-rate').textContent = rateLabel;
  stub.dataset.reason = reason ?? '';

  showActions.set(stub, onShow ?? expand);
  // "show" reveals it for now; "restore" undoes a decision you made and sticks.
  stub.querySelector('.ojrf-stub-show').textContent = onShow ? 'restore' : 'show';

  element.classList.add(HIDDEN_CLASS);
  stubs.set(element, stub);

  // Appending on every pass - even for a stub already in the group - keeps the
  // block ordered the same way the listings are.
  const group = ensureGroup();
  if (group) {
    group.querySelector('.ojrf-group-list').appendChild(stub);
  } else if (stub.parentElement === null || stub.nextElementSibling !== element) {
    element.parentElement?.insertBefore(stub, element);
  }
}

export function expand(listing) {
  const { element } = listing;
  const stub = stubs.get(element);
  if (stub) {
    stub.remove();
    stubs.delete(element);
  }
  element.classList.remove(HIDDEN_CLASS);
}

/**
 * Whether this listing is currently hidden.
 *
 * Reads the class rather than the stub registry, because with hidden listings
 * turned off there is no stub to find and the listing is hidden all the same.
 */
export function isCollapsed(listing) {
  return Boolean(listing?.element?.classList?.contains(HIDDEN_CLASS));
}

/**
 * Hide or restore a part of a listing the site rendered - its own rate line, or
 * its description excerpt.
 *
 * A class toggle, never a removal, so switching the setting back leaves the card
 * exactly as the site built it.
 */
export function setPartHidden(element, hidden) {
  if (!element) return;
  element.classList.toggle(PART_HIDDEN_CLASS, Boolean(hidden));
}

/**
 * Put every listing back exactly as the site rendered it.
 * The meta row is the caller's to clear - see filter.js restore().
 */
export function restoreAll(listings) {
  for (const listing of listings) {
    expand(listing);
    setPartHidden(listing.rateBlock, false);
    setPartHidden(listing.descBlock, false);
  }
  removeGroup();
}
