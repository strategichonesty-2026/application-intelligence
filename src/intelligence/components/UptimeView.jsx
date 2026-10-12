import { useState } from 'react';
import { Button, Card } from '../ui/primitives';
import { StateMessage } from '../ui/StateMessage';
import DataGate, { TableSkeleton } from '../ui/DataGate';
import { useResource } from '../data/useResource';
import { monitoringApi } from '../data/api';

const BAR_W = 12; const GAP = 3; const H = 44;

// Each bar is one day. Height = share of checks that got an answer. A day with no checks is a dotted outline
// (never drawn as 100%). Failed days are labelled in the hover text and in the summary line, not by colour alone.
function Strip({ app }) {
  const w = app.days.length * (BAR_W + GAP);
  return (
    <svg role="img" width="100%" viewBox={`0 0 ${w} ${H}`} preserveAspectRatio="none" style={{ maxWidth: w * 1.6, height: H }}
      aria-label={`${app.name}: ${app.uptimePct === null ? 'no checks in this period' : `${app.uptimePct}% of ${app.checks} checks answered`}`}>
      {app.days.map((d, i) => {
        const x = i * (BAR_W + GAP);
        const title = d.uptimePct === null ? `${d.date}: no checks` : `${d.date}: ${d.answered} answered, ${d.failed} failed (${d.uptimePct}%)`;
        if (d.uptimePct === null) return <rect key={d.date} x={x} y={H - 6} width={BAR_W} height={6} rx={2} fill="none" stroke="currentColor" strokeOpacity="0.35" strokeDasharray="2 2"><title>{title}</title></rect>;
        const h = Math.max(4, (d.uptimePct / 100) * H);
        return <rect key={d.date} x={x} y={H - h} width={BAR_W} height={h} rx={2} fill={d.failed ? 'var(--ai-bad-fg, #b42318)' : 'var(--ai-ok-fg, #067647)'}><title>{title}</title></rect>;
      })}
    </svg>
  );
}

/** Uptime per application from recorded checks only. */
export default function UptimeView() {
  const [days, setDays] = useState(30);
  const res = useResource((s) => monitoringApi.uptime(days, s), [days], { poll: false });
  return (
    <Card title="Uptime" subtitle="Is each app answering? One bar per day, from the checks that were actually run. Dotted = no check that day (not counted as up)."
      actions={<span style={{ display: 'flex', gap: 6 }}><Button size="sm" variant={days === 7 ? 'primary' : undefined} onClick={() => setDays(7)}>7 days</Button><Button size="sm" variant={days === 30 ? 'primary' : undefined} onClick={() => setDays(30)}>30 days</Button></span>}>
      <DataGate res={res} what="uptime" skeleton={<TableSkeleton rows={3} />}>
        {(u) => !u.applications.length
          ? <StateMessage icon="apps" compact title="No applications yet">Register an application and run a check to start the graph.</StateMessage>
          : (
            <>
              <p style={{ margin: '0 0 12px' }}>
                {u.overall.uptimePct === null ? 'No checks in this period yet. Click "Check all" on the Applications page.'
                  : <>Overall: <strong>{u.overall.uptimePct}%</strong> of {u.overall.checks} checks answered{u.overall.failed ? `, ${u.overall.failed} failed` : ''}.</>}
              </p>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {u.applications.map((a) => (
                  <li key={a.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <strong>{a.name}</strong>
                      <span className="ai-muted">{a.uptimePct === null ? 'No checks yet' : `${a.uptimePct}% · ${a.checks} checks${a.failed ? ` · ${a.failed} failed` : ''}`}</span>
                    </div>
                    <Strip app={a} />
                  </li>
                ))}
              </ul>
              <p className="ai-field__hint" style={{ marginTop: 12 }}>Checks run only when you click "Check now" / "Check all" (or on the daily schedule if you turned it on), so a percentage describes the checks that happened, not every minute. Records are kept for 30 days. Visitor and login counts are not here: the apps do not send them yet.</p>
            </>
          )}
      </DataGate>
    </Card>
  );
}
