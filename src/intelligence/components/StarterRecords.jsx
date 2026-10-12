import { useState } from 'react';
import { Button, Card } from '../ui/primitives';
import { Banner, StateMessage } from '../ui/StateMessage';
import { ConfirmDialog } from '../ui/Dialog';
import DataGate, { TableSkeleton } from '../ui/DataGate';
import { useToast } from '../ui/Toast';
import { useResource } from '../data/useResource';
import { monitoringApi } from '../data/api';
import { Badge } from '../ui/StatusBadge';

const KINDS = [
  { key: 'applications', label: 'Applications', noun: 'application', line: (r) => `${r.name}${r.unconfirmed ? ' (identity unconfirmed)' : ''}` },
  { key: 'credentials', label: 'Credential records', noun: 'credential record', line: (r) => `${r.name}${r.envVarName ? ` · ${r.envVarName}` : ''}` },
  { key: 'subscriptions', label: 'Subscription records', noun: 'subscription record', line: (r) => `${r.provider}${r.service ? ` · ${r.service}` : ''}` },
];

/** Preview, then add only the suggested records that are missing. Additive: nothing is changed or removed. */
export default function StarterRecords({ onLoaded }) {
  const toast = useToast();
  const res = useResource((s) => monitoringApi.starterPreview(s), []);
  const [pick, setPick] = useState({ applications: true, credentials: true, subscriptions: true });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const { added } = await monitoringApi.starterLoad(pick);
      toast.success(`Added ${added.applications} application(s), ${added.credentials} credential record(s), ${added.subscriptions} subscription record(s). Nothing existing was changed.`);
      setConfirm(false); res.reload(); if (onLoaded) onLoaded();
    } catch (e) { toast.error(`Could not load the records: ${e.message}`); } finally { setBusy(false); }
  };

  return (
    <Card title="Suggested starting records" subtitle="One click to add the starting applications, credential register and subscription register. Only what is missing is added; nothing is changed or deleted.">
      <DataGate res={res} what="the starting records" skeleton={<TableSkeleton rows={3} />}>
        {({ plan }) => {
          const total = KINDS.reduce((n, k) => n + plan[k.key].add.length, 0);
          const selected = KINDS.reduce((n, k) => n + (pick[k.key] ? plan[k.key].add.length : 0), 0);
          if (total === 0) return <StateMessage icon="check-circle" compact title="Nothing to add">Every suggested record is already registered.</StateMessage>;
          return (
            <>
              <Banner tone="info" icon="info">Applications are added <strong>without running a check</strong>: nothing is requested from them until you click Check now. Credential and subscription records hold names and references only: no secret values, no prices, and nothing is marked verified, rotated or revoked.</Banner>
              {KINDS.map((k) => {
                const p = plan[k.key];
                return (
                  <div key={k.key} style={{ marginTop: 14 }}>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
                      <input type="checkbox" checked={pick[k.key]} disabled={!p.add.length} onChange={(e) => setPick((x) => ({ ...x, [k.key]: e.target.checked }))} />
                      {k.label}: {p.add.length} to add<span className="ai-muted" style={{ fontWeight: 400 }}> · {p.skip.length} already there</span>
                    </label>
                    {p.add.length > 0 && <ul className="ai-bullets" style={{ marginTop: 6 }}>{p.add.map((r, i) => <li key={i}>{k.line(r)}{k.key === 'applications' && r.mode === 'manual_only' && <> <Badge tone="neutral" icon="lock">manual only</Badge></>}</li>)}</ul>}
                    {k.key === 'applications' && p.invalid.length > 0 && <p className="ai-field__hint">Not added: {p.invalid.join(', ')}.</p>}
                  </div>
                );
              })}
              <div style={{ marginTop: 16 }}><Button variant="primary" icon="plus" disabled={selected === 0} onClick={() => setConfirm(true)}>Load {selected} missing record{selected === 1 ? '' : 's'}</Button></div>
              <ConfirmDialog open={confirm} title="Load the missing records?" confirmLabel="Load them" busy={busy} onConfirm={load} onCancel={() => setConfirm(false)}>
                This adds {selected} record{selected === 1 ? '' : 's'} that are not there yet. Existing records are left exactly as they are, and no application is contacted.
              </ConfirmDialog>
            </>
          );
        }}
      </DataGate>
    </Card>
  );
}
