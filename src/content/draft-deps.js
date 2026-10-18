/**
 * The wiring a draft panel needs, in one place.
 *
 * The panel itself has no opinion about storage or the network; this hands it
 * the real ones. Built once and shared by the modal (search page) and the job
 * page, so a draft made in one is the same draft the other shows.
 */

import { loadAuth, requestDraft } from '../core/account.js';
import { loadAbout } from '../core/about.js';
import { loadProfiles } from '../core/profiles.js';
import { loadDrafts, saveDraft } from '../core/drafts.js';
import { writeToClipboard } from './job-modal.js';

/**
 * @param {object} hooks
 * @param {() => object} hooks.getSettings   current settings snapshot
 * @param {(patch: object) => Promise<any>} hooks.saveSettings
 * @param {(credits: number) => void} hooks.onCredits   balance after a charge
 * @param {() => void} hooks.openOptions
 */
export function draftDeps({ getSettings, saveSettings, onCredits, openOptions }) {
  return {
    getAuth: loadAuth,
    getProfiles: loadProfiles,
    getAbout: loadAbout,
    getSettings,
    saveSettings,
    request: requestDraft,
    loadDrafts,
    saveDraft,
    onCredits,
    openOptions,
    copy: writeToClipboard,
  };
}
