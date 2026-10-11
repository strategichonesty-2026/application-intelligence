import Icon from './Icon';
import { Button } from './primitives';

// One component for every "nothing to show" situation so each of them says what
// happened and what to do next, instead of being a blank area.
export function StateMessage({ icon = 'info', tone = 'neutral', title, children, action, compact = false, role }) {
  return (
    <div className={`ai-state ai-state--${tone} ${compact ? 'ai-state--compact' : ''}`} role={role}>
      <span className="ai-state__icon"><Icon name={icon} size={compact ? 20 : 26} /></span>
      <h3 className="ai-state__title">{title}</h3>
      {children && <p className="ai-state__text">{children}</p>}
      {action && <div className="ai-state__action">{action}</div>}
    </div>
  );
}

// Inline notice above content (stale data, failed refresh, sample data).
export function Banner({ tone = 'info', icon, children, action }) {
  const defaultIcon = { info: 'info', warn: 'alert-triangle', bad: 'x-circle', ok: 'check-circle' }[tone];
  return (
    <div className={`ai-banner ai-banner--${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <Icon name={icon || defaultIcon} size={18} />
      <div className="ai-banner__text">{children}</div>
      {action}
    </div>
  );
}

// Maps an ApiError to the right full-panel message.
export function ApiErrorState({ error, onRetry, what = 'monitoring data' }) {
  const retry = onRetry ? <Button icon="refresh" onClick={onRetry}>Try again</Button> : null;
  if (error.kind === 'auth') {
    return (
      <StateMessage icon="lock" tone="warn" title="Authentication required" action={retry}>
        The dashboard was not allowed to read {what}. The API key this site was built with is missing or no longer valid.
        Ask the platform owner to check the deployment’s API key settings, then try again.
      </StateMessage>
    );
  }
  if (error.kind === 'unconfigured') {
    return <StateMessage icon="lock" tone="warn" title="Sign-in is not configured" action={retry}>{error.message} The server owner must set the sign-in variables, then try again.</StateMessage>;
  }
  if (error.kind === 'notfound') {
    return <StateMessage icon="search" title="Not found" action={retry}>{error.message}</StateMessage>;
  }
  return (
    <StateMessage icon="wifi-off" tone="bad" title="Dashboard API unavailable" role="alert" action={retry}>
      The dashboard could not load {what}: {error.message} This is a problem reaching the monitoring service, not necessarily with your applications.
      Applications are not shown as healthy while this is the case.
    </StateMessage>
  );
}
