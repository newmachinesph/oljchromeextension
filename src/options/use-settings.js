import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULTS,
  loadSettings,
  saveSettings,
  resetSettings,
  onSettingsChanged,
} from '../core/settings.js';
import { saveDock, DEFAULT_DOCK } from '../core/dock.js';

/**
 * Single source of settings state for the options UI.
 *
 * Also subscribes to storage changes, so edits made from the injected control
 * bar show up here live instead of going stale behind an open options tab.
 */
export function useSettings() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    let active = true;

    loadSettings().then((loaded) => {
      if (!active) return;
      setSettings(loaded);
      setLoading(false);
    });

    const unsubscribe = onSettingsChanged((next) => {
      if (active) setSettings(next);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const update = useCallback(async (partial) => {
    // Optimistic: the field should not lag behind the keystroke.
    setSettings((current) => ({ ...current, ...partial }));
    const next = await saveSettings(partial);
    setSettings(next);
    setSavedAt(Date.now());
  }, []);

  const reset = useCallback(async () => {
    /*
     * The dock goes back too.
     *
     * It lives in its own store rather than in settings, so "reset every
     * setting to its default" quietly left it wherever you had dragged it -
     * which is not what that sentence promises. It is a preference, so it
     * resets. Your clocks, snippets and logged hours are data, not settings,
     * and are deliberately left alone: this button is not a delete button.
     */
    const [next] = await Promise.all([resetSettings(), saveDock({ ...DEFAULT_DOCK })]);
    setSettings(next);
    setSavedAt(Date.now());
  }, []);

  return { settings, update, reset, loading, savedAt };
}
