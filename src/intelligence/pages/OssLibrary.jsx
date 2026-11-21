import { useEffect, useMemo, useState } from 'react';
import { Button, Card, IconButton, SearchBox } from '../ui/primitives';
import { Badge } from '../ui/StatusBadge';
import { StateMessage } from '../ui/StateMessage';
import DataGate, { TableSkeleton } from '../ui/DataGate';
import { ConfirmDialog } from '../ui/Dialog';
import { useToast } from '../ui/Toast';
import { useResource } from '../data/useResource';
import { ossApi } from '../data/api';
import { hrefTo } from '../data/useRoute';
import { repoFor } from '../data/portfolioView';
import { LICENSE_META, MAINTENANCE_META, EFFORT_LABEL, DECISION_META, DECISION_FILTERS, verification, safeUrl } from '../data/ossView';
import OssDialog from '../components/OssDialog';

export function OssRow({ project: p, repo, onEdit, onDelete }) {
  const lic = LICENSE_META[p.licenseClass] || LICENSE_META.unknown;
  const mt = MAINTENANCE_META[p.maintenance] || MAINTENANCE_META.unknown;
  const dc = DECISION_META[p.decision] || DECISION_META.to_evaluate;
  const vf = verification(p);
  const link = safeUrl(p.url);
  return (
    <li className="ai-attn__item">
      <div className="ai-pf__badges">
        <Badge tone={dc.tone}>{dc.label}</Badge>
        <Badge tone={vf.tone} icon={vf.state === 'verified' ? 'check-circle' : 'help-circle'}>{vf.label}</Badge>
      </div>
      <div className="ai-attn__main">
        <strong>{link ? <a href={link} target="_blank" rel="noopener noreferrer">{p.name}</a> : p.name}</strong>
        {p.gap && <span className="ai-sub">Fills: {p.gap}</span>}
        <span className="ai-sub">
          <Badge tone={lic.tone} title={lic.help}>{p.license ? `${p.license} · ${lic.label}` : lic.label}</Badge>{' '}
          <Badge tone={mt.tone}>{mt.label}</Badge>{' '}
          Last release: {p.lastRelease || 'not checked'} · Effort: {EFFORT_LABEL[p.effort] || EFFORT_LABEL.unknown}
        </span>
        {p.commercialNote && <span className="ai-sub">Commercial use: {p.commercialNote}</span>}
        {p.securityNote && <span className="ai-sub">Security: {p.securityNote}</span>}
        <span className="ai-sub">{vf.text}</span>
        {p.repoName && <span className="ai-sub">For repository: {repo ? <a href={hrefTo(`/applications/${repo.id}`)}>{p.repoName}</a> : p.repoName}</span>}
      </div>
      <div className="ai-pf__actions">
        <IconButton icon="pencil" label={`Edit ${p.name}`} onClick={() => onEdit(p)} />
        <IconButton icon="trash" label={`Delete ${p.name}`} onClick={() => onDelete(p)} />
      </div>
    </li>
  );
}

export default function OssLibrary({ reposRes, route }) {
  const toast = useToast();
  const decision = DECISION_FILTERS.some((f) => f.id === route.params.decision) ? route.params.decision || '' : '';
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  const res = useResource((s) => ossApi.list({ q: dq, decision }, s), [dq, decision], { poll: false });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const repos = (reposRes.data && reposRes.data.repositories) || [];
  const repoNames = useMemo(() => repos.map((r) => r.name).sort(), [repos]);

  const remove = async () => {
    setBusy(true);
    try { await ossApi.remove(deleting.id); toast.success('Removed.'); res.reload(); setDeleting(null); }
    catch (err) { toast.error(`Not removed: ${err.message}`); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="ai-page__head">
        <div>
          <h1 className="ai-page__title">Open-source Library</h1>
          <p className="ai-page__sub">Projects that could fill a gap, with licence, maintenance and effort. Nothing is looked up automatically: every fact is “not checked” until you add a source and a date.</p>
        </div>
        <div className="ai-card__actions"><Button variant="primary" icon="plus" onClick={() => setEditing('new')}>Add project</Button></div>
      </div>
      <Card flush>
        <div className="ai-toolbar">
          <SearchBox value={q} onChange={setQ} label="Search the library" placeholder="Search by name, gap, licence or repository…" />
          <div className="ai-segment" role="group" aria-label="Decision">
            {DECISION_FILTERS.map((f) => (
              <button key={f.id || 'all'} type="button" aria-pressed={f.id === decision} onClick={() => route.replaceParams({ ...route.params, decision: f.id || undefined })}>{f.label}</button>
            ))}
          </div>
        </div>
        <DataGate res={res} what="the library" skeleton={<TableSkeleton rows={3} />}>
          {({ projects }) => projects.length ? (
            <ul className="ai-attn">{projects.map((p) => <OssRow key={p.id} project={p} repo={repoFor(repos, p.repoName)} onEdit={setEditing} onDelete={setDeleting} />)}</ul>
          ) : (
            <StateMessage icon="inbox" title={dq || decision ? 'Nothing matches' : 'The library is empty'}>
              {dq || decision ? 'Try fewer words or another filter.' : 'Add a project when you find one worth evaluating. Nothing is added or looked up for you.'}
            </StateMessage>
          )}
        </DataGate>
      </Card>
      <OssDialog open={Boolean(editing)} project={editing && editing !== 'new' ? editing : null} repoNames={repoNames} onClose={() => setEditing(null)} onSaved={() => res.reload()} />
      <ConfirmDialog open={Boolean(deleting)} title="Remove this project?" confirmLabel="Remove" danger busy={busy} onConfirm={remove} onCancel={() => setDeleting(null)}>
        {deleting && <p>“{deleting.name}” will be removed from the library. Nothing else is affected.</p>}
      </ConfirmDialog>
    </>
  );
}
