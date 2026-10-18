import { useEffect, useState } from 'react';
import { PRESETS } from '../core/presets.js';
import {
  PRESET_LEVELS,
  MY_PRESETS_GROUP,
  presetGroups,
  duplicateOf,
  overrideOf,
  blankPreset,
  loadUserPresets,
  saveUserPreset,
  removeUserPreset,
  onUserPresetsChanged,
} from '../core/user-presets.js';
import { TextField, KeywordsField, NumberField, Button } from './fields.jsx';

/**
 * Managing presets: yours, and your edits to the shipped ones.
 *
 * The distinction the UI has to make legible is copy-versus-edit. Editing a
 * shipped preset keeps its name and slot and can always be reverted, because
 * the original is never written over - only shadowed. Copying gives you a
 * separate entry under "My presets" and leaves the original alone. The buttons
 * say which is which rather than making you infer it.
 */
export function Presets({ onApply }) {
  const [mine, setMine] = useState(null);
  const [level, setLevel] = useState('any');
  /** The preset being edited, as a draft - nothing is saved until you say so. */
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    loadUserPresets().then(setMine);
    return onUserPresetsChanged(setMine);
  }, []);

  if (mine === null) return <p className="loading">Loading...</p>;

  const groups = presetGroups(mine, PRESETS, level);

  const startEdit = (preset) => {
    // A shipped preset is edited through an override; one of yours directly.
    setDraft(preset.owned ? { ...preset } : overrideOf(preset));
  };

  const startCopy = (preset) => setDraft(duplicateOf(preset, mine));
  const startNew = () => setDraft(blankPreset(mine));

  const commit = async () => {
    setMine(await saveUserPreset(draft));
    setDraft(null);
  };

  const revert = async (preset) => {
    setMine(await removeUserPreset(preset.id));
    if (draft?.id === preset.id) setDraft(null);
  };

  const patch = (field) => (value) => setDraft({ ...draft, [field]: value });
  const patchFilter = (field) => (value) =>
    setDraft({ ...draft, filters: { ...draft.filters, [field]: value } });

  return (
    <>
      <p className="field-hint">
        Mostly these are vocabulary — the words employers here actually use, and a rate floor for
        that kind of work rather than for the site as a whole. Copy one to make it yours, or edit a
        shipped one in place; an edit can always be reverted, because the original is only shadowed
        and never overwritten.
      </p>

      <div className="field">
        <span className="field-label">Level</span>
        <span className="field-control field-chips">
          {PRESET_LEVELS.map((band) => (
            <button
              key={band.value}
              type="button"
              className={`tag-chip${level === band.value ? ' tag-chip-on' : ''}`}
              onClick={() => setLevel(band.value)}
            >
              {band.label}
            </button>
          ))}
        </span>
        <span className="field-hint">
          A preset with no band set stays visible under every level, so narrowing never hides one
          that never made a claim.
        </span>
      </div>

      <div className="preset-toolbar">
        <Button variant="primary" onClick={startNew}>
          New preset
        </Button>
      </div>

      {draft && (
        <div className="preset-editor">
          <h3 className="preset-editor-title">
            {draft.source === 'override' ? `Editing “${draft.name}”` : 'Your preset'}
          </h3>
          {draft.source === 'override' && (
            <p className="field-hint">
              This shadows the shipped preset of the same name. Revert to bring the original back.
            </p>
          )}

          <TextField
            label="Name"
            required
            value={draft.name}
            placeholder="What you would call this search"
            onChange={patch('name')}
          />
          <TextField
            label="One-line note"
            value={draft.hint}
            placeholder="Who it is for, or what to watch out for"
            onChange={patch('hint')}
          />

          <div className="field">
            <span className="field-label">Level</span>
            <span className="field-control field-radios">
              {PRESET_LEVELS.map((band) => (
                <label key={band.value} className="radio">
                  <input
                    type="radio"
                    name="draft-level"
                    checked={draft.level === band.value}
                    onChange={() => patch('level')(band.value)}
                  />
                  <span>{band.label}</span>
                </label>
              ))}
            </span>
          </div>

          <NumberField
            label="Rate floor"
            hint="USD per month. The point of a preset is a floor for this kind of work, not for the whole site."
            value={draft.filters.thresholdUsdPerMonth}
            min={0}
            step={50}
            suffix="/mo"
            onChange={patchFilter('thresholdUsdPerMonth')}
          />
          <KeywordsField
            label="Search terms"
            hint="Comma separated. This is the part that earns its keep — the words employers actually type."
            value={draft.filters.searchKeywords}
            placeholder="n8n, make.com, workflow automation"
            onChange={patchFilter('searchKeywords')}
          />
          <KeywordsField
            label="Exclude"
            hint="Listings mentioning these are hidden."
            value={draft.filters.excludeKeywords}
            placeholder="commission only, unpaid"
            onChange={patchFilter('excludeKeywords')}
          />

          <div className="preset-editor-actions">
            <Button variant="primary" onClick={commit} disabled={!draft.name.trim()}>
              Save preset
            </Button>
            <Button onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {groups.length === 0 && <p className="field-hint">No presets at this level.</p>}

      {groups.map(({ group, presets }) => (
        <div key={group} className="field">
          <span className="field-label">{group}</span>
          <ul className="search-list">
            {presets.map((preset) => (
              <li key={preset.id ?? preset.name} className="search-row">
                <span className="search-main">
                  <strong>{preset.name}</strong>
                  {preset.level && preset.level !== 'any' && (
                    <span className="preset-badge">{preset.level}</span>
                  )}
                  {preset.measured && <span className="preset-badge measured">measured</span>}
                  {preset.overridden && <span className="preset-badge">edited</span>}
                  {preset.hint && <em> — {preset.hint}</em>}
                </span>
                <span className="preset-row-actions">
                  <Button size="sm" variant="primary" onClick={() => onApply(preset)}>
                    Apply
                  </Button>
                  <Button size="sm" onClick={() => startEdit(preset)}>
                    Edit
                  </Button>
                  <Button size="sm" onClick={() => startCopy(preset)}>
                    Copy
                  </Button>
                  {preset.owned && (
                    <Button size="sm" variant="danger" onClick={() => revert(preset)}>
                      {preset.overridden ? 'Revert' : 'Delete'}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <p className="field-hint">
        Applying a preset overwrites the filters you are using now. Save yours as a search first if
        you want it back. Presets under “{MY_PRESETS_GROUP}” are kept on this machine only.
      </p>
    </>
  );
}
