/**
 * Classic-script bootstrap.
 *
 * MV3 content scripts are not modules, so this is the smallest possible shim:
 * dynamic-import the real entry point, which unlocks ordinary ES module imports
 * for everything else (and lets Node import the same files in tests).
 */

const SETTINGS_KEY = 'ojRateFilter';

// The master switch (settings.injectionEnabled), read straight from storage to
// keep this a tiny classic-script shim. Absent means on - the default.
const injectionOn = (settings) => settings?.injectionEnabled !== false;

// Flip the switch from the popup and the open OnlineJobs.ph tabs reload, so
// turning our UI on or off takes effect immediately in both directions rather
// than only on the next navigation. Registered even when we are about to bail,
// so a disabled tab can bring itself back when re-enabled.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes[SETTINGS_KEY]) return;
  if (injectionOn(changes[SETTINGS_KEY].oldValue) !== injectionOn(changes[SETTINGS_KEY].newValue)) {
    window.location.reload();
  }
});

(async () => {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  if (!injectionOn(stored?.[SETTINGS_KEY])) return;

  // Two pages, two entry points: the search results need the whole filter, an
  // individual job needs only its rate restated and a dismiss button.
  const entry = /\/jobseekers\/job\//.test(window.location.pathname)
    ? 'src/content/job-main.js'
    : 'src/content/main.js';

  try {
    await import(chrome.runtime.getURL(entry));
  } catch (error) {
    console.error('[OljExtension] could not load:', error);
  }
})();
