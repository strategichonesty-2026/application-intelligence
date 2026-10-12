import { useState } from 'react';
import { Button, Card, Select } from '../ui/primitives';
import { Badge } from '../ui/StatusBadge';
import { StatusBadge } from '../ui/StatusBadge';
import { StateMessage } from '../ui/StateMessage';
import DataGate, { TableSkeleton } from '../ui/DataGate';
import AppFormDialog from '../components/AppFormDialog';
import StarterRecords from '../components/StarterRecords';
import SignInReminders from '../components/SignInReminders';
import { ConfirmDialog } from '../ui/Dialog';
import { useToast } from '../ui/Toast';
import { useResource } from '../data/useResource';
import { useDashboardClock } from '../data/DashboardContext';
import { monitoringApi } from '../data/api';
import { hrefTo } from '../data/useRoute';
import { hostOf, relativeTime, absoluteTime, MODE_LABEL } from '../data/format';
import { Banner } from '../ui/StateMessage';

const POLL_OPTIONS = [
  { value: '0', label: 'Off (refresh manually)' }, { value: '300000', label: 'Every 5 minutes' },
];

function Row({ label, children }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

export function CycleBadge({ health }) {
  if (!health) return <Badge tone="neutral" icon="clock">Checking…</Badge>;
  if (health.state === 'manual') return <Badge tone="neutral" icon="info">Manual: automatic checks are off</Badge>;
  if (health.state === 'ok') return <Badge tone="ok" icon="check-circle">{health.ageSeconds != null ? `Daily check completed ${Math.max(1, Math.round(health.ageSeconds / 3600))} h ago` : 'Waiting for the first daily check'}</Badge>;
  if (health.state === 'stalled') return <Badge tone="bad" icon="x-circle">Stalled</Badge>;
  if (health.state === 'never_ran') return <Badge tone="bad" icon="x-circle">Never ran</Badge>;
  return <Badge tone="neutral" icon="info">Nothing to monitor</Badge>;
}

const EVENT_LABEL = { opened: 'Incident opened', recovered: 'Recovered', test: 'Test' };

function DeliveryBadge({ n }) {
  switch (n.status) {
    case 'sent': return <Badge tone="ok" icon="check-circle">Accepted by provider</Badge>;
    case 'pending': return <Badge tone="warn" icon="clock">{n.attempts > 0 ? `Retrying (attempt ${n.attempts} failed)` : 'Queued'}</Badge>;
    case 'sending': return <Badge tone="neutral" icon="clock">Sending</Badge>;
    case 'failed': return <Badge tone="bad" icon="x-circle">Failed</Badge>;
    default: return <Badge tone="neutral" icon="info">Not sent: email not configured</Badge>;
  }
}

function AlertsCard() {
  const toast = useToast();
  const cfg = useResource((s) => monitoringApi.alertsConfig(s), []);
  const list = useResource((s) => monitoringApi.alerts(s), []);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  const sendTest = async () => {
    setTesting(true); setResult(null);
    try {
      const out = await monitoringApi.testAlert();
      setResult({ tone: 'ok', text: out.message });
      toast.success('The email provider accepted the test message.');
    } catch (err) {
      setResult({ tone: 'bad', text: err.message });
      toast.error('The test email was not accepted. Details are shown in the card.');
    } finally { setTesting(false); list.reload(); }
  };

  return (
    <Card title="Email alerts" subtitle="Sent once when an incident opens and once when it recovers." flush>
      <div className="ai-card__body">
        <DataGate res={cfg} what="alert settings" skeleton={<TableSkeleton rows={2} />}>
          {(c) => (
            <>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                {c.configured ? <Badge tone="ok" icon="check-circle">Configured</Badge> : <Badge tone="warn" icon="alert-triangle">Not configured</Badge>}
                {c.configured && <span className="ai-muted">Recipients: {c.recipients.join(', ')} · provider: Resend</span>}
                <span style={{ flex: 1 }} />
                <Button icon="inbox" loading={testing} disabled={!c.configured} onClick={sendTest}>Send test email</Button>
              </div>
              {!c.configured && (
                <div className="ai-callout ai-callout--warn" style={{ marginTop: 12 }}>
                  <div>
                    <strong>No alert email will be sent until this is configured.</strong> {c.message}
                    <ul className="ai-bullets" style={{ marginTop: 6 }}>
                      {[...c.missing, ...c.invalid].map((m) => <li key={m}><code>{m}</code></li>)}
                    </ul>
                    Set these on the server (never in this console), then redeploy. Incidents are still recorded and shown here while alerts are off.
                  </div>
                </div>
              )}
              {result && <div style={{ marginTop: 12 }}><Banner tone={result.tone}>{result.text}</Banner></div>}
            </>
          )}
        </DataGate>
      </div>
      <DataGate res={list} what="notifications" skeleton={<TableSkeleton rows={2} />}>
        {({ alerts }) => alerts.length === 0 ? (
          <StateMessage icon="inbox" compact title="No notifications yet">An entry appears here when an incident opens or recovers, or when you send a test.</StateMessage>
        ) : (
          <div className="ai-tablewrap">
            <table className="ai-table ai-table--cards">
              <thead><tr><th scope="col">When</th><th scope="col">Event</th><th scope="col">Application</th><th scope="col">Delivery status</th><th scope="col">Detail</th></tr></thead>
              <tbody>
                {alerts.map((n) => (
                  <tr key={n.id}>
                    <td className="ai-cell-first"><time dateTime={n.createdAt} title={absoluteTime(n.createdAt)}>{relativeTime(n.createdAt)}</time></td>
                    <td data-label="Event">{EVENT_LABEL[n.event] || n.event}</td>
                    <td data-label="Application">{n.applicationName || <span className="ai-muted">—</span>}</td>
                    <td data-label="Delivery"><DeliveryBadge n={n} /></td>
                    <td data-label="Detail"><span className="ai-sub" style={{ maxWidth: 320 }}>{n.lastError || (n.status === 'sent' ? 'The provider confirmed it accepted the message. Inbox delivery is not tracked.' : n.nextAttemptAt ? `Next attempt ${relativeTime(n.nextAttemptAt) || 'soon'}` : '')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataGate>
    </Card>
  );
}

export default function Settings({ appsRes, summaryRes }) {
  const toast = useToast();
  const { pollMs, setPollMs } = useDashboardClock();
  const config = useResource((s) => monitoringApi.config(s), []);
  const [form, setForm] = useState({ open: false, app: null });
  const [toggle, setToggle] = useState(null);
  const [busy, setBusy] = useState(false);
  const refreshApps = () => { appsRes.reload(); summaryRes.reload(); };

  const applyToggle = async () => {
    setBusy(true);
    try {
      await monitoringApi.update(toggle.id, { enabled: !toggle.enabled });
      toast.success(toggle.enabled ? `Monitoring paused for ${toggle.name}.` : `Monitoring resumed for ${toggle.name}.`);
      refreshApps();
    } catch (err) { toast.error(`The change could not be saved: ${err.message}`); }
    finally { setBusy(false); setToggle(null); }
  };

  return (
    <>
      <div className="ai-page__head">
        <div>
          <h1 className="ai-page__title">Settings</h1>
          <p className="ai-page__sub">Manage monitored applications and how this console behaves. Changes to monitoring ask for confirmation first.</p>
        </div>
      </div>

      <Card title="Monitored applications" subtitle="Register, edit or pause what is being checked." flush
        actions={<Button variant="primary" size="sm" icon="plus" onClick={() => setForm({ open: true, app: null })}>Register application</Button>}>
        <DataGate res={appsRes} what="applications" skeleton={<TableSkeleton rows={3} />}>
          {({ applications }) => applications.length === 0 ? (
            <StateMessage icon="apps" compact title="Monitoring is not configured yet">Register an application’s URL to start collecting checks.</StateMessage>
          ) : (
            <div className="ai-tablewrap">
              <table className="ai-table ai-table--cards">
                <thead><tr><th scope="col">Application</th><th scope="col">Status</th><th scope="col">Check</th><th scope="col">Checked</th><th scope="col" className="ai-num">Actions</th></tr></thead>
                <tbody>
                  {applications.map((a) => (
                    <tr key={a.id}>
                      <td className="ai-cell-first"><div className="ai-cell-app"><a href={hrefTo(`/applications/${encodeURIComponent(a.id)}`)}>{a.name}</a><small><span className="ai-tag">{a.environment}</span> {hostOf(a.url)}</small></div></td>
                      <td data-label="Status"><StatusBadge app={a} /></td>
                      <td data-label="Check">{a.check.typeLabel}</td>
                      <td data-label="Checked">{MODE_LABEL[a.mode] || MODE_LABEL.manual}</td>
                      <td className="ai-cell-actions">
                        <div className="ai-actions">
                          <Button size="sm" icon="pencil" onClick={() => setForm({ open: true, app: a })} aria-label={`Edit ${a.name}`}>Edit</Button>
                          <Button size="sm" onClick={() => setToggle(a)} aria-label={`${a.enabled ? 'Pause' : 'Resume'} monitoring for ${a.name}`}>{a.enabled ? 'Pause' : 'Resume'}</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataGate>
      </Card>

      <div className="ai-two">
        <Card title="Dashboard preferences">
          <Select label="Refresh data automatically" value={String(pollMs)} onChange={(v) => { setPollMs(Number(v)); toast.success('Preference saved in this browser.'); }} options={POLL_OPTIONS} />
          <p className="ai-field__hint" style={{ marginTop: 8 }}>Only changes how often this page re-reads results. It does not change how often applications are checked. Stored in this browser only.</p>
        </Card>

        <Card title="Monitoring service">
          <DataGate res={config} what="configuration" skeleton={<TableSkeleton rows={3} />}>
            {(c) => (
              <dl className="ai-facts" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <Row label="Environment"><span className="ai-tag">{c.environment}</span></Row>
                <Row label="Automatic check"><CycleBadge health={summaryRes.data && summaryRes.data.monitoring.health} /></Row>
                <Row label="Automatic checks">{c.monitoring.schedule === 'daily' ? `Daily at ${String(c.monitoring.dailyUtcHour).padStart(2, '0')}:00 UTC` : 'Off. Applications are checked only when you click Check now or Check all'}</Row>
                <Row label="Incident opens after">{c.rules.failuresToOpenIncident} confirmed failed check (retried once immediately)</Row>
                <Row label="Incident closes after">{c.rules.successesToResolve} passing check</Row>
                <Row label="Check history kept">{c.rules.retentionDays} days</Row>
                <Row label="Private network targets">{c.privateTargetsAllowed ? 'Allowed (development)' : 'Blocked'}</Row>
                <Row label="Last completed automatic check">{summaryRes.data && summaryRes.data.monitoring.lastCycleCompletedAt ? <time title={absoluteTime(summaryRes.data.monitoring.lastCycleCompletedAt)}>{relativeTime(summaryRes.data.monitoring.lastCycleCompletedAt)}</time> : <span className="ai-muted">None yet</span>}</Row>
                <Row label="Independent heartbeat">
                  {!c.heartbeat.configured ? <Badge tone="warn" icon="alert-triangle">Not configured</Badge>
                    : !c.heartbeat.valid ? <Badge tone="bad" icon="x-circle">Invalid URL</Badge>
                      : (summaryRes.data && summaryRes.data.monitoring.heartbeat && summaryRes.data.monitoring.heartbeat.lastSuccessAt)
                        ? <Badge tone="ok" icon="check-circle">Last ping {relativeTime(summaryRes.data.monitoring.heartbeat.lastSuccessAt)}</Badge>
                        : <Badge tone="neutral" icon="clock">Waiting for first ping</Badge>}
                </Row>
              </dl>
            )}
          </DataGate>
          <DataGate res={config} what="configuration" skeleton={null}>
            {(c) => !c.heartbeat.configured && (
              <div className="ai-callout ai-callout--warn" style={{ marginTop: 12 }}>
                <div><strong>Nothing outside this service watches the monitor.</strong> Without an independent heartbeat, if monitoring stops no alert is sent. Set <code>APP_INTELLIGENCE_HEARTBEAT_URL</code> to a heartbeat URL from an external service.</div>
              </div>
            )}
          </DataGate>
        </Card>
      </div>

      <AlertsCard />

      <SignInReminders />

      <StarterRecords onLoaded={refreshApps} />

      <Card title="Access and privacy">
        <ul className="ai-bullets">
          <li>Access to this console and its API is controlled by the deployment’s API key. Per-user accounts and roles are not part of Phase 1.</li>
          <li>The dashboard never shows secrets, credentials, raw health-check responses or financial information.</li>
          <li>Error text is reduced to a short, plain-language summary before it is stored.</li>
        </ul>
      </Card>

      <AppFormDialog open={form.open} application={form.app} onClose={() => setForm({ open: false, app: null })} onSaved={refreshApps} />
      <ConfirmDialog open={Boolean(toggle)} danger={Boolean(toggle && toggle.enabled)} busy={busy} title={toggle && toggle.enabled ? `Pause monitoring for ${toggle.name}?` : `Resume monitoring for ${toggle ? toggle.name : ''}?`}
        confirmLabel={toggle && toggle.enabled ? 'Pause monitoring' : 'Resume monitoring'} onCancel={() => setToggle(null)} onConfirm={applyToggle}>
        {toggle && toggle.enabled
          ? <p>No new checks will run, and the application will show as “Paused” rather than healthy. Existing history is kept. Any open incident stays open until monitoring resumes.</p>
          : <p>Checks start again the next time you click Check now / Check all, or at the next daily check if that is switched on.</p>}
      </ConfirmDialog>
    </>
  );
}
