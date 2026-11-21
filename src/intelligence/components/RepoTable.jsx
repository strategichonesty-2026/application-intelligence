import { useMemo, useState } from 'react';
import { Select, SearchBox } from '../ui/primitives';
import { Badge } from '../ui/StatusBadge';
import { StateMessage } from '../ui/StateMessage';
import { hrefTo } from '../data/useRoute';
import { KIND_LABEL, ACTIVITY_META, DEPLOY_META, TYPE_FILTERS, PRIORITY_FILTERS, priorityMeta, healthMeta, daysText, filterRepos, sortRepos } from '../data/repoView';

export function PriorityBadge({ priority }) {
  const m = priorityMeta(priority);
  return m ? <Badge tone={m.tone}>{m.label}</Badge> : <span className="ai-muted">Not set</span>;
}

/** Every repository with its three signals in separate columns. Presentation only. */
export default function RepoTable({ repos, needType, initialType = 'all' }) {
  const [type, setType] = useState(TYPE_FILTERS.some((t) => t.value === initialType) ? initialType : 'all');
  const [priority, setPriority] = useState('all');
  const [q, setQ] = useState('');
  const rows = useMemo(() => sortRepos(filterRepos(repos, { type, priority, q })), [repos, type, priority, q]);

  if (!repos.length) {
    return <StateMessage icon="inbox" title="No repositories yet">Press “Sync now” to read your repositories from GitHub. Nothing is shown until a sync has run.</StateMessage>;
  }
  return (
    <>
      {needType > 0 && (
        <div className="ai-note" role="status">
          <strong>{needType} {needType === 1 ? 'repository needs' : 'repositories need'} a confirmed type.</strong> Types are suggested from the files; only confirmed applications and services get health checks.
        </div>
      )}
      <div className="ai-toolbar">
        <SearchBox value={q} onChange={setQ} label="Search repositories" placeholder="Search name, purpose or stack" />
        <Select label="Type" value={type} onChange={setType} options={TYPE_FILTERS} />
        <Select label="Priority" value={priority} onChange={setPriority} options={PRIORITY_FILTERS} />
        <div className="ai-toolbar__spacer" />
        <span className="ai-muted">{rows.length} of {repos.length}</span>
      </div>
      <div className="ai-tablewrap">
        <table className="ai-table ai-table--cards">
          <thead>
            <tr><th>Repository</th><th>Type</th><th>Priority</th><th>Repository activity</th><th>Deployment</th><th>Health</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const act = ACTIVITY_META[r.activity.state] || ACTIVITY_META.unknown;
              const dep = DEPLOY_META[r.deployment.state] || DEPLOY_META.unknown;
              const hl = healthMeta(r.health.state);
              return (
                <tr key={r.id}>
                  <td className="ai-cell-first ai-cell-app">
                    <a href={hrefTo(`/applications/${r.id}`)}><strong>{r.name}</strong></a>
                    <span className="ai-sub">{r.purpose.value || 'No description yet'}</span>
                  </td>
                  <td data-label="Type">
                    {r.type.value ? <Badge tone={r.type.confirmed ? 'ok' : 'neutral'} title={r.type.evidence}>{KIND_LABEL[r.type.value]}{r.type.confirmed ? '' : ' (suggested)'}</Badge> : <Badge tone="warn">Needs a type</Badge>}
                  </td>
                  <td data-label="Priority"><PriorityBadge priority={r.priority} /></td>
                  <td data-label="Activity"><Badge tone={act.tone} icon={act.icon}>{act.label}</Badge>{r.activity.days !== null && <span className="ai-sub">pushed {daysText(r.activity.days)}</span>}</td>
                  <td data-label="Deployment"><Badge tone={dep.tone} icon={dep.icon} title={r.deployment.evidence}>{dep.label}</Badge>{r.deployment.platform && <span className="ai-sub">{r.deployment.platform}</span>}</td>
                  <td data-label="Health"><Badge tone={hl.tone} icon={hl.icon} title={r.health.note}>{hl.label}</Badge></td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={6} className="ai-muted">No repository matches these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
