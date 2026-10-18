/**
 * Presentational form pieces. They render what they are given and report edits
 * upward; only KeywordsField keeps local state, and only while being typed in.
 */

import { useState } from 'react';

/**
 * The one button.
 *
 * Every button in the settings goes through here so that height, padding,
 * radius and font come from the control tokens rather than from whichever rule
 * happened to be nearest. `variant` chooses colour, `size` chooses metrics, and
 * the two are orthogonal - a small danger button is `variant="danger"
 * size="sm"`, not a new class.
 *
 * `type` defaults to "button" on purpose: these live inside <label> and <form>
 * ancestors, and a stray submit is a page reload nobody asked for.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  const classes = ['btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}

/**
 * The one text input. Same argument as Button: metrics come from the tokens.
 *
 * `mono` is for anything you read character by character (regexes, urls);
 * `invalid` is the error skin. Everything else passes straight through, so a
 * caller can still set inputMode, spellCheck or a ref without a new prop here.
 */
export function Input({ mono = false, invalid = false, className = '', ...rest }) {
  const classes = ['text-input', mono && 'mono', invalid && 'invalid', className]
    .filter(Boolean)
    .join(' ');
  return <input type="text" className={classes} {...rest} />;
}

/**
 * A file picker dressed as the standard button.
 *
 * A native <input type="file"> cannot be styled, so it hides inside a label
 * that carries the button look; clicking the label opens the OS picker. The
 * change handler receives the raw event - callers already clear
 * `event.target.value` themselves so picking the same file twice still fires.
 */
export function FileButton({ label = 'Choose a file…', accept, onFile, className = '' }) {
  return (
    <label className={['file-btn', className].filter(Boolean).join(' ')}>
      {label}
      <input type="file" accept={accept} hidden onChange={onFile} />
    </label>
  );
}

/**
 * The asterisk on a required field's label.
 *
 * Advisory only. The settings autosave on every keystroke - there is no submit
 * step to gate - so this documents which fields a draft actually needs rather
 * than pretending to validate. Hidden from screen readers because the input
 * carries aria-required, which is the part assistive tech acts on.
 */
function RequiredMark({ required }) {
  if (!required) return null;
  return (
    <span className="field-req" aria-hidden="true" title="Required">
      *
    </span>
  );
}

/**
 * Top-level grouping for the settings.
 *
 * There are enough of them now that one long scroll is a poor way to find
 * anything, and the groups are genuinely separate concerns.
 */
export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className={tab.id === active ? 'tab tab-on' : 'tab'}
          aria-selected={tab.id === active}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function TextField({
  label,
  hint,
  value,
  placeholder,
  mono,
  invalid,
  required,
  onChange,
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        <RequiredMark required={required} />
      </span>
      <span className="field-control">
        <Input
          mono={mono}
          invalid={invalid}
          value={value}
          placeholder={placeholder}
          spellCheck="false"
          aria-required={required || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function TextareaField({
  label,
  hint,
  value,
  placeholder,
  rows = 6,
  required,
  onChange,
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        <RequiredMark required={required} />
      </span>
      <textarea
        className="text-input textarea"
        rows={rows}
        value={value}
        placeholder={placeholder}
        aria-required={required || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Section({ title, description, children }) {
  return (
    <section className="section">
      <h2>{title}</h2>
      {description && <p className="section-desc">{description}</p>}
      <div className="section-body">{children}</div>
    </section>
  );
}

export function NumberField({ label, hint, value, min, max, step = 1, suffix, onChange }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-control">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
        />
        {suffix && <span className="field-suffix">{suffix}</span>}
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function ToggleField({ label, hint, checked, onChange }) {
  return (
    <label className="field field-toggle">
      <span className="field-control">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="field-label">{label}</span>
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Multi-select bound to an array of values. */
export function CheckboxGroupField({ label, hint, value, options, onChange }) {
  const toggle = (option, checked) => {
    const next = checked ? [...value, option] : value.filter((entry) => entry !== option);
    onChange([...new Set(next)]);
  };

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <span className="field-control field-radios">
        {options.map((option) => (
          <label key={option.value} className="radio">
            <input
              type="checkbox"
              checked={value.includes(option.value)}
              onChange={(event) => toggle(option.value, event.target.checked)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

/**
 * A comma-separated list edited as text but stored as an array.
 *
 * The text stays local while being typed, so a trailing comma does not vanish
 * mid-keystroke; it is committed on blur and on Enter.
 */
export function KeywordsField({ label, hint, placeholder, value, onChange }) {
  const [draft, setDraft] = useState(null);
  const text = draft ?? value.join(', ');

  const commit = () => {
    onChange(text.split(',').map((entry) => entry.trim()));
    setDraft(null);
  };

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-control">
        <input
          type="text"
          className="preview-input"
          value={text}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
          }}
        />
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function RadioField({ label, hint, name, value, options, onChange }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <span className="field-control field-radios">
        {options.map((option) => (
          <label key={option.value} className="radio">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}
