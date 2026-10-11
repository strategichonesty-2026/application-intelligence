import { useState } from 'react';
import { Button, Card } from '../ui/primitives';
import { useToast } from '../ui/Toast';
import { monitoringApi } from '../data/api';
import { StateMessage } from '../ui/StateMessage';
import DataGate, { TableSkeleton } from '../ui/DataGate';
import HealthTable from '../components/HealthTable';
import MonitoringBanners from '../components/MonitoringBanners';
import AppFormDialog from '../components/AppFormDialog';

export default function Applications({ summaryRes, appsRes, route }) {
  const toast = useToast();
  const [registering, setRegistering] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  const [checkingId, setCheckingId] = useState(null);
  const reload = () => { appsRes.reload(); summaryRes.reload(); };
  // Manual-first: nothing is checked unless one of these is clicked.
  const checkAll = async () => {
    setCheckingAll(true);
    try {
      const { results } = await monitoringApi.checkAll();
      const ran = results.filter((r) => r.outcome); const bad = ran.filter((r) => r.outcome !== 'ok');
      toast[bad.length ? 'info' : 'success'](`Checked ${ran.length} application${ran.length === 1 ? '' : 's'}${bad.length ? `; ${bad.length} need a look` : ': all passed'}.`);
      reload();
    } catch (err) { toast.error(`The checks could not be run: ${err.message}`); }
    finally { setCheckingAll(false); }
  };
  const checkOne = async (a) => {
    setCheckingId(a.id);
    try {
      const { result } = await monitoringApi.checkNow(a.id);
      toast[result.outcome === 'ok' ? 'success' : 'info'](result.outcome === 'ok' ? `${a.name}: check passed.` : `${a.name}: ${result.summary || result.outcome}`);
      reload();
    } catch (err) { toast.error(`The check could not be run: ${err.message}`); }
    finally { setCheckingId(null); }
  };
  const filters = { status: route.params.status, env: route.params.env, q: route.params.q };
  const onFilters = (patch) => route.replaceParams({ ...route.params, ...patch });

  return (
    <>
      <div className="ai-page__head">
        <div>
          <h1 className="ai-page__title">Applications</h1>
          <p className="ai-page__sub">Every registered application, its current status and how it is being checked.</p>
        </div>
        <div className="ai-card__actions">
          <Button icon="refresh" loading={checkingAll} disabled={Boolean(checkingId)} onClick={checkAll}>Check all</Button>
          <Button variant="primary" icon="plus" onClick={() => setRegistering(true)}>Register application</Button>
        </div>
      </div>
      <MonitoringBanners summary={summaryRes.data} apps={appsRes.data && appsRes.data.applications} />
      <Card flush>
        <DataGate res={appsRes} what="applications" skeleton={<TableSkeleton rows={5} />}>
          {({ applications }) => (
            <HealthTable apps={applications} filters={filters} onFilters={onFilters} onCheck={checkOne} checkingId={checkingId}
              emptyAction={(
                <StateMessage icon="apps" title="Monitoring is not configured yet"
                  action={<Button variant="primary" icon="plus" onClick={() => setRegistering(true)}>Register your first application</Button>}>
                  Nothing is registered, so there is nothing to monitor. Add an application’s URL and choose how it should be checked.
                </StateMessage>
              )} />
          )}
        </DataGate>
      </Card>
      <AppFormDialog open={registering} application={null} onClose={() => setRegistering(false)} onSaved={() => { appsRes.reload(); summaryRes.reload(); }} />
    </>
  );
}
