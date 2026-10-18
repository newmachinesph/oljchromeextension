/**
 * Classic-script bootstrap for the v2 jobseeker pages.
 *
 * v2 is a React app on a different subdomain from the results pages, so the full
 * filter would have nothing to scan there. This loads only the board launcher -
 * a way into the tracker from wherever a jobseeker actually lives on the site.
 */

const SETTINGS_KEY = 'ojRateFilter';

// The master switch (settings.injectionEnabled); absent means on. Read from
// storage directly so this stays a tiny classic-script shim.
const injectionOn = (settings) => settings?.injectionEnabled !== false;

// Flipping the switch reloads the tab, so it applies both ways at once.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes[SETTINGS_KEY]) return;
  if (injectionOn(changes[SETTINGS_KEY].oldValue) !== injectionOn(changes[SETTINGS_KEY].newValue)) {
    window.location.reload();
  }
});

(async () => {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  if (!injectionOn(stored?.[SETTINGS_KEY])) return;

  try {
    await import(chrome.runtime.getURL('src/content/v2-main.js'));
  } catch (error) {
    console.error('[OljExtension] v2 launcher failed to load:', error);
  }
})();
