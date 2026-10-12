import { useEffect, useState, useCallback } from 'react';
import Icon from '../ui/Icon';
import { Button } from '../ui/primitives';
import { Badge } from '../ui/StatusBadge';
import { Banner } from '../ui/StateMessage';
import { showcaseApi, signOut } from '../data/api';
import { relativeTime } from '../data/format';

// Plain words for a view-only audience. Anything we cannot prove is "Not sure", never "Up".
const SIMPLE = {
  healthy: { label: 'Up', tone: 'ok', icon: 'check-circle' },
  reachable: { label: 'Up', tone: 'ok', icon: 'check-circle' },
  degraded: { label: 'Slow', tone: 'warn', icon: 'alert-triangle' },
  unhealthy: { label: 'Down', tone: 'bad', icon: 'x-circle' },
  paused: { label: 'Paused', tone: 'neutral', icon: 'pause-circle' },
};
const NOT_SURE = { label: 'Not sure', tone: 'neutral', icon: 'help-circle' };

/** View-only page: app names and up/down only. No addresses, errors, settings or secrets are ever sent to it. */
export default function Showcase() {
  const [state, setState] = useState({ loading: true, apps: [], error: null });
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    showcaseApi.list().then((r) => setState({ loading: false, apps: r.applications || [], error: null }))
      .catch((e) => { if (e.kind !== 'auth') setState((s) => ({ ...s, loading: false, error: e.message })); });
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="ai-login" style={{ alignItems: 'flex-start' }}>
      <div className="ai-card ai-login__card" style={{ maxWidth: 560 }}>
        <div className="ai-brand" style={{ padding: 0, marginBottom: 12 }}><span className="ai-brand__mark"><Icon name="activity" size={16} /></span>Application Intelligence</div>
        <h1 className="ai-card__title" style={{ fontSize: 18 }}>App status</h1>
        <p className="ai-card__sub" style={{ marginBottom: 16 }}>View only. This shows what was found the last time each app was checked.</p>
        {state.error && <div style={{ marginBottom: 12 }}><Banner tone="bad">{state.error}</Banner></div>}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {state.apps.map((a) => {
            const m = SIMPLE[a.status] || NOT_SURE;
            return (
              <li key={a.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--ai-border, #e5e7eb)' }}>
                <div><strong>{a.name}</strong><div className="ai-field__hint">{a.lastCheckedAt ? `Checked ${relativeTime(a.lastCheckedAt)}` : 'Not checked yet'}</div></div>
                <Badge tone={m.tone} icon={m.icon}>{m.label}</Badge>
              </li>
            );
          })}
        </ul>
        {!state.loading && !state.error && state.apps.length === 0 && <p className="ai-field__hint">No apps to show yet.</p>}
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <Button onClick={load} loading={state.loading}>Refresh</Button>
          <Button onClick={signOut}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}
