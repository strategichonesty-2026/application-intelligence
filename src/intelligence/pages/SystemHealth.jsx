import Icon from '../ui/Icon';
import { Button, Card, LinkButton, Select } from '../ui/primitives';
import { Badge, IncidentStatusBadge, SeverityBadge } from '../ui/StatusBadge';
import { StateMessage, Banner } from '../ui/StateMessage';
import DataGate, { TableSkeleton } from '../ui/DataGate';
import { ActivityFeed, incidentTitle } from '../components/Feeds';
import { CycleBadge } from './Settings';
import { useResource } from '../data/useResource';
import { monitoringApi } from '../data/api';
import { hrefTo } from '../data/useRoute';
import { absoluteTime, relativeTime, formatDuration, clockTime } from '../data/format';

const RANGE_OPTIONS = [
  { value: 'all', label: 'All time' }, { value: '1h', label: 'Last hour' }, { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' },
];
const PAGE_SIZE = 10;

function Stamp({ iso, empty = DASHES }) {
  if (!iso) return <span className="ai-muted">{empty}</span>;
  return <><time dateTime={iso}>{relativeTime(iso)}</time><span className="ai-sub">{absoluteTime(iso)}</span></>;
}
const DASHES = '—';

function EventCard({ item }) {
  const monitoring = item.kind === 'monitoring';
  const open = item.status === 'open';
  return (
    <li className="ai-event" style={{ display: 'block' }}>
      <div className="ai-list__title">
        <a href={hrefTo(`/applications/${encodeURIComponent(item.applicationId)}`)}>{item.applicationName}</a>
        <span className="ai-tag">{item.environment}</span>
        <IncidentStatusBadge item={item} />
        {!monitoring && <SeverityBadge severity={item.severity} />}
        <span style={{ flex: 1 }} />
        <LinkButton size="sm" href={item.applicationUrl} external>Open application</LinkButton>
      </div>
      <div style={{ fontWeight: 600, marginTop: 6 }}>{incidentTitle(item)}</div>
      <p className="ai-event__note">{item.summary}</p>
      {monitoring ? (
        <div className="ai-callout ai-callout--neutral" style={{ marginTop: 10 }}>
          <Icon name="wrench" size={16} />
          <div><strong>This is a monitoring-service fault, not an application failure.</strong> The check could not run, so nothing is known about the application at this time. It did not count towards an incident.</div>
        </div>
      ) : null}
      <dl>
        <div><dt>{monitoring ? 'Occurred' : 'First detected'}</dt><dd><Stamp iso={item.firstDetectedAt} /></dd></div>
        {!monitoring && <div><dt>Latest observed failure</dt><dd><Stamp iso={item.lastFailureAt} /></dd></div>}
        {!monitoring && <div><dt>Recovered</dt><dd>{item.resolvedAt ? <><Stamp iso={item.resolvedAt} /><span className="ai-sub">after {formatDuration(item.firstDetectedAt, item.resolvedAt)}</span></> : <span className="ai-muted">{open ? 'Not recovered yet' : DASHES}</span>}</dd></div>}
        {!monitoring && <div><dt>Failed checks</dt><dd>{item.failureCount}</dd></div>}
      </dl>
    </li>
  );
}

export default function SystemHealth({ summaryRes, appsRes, route }) {
  const p = route.params;
  const tab = p.tab === 'checks' ? 'checks' : 'incidents';
  const page = Math.max(1, Number(p.page) || 1);
  const setP = (patch) => route.replaceParams({ ...p, page: undefined, ...patch });
  const filters = { application: p.application, status: p.status, severity: p.severity, kind: p.kind, range: p.range };

  const incidents = useResource((s) => monitoringApi.incidents({ ...filters, page, pageSize: PAGE_SIZE }, s), [filters, page, tab], { poll: tab === 'incidents' });
  const checks = useResource((s) => monitoringApi.activity({ application: p.application, limit: 50 }, s), [p.application, tab], { poll: tab === 'checks' });

  const apps = (appsRes.data && appsRes.data.applications) || [];
  const appOptions = [{ value: 'all', label: 'All applications' }, ...apps.map((a) => ({ value: a.id, label: a.name }))];
  const hasFilters = Object.values(filters).some((v) => v && v !== 'all');
  const clear = () => route.replaceParams({ tab: p.tab });
  const mon = summaryRes.data && summaryRes.data.monitoring;

  return (
    <>
      <div className="ai-page__head">
        <div>
          <h1 className="ai-page__title">System Health</h1>
          <p className="ai-page__sub">Incidents and check history in time order. Application failures and monitoring-service faults are kept apart, so you can tell whether the problem is the application or the monitoring.</p>
        </div>
      </div>

      <Card title="Monitoring service" subtitle="The part of the platform that runs the checks.">
        <DataGate res={summaryRes} what="monitoring status" skeleton={<TableSkeleton rows={1} />}>
          {({ monitoring }) => (
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
              <CycleBadge health={monitoring.health} />
              <span className="ai-muted">Last check recorded: <strong style={{ color: 'inherit' }}>{monitoring.lastCheckRecordedAt ? relativeTime(monitoring.lastCheckRecordedAt) : 'none yet'}</strong></span>
              <span className="ai-muted">Last automatic check: <strong>{monitoring.lastCycleCompletedAt ? relativeTime(monitoring.lastCycleCompletedAt) : 'none (automatic checks are ' + (monitoring.schedule === 'daily' ? 'on, none run yet)' : 'off)')}</strong></span>
              {monitoring.lastTickError && <Badge tone="warn" icon="alert-triangle">Last scheduler run hit an error</Badge>}
            </div>
          )}
        </DataGate>
      </Card>

      <div role="tablist" aria-label="Health views" className="ai-tabs">
        <button role="tab" aria-selected={tab === 'incidents'} onClick={() => route.replaceParams({ ...p, tab: undefined, page: undefined })}>Incidents and faults</button>
        <button role="tab" aria-selected={tab === 'checks'} onClick={() => route.replaceParams({ ...p, tab: 'checks', page: undefined })}>Check history</button>
      </div>

      <Card flush>
        <div className="ai-toolbar" role="search" aria-label="Filter history">
          <Select label="Application" value={p.application || 'all'} onChange={(v) => setP({ application: v })} options={appOptions} />
          {tab === 'incidents' && (
            <>
              <Select label="Source" value={p.kind || 'all'} onChange={(v) => setP({ kind: v })}
                options={[{ value: 'all', label: 'All sources' }, { value: 'application', label: 'Application failures' }, { value: 'monitoring', label: 'Monitoring service' }]} />
              <Select label="Status" value={p.status || 'all'} onChange={(v) => setP({ status: v })}
                options={[{ value: 'all', label: 'Any status' }, { value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }]} />
              <Select label="Severity" value={p.severity || 'all'} onChange={(v) => setP({ severity: v })}
                options={[{ value: 'all', label: 'Any severity' }, { value: 'critical', label: 'Critical' }, { value: 'warning', label: 'Warning' }]} />
              <Select label="Time range" value={p.range || 'all'} onChange={(v) => setP({ range: v })} options={RANGE_OPTIONS} />
            </>
          )}
          {hasFilters && <Button variant="ghost" size="sm" icon="x" onClick={clear}>Clear filters</Button>}
        </div>

        {tab === 'incidents' ? (
          <DataGate res={incidents} what="incident history" skeleton={<TableSkeleton rows={4} />}>
            {({ items, total }) => {
              if (!items.length) {
                return hasFilters
                  ? <StateMessage icon="search" compact title="No events match these filters" action={<Button onClick={clear}>Clear filters</Button>}>Try a wider time range, or a different application or status.</StateMessage>
                  : <StateMessage icon="inbox" title="No incidents or monitoring faults recorded">
                    {apps.length ? 'An incident is opened when a check fails and its immediate retry fails too. Nothing has met that bar so far. The “Check history” tab shows every individual check.' : 'No applications are registered yet, so there is nothing to record.'}
                  </StateMessage>;
              }
              const pages = Math.ceil(total / PAGE_SIZE);
              return (
                <>
                  <ul className="ai-list">{items.map((i) => <EventCard key={`${i.kind}-${i.id}`} item={i} />)}</ul>
                  <div className="ai-pager">
                    <span aria-live="polite">Showing {(page - 1) * PAGE_SIZE + 1}–{(page - 1) * PAGE_SIZE + items.length} of {total}</span>
                    {pages > 1 && (
                      <div>
                        <Button size="sm" icon="chevron-left" disabled={page <= 1} onClick={() => route.replaceParams({ ...p, page: String(page - 1) })}>Newer</Button>
                        <Button size="sm" disabled={page >= pages} onClick={() => route.replaceParams({ ...p, page: String(page + 1) })}>Older <Icon name="chevron-right" /></Button>
                      </div>
                    )}
                  </div>
                </>
              );
            }}
          </DataGate>
        ) : (
          <DataGate res={checks} what="check history" skeleton={<TableSkeleton rows={4} />}>
            {({ checks: list }) => list.length
              ? (
                <>
                  <ActivityFeed checks={list} />
                  <div className="ai-pager"><span>Showing the latest {list.length} checks. Older checks are summarised as incidents.</span></div>
                </>
              )
              : <StateMessage icon="clock" title="No checks recorded">{p.application ? 'This application has not been checked yet.' : 'No check has run yet. Checks start automatically once an application is registered.'}</StateMessage>}
          </DataGate>
        )}
      </Card>
      {mon && mon.health && (mon.health.state === 'stalled' || mon.health.state === 'never_ran') && (
        <Banner tone="bad" icon="wrench">The monitoring service is not completing cycles, so this history will not grow until it is restarted.</Banner>
      )}
    </>
  );
}
