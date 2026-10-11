import { Banner } from '../ui/StateMessage';
import { hrefTo } from '../data/useRoute';

/** Page-level warnings that change how much to trust the numbers below them. */
export default function MonitoringBanners({ summary, apps }) {
  if (!summary || !apps) return null;
  const out = [];
  const h = summary.monitoring && summary.monitoring.health;
  if (h && h.state === 'stalled') {
    out.push(
      <Banner key="svc" tone="bad" icon="wrench">
        <strong>The daily check has not completed for over 36 hours.</strong> The last one finished {new Date(h.lastCycleCompletedAt).toLocaleString()}.
        Statuses below may be out of date. You can still click Check all. This is a monitoring-service problem, not necessarily an application failure.
      </Banner>,
    );
  }
  if (h && h.state === 'never_ran') {
    out.push(
      <Banner key="svc" tone="bad" icon="wrench">
        <strong>The daily check is switched on, but it has never completed.</strong> Make sure the API server is running at the scheduled hour. You can still click Check all.
      </Banner>,
    );
  }
  const stale = apps.filter((a) => a.status === 'stale');
  if (stale.length) {
    out.push(
      <Banner key="stale" tone="warn" icon="clock">
        <strong>{stale.length === 1 ? '1 application has' : `${stale.length} applications have`} stale monitoring data</strong> ({stale.slice(0, 3).map((a) => a.name).join(', ')}{stale.length > 3 ? '…' : ''}).
        {' '}Their last result is shown as stale, not as current.{' '}
        <a href={hrefTo('/applications', { status: 'stale' })}>View stale applications</a>
      </Banner>,
    );
  }
  const faults = apps.filter((a) => a.monitoringFault);
  if (faults.length) {
    out.push(
      <Banner key="fault" tone="warn" icon="wrench">
        <strong>The monitoring service failed to check {faults.length === 1 ? faults[0].name : `${faults.length} applications`}.</strong>{' '}
        That is a monitoring problem, so no application failure is being reported for {faults.length === 1 ? 'it' : 'them'}.{' '}
        <a href={hrefTo('/health', { kind: 'monitoring' })}>See monitoring-service faults</a>
      </Banner>,
    );
  }
  return out.length ? <>{out}</> : null;
}
