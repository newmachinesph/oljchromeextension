import { useEffect, useState } from 'react';
import {
  loadProfiles,
  createProfile,
  saveProfile,
  removeProfile,
  setDefaultProfile,
  onProfilesChanged,
} from '../core/profiles.js';
import { ProfileEditor } from './ProfileEditor.jsx';

/**
 * The list of profiles, and the editor for one.
 *
 * A profile is a specialization you apply under. One is the default, used when
 * a draft does not say otherwise. The list owns the store; the editor edits a
 * copy and saves through here.
 */
export function Profiles() {
  const [profiles, setProfiles] = useState(null);
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    loadProfiles().then(setProfiles);
    return onProfilesChanged(setProfiles);
  }, []);

  if (profiles === null) return <p className="loading">Loading...</p>;

  const onNew = async () => {
    const list = await createProfile({ label: 'New profile' });
    setProfiles(list);
    // Open the one that was just added (the last with the highest updatedAt).
    const added = list[list.length - 1];
    setEditingId(added?.id ?? null);
  };

  const onChange = (profile) => {
    setProfiles((current) => current.map((p) => (p.id === profile.id ? profile : p)));
    saveProfile(profile);
  };

  const editing = profiles.find((p) => p.id === editingId) ?? null;

  if (editing) {
    return (
      <ProfileEditor profile={editing} onChange={onChange} onDone={() => setEditingId(null)} />
    );
  }

  return (
    <>
      {profiles.length === 0 ? (
        <p className="field-hint">No profiles yet. Add one to draft applications from it.</p>
      ) : (
        <ul className="profile-list">
          {profiles.map((profile) => (
            <li key={profile.id} className="profile-card">
              <div className="profile-head">
                <span className="profile-name">{profile.label || '(untitled)'}</span>
                {profile.isDefault && <span className="profile-badge">default</span>}
              </div>
              {profile.headline && <p className="profile-headline">{profile.headline}</p>}
              {profile.targetRoles.length > 0 && (
                <p className="profile-roles">{profile.targetRoles.join(', ')}</p>
              )}
              {profile.body && <p className="profile-preview">{profile.body.slice(0, 140)}…</p>}
              <div className="profile-actions">
                <button type="button" className="reset" onClick={() => setEditingId(profile.id)}>
                  Edit
                </button>
                {!profile.isDefault && (
                  <button
                    type="button"
                    className="reset"
                    onClick={() => setDefaultProfile(profile.id).then(setProfiles)}
                  >
                    Set default
                  </button>
                )}
                <button
                  type="button"
                  className="reset"
                  onClick={() => removeProfile(profile.id).then(setProfiles)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="reset" onClick={onNew}>
        New profile
      </button>
    </>
  );
}
