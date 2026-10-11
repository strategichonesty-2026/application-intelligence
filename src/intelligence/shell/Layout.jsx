import { useEffect, useRef, useState } from 'react';
import Icon from '../ui/Icon';
import { Button } from '../ui/primitives';
import { hrefTo } from '../data/useRoute';
import { absoluteTime, clockTime, relativeTime } from '../data/format';
import { useDashboardClock } from '../data/DashboardContext';
import { sampleScenario, signOut } from '../data/api';

// Phase 1 only. Later phases add entries here; nothing unfinished is listed.
const NAV = [
  { id: '', label: 'Overview', icon: 'dashboard' },
  { id: 'applications', label: 'Applications', icon: 'apps' },
  { id: 'health', label: 'System Health', icon: 'activity' },
  { id: 'secrets', label: 'Secrets & Subscriptions', icon: 'lock' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export const isCurrent = (section, navId) => (navId === '' ? section === '' : section === navId);

function AccountMenu({ environment }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="ai-menu" ref={ref}>
      <button type="button" className="ai-avatar" aria-label="Account and access" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        <Icon name="user" size={18} />
      </button>
      {open && (
        <div className="ai-menu__panel">
          <h3>Application owner</h3>
          <p>Signed in with the owner password. Sessions are short-lived and end when the tab closes. Individual user accounts are not part of Phase 1.</p>
          <dl>
            <dt>Environment</dt><dd>{environment || 'Unknown'}</dd>
            <dt>Access</dt><dd>Owner sign-in</dd>
          </dl>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="sm" icon="settings" onClick={() => { window.location.hash = hrefTo('/settings'); setOpen(false); }}>Open settings</Button>
            <Button size="sm" onClick={() => { setOpen(false); signOut(); }}>Sign out</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Layout({ section, summary, lastSuccessAt, children }) {
  const { refresh, lastLoadedAt, pollMs } = useDashboardClock();
  const [refreshing, setRefreshing] = useState(false);
  const environment = summary && summary.environment;
  const sample = sampleScenario();

  const doRefresh = () => { setRefreshing(true); refresh(); setTimeout(() => setRefreshing(false), 700); };

  const stamps = (
    <>
      <div className="ai-stamp">
        <span>Last successful check</span>
        <strong title={lastSuccessAt ? absoluteTime(lastSuccessAt) : ''}>{lastSuccessAt ? relativeTime(lastSuccessAt) : 'None yet'}</strong>
      </div>
      <div className="ai-stamp">
        <span>Dashboard refreshed{pollMs ? ` (auto, ${pollMs >= 60000 ? `${pollMs / 60000} min` : `${pollMs / 1000} s`})` : ' (manual)'}</span>
        <strong title={lastLoadedAt ? absoluteTime(lastLoadedAt) : ''}>{lastLoadedAt ? clockTime(lastLoadedAt) : '—'}</strong>
      </div>
    </>
  );

  return (
    <>
      <a className="ai-skip" href="#ai-main" onClick={(e) => { e.preventDefault(); document.getElementById('ai-main').focus(); }}>Skip to content</a>
      <aside className="ai-sidebar">
        <div className="ai-brand"><span className="ai-brand__mark"><Icon name="activity" size={16} /></span>Application Intelligence</div>
        <nav className="ai-nav" aria-label="Primary">
          {NAV.map((n) => (
            <a key={n.id} href={hrefTo(n.id ? `/${n.id}` : '')} aria-current={isCurrent(section, n.id) ? 'page' : undefined}>
              <Icon name={n.icon} size={18} />{n.label}
            </a>
          ))}
        </nav>
        <div className="ai-sidebar__foot">
          <span>Application Intelligence</span>
          <div>Phase 1 · Availability monitoring</div>
        </div>
      </aside>
      <div className="ai-main">
        <header className="ai-header">
          <span className="ai-header__title">Application Intelligence</span>
          {environment && <span className={`ai-env ai-env--${environment}`} title="Environment this console is monitoring from"><Icon name="server" size={13} />{environment}</span>}
          <div className="ai-header__spacer" />
          <div className="ai-stamps">{stamps}</div>
          <Button size="sm" icon="refresh" onClick={doRefresh} loading={refreshing} aria-label="Refresh dashboard now">Refresh</Button>
          <AccountMenu environment={environment} />
        </header>
        <main id="ai-main" className="ai-content" tabIndex={-1}>
          <div className="ai-page">
            <div className="ai-stamps-mobile">{stamps}</div>
            {sample && (
              <div className="ai-banner ai-banner--warn" role="status">
                <Icon name="alert-triangle" size={18} />
                <div className="ai-banner__text"><strong>Sample data.</strong> Scenario “{sample}” uses fictional development fixtures. None of these results come from real monitoring.</div>
              </div>
            )}
            {children}
          </div>
        </main>
      </div>
      <nav className="ai-mobnav" aria-label="Primary mobile">
        {NAV.map((n) => (
          <a key={n.id} href={hrefTo(n.id ? `/${n.id}` : '')} aria-current={isCurrent(section, n.id) ? 'page' : undefined}>
            <Icon name={n.icon} size={20} />{n.label}
          </a>
        ))}
      </nav>
    </>
  );
}
