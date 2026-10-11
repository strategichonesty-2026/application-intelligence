import { useState } from 'react';
import { Button, Card } from '../ui/primitives';
import { StateMessage, ApiErrorState } from '../ui/StateMessage';
import DataGate, { TableSkeleton } from '../ui/DataGate';
import SummaryCards from '../components/SummaryCards';
import HealthTable from '../components/HealthTable';
import { IncidentFeed, ActivityFeed } from '../components/Feeds';
import MonitoringBanners from '../components/MonitoringBanners';
import AppFormDialog from '../components/AppFormDialog';
import { useResource } from '../data/useResource';
import { monitoringApi } from '../data/api';
import { hrefTo } from '../data/useRoute';
import { Skeleton } from '../ui/primitives';

function NoApplications({ onRegister }) {
  return (
    <StateMessage icon="apps" title="Monitoring is not configured yet"
      action={<Button variant="primary" icon="plus" onClick={onRegister}>Register your first application</Button>}>
      No applications are registered, so there is nothing to monitor and no health information to show.
      Register an application with its URL to start collecting real checks.
    </StateMessage>
  );
}

export default function Overview({ summaryRes, appsRes, route }) {
  const [registering, setRegistering] = useState(false);
  const incidents = useResource((s) => monitoringApi.incidents({ pageSize: 5 }, s), []);
  const activity = useResource((s) => monitoringApi.activity({ limit: 8 }, s), []);
  const filters = { status: route.params.status, env: route.params.env, q: route.params.q };
  const onFilters = (patch) => route.replaceParams({ ...route.params, ...patch });
  const reloadAll = () => { appsRes.reload(); summaryRes.reload(); incidents.reload(); activity.reload(); };

  // One explanation, not four, when the API itself cannot be reached.
  const apiDown = summaryRes.error && !summaryRes.data && appsRes.error && !appsRes.data;

  return (
    <>
      <div className="ai-page__head">
        <div>
          <h1 className="ai-page__title">Application Overview</h1>
          <p className="ai-page__sub">The central monitoring view for every registered application. All figures come from real health checks, and nothing here is estimated.</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setRegistering(true)}>Register application</Button>
      </div>

      {apiDown ? <Card><ApiErrorState error={summaryRes.error} onRetry={reloadAll} /></Card> : (<>
      <DataGate res={summaryRes} what="the summary" skeleton={<div className="ai-summary">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={92} />)}</div>}>
        {(summary) => (
          <>
            <MonitoringBanners summary={summary} apps={appsRes.data && appsRes.data.applications} />
            <SummaryCards counts={summary.counts} />
          </>
        )}
      </DataGate>

      <Card title="Application health" subtitle="Worst status first. Select an application for check details and its limitations." flush>
        <DataGate res={appsRes} what="applications" skeleton={<TableSkeleton rows={5} />}>
          {({ applications }) => (
            <HealthTable apps={applications} filters={filters} onFilters={onFilters}
              emptyAction={<NoApplications onRegister={() => setRegistering(true)} />} />
          )}
        </DataGate>
      </Card>

      <div className="ai-two">
        <Card title="Recent incidents" flush
          actions={<a href={hrefTo('/health')}>View all</a>}>
          <DataGate res={incidents} what="incidents" skeleton={<TableSkeleton rows={3} />}>
            {({ items }) => items.length ? <IncidentFeed items={items} /> : (
              <StateMessage icon="inbox" compact title="No incidents recorded">
                An incident is opened when an application fails three checks in a row. None has happened{appsRes.data && appsRes.data.applications.length === 0 ? ', and no applications are monitored yet' : ' so far'}.
              </StateMessage>
            )}
          </DataGate>
        </Card>
        <Card title="Recent monitoring activity" flush
          actions={<a href={hrefTo('/health', { tab: 'checks' })}>Check history</a>}>
          <DataGate res={activity} what="monitoring activity" skeleton={<TableSkeleton rows={3} />}>
            {({ checks }) => checks.length ? <ActivityFeed checks={checks} /> : (
              <StateMessage icon="clock" compact title="No checks have run yet">
                Checks run automatically on each application’s schedule. The first result appears here within a minute of registering an application.
              </StateMessage>
            )}
          </DataGate>
        </Card>
      </div>
      </>)}
      <AppFormDialog open={registering} application={null} onClose={() => setRegistering(false)} onSaved={reloadAll} />
    </>
  );
}
