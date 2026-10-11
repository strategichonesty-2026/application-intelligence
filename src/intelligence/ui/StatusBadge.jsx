import Icon from './Icon';
import { Tip } from './primitives';
import { statusMetaFor, OUTCOME_META, SEVERITY_META } from '../data/statusMeta';

// Icon + text, always. Colour reinforces the meaning but never carries it alone.
export function Badge({ tone = 'neutral', icon, children, title }) {
  return (
    <span className={`ai-badge ai-badge--${tone}`} title={title}>
      {icon && <Icon name={icon} size={14} />}
      <span>{children}</span>
    </span>
  );
}

export function StatusBadge({ app, withHelp = false }) {
  const meta = statusMetaFor(app);
  const badge = <Badge tone={meta.tone} icon={meta.icon}>{meta.label}</Badge>;
  return withHelp ? <Tip text={meta.help}>{badge}</Tip> : badge;
}

export function OutcomeBadge({ outcome }) {
  const meta = OUTCOME_META[outcome] || OUTCOME_META.inconclusive;
  return <Badge tone={meta.tone} icon={meta.icon}>{meta.label}</Badge>;
}

export function SeverityBadge({ severity }) {
  const meta = SEVERITY_META[severity] || SEVERITY_META.warning;
  return <Badge tone={meta.tone} icon={meta.icon}>{meta.label}</Badge>;
}

export function IncidentStatusBadge({ item }) {
  if (item.kind === 'monitoring') return <Badge tone="neutral" icon="wrench">Monitoring service</Badge>;
  return item.status === 'open'
    ? <Badge tone="bad" icon="alert-triangle">Open</Badge>
    : <Badge tone="ok" icon="check-circle">Resolved</Badge>;
}
