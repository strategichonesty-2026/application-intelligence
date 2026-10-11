import { Skeleton } from './primitives';
import { ApiErrorState, Banner } from './StateMessage';
import { Button } from './primitives';
import { absoluteTime, clockTime } from '../data/format';

export function TableSkeleton({ rows = 4 }) {
  return (
    <div className="ai-skeleton-rows" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <Skeleton width="28%" height={14} /><Skeleton width={80} height={20} /><Skeleton width="14%" height={14} /><Skeleton width="14%" height={14} /><Skeleton width="20%" height={14} />
        </div>
      ))}
      <span className="ai-visually-hidden">Loading monitoring data…</span>
    </div>
  );
}

/**
 * Standard handling of a useResource result:
 *  first load -> skeleton, failure with nothing to show -> explanatory error,
 *  failed refresh with data on screen -> keep the data and say it is old.
 */
export default function DataGate({ res, skeleton = <TableSkeleton />, what, children }) {
  if (res.loading && !res.data) return skeleton;
  if (!res.data) return res.error ? <ApiErrorState error={res.error} onRetry={res.reload} what={what} /> : skeleton;
  return (
    <>
      {res.error && (
        <Banner tone="warn" action={<Button size="sm" icon="refresh" onClick={res.reload}>Retry</Button>}>
          Could not refresh {what || 'monitoring data'} ({res.error.message}) Showing the last data received at{' '}
          <time dateTime={res.loadedAt} title={absoluteTime(res.loadedAt)}>{clockTime(res.loadedAt)}</time>.
        </Banner>
      )}
      {children(res.data)}
    </>
  );
}
