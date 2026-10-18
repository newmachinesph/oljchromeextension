import { useEffect, useState } from 'react';
import { TextField, TextareaField, KeywordsField, FileButton } from './fields.jsx';
import { importFile, SUPPORTED_HINT } from './import-file.js';
import { isResumeUrl, base64ToBytes, resumeFilename, RESUME_URL_KEY } from '../core/resume.js';

/**
 * The editor for one profile.
 *
 * Label, headline, target roles, and the résumé body - typed, pasted, imported
 * from a PDF/DOCX/TXT here in the browser, or pulled from your OnlineJobs résumé
 * by its link (fetched at the extension's origin, converted here; nothing is
 * uploaded). Changes are handed up via onChange; the parent owns the store.
 */
export function ProfileEditor({ profile, onChange, onDone }) {
  const [note, setNote] = useState('');
  const [resumeUrl, setResumeUrl] = useState('');
  const set = (field) => (value) => onChange({ ...profile, [field]: value });

  // If the v2 helper spotted your résumé link while you were on the site, offer
  // it here so importing it is one click.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    chrome.storage.local.get(RESUME_URL_KEY).then((stored) => {
      const url = stored?.[RESUME_URL_KEY];
      if (isResumeUrl(url)) setResumeUrl(url);
    });
  }, []);

  /** Put converted text into the body, asking before replacing existing text. */
  function applyImport(markdown, source) {
    if (!markdown) {
      setNote('That file had no text to read (a scanned PDF has none). Paste or type instead.');
      return;
    }
    const merge =
      profile.body.trim().length > 0 &&
      !window.confirm('Replace the current body with the imported text? Cancel keeps both.');
    onChange({ ...profile, body: merge ? `${profile.body}\n\n${markdown}` : markdown, source });
    setNote(`Imported from your ${source === 'text' ? 'file' : source.toUpperCase()}.`);
  }

  async function onFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setNote('Reading…');
    try {
      const { markdown, source } = await importFile(file);
      applyImport(markdown, source);
    } catch (error) {
      setNote(error.message);
    }
  }

  async function onImportUrl() {
    if (!isResumeUrl(resumeUrl)) {
      setNote('Enter your OnlineJobs résumé link (from your account’s “View résumé”).');
      return;
    }
    setNote('Fetching your résumé…');
    try {
      const result = await chrome.runtime.sendMessage({ type: 'fetch-resume', url: resumeUrl });
      if (!result?.ok) {
        setNote(result?.error ?? 'Could not import that link.');
        return;
      }
      const file = new File([base64ToBytes(result.base64)], resumeFilename(resumeUrl, result.contentType), {
        type: result.contentType || 'application/pdf',
      });
      const { markdown, source } = await importFile(file);
      applyImport(markdown, source);
    } catch (error) {
      setNote(error.message ?? 'Could not import that link.');
    }
  }

  return (
    <div className="profile-editor">
      <TextField
        label="Label"
        value={profile.label}
        placeholder="e.g. Virtual Assistant"
        onChange={set('label')}
      />
      <TextField
        label="Headline"
        value={profile.headline}
        placeholder="One line an employer sees first"
        onChange={set('headline')}
      />
      <KeywordsField
        label="Target roles"
        hint="Comma-separated. The roles this profile is for."
        placeholder="virtual assistant, data entry"
        value={profile.targetRoles}
        onChange={set('targetRoles')}
      />
      <TextareaField
        label="Résumé / overview"
        rows={10}
        value={profile.body}
        placeholder="Your experience and skills for this specialization, in your own words."
        onChange={set('body')}
      />

      <div className="field">
        <span className="field-label">Import from a file</span>
        <FileButton accept=".pdf,.docx,.txt,.md" onFile={onFile} />
        <span className="field-hint">{SUPPORTED_HINT}. Converted here; the file is not uploaded.</span>
      </div>

      <div className="field">
        <span className="field-label">Import your OnlineJobs résumé</span>
        <div className="resume-url-row">
          <input
            type="text"
            className="text-input"
            placeholder="Paste your résumé link…"
            value={resumeUrl}
            spellCheck="false"
            onChange={(event) => setResumeUrl(event.target.value)}
          />
          <button type="button" className="reset file-button" onClick={onImportUrl}>
            Import résumé
          </button>
        </div>
        <span className="field-hint">
          On OnlineJobs, open your account and “View résumé”, then paste that link here. Fetched by
          the extension and converted on this page; if the link needs your login, download it and
          use “Import from a file” above.
        </span>
        {note && <span className="field-hint">{note}</span>}
      </div>

      <div className="rules-actions">
        <button type="button" className="reset" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
