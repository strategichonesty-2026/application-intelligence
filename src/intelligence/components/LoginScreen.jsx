import { useEffect, useState } from 'react';
import Icon from '../ui/Icon';
import { Button, Field } from '../ui/primitives';
import { Banner } from '../ui/StateMessage';
import { signIn, fetchSignInHelp } from '../data/api';

/** Owner sign-in. The password is checked on the server; nothing secret exists in this front-end. */
export default function LoginScreen({ notice }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [help, setHelp] = useState({ minLength: 16, hint: null, viewerHint: null });
  useEffect(() => { let alive = true; fetchSignInHelp().then((h) => { if (alive) setHelp(h); }); return () => { alive = false; }; }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!password) { setError({ kind: 'badcredentials', message: 'Enter your passphrase.' }); return; }
    setBusy(true); setError(null);
    try { await signIn(password); setPassword(''); }
    catch (err) { setError({ kind: err.kind, message: err.message }); }
    finally { setBusy(false); }
  };

  return (
    <div className="ai-login">
      <form className="ai-card ai-login__card" onSubmit={submit} noValidate aria-labelledby="ai-login-title">
        <div className="ai-brand" style={{ padding: 0, marginBottom: 12 }}><span className="ai-brand__mark"><Icon name="activity" size={16} /></span>Application Intelligence</div>
        <h1 id="ai-login-title" className="ai-card__title" style={{ fontSize: 18 }}>Sign in</h1>
        <p className="ai-card__sub" style={{ marginBottom: 16 }}>Monitoring data and controls are available to the application owner only.</p>
        {notice && <div style={{ marginBottom: 12 }}><Banner tone="info">{notice}</Banner></div>}
        {error && (
          <div style={{ marginBottom: 12 }}>
            <Banner tone={error.kind === 'unconfigured' || error.kind === 'ratelimited' ? 'warn' : 'bad'} icon={error.kind === 'unconfigured' ? 'lock' : undefined}>
              {error.message}
              {error.kind === 'unconfigured' && ' The server owner needs to set the sign-in variables described in the deployment guide.'}
            </Banner>
          </div>
        )}
        <Field label={`Owner passphrase (${help.minLength} or more characters)`} error={error && error.kind === 'badcredentials' ? error.message : undefined}
          hint={`Use your passphrase: ${help.minLength} or more characters. Letters, spaces and numbers are all fine; it is not digits only.`}>
          {(p) => <input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />}
        </Field>
        <div style={{ marginTop: 16 }}><Button variant="primary" type="submit" loading={busy}>Sign in</Button></div>
        {(help.hint || help.viewerHint) && (
          <div className="ai-field__hint" style={{ marginTop: 10 }}>
            <strong>Forgot it? Reminders:</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {help.hint && <li>Owner: {help.hint}</li>}
              {help.viewerHint && <li>View-only: {help.viewerHint}</li>}
            </ul>
          </div>
        )}
        {(help.hint || help.viewerHint) && <p className="ai-field__hint" style={{ marginTop: 8 }}>The reminders above is visible to anyone who opens this page, so it should jog your memory without giving the passphrase away. After 5 wrong tries from one place, sign-in pauses for 15 minutes.</p>}
        <p className="ai-field__hint" style={{ marginTop: 14 }}>The password is verified by the server and is never stored in your browser. Your session ends when you close the tab or after 8 hours.</p>
      </form>
    </div>
  );
}
