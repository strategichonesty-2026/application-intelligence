import { useEffect, useState } from 'react';
import { Button, Card, Field } from '../ui/primitives';
import { Banner } from '../ui/StateMessage';
import { useToast } from '../ui/Toast';
import { monitoringApi } from '../data/api';

/** Owner-only: edit the reminders shown on the sign-in page. They are public, so they must not reveal a passphrase. */
export default function SignInReminders() {
  const toast = useToast();
  const [loaded, setLoaded] = useState(null);
  const [owner, setOwner] = useState('');
  const [viewer, setViewer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    monitoringApi.hints().then((h) => { if (alive) { setLoaded(h); setOwner(h.owner || ''); setViewer(h.viewer || ''); } })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await monitoringApi.saveHints(loaded.viewerEnabled ? { owner, viewer } : { owner });
      toast.success('Reminders saved. They now show on the sign-in page.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Card title="Sign-in reminders" subtitle="A short note on the sign-in page to jog your memory. Anyone who opens the page can read it, so never write the passphrase itself.">
      {error && <div style={{ marginBottom: 12 }}><Banner tone="bad">{error}</Banner></div>}
      {loaded && (
        <form onSubmit={save} noValidate>
          <Field label="Owner reminder" hint="Example: the name of my first school plus my lucky number.">
            {(p) => <input {...p} type="text" maxLength={loaded.max} value={owner} onChange={(ev) => setOwner(ev.target.value)} />}
          </Field>
          {loaded.viewerEnabled && (
            <div style={{ marginTop: 12 }}>
              <Field label="View-only reminder (for friends)" hint="Shown to everyone who opens the sign-in page.">
                {(p) => <input {...p} type="text" maxLength={loaded.max} value={viewer} onChange={(ev) => setViewer(ev.target.value)} />}
              </Field>
            </div>
          )}
          {!loaded.viewerEnabled && <p className="ai-field__hint" style={{ marginTop: 8 }}>View-only sign-in is off. Add the APP_INTELLIGENCE_VIEWER_PASSWORD variable to turn it on.</p>}
          <div style={{ marginTop: 14 }}><Button variant="primary" type="submit" loading={busy}>Save reminders</Button></div>
        </form>
      )}
    </Card>
  );
}
