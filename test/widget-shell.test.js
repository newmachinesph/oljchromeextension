// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import WinBox from '../vendor/winbox/winbox.js';
import {
  createWidgetShell,
  CLOSE_MESSAGE,
  STATES,
  WINDOW_CLASS,
} from '../src/content/widget-shell.js';
import { findWidget, VIEW_IDS } from '../src/core/dock.js';

/*
 * The real WinBox, not a stand-in.
 *
 * The shell's whole job is now translating our contract into someone else's
 * window manager, and a mock would only ever assert that we call the methods
 * we think we call. Injecting the actual library means these tests fail if
 * WinBox changes under us - which is the risk that taking a dependency buys.
 */
const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnop';
const shellFor = () => createWidgetShell(document, { WinBox });

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.className = '';
  globalThis.chrome = {
    runtime: { getURL: (path) => `${EXTENSION_ORIGIN}/${path}` },
  };
});

const boxes = () => [...document.querySelectorAll(`.winbox.${WINDOW_CLASS}`)];
const shown = () => boxes().filter((box) => !box.classList.contains('hide'));
const titleOf = (box) => box.querySelector('.wb-title')?.textContent;
const frameIn = (box) => box.querySelector('iframe');

describe('opening', () => {
  it('builds nothing until something is opened', async () => {
    shellFor();
    // A window nobody has asked for should not be in the page's markup, let
    // alone loading an iframe.
    expect(boxes()).toHaveLength(0);
  });

  it('takes a descriptor or a bare id', async () => {
    const shell = shellFor();
    await shell.open('board');
    expect(shell.current()).toBe('board');

    await shell.open(findWidget('clocks'));
    expect(shell.current()).toBe('clocks');
  });

  it('frames the view the descriptor names', async () => {
    const shell = shellFor();
    await shell.open('clocks');
    expect(frameIn(boxes()[0]).src).toBe(
      `${EXTENSION_ORIGIN}/dist/options/index.html?view=clocks`,
    );
  });

  it('titles the window with the widget', async () => {
    const shell = shellFor();
    await shell.open('timer');
    expect(titleOf(boxes()[0])).toBe('Time');
  });

  it('marks each window as ours, so our styling can reach it', async () => {
    // Scoping matters: another extension's WinBox on the same page must not
    // pick up our skin, and ours must not pick up theirs.
    const shell = shellFor();
    await shell.open('board');
    expect(boxes()[0].classList.contains(WINDOW_CLASS)).toBe(true);
    expect(boxes()[0].classList.contains('ojrf-winbox-board')).toBe(true);
  });

  it('sits above everything the job site draws', async () => {
    const shell = shellFor();
    await shell.open('board');
    expect(Number(boxes()[0].style.zIndex)).toBeGreaterThanOrEqual(2147483000);
  });

  it('opens every widget the catalogue says is framed', async () => {
    // The catalogue and the shell must not drift: a `view` widget the shell
    // refuses to open is a dock icon that does nothing.
    const shell = shellFor();
    for (const id of VIEW_IDS) {
      await shell.open(id);
      expect(shell.current(), id).toBe(id);
    }
  });
});

describe('what it refuses to open', () => {
  it('ignores a widget that belongs in a tab, not a window', async () => {
    // Settings is a `page` and the ops tools are `link`s; the dock opens those
    // itself. Half-opening one here would show an empty window.
    const shell = shellFor();
    await shell.open('settings');
    expect(shell.current()).toBeNull();
    await shell.open('invoices');
    expect(shell.current()).toBeNull();
    expect(boxes()).toHaveLength(0);
  });

  it('ignores an id we do not have', async () => {
    const shell = shellFor();
    await shell.open('weather');
    expect(shell.current()).toBeNull();
  });
});

describe('switching between widgets', () => {
  it('keeps one window per widget', async () => {
    const shell = shellFor();
    await shell.open('board');
    await shell.open('clocks');
    expect(boxes()).toHaveLength(2);
  });

  it('does not rebuild a window it has already made', async () => {
    /*
     * The reason windows are kept rather than destroyed: reopening the board
     * should not throw away the lane you were mid-drag on, and the pomodoro
     * should not restart from zero every time.
     */
    const shell = shellFor();
    await shell.open('board');
    const first = frameIn(boxes()[0]);
    await shell.open('clocks');
    await shell.open('board');

    expect(boxes()).toHaveLength(2);
    expect(frameIn(boxes()[0])).toBe(first);
  });
});

describe('closing', () => {
  it('hides rather than destroying, so the widget keeps its place', async () => {
    const shell = shellFor();
    await shell.open('board');
    const frame = frameIn(boxes()[0]);
    shell.close();

    expect(shell.current()).toBeNull();
    // Still in the document, just not on screen.
    expect(boxes()).toHaveLength(1);
    expect(frameIn(boxes()[0])).toBe(frame);
    expect(shown()).toHaveLength(0);
  });

  it('survives the library close button without losing the frame', async () => {
    // The library's chrome is not ours to intercept, so onclose cancels the
    // teardown and hides instead. Otherwise a stray click on the X would throw
    // away a half-written note.
    const shell = shellFor();
    await shell.open('board');
    const frame = frameIn(boxes()[0]);

    boxes()[0].querySelector('.wb-close').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(shell.current()).toBeNull();
    expect(frameIn(boxes()[0])).toBe(frame);
  });

  it('hands focus back to wherever it came from', async () => {
    const before = document.createElement('button');
    document.body.appendChild(before);
    before.focus();

    const shell = shellFor();
    await shell.open('board');
    shell.close();

    expect(document.activeElement).toBe(before);
  });

  it('does nothing when nothing is open', async () => {
    const shell = shellFor();
    expect(() => shell.close()).not.toThrow();
    expect(shell.current()).toBeNull();
  });
});

describe('toggle', () => {
  it('puts away the widget that is already showing', async () => {
    const shell = shellFor();
    await shell.toggle('board');
    expect(shell.current()).toBe('board');
    await shell.toggle('board');
    expect(shell.current()).toBeNull();
  });

  it('switches straight to a different widget rather than closing', async () => {
    // Clicking the clock while the board is open means "show me the clock",
    // not "close the board".
    const shell = shellFor();
    await shell.toggle('board');
    await shell.toggle('clocks');
    expect(shell.current()).toBe('clocks');
  });

  it('brings a minimised widget back rather than closing it', async () => {
    // It is already put away; closing there would end the session for a click
    // that meant the opposite.
    const shell = shellFor();
    await shell.toggle('board');
    shell.minimize();
    expect(shell.state()).toBe(STATES.MIN);

    await shell.toggle('board');
    expect(shell.current()).toBe('board');
    expect(shell.state()).toBe(STATES.NORMAL);
  });
});

describe('the window controls', () => {
  it('opens in the normal state', async () => {
    const shell = shellFor();
    await shell.open('clocks');
    expect(shell.state()).toBe(STATES.NORMAL);
  });

  it('offers minimise, maximise and close', async () => {
    const shell = shellFor();
    await shell.open('board');
    const box = boxes()[0];
    expect(box.querySelector('.wb-min')).not.toBeNull();
    expect(box.querySelector('.wb-max')).not.toBeNull();
    expect(box.querySelector('.wb-close')).not.toBeNull();
  });

  it('reports minimise, maximise and restore back to us', async () => {
    // The dock paints its icons from these, so they have to be true even when
    // the change came from the library's own chrome rather than our API.
    const shell = shellFor();
    await shell.open('clocks');

    shell.maximize();
    expect(shell.state()).toBe(STATES.MAX);

    shell.restore();
    expect(shell.state()).toBe(STATES.NORMAL);

    shell.minimize();
    expect(shell.state()).toBe(STATES.MIN);
  });

  it('keeps the widget loaded while minimised', async () => {
    // The whole point: a pomodoro does not pause because you looked away.
    const shell = shellFor();
    await shell.open('pomodoro');
    const frame = frameIn(boxes()[0]);
    shell.minimize();

    expect(shell.current()).toBe('pomodoro');
    expect(frameIn(boxes()[0])).toBe(frame);
  });

  it('goes back to normal after closing', async () => {
    const shell = shellFor();
    await shell.open('board');
    shell.maximize();
    shell.close();
    expect(shell.state()).toBe(STATES.NORMAL);
  });

  it('reports normal when nothing is open at all', () => {
    expect(shellFor().state()).toBe(STATES.NORMAL);
  });

  it('ignores the controls when nothing is open', () => {
    const shell = shellFor();
    expect(() => {
      shell.minimize();
      shell.maximize();
      shell.restore();
    }).not.toThrow();
  });
});

describe('the close message from inside the frame', () => {
  /*
   * A framed view is cross-origin from the job site around it, so its Escape
   * keypress never reaches this shell. It posts a message up instead - and that
   * message is the one thing here an untrusted page could try to forge.
   */
  const post = (data, { origin, source }) => {
    const event = new MessageEvent('message', { data, origin });
    // jsdom will not accept an arbitrary `source` through the constructor, so
    // it is defined on the event directly.
    Object.defineProperty(event, 'source', { value: source });
    window.dispatchEvent(event);
  };

  it('closes when one of our own frames asks', async () => {
    const shell = shellFor();
    await shell.open('board');
    post(
      { type: CLOSE_MESSAGE },
      { origin: EXTENSION_ORIGIN, source: frameIn(boxes()[0]).contentWindow },
    );
    expect(shell.current()).toBeNull();
  });

  it('still accepts the older board-only message', async () => {
    // Kept so a frame left over mid-upgrade does not become uncloseable.
    const shell = shellFor();
    await shell.open('board');
    post(
      { type: 'ojrf-board-close' },
      { origin: EXTENSION_ORIGIN, source: frameIn(boxes()[0]).contentWindow },
    );
    expect(shell.current()).toBeNull();
  });

  it('refuses a message from the job site around it', async () => {
    // Otherwise onlinejobs.ph could postMessage its way into dismissing
    // whatever you had open.
    const shell = shellFor();
    await shell.open('board');
    post(
      { type: CLOSE_MESSAGE },
      { origin: 'https://www.onlinejobs.ph', source: frameIn(boxes()[0]).contentWindow },
    );
    expect(shell.current()).toBe('board');
  });

  it('refuses a message from a window that is not one of our frames', async () => {
    // The right origin is not enough on its own; it must be a frame we made.
    const shell = shellFor();
    await shell.open('board');
    post({ type: CLOSE_MESSAGE }, { origin: EXTENSION_ORIGIN, source: window });
    expect(shell.current()).toBe('board');
  });

  it('ignores a message that is not ours at all', async () => {
    const shell = shellFor();
    await shell.open('board');
    post(
      { type: 'something-else' },
      { origin: EXTENSION_ORIGIN, source: frameIn(boxes()[0]).contentWindow },
    );
    expect(shell.current()).toBe('board');
  });
});

describe('telling the dock', () => {
  it('reports what is open and how, so the icons can follow', async () => {
    const seen = [];
    const shell = shellFor();
    const stop = shell.onChange((change) => seen.push(`${change.id}:${change.state}`));

    await shell.open('board');
    shell.minimize();
    shell.close();
    stop();
    await shell.open('clocks');

    expect(seen).toContain('board:normal');
    expect(seen).toContain('board:min');
    expect(seen).toContain('null:normal');
    // Unsubscribed before the last open, so it must not appear.
    expect(seen).not.toContain('clocks:normal');
  });
});

describe('destroy', () => {
  it('takes every window away and stops listening', async () => {
    const shell = shellFor();
    await shell.open('board');
    await shell.open('clocks');
    shell.destroy();

    expect(boxes()).toHaveLength(0);
    expect(shell.current()).toBeNull();

    // A stray message after teardown must not throw from a detached handler.
    expect(() => window.dispatchEvent(new MessageEvent('message', { data: {} }))).not.toThrow();
  });
});
