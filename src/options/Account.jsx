import { useEffect, useState } from 'react';
import {
  API_BASE,
  fetchAccount,
  loadAuth,
  requestVerify,
  deleteAccount,
} from '../core/account.js';
import {
  readOljEmail,
  hasOljPermission,
  requestOljPermission,
} from '../core/olj-account.js';

/**
 * The account tab: verification, referrals, and deleting the account.
 *
 * Everything else in the options page is local and needs no account; this one
 * tab is where the optional server side is managed. Signed out, it says so and
 * points at the popup, which is where signing in lives.
 */
export function Account() {
  const [state, setState] = useState({ status: 'loading' });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    const auth = await loadAuth();
    if (!auth) {
      setState({ status: 'signed-out' });
      return;
    }
    try {
      const account = await fetchAccount();
      if (!account) {
        setState({ status: 'signed-out' });
        return;
      }
      setState({ status: 'signed-in', account });
    } catch (error) {
      setState({ status: 'error', message: error.message });
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function verify() {
    setBusy(true);
    setNote('Checking…');
    try {
      if (!(await hasOljPermission())) {
        const granted = await requestOljPermission();
        if (!granted) {
          setNote('Permission to read your OnlineJobs.ph account was declined, so we cannot verify.');
          return;
        }
      }
      const read = await readOljEmail();
      if (!read.ok) {
        setNote(
          read.error === 'not-found' || read.error === 'permission'
            ? 'We could not read your OnlineJobs.ph email. Open onlinejobs.ph, make sure you are logged in, then try again.'
            : 'Could not reach onlinejobs.ph. Check you are logged in there and try again.',
        );
        return;
      }
      const result = await requestVerify(read.email);
      if (!result.verified) {
        setNote(
          'That OnlineJobs.ph email does not match the email you signed up with. Use the same email your OnlineJobs.ph account uses.',
        );
        return;
      }
      setNote(result.welcomeGranted ? 'Verified — 5 welcome credits added.' : 'Verified.');
      await refresh();
    } catch (error) {
      setNote(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setNote('');
    try {
      await deleteAccount();
      setConfirmingDelete(false);
      setState({ status: 'signed-out' });
      setNote('Your account was deleted and you have been signed out.');
    } catch (error) {
      setNote(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function openByokSettings() {
    const auth = await loadAuth();
    const next = '/dashboard#byok';
    const url = auth?.token
      ? new URL(`/api/auth/handoff?token=${encodeURIComponent(auth.token)}&next=${encodeURIComponent(next)}`, API_BASE)
      : new URL(next, API_BASE);
    chrome.tabs.create({ url: url.href });
  }

  if (state.status === 'loading') return <p className="loading">Loading…</p>;

  if (state.status === 'signed-out') {
    return (
      <p className="field-hint">
        {note || 'You are signed out. Open the extension popup to sign in or create an account — the AI features are the only ones that need one.'}
      </p>
    );
  }

  if (state.status === 'error') {
    return <p className="field-hint">Could not load your account: {state.message}</p>;
  }

  const { account } = state;
  const verified = account.user.emailVerified === true;
  const referral = account.referral ?? {};
  const inviteLink = referral.code ? `${API_BASE}/sign-up?ref=${encodeURIComponent(referral.code)}` : '';

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <div className="field">
        <span className="field-label">Signed in as</span>
        <p className="field-hint">{account.user.email}</p>
      </div>

      <div className="field">
        <span className="field-label">Verification</span>
        {verified ? (
          <p className="field-hint">
            Verified against your OnlineJobs.ph account. AI features are available.
          </p>
        ) : (
          <>
            <p className="field-hint">
              Not verified. AI features need us to confirm the email on your OnlineJobs.ph account
              matches this one; verifying also adds 5 free credits. Make sure you are logged in to
              onlinejobs.ph first.
            </p>
            <button type="button" onClick={verify} disabled={busy}>
              Verify my OnlineJobs.ph account
            </button>
          </>
        )}
      </div>

      <div className="field">
        <span className="field-label">AI billing</span>
        <p className="field-hint">
          {account.byok?.enabled
            ? `BYOK is active with ${account.byok.provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'} (${account.byok.model}). AI requests use ${account.byok.keyHint} and do not spend OljExtension credits.`
            : 'AI requests currently use OljExtension credits. You can add an OpenAI or OpenRouter key on the dashboard.'}
        </p>
        <button type="button" className="btn btn-secondary" onClick={openByokSettings}>
          Manage keys on the dashboard
        </button>
      </div>

      <div className="field">
        <span className="field-label">Invite friends</span>
        <p className="field-hint">
          Share your link. When a friend signs up and takes their first AI action, you both benefit
          — you earn credits, up to {referral.max ?? 5} friends.
        </p>
        {referral.code && (
          <>
            <div className="search-row">
              <input
                type="text"
                className="text-input"
                readOnly
                value={inviteLink}
                aria-label="Your invite link"
                onFocus={(event) => event.target.select()}
              />
              <button type="button" onClick={copyLink}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
            <p className="field-hint">
              Your code: <strong>{referral.code}</strong> ·{' '}
              {(referral.activated ?? 0)} / {referral.max ?? 5} activated · +
              {(referral.creditsEarned ?? 0)} credit{(referral.creditsEarned ?? 0) === 1 ? '' : 's'} earned
              {referral.atMax ? ' · cap reached' : ''}
            </p>
          </>
        )}
      </div>

      <div className="field">
        <span className="field-label">Delete account</span>
        <p className="field-hint">
          Removes your account from our server and signs you out here. Your local settings, profiles
          and everything else on this machine are untouched. This cannot be undone.
        </p>
        {confirmingDelete ? (
          <span className="footer-confirm" role="alertdialog" aria-label="Confirm delete">
            <span className="footer-confirm-q">Delete your account? This can’t be undone.</span>
            <button type="button" className="reset reset-danger" onClick={remove} disabled={busy}>
              Yes, delete it
            </button>
            <button type="button" className="reset" onClick={() => setConfirmingDelete(false)} disabled={busy}>
              Cancel
            </button>
          </span>
        ) : (
          <button type="button" className="reset reset-danger" onClick={() => setConfirmingDelete(true)}>
            Delete my account…
          </button>
        )}
      </div>

      {note && <p className="field-hint" aria-live="polite">{note}</p>}
    </>
  );
}
