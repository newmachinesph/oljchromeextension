import { useEffect, useMemo, useState } from 'react';
import { loadSaved, removeSaved, onSavedChanged } from '../core/saved.js';
import { setApplication, loadApplications, onApplicationsChanged } from '../core/applications.js';
import { loadJobNotes, setJobNote, onJobNotesChanged } from '../core/job-notes.js';
import {
  loadJobTags,
  addJobTag,
  removeJobTag,
  onJobTagsChanged,
  allTags,
  MAX_TAGS_PER_JOB,
} from '../core/job-tags.js';
import { loadTagColors, onTagColorsChanged } from '../core/tag-colors.js';
import { DEFAULT_TAGS, tagColor, tagChipStyle } from '../core/tags-catalog.js';
import { formatUsdPerMonth } from '../core/normalize.js';

/** Only ever hand an http(s) link to an anchor - never a javascript: url. */
function safeHref(url) {
  if (!url) return '#';
  try {
    const resolved = new URL(url, 'https://www.onlinejobs.ph');
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.href : '#';
  } catch {
    return '#';
  }
}

/**
 * The jobs you set aside, with the note and tags you put on each.
 *
 * Four stores meet here, all keyed by the same job id: the save, its note, its
 * tags, and whether it is already tracked as an application. The list owns none
 * of them - it reads them and writes back through each store's own setter, so a
 * change shows up on the job page too.
 */
export function SavedJobs() {
  const [saved, setSaved] = useState(null);
  const [notes, setNotes] = useState(new Map());
  const [tags, setTags] = useState(new Map());
  const [tagColors, setTagColors] = useState(new Map());
  const [apps, setApps] = useState(null);
  const [filter, setFilter] = useState('');
  const [drafts, setDrafts] = useState(new Map());
  const [selected, setSelected] = useState(new Set());

  useEffect(() => {
    loadSaved().then(setSaved);
    loadJobNotes().then(setNotes);
    loadJobTags().then(setTags);
    loadTagColors().then(setTagColors);
    loadApplications().then(setApps);
    const offs = [
      onSavedChanged(setSaved),
      onJobNotesChanged(setNotes),
      onJobTagsChanged(setTags),
      onTagColorsChanged(setTagColors),
      onApplicationsChanged(setApps),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const tagChoices = useMemo(() => allTags(tags), [tags]);

  // A compared job that was since removed must drop out of the selection, or it
  // silently holds a slot and disables the other checkboxes for no visible reason.
  const active = useMemo(
    () => (saved ? new Set([...selected].filter((key) => saved.has(key))) : new Set()),
    [selected, saved],
  );

  // Wait for applications too, so the Track guard never renders enabled against
  // a job that is in fact already on the board.
  if (saved === null || apps === null) return <p className="loading">Loading...</p>;

  const rows = [...saved.entries()]
    .sort((a, b) => b[1].savedAt - a[1].savedAt)
    .filter(
      ([key]) =>
        !filter || (tags.get(key) ?? []).some((t) => t.toLowerCase() === filter.toLowerCase()),
    );

  const noteFor = (key) => (drafts.has(key) ? drafts.get(key) : (notes.get(key)?.text ?? ''));
  const editNote = (key, text) => setDrafts((d) => new Map(d).set(key, text));
  const commitNote = async (key) => {
    if (!drafts.has(key)) return;
    await setJobNote(key, drafts.get(key));
    // Drop the draft so the live note (which the store may have truncated) shows.
    setDrafts((d) => {
      const next = new Map(d);
      next.delete(key);
      return next;
    });
  };

  // Go through the store's queue-safe primitives rather than rebuilding the
  // whole list from React state, which a concurrent edit could have made stale.
  const addTag = (key, raw) => addJobTag(key, raw);
  const removeTag = (key, tag) => removeJobTag(key, tag);

  const track = (key, job) => {
    if (apps.has(key)) return; // never regress a job already on the board
    setApplication(key, {
      status: 'preparing',
      title: job.title,
      url: job.url,
      employer: job.employer,
      usdPerMonth: job.usdPerMonth ?? undefined,
    });
  };

  const MAX_COMPARE = 3;
  const toggleCompare = (key) =>
    setSelected((current) => {
      const next = new Set([...current].filter((k) => saved.has(k)));
      if (next.has(key)) next.delete(key);
      else if (next.size < MAX_COMPARE) next.add(key);
      return next;
    });
  const canCompare = (key) => active.has(key) || active.size < MAX_COMPARE;
  const comparing = [...saved.entries()].filter(([key]) => active.has(key));

  if (saved.size === 0) {
    return (
      <p className="field-hint">
        No saved jobs yet. On a job, use <strong>Save</strong> to keep it here for later.
      </p>
    );
  }

  return (
    <div className="saved-jobs">
      {tagChoices.length > 0 && (
        <div className="saved-filter">
          <button
            type="button"
            className={`tag-chip${filter === '' ? ' tag-chip-on' : ''}`}
            onClick={() => setFilter('')}
          >
            All
          </button>
          {tagChoices.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`tag-chip${filter === tag ? ' tag-chip-on' : ''}`}
              style={tagChipStyle(tagColor(tag, tagColors))}
              onClick={() => setFilter(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {active.size === 1 && (
        <p className="field-hint">Select one more job to compare them side by side.</p>
      )}
      {comparing.length >= 2 && (
        <Comparison jobs={comparing} tags={tags} onClear={() => setSelected(new Set())} />
      )}

      {rows.length === 0 ? (
        <p className="field-hint">No saved jobs tagged “{filter}”.</p>
      ) : (
        <ul className="saved-list">
          {rows.map(([key, job]) => {
            const jobTags = tags.get(key) ?? [];
            const tracked = apps.has(key);
            return (
              <li key={key} className="saved-card">
                <div className="saved-head">
                  <a className="saved-title" href={safeHref(job.url)} target="_blank" rel="noreferrer">
                    {job.title || '(untitled job)'}
                  </a>
                  <span className="saved-head-actions">
                    <label
                      className="saved-compare"
                      title={
                        canCompare(key)
                          ? 'Add to comparison (up to 3)'
                          : 'Comparison full — remove one to add this job'
                      }
                    >
                      <input
                        type="checkbox"
                        checked={active.has(key)}
                        disabled={!canCompare(key)}
                        onChange={() => toggleCompare(key)}
                      />
                      Compare
                    </label>
                    <button
                      type="button"
                      className="reset saved-track"
                      disabled={tracked}
                      title={
                        tracked
                          ? 'Already on the board'
                          : 'Start tracking this on the board, in Preparing'
                      }
                      onClick={() => track(key, job)}
                    >
                      {tracked ? 'On board' : 'Track'}
                    </button>
                    <button type="button" className="reset saved-remove" onClick={() => removeSaved(key)}>
                      Remove
                    </button>
                  </span>
                </div>
                <p className="saved-meta">
                  {job.employer && <span>{job.employer}</span>}
                  {Number.isFinite(job.usdPerMonth) && <span>{formatUsdPerMonth(job.usdPerMonth)}</span>}
                </p>

                <div className="saved-tags">
                  {jobTags.map((tag) => (
                    <span key={tag} className="tag-chip" style={tagChipStyle(tagColor(tag, tagColors))}>
                      {tag}
                      <button
                        type="button"
                        className="tag-remove"
                        aria-label={`Remove tag ${tag}`}
                        onClick={() => removeTag(key, tag)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {jobTags.length >= MAX_TAGS_PER_JOB ? (
                    <span className="field-hint">Up to {MAX_TAGS_PER_JOB} tags.</span>
                  ) : (
                    <input
                      type="text"
                      className="tag-add"
                      placeholder="+ tag"
                      aria-label="Add a tag"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          addTag(key, event.target.value);
                          event.target.value = '';
                        }
                      }}
                      onBlur={(event) => {
                        // Commit a typed-but-not-entered tag rather than losing it.
                        if (event.target.value.trim()) {
                          addTag(key, event.target.value);
                          event.target.value = '';
                        }
                      }}
                    />
                  )}
                </div>
                {jobTags.length < MAX_TAGS_PER_JOB && (() => {
                  const onJob = new Set(jobTags.map((t) => t.toLowerCase()));
                  const seen = new Set(tagChoices.map((t) => t.toLowerCase()));
                  const suggestions = [
                    ...tagChoices,
                    ...DEFAULT_TAGS.map((d) => d.label).filter((d) => !seen.has(d.toLowerCase())),
                  ].filter((t) => !onJob.has(t.toLowerCase())).slice(0, 8);
                  return suggestions.length ? (
                    <div className="saved-tag-suggest">
                      {suggestions.map((tag) => (
                        <button key={tag} type="button" className="tag-chip saved-tag-pick" style={tagChipStyle(tagColor(tag, tagColors))} onClick={() => addTag(key, tag)}>
                          + {tag}
                        </button>
                      ))}
                    </div>
                  ) : null;
                })()}

                <textarea
                  className="text-input saved-note"
                  rows={2}
                  placeholder="A note for this job…"
                  value={noteFor(key)}
                  onChange={(event) => editNote(key, event.target.value)}
                  onBlur={() => commitNote(key)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Two or three saved jobs, side by side.
 *
 * A manual, local comparison over what the save already knows - the rate, the
 * employer, your tags, when you saved it. The best pay in the row is marked, so
 * the one number most likely to decide it does not have to be eyeballed.
 */
function Comparison({ jobs, tags, onClear }) {
  const rates = jobs.map(([, job]) => (Number.isFinite(job.usdPerMonth) ? job.usdPerMonth : null));
  const bestRate = rates.reduce((best, rate) => (rate !== null && rate > (best ?? -Infinity) ? rate : best), null);
  const savedDate = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : '—');

  return (
    <div className="saved-compare-panel">
      <div className="saved-compare-head">
        <h3>Comparing {jobs.length} jobs</h3>
        <button type="button" className="reset" onClick={onClear}>
          Clear
        </button>
      </div>
      <div className="saved-compare-scroll">
        <table className="data-table saved-compare-table">
          <thead>
            <tr>
              <th></th>
              {jobs.map(([key, job]) => (
                <th key={key}>
                  <a href={safeHref(job.url)} target="_blank" rel="noreferrer">
                    {job.title || '(untitled job)'}
                  </a>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Pay (USD/mo)</th>
              {jobs.map(([key, job]) => (
                <td
                  key={key}
                  className={
                    Number.isFinite(job.usdPerMonth) && job.usdPerMonth === bestRate ? 'compare-best' : ''
                  }
                >
                  {Number.isFinite(job.usdPerMonth) ? formatUsdPerMonth(job.usdPerMonth) : '—'}
                </td>
              ))}
            </tr>
            <tr>
              <th>Employer</th>
              {jobs.map(([key, job]) => (
                <td key={key}>{job.employer || '—'}</td>
              ))}
            </tr>
            <tr>
              <th>Tags</th>
              {jobs.map(([key]) => (
                <td key={key}>{(tags.get(key) ?? []).join(', ') || '—'}</td>
              ))}
            </tr>
            <tr>
              <th>Saved</th>
              {jobs.map(([key, job]) => (
                <td key={key}>{savedDate(job.savedAt)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
