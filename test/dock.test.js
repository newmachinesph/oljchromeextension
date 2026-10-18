import { describe, it, expect } from 'vitest';
import {
  WIDGETS,
  DEFAULT_DOCK,
  DEFAULT_ORDER,
  DOCK_EDGES,
  VIEW_IDS,
  TIERS,
  sanitizeDock,
  dockItems,
  isDocked,
  toggleDockWidget,
  moveDockWidget,
  findWidget,
  widgetUrl,
  isLocked,
} from '../src/core/dock.js';

describe('the catalogue', () => {
  it('gives every widget a unique id', () => {
    const ids = WIDGETS.map((widget) => widget.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every widget the fields the dock and the shell read', () => {
    for (const widget of WIDGETS) {
      expect(widget.label, widget.id).toBeTruthy();
      expect(widget.hint, widget.id).toBeTruthy();
      expect(widget.icon, widget.id).toBeTruthy();
      expect(['view', 'page', 'link'], widget.id).toContain(widget.kind);
      expect([TIERS.FREE, TIERS.OPS], widget.id).toContain(widget.tier);
    }
  });

  it('tells each kind of widget where it goes', () => {
    // The shell needs a size; a tab-opener needs somewhere to point. A widget
    // missing its own half of that opens a blank frame, or nothing at all.
    for (const widget of WIDGETS) {
      if (widget.kind === 'view') expect(widget.size, widget.id).toBeTruthy();
      if (widget.kind === 'link') expect(widget.path, widget.id).toMatch(/^\//);
      if (widget.kind === 'page') expect(widget.page, widget.id).toBeTruthy();
    }
  });

  it('starts you with widgets that all exist', () => {
    for (const id of DEFAULT_ORDER) expect(findWidget(id), id).not.toBeNull();
  });

  it('keeps the paid tools out of the default dock', () => {
    // Eight locked icons in front of someone who has not subscribed is a shop
    // window, not a dock.
    for (const id of DEFAULT_ORDER) expect(findWidget(id).tier).toBe(TIERS.FREE);
  });

  it('lists exactly the widgets the React side must have a view for', () => {
    expect(VIEW_IDS).toEqual(WIDGETS.filter((w) => w.kind === 'view').map((w) => w.id));
  });
});

describe('sanitizeDock', () => {
  it('turns nothing into the defaults', () => {
    expect(sanitizeDock(null)).toEqual({ ...DEFAULT_DOCK, order: [...DEFAULT_ORDER] });
    expect(sanitizeDock(undefined).order).toEqual(DEFAULT_ORDER);
    // Against the default itself, not a copy of its current value: what this
    // asserts is "junk falls back to the default", and hard-coding the edge
    // made it fail the day the default moved for an unrelated reason.
    expect(sanitizeDock('nonsense').edge).toBe(DEFAULT_DOCK.edge);
  });

  it('drops ids we no longer ship', () => {
    // A widget removed in a later version must not leave a hole in the dock.
    expect(sanitizeDock({ order: ['board', 'weather', 'clocks'] }).order).toEqual([
      'board',
      'clocks',
    ]);
  });

  it('collapses a duplicate rather than drawing it twice', () => {
    expect(sanitizeDock({ order: ['board', 'board'] }).order).toEqual(['board']);
  });

  it('keeps an empty dock empty', () => {
    // Someone who removed everything asked for that; it is not a missing value
    // to be filled back in with the defaults.
    expect(sanitizeDock({ order: [] }).order).toEqual([]);
  });

  it('refuses an edge that is not one', () => {
    expect(sanitizeDock({ edge: 'top' }).edge).toBe(DEFAULT_DOCK.edge);
    for (const edge of DOCK_EDGES) expect(sanitizeDock({ edge }).edge).toBe(edge);
  });

  it('holds the offset inside the window', () => {
    expect(sanitizeDock({ offset: -3 }).offset).toBe(0);
    expect(sanitizeDock({ offset: 9 }).offset).toBe(1);
    expect(sanitizeDock({ offset: 'x' }).offset).toBe(DEFAULT_DOCK.offset);
    expect(sanitizeDock({ offset: 0.25 }).offset).toBe(0.25);
  });

  it('treats only an explicit false as off', () => {
    expect(sanitizeDock({ enabled: false }).enabled).toBe(false);
    expect(sanitizeDock({ enabled: undefined }).enabled).toBe(true);
    expect(sanitizeDock({ labels: false }).labels).toBe(false);
  });
});

describe('dockItems', () => {
  it('returns descriptors in the stored order, not the catalogue order', () => {
    const items = dockItems({ order: ['clocks', 'board'] });
    expect(items.map((item) => item.id)).toEqual(['clocks', 'board']);
  });

  it('is safe on rubbish', () => {
    expect(dockItems(null).length).toBe(DEFAULT_ORDER.length);
    expect(dockItems({ order: ['nope'] })).toEqual([]);
  });
});

describe('toggleDockWidget', () => {
  it('adds at the end and removes from anywhere', () => {
    const added = toggleDockWidget({ order: ['board'] }, 'clocks');
    expect(added.order).toEqual(['board', 'clocks']);
    expect(toggleDockWidget(added, 'board').order).toEqual(['clocks']);
  });

  it('ignores an id we do not have', () => {
    expect(toggleDockWidget({ order: ['board'] }, 'weather').order).toEqual(['board']);
  });

  it('lets the paid tools be docked like anything else', () => {
    // Someone paying for invoices should be able to reach them without leaving
    // the job board - that is the whole argument for a dock.
    expect(isDocked(toggleDockWidget({ order: [] }, 'invoices'), 'invoices')).toBe(true);
  });
});

describe('moveDockWidget', () => {
  const dock = { order: ['board', 'saved', 'clocks'] };

  it('shuffles one along', () => {
    expect(moveDockWidget(dock, 'clocks', -1).order).toEqual(['board', 'clocks', 'saved']);
    expect(moveDockWidget(dock, 'board', 2).order).toEqual(['saved', 'clocks', 'board']);
  });

  it('clamps rather than wrapping', () => {
    // Dragging the first icon left should do nothing, not fling it to the end.
    expect(moveDockWidget(dock, 'board', -1).order).toEqual(['board', 'saved', 'clocks']);
    expect(moveDockWidget(dock, 'clocks', 5).order).toEqual(['board', 'saved', 'clocks']);
  });

  it('does nothing without a real move', () => {
    expect(moveDockWidget(dock, 'saved', 0).order).toEqual(dock.order);
    expect(moveDockWidget(dock, 'weather', 1).order).toEqual(dock.order);
    expect(moveDockWidget(dock, 'saved', Number.NaN).order).toEqual(dock.order);
  });
});

describe('widgetUrl', () => {
  it('joins the base to the path without doubling the slash', () => {
    expect(widgetUrl(findWidget('invoices'), 'https://oljextension.site/')).toBe(
      'https://oljextension.site/dashboard/invoices',
    );
    expect(widgetUrl(findWidget('invoices'), 'http://localhost:3100')).toBe(
      'http://localhost:3100/dashboard/invoices',
    );
  });

  it('has nothing to say about a widget that is not a link', () => {
    expect(widgetUrl(findWidget('board'), 'https://x')).toBeNull();
    expect(widgetUrl(findWidget('settings'), 'https://x')).toBeNull();
    expect(widgetUrl(null, 'https://x')).toBeNull();
  });
});

describe('isLocked', () => {
  it('locks the paid tools until there is a subscription', () => {
    expect(isLocked(findWidget('invoices'))).toBe(true);
    expect(isLocked(findWidget('invoices'), { subscribed: true })).toBe(false);
  });

  it('never locks a free one', () => {
    expect(isLocked(findWidget('board'))).toBe(false);
    expect(isLocked(null)).toBe(false);
  });
});
