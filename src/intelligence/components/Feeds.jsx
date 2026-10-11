import Icon from '../ui/Icon';
import { Badge, IncidentStatusBadge, SeverityBadge } from '../ui/StatusBadge';
import { absoluteTime, relativeTime, formatDuration } from '../data/format';
import { OUTCOME_META } from '../data/statusMeta';
import { hrefTo } from '../data/useRoute';

export function incidentTitle(item) {
  if (item.kind === 'monitoring') return 'Monitoring service could not run a check';
  if (item.reason === 'slow_response' || item.severity === 'warning') return item.failureCount >= 3 ? `Degraded for ${item.failureCount} checks in a row` : 'Degraded performance';
  return `Health check failed ${item.failureCount === 1 ? 'once' : item.failureCount === 2 ? 'twice' : item.failureCount === 3 ? 'three times' : `${item.failureCount} times`} in a row`;
}

/** Compact incident list used on the Overview and application pages. */
export function IncidentFeed({ items, showApp = true }) {
  return (
    <ul className="ai-list">
      {items.map((i) => {
        const open = i.status === 'open';
        const tone = i.kind === 'monitoring' ? 'neutral' : open ? (i.severity === 'critical' ? 'bad' : 'warn') : 'ok';
        const icon = i.kind === 'monitoring' ? 'wrench' : open ? 'alert-triangle' : 'check-circle';
        return (
          <li key={`${i.kind}-${i.id}`}>
            <span className={`ai-dot ai-dot--${tone}`}><Icon name={icon} size={14} /></span>
            <div className="ai-list__main">
              <div className="ai-list__title">
                {showApp && <a href={hrefTo(`/applications/${encodeURIComponent(i.applicationId)}`)}>{i.applicationName}</a>}
                <IncidentStatusBadge item={i} />
                {i.kind !== 'monitoring' && <SeverityBadge severity={i.severity} />}
              </div>
              <div className="ai-list__meta">{incidentTitle(i)}. {i.summary}</div>
              <div className="ai-list__meta">
                Detected <time dateTime={i.firstDetectedAt} title={absoluteTime(i.firstDetectedAt)}>{relativeTime(i.firstDetectedAt)}</time>
                {i.resolvedAt && <> · Recovered <time dateTime={i.resolvedAt} title={absoluteTime(i.resolvedAt)}>{relativeTime(i.resolvedAt)}</time> (after {formatDuration(i.firstDetectedAt, i.resolvedAt)})</>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function checkLine(c) {
  const bits = [];
  if (c.httpStatus) bits.push(`HTTP ${c.httpStatus}`);
  if (c.responseMs !== null && c.responseMs !== undefined) bits.push(`${c.responseMs} ms`);
  return bits.join(' · ');
}

/** Latest individual checks, so "is monitoring actually running?" is answerable. */
export function ActivityFeed({ checks, showApp = true }) {
  return (
    <ul className="ai-list">
      {checks.map((c) => {
        const meta = OUTCOME_META[c.outcome] || OUTCOME_META.inconclusive;
        return (
          <li key={c.id}>
            <span className={`ai-dot ai-dot--${meta.tone}`}><Icon name={meta.icon} size={14} /></span>
            <div className="ai-list__main">
              <div className="ai-list__title">
                {showApp && <a href={hrefTo(`/applications/${encodeURIComponent(c.applicationId)}`)}>{c.applicationName}</a>}
                <Badge tone={meta.tone}>{meta.label}</Badge>
                {c.trigger !== 'scheduled' && <span className="ai-tag">{c.trigger === 'manual' ? 'Run manually' : 'First check'}</span>}
              </div>
              <div className="ai-list__meta">{c.summary ? `${c.summary}${c.responseMs != null ? ` (${c.responseMs} ms)` : ''}` : checkLine(c) || 'Check completed.'}</div>
            </div>
            <time className="ai-list__time" dateTime={c.checkedAt} title={absoluteTime(c.checkedAt)}>{relativeTime(c.checkedAt)}</time>
          </li>
        );
      })}
    </ul>
  );
}
