import { useState } from 'react';
import Icon from '../ui/Icon';
import { Button, Card, LinkButton } from '../ui/primitives';
import { StatusBadge } from '../ui/StatusBadge';
import { StateMessage } from '../ui/StateMessage';
import DataGate, { TableSkeleton } from '../ui/DataGate';
import { IncidentFeed, ActivityFeed } from '../components/Feeds';
import ResponseChart from '../components/ResponseChart';
import AppFormDialog from '../components/AppFormDialog';
import { ConfirmDialog } from '../ui/Dialog';
import { useToast } from '../ui/Toast';
import { useResource } from '../data/useResource';
import { monitoringApi } from '../data/api';
import { hrefTo } from '../data/useRoute';
import { absoluteTime, relativeTime, formatMs, MODE_LABEL, MODE_HELP, DASH } from '../data/format';

const RANGES = [{ id: '1h', label: '1 hour' }, { id: '24h', label: '24 hours' }, { id: '7d', label: '7 days' }];

function Fact({ label, children }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}
const When = ({ iso, empty }) => (iso
  ? <><time dateTime={iso}>{relativeTime(iso)}</time> <span className="ai-sub">{absoluteTime(iso)}</span></>
  : <span className="ai-muted">{empty}</span>);

/** The one callout that explains what the current status means and what to do. */
function StatusExplanation({ app }) {
  const s = app.status;
  if (app.monitoringFault) {
    return <div className="ai-callout ai-callout--neutral"><Icon name="wrench" size={18} /><div><strong>Monitoring issue, not an application failure.</strong> The monitoring service could not complete the last check ({app.lastSummary || 'internal error'}). The application may be perfectly fine; it just is not being verified right now.</div></div>;
  }
  if (s === 'unknown' && app.suspect) {
    return <div className="ai-callout ai-callout--warn"><Icon name="alert-triangle" size={18} /><div><strong>Last check failed; not yet confirmed.</strong> {app.statusNote} It is shown as unable to verify, not unavailable, until repeated checks confirm it.</div></div>;
  }
  if (s === 'unknown' && app.lastOutcome === 'inconclusive' && app.lastHttpStatus === 404) {
    return <div className="ai-callout ai-callout--warn"><Icon name="search" size={18} /><div><strong>Server responding, path not found (HTTP 404).</strong> The application is up, but nothing exists at the registered address, so its health cannot be verified. Check that the registered URL or health endpoint path is correct.</div></div>;
  }
  if (s === 'unknown' && app.lastOutcome === 'inconclusive' && app.lastSummary && /health endpoint answered/.test(app.lastSummary)) {
    return <div className="ai-callout ai-callout--warn"><Icon name="help-circle" size={18} /><div><strong>Health endpoint not usable.</strong> {app.lastSummary}</div></div>;
  }
  if (s === 'unhealthy') {
    return <div className="ai-callout ai-callout--bad"><Icon name="x-circle" size={18} /><div><strong>Unavailable.</strong> {app.lastSummary} The last check failed and its immediate retry failed too. Open the application to confirm what users see, then use “Check now” once you have a fix in place.</div></div>;
  }
  if (s === 'degraded') {
    return <div className="ai-callout ai-callout--warn"><Icon name="alert-triangle" size={18} /><div><strong>Degraded.</strong> {app.lastSummary || app.statusNote} {app.consecutiveFailures > 0 && 'Degraded results are shown but never raise an incident.'}</div></div>;
  }
  if (s === 'stale') {
    return <div className="ai-callout ai-callout--neutral"><Icon name="clock" size={18} /><div><strong>Monitoring data is stale.</strong> The last check was {relativeTime(app.lastCheckedAt)}, which is longer than {Math.round(app.check.staleAfterSeconds / 3600)} hours, so a daily check was missed. The status before that is not shown as current. Run “Check now” to get a fresh result.</div></div>;
  }
  if (s === 'unknown' && app.lastOutcome === 'inconclusive') {
    return <div className="ai-callout ai-callout--warn"><Icon name="lock" size={18} /><div><strong>Authentication required.</strong> {app.lastSummary} Phase 1 never stores credentials. Point the check at a public health endpoint, or an address that does not require sign-in.</div></div>;
  }
  if (s === 'pending') return <div className="ai-callout ai-callout--neutral"><Icon name="clock" size={18} /><div>No check has completed yet. The first result appears shortly after registration.</div></div>;
  if (s === 'paused') return <div className="ai-callout ai-callout--neutral"><Icon name="pause-circle" size={18} /><div>Monitoring is paused. No new checks run until it is re-enabled in the monitoring configuration.</div></div>;
  if (s === 'reachable') return <div className="ai-callout"><Icon name="globe" size={18} /><div><strong>Reachable, health not verified.</strong> The registered URL answers, but a homepage check cannot show that the application’s features, database or integrations work. Add a health endpoint check for a real health signal.</div></div>;
  return <div className="ai-callout"><Icon name="info" size={18} /><div>{app.statusNote}</div></div>;
}

export default function ApplicationDetail({ id, appsRes, summaryRes }) {
  const toast = useToast();
  const [range, setRange] = useState('24h');
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const detail = useResource((s) => monitoringApi.application(id, s), [id]);
  const history = useResource((s) => monitoringApi.history(id, range, s), [id, range]);
  const reloadAll = () => { detail.reload(); history.reload(); appsRes.reload(); summaryRes.reload(); };

  const checkNow = async () => {
    setChecking(true);
    try {
      const { result } = await monitoringApi.checkNow(id);
      const ok = result.outcome === 'ok';
      (ok ? toast.success : toast.info)(ok ? `Check passed${result.responseMs != null ? ` in ${result.responseMs} ms` : ''}.` : `Check finished: ${result.summary || result.outcome}`);
      reloadAll();
    } catch (err) { toast.error(`The check could not be run: ${err.message}`); }
    finally { setChecking(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await monitoringApi.remove(id);
      toast.success('Application removed. Its history was deleted.');
      appsRes.reload(); summaryRes.reload();
      window.location.hash = hrefTo('/applications');
    } catch (err) { toast.error(`Could not remove the application: ${err.message}`); setBusy(false); setDeleting(false); }
  };

  return (
    <>
      <div>
        <a className="ai-back" href={hrefTo('')}><Icon name="arrow-left" size={14} />Back to overview</a>
      </div>
      <DataGate res={detail} what="this application" skeleton={<TableSkeleton rows={6} />}>
        {({ application: app, incidents, recentChecks }) => (
          <>
            <div className="ai-page__head">
              <div>
                <h1 className="ai-page__title" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>{app.name} <StatusBadge app={app} /></h1>
                <p className="ai-page__sub">{app.description || 'No description added.'}</p>
              </div>
              <div className="ai-card__actions">
                <Button icon="refresh" loading={checking} onClick={checkNow} disabled={!app.enabled}>Check now</Button>
                <LinkButton variant="primary" href={app.url} external>Open application</LinkButton>
              </div>
            </div>

            <StatusExplanation app={app} />

            <Card title="Current monitoring status">
              <dl className="ai-facts">
                <Fact label="Registered URL"><a href={app.url} target="_blank" rel="noopener noreferrer">{app.url}</a></Fact>
                <Fact label="Environment"><span className="ai-tag">{app.environment}</span></Fact>
                <Fact label="Check type">{app.check.typeLabel}</Fact>
                <Fact label="Endpoint checked"><code>{app.check.endpoint}</code></Fact>
                <Fact label="Last checked"><When iso={app.lastCheckedAt} empty="No check has run" /></Fact>
                <Fact label="Last successful check"><When iso={app.lastSuccessAt} empty="Never succeeded" /></Fact>
                <Fact label="Latest response time">{app.responseMs != null ? formatMs(app.responseMs) : <span className="ai-muted">{DASH} not measured on the latest check</span>}</Fact>
                <Fact label="Latest HTTP status">{app.lastHttpStatus || <span className="ai-muted">{DASH} no response</span>}</Fact>
                <Fact label="Consecutive failed checks">{app.consecutiveFailures}</Fact>
              </dl>
              <div className="ai-callout ai-callout--neutral" style={{ marginTop: 16 }}>
                <Icon name="info" size={18} />
                <div><strong>What this check can and cannot tell you.</strong> {app.check.limitation}</div>
              </div>
            </Card>

            <Card title="Response-time history" subtitle="From real checks that received a response."
              actions={(
                <div className="ai-segment" role="group" aria-label="Time range">
                  {RANGES.map((r) => <button key={r.id} type="button" aria-pressed={range === r.id} onClick={() => setRange(r.id)}>{r.label}</button>)}
                </div>
              )}>
              <DataGate res={history} what="response history" skeleton={<TableSkeleton rows={3} />}>
                {({ points }) => {
                  const measured = points.filter((p) => p.responseMs != null);
                  return measured.length >= 3
                    ? <ResponseChart points={points} slowThresholdMs={app.check.slowThresholdMs} />
                    : (
                      <StateMessage icon="activity" compact title="Not enough history to draw a chart">
                        {measured.length === 0 ? 'No response times were measured in this period.' : `Only ${measured.length} response ${measured.length === 1 ? 'time was' : 'times were'} measured in this period.`}
                        {' '}A chart appears once at least three checks have recorded a response time.
                      </StateMessage>
                    );
                }}
              </DataGate>
            </Card>

            <div className="ai-two">
              <Card title="Incidents and recoveries" flush actions={<a href={hrefTo('/health', { application: app.id })}>All history</a>}>
                {incidents.length
                  ? <IncidentFeed items={incidents} showApp={false} />
                  : <StateMessage icon="inbox" compact title="No incidents recorded">An incident is opened when a check fails (after one immediate retry), and closed by the next passing check.</StateMessage>}
              </Card>
              <Card title="Recent checks" flush actions={<a href={hrefTo('/health', { tab: 'checks', application: app.id })}>Check history</a>}>
                {recentChecks.length
                  ? <ActivityFeed checks={recentChecks} showApp={false} />
                  : <StateMessage icon="clock" compact title="No checks yet">Results appear here after the first check completes.</StateMessage>}
              </Card>
            </div>

            <Card title="Monitoring configuration" actions={<Button size="sm" icon="pencil" onClick={() => setEditing(true)}>Edit configuration</Button>}>
              <dl className="ai-facts">
                <Fact label="Monitoring">{app.enabled ? 'Enabled' : 'Paused'}</Fact>
                <Fact label="How it is checked">{MODE_LABEL[app.mode] || MODE_LABEL.manual}<span className="ai-sub">{MODE_HELP[app.mode] || MODE_HELP.manual}</span></Fact>
                <Fact label="Expected HTTP status">{app.check.expectedStatus}</Fact>
                <Fact label="Timeout">{formatMs(app.check.timeoutMs)}</Fact>
                <Fact label="Slow-response limit">{app.check.slowThresholdMs == null ? <span className="ai-muted">Not set (no response-time limit applied)</span> : formatMs(app.check.slowThresholdMs)}</Fact>
                <Fact label="Counted as stale after">{app.check.staleAfterSeconds == null ? <span className="ai-muted">Never (manual: the last-checked time is shown)</span> : `${Math.round(app.check.staleAfterSeconds / 3600)} h without a check`}</Fact>
                <Fact label="Incident opens">When a check fails and its immediate retry fails too (degraded never opens one)</Fact>
                <Fact label="Incident closes">At the next passing check</Fact>
                <Fact label="Registered">{absoluteTime(app.createdAt)}</Fact>
              </dl>
            </Card>

            <Card title="Known limitations and integration status">
              <ul className="ai-bullets">
                <li><strong>This check:</strong> {app.check.limitation}</li>
                <li><strong>Availability only.</strong> Phase 1 measures whether the application answers. It does not see user activity, errors inside the application, chatbot quality or support requests.</li>
                <li><strong>No application integration.</strong> The platform only sees what the checked address exposes. Nothing is installed in, or read from, the application itself.</li>
                <li><strong>No alerting yet.</strong> Incidents appear in this console. Email or chat notifications are not available.</li>
                <li><strong>Private by design.</strong> Health responses are inspected for a status word and discarded. Credentials, response bodies and financial data are never stored or shown.</li>
              </ul>
              <div style={{ marginTop: 16 }}>
                <Button variant="danger" size="sm" icon="trash" onClick={() => setDeleting(true)}>Remove application</Button>
              </div>
            </Card>

            <AppFormDialog open={editing} application={app} onClose={() => setEditing(false)} onSaved={reloadAll} />
            <ConfirmDialog open={deleting} danger title={`Remove ${app.name}?`} confirmLabel="Remove application" busy={busy}
              onCancel={() => setDeleting(false)} onConfirm={remove}>
              <p>This stops monitoring and permanently deletes all of its check history and incidents.</p>
              <p className="ai-muted">The application itself is not touched. You can register it again later, but the history cannot be restored.</p>
            </ConfirmDialog>
          </>
        )}
      </DataGate>
    </>
  );
}
