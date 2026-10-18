import { useEffect, useState } from 'react';
import { loadAbout, saveAbout, onAboutChanged, newId, CONTACT_KINDS } from '../core/about.js';
import { TextField, TextareaField } from './fields.jsx';

/**
 * About you: the shared block every profile draws on.
 *
 * Edited in local state and saved on change. Contact details (email, phone)
 * live here but are never sent to the model; the rest - location, availability,
 * equipment, languages, links - is what a draft may use.
 */
export function About() {
  const [about, setAbout] = useState(null);

  useEffect(() => {
    loadAbout().then(setAbout);
    return onAboutChanged(setAbout);
  }, []);

  if (about === null) return <p className="loading">Loading...</p>;

  const set = (field) => (value) => {
    setAbout({ ...about, [field]: value });
    saveAbout({ [field]: value });
  };

  const setLinks = (links) => {
    setAbout({ ...about, links });
    saveAbout({ links });
  };

  const addLink = () => setLinks([...about.links, { id: newId(), label: '', url: '' }]);

  const setContacts = (contacts) => {
    setAbout({ ...about, contacts });
    saveAbout({ contacts });
  };

  const addContact = () =>
    setContacts([...(about.contacts ?? []), { id: newId(), kind: 'email', value: '' }]);
  const changeContact = (id, patch) =>
    setContacts((about.contacts ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const removeContact = (id) => setContacts((about.contacts ?? []).filter((c) => c.id !== id));
  const changeLink = (id, patch) =>
    setLinks(about.links.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLink = (id) => setLinks(about.links.filter((l) => l.id !== id));

  return (
    <>
      <p className="field-hint">
        Filled once and shared by every profile. Email and phone are kept for your reference and
        are never sent to the model; everything else here may appear in a draft.
      </p>

      <TextField
        label="Name"
        required
        value={about.name}
        placeholder="Your name"
        onChange={set('name')}
      />
      <TextField label="Email" value={about.email} placeholder="you@example.com" onChange={set('email')} />
      <TextField label="Phone" value={about.phone} placeholder="Optional" onChange={set('phone')} />
      <TextField
        label="Location"
        required
        value={about.location}
        placeholder="City, country"
        onChange={set('location')}
      />
      <TextField label="Timezone" value={about.timezone} placeholder="e.g. GMT+8" onChange={set('timezone')} />
      <TextField
        label="Availability"
        required
        value={about.availability}
        placeholder="e.g. 40 hrs/week, overlaps US mornings"
        onChange={set('availability')}
      />
      <TextField
        label="Tools & equipment"
        value={about.equipment}
        placeholder="e.g. i5 laptop, 100 Mbps fibre + backup LTE, headset"
        onChange={set('equipment')}
      />
      <TextField
        label="Languages"
        value={about.languages}
        placeholder="e.g. English (fluent), Filipino (native)"
        onChange={set('languages')}
      />
      <TextField
        label="Scheduling link"
        value={about.schedulingUrl}
        placeholder="https://calendly.com/your-name"
        hint="Calendly, Cal.com, or whatever you book interviews with. Unlike your email and phone, this one may appear in a draft — it is there to be handed to an employer."
        onChange={set('schedulingUrl')}
      />
      <TextareaField
        label="Anything else"
        rows={3}
        value={about.other}
        placeholder="Anything worth saying in every application that does not fit above"
        onChange={set('other')}
      />

      <div className="field">
        <span className="field-label">Contacts</span>
        <span className="field-hint">
          The ways an employer can reach you. Kept on this machine and never sent to the model —
          they are here so you can copy one into an application yourself.
        </span>
        <ul className="link-list">
          {(about.contacts ?? []).map((contact) => (
            <li key={contact.id} className="link-row">
              <select
                className="text-input link-label"
                value={contact.kind}
                aria-label="Contact type"
                onChange={(event) => changeContact(contact.id, { kind: event.target.value })}
              >
                {CONTACT_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                className="text-input link-url"
                placeholder="you@example.com, @handle, +63…"
                value={contact.value}
                spellCheck="false"
                onChange={(event) => changeContact(contact.id, { value: event.target.value })}
              />
              <button type="button" className="rule-remove" onClick={() => removeContact(contact.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="reset" onClick={addContact}>
          Add a contact
        </button>
      </div>

      <div className="field">
        <span className="field-label">Links</span>
        <ul className="link-list">
          {about.links.map((link) => (
            <li key={link.id} className="link-row">
              <input
                type="text"
                className="text-input link-label"
                placeholder="Label (Portfolio)"
                value={link.label}
                onChange={(event) => changeLink(link.id, { label: event.target.value })}
              />
              <input
                type="text"
                className="text-input link-url"
                placeholder="https://…"
                value={link.url}
                spellCheck="false"
                onChange={(event) => changeLink(link.id, { url: event.target.value })}
              />
              <button type="button" className="rule-remove" onClick={() => removeLink(link.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="reset" onClick={addLink}>
          Add a link
        </button>
      </div>
    </>
  );
}
