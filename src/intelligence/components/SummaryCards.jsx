import { hrefTo } from '../data/useRoute';
import Icon from '../ui/Icon';

function Stat({ label, value, note, tone, href, hint }) {
  const body = (
    <>
      <div className="ai-stat__label">
        <span>{label}</span>
        {href && <Icon name="chevron-right" size={14} />}
      </div>
      <div className="ai-stat__value">{value}</div>
      <div className="ai-stat__note">{note}</div>
    </>
  );
  const cls = `ai-stat ai-stat--${tone}`;
  // A card is a link only when there is a meaningful filtered view behind it.
  return href ? <a className={cls} href={href} aria-label={`${label}: ${value}. ${hint}`}>{body}</a> : <div className={cls}>{body}</div>;
}

/** Counts come straight from /summary. Nothing is derived or defaulted here. */
export default function SummaryCards({ counts }) {
  const none = counts.total === 0;
  return (
    <div className="ai-summary" role="group" aria-label="Summary">
      <Stat label="Registered applications" value={counts.total} tone="neutral"
        note={none ? 'Nothing is monitored yet' : counts.paused ? `${counts.paused} paused` : 'All are monitored'}
        href={none ? null : hrefTo('/applications')} hint="View all applications." />
      <Stat label="Healthy" value={counts.healthy} tone="ok"
        note={counts.reachableOnly ? `${counts.reachableOnly} reachable only: health not verified` : none ? '' : `verified healthy, of ${counts.total} registered`}
        href={counts.healthy ? hrefTo('/applications', { status: 'healthy' }) : null} hint="View healthy applications." />
      <Stat label="Requiring attention" value={counts.attention} tone={counts.attention ? 'warn' : 'neutral'}
        note={counts.attention ? 'Degraded, unavailable, stale, or a failed check' : none ? '' : 'None right now'}
        href={counts.attention ? hrefTo('/applications', { status: 'attention' }) : null} hint="View applications that need attention." />
      <Stat label="Active incidents" value={counts.activeIncidents} tone={counts.activeIncidents ? 'bad' : 'neutral'}
        note={counts.activeIncidents ? 'Opened after 3 failed checks in a row' : none ? '' : 'No open incidents'}
        href={counts.activeIncidents ? hrefTo('/health', { status: 'open' }) : null} hint="View open incidents." />
    </div>
  );
}
