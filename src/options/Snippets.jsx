import { useEffect, useState } from 'react';
import {
  loadSnippets,
  saveSnippet,
  removeSnippet,
  onSnippetsChanged,
  MAX_BODY,
} from '../core/snippets.js';

/**
 * Your own reusable text - intros, stock answers, subject lines - written once
 * and copied when applying. Not AI: just your words, saved locally.
 */
export function Snippets() {
  const [snippets, setSnippets] = useState(null);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');

  useEffect(() => {
    loadSnippets().then(setSnippets);
    const off = onSnippetsChanged(setSnippets);
    return off;
  }, []);

  if (snippets === null) return <p className="loading">Loading…</p>;

  const add = () => {
    if (!newTitle.trim() && !newBody.trim()) return;
    saveSnippet({ title: newTitle, body: newBody });
    setNewTitle('');
    setNewBody('');
  };

  return (
    <div className="snippets">
      <div className="snippet-new">
        <input
          className="text-input"
          placeholder="Snippet title (e.g. Intro, Internet speed answer)"
          value={newTitle}
          maxLength={80}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <textarea
          className="text-input"
          rows={3}
          placeholder="The text you want to reuse…"
          value={newBody}
          maxLength={MAX_BODY}
          onChange={(e) => setNewBody(e.target.value)}
        />
        <button type="button" className="tracker-add" onClick={add} disabled={!newTitle.trim() && !newBody.trim()}>
          Add snippet
        </button>
      </div>

      {snippets.length === 0 ? (
        <p className="field-hint">No snippets yet. Add one above, then copy it when you apply.</p>
      ) : (
        <ul className="snippet-list">
          {snippets.map((snippet) => (
            <SnippetRow key={snippet.id} snippet={snippet} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SnippetRow({ snippet }) {
  const [title, setTitle] = useState(snippet.title);
  const [body, setBody] = useState(snippet.body);
  const [copied, setCopied] = useState(false);

  // Reflect an external change (another tab) that isn't the field being edited.
  useEffect(() => setTitle(snippet.title), [snippet.title]);
  useEffect(() => setBody(snippet.body), [snippet.body]);

  const commit = () => {
    if (title !== snippet.title || body !== snippet.body) {
      saveSnippet({ id: snippet.id, title, body });
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard blocked; leave the state alone rather than lying about it.
    }
  };

  return (
    <li className="snippet">
      <div className="snippet-head">
        <input
          className="text-input snippet-title"
          value={title}
          maxLength={80}
          aria-label="Snippet title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
        />
        <button type="button" className="reset snippet-copy" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <button type="button" className="rule-remove" aria-label={`Delete snippet ${snippet.title}`} onClick={() => removeSnippet(snippet.id)}>
          Delete
        </button>
      </div>
      <textarea
        className="text-input snippet-body"
        rows={3}
        value={body}
        maxLength={MAX_BODY}
        aria-label="Snippet text"
        onChange={(e) => setBody(e.target.value)}
        onBlur={commit}
      />
    </li>
  );
}
