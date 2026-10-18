/**
 * The dock on the v2 jobseeker pages.
 *
 * v2 is a single-page React app, which re-renders its tree as you move around -
 * but a node appended to <body>, outside React's root, is not part of that tree
 * and survives. A MutationObserver puts the dock back on the rare chance
 * something removes it, so the mini apps are always one click away.
 *
 * The widgets themselves are the same ones the results pages open: iframes onto
 * the extension's own views, reused untouched.
 */

import { createWidgetShell } from './widget-shell.js';
import { mountDock } from './dock.js';
import { isResumeUrl, RESUME_URL_KEY } from '../core/resume.js';

let lastResumeUrl = '';

/**
 * Best-effort: note your résumé link if it appears on the page (the "View
 * résumé" link, or a link straight to a résumé file), so the profile editor can
 * offer to import it. Purely a convenience - it only ever remembers a link, and
 * only from OnlineJobs.
 */
function captureResume() {
  for (const anchor of document.querySelectorAll('a[href]')) {
    const raw = anchor.getAttribute('href') || '';
    let abs;
    try {
      abs = new URL(raw, location.origin).href;
    } catch {
      continue;
    }
    const text = (anchor.textContent || '').toLowerCase();
    const looksLikeResume = /resume|\.pdf(\?|$)|\.docx(\?|$)/i.test(abs) || text.includes('view resume');
    if (isResumeUrl(abs) && looksLikeResume) {
      if (abs !== lastResumeUrl && chrome.storage?.local) {
        lastResumeUrl = abs;
        chrome.storage.local.set({ [RESUME_URL_KEY]: abs });
      }
      return;
    }
  }
}

const widgets = createWidgetShell();
mountDock(widgets);
captureResume();

// Body-appended nodes usually survive a React re-render; this is the belt to
// that braces, re-adding the dock if anything ever clears it. The résumé link
// often appears only after a click into "update résumé", so re-check then.
const observer = new MutationObserver(() => {
  mountDock(widgets);
  captureResume();
});
observer.observe(document.body, { childList: true, subtree: true });
