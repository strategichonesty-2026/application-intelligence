import { useEffect, useMemo, useState } from 'react';
import { Button, Card, IconButton, SearchBox } from '../ui/primitives';
import { Badge } from '../ui/StatusBadge';
import { StateMessage } from '../ui/StateMessage';
import DataGate, { TableSkeleton } from '../ui/DataGate';
import { ConfirmDialog } from '../ui/Dialog';
import { useToast } from '../ui/Toast';
import { useResource } from '../data/useResource';
import { portfolioApi } from '../data/api';
import { hrefTo } from '../data/useRoute';
import { absoluteTime } from '../data/format';
import { TABS, tabById, TYPE_LABEL, STATUS_LABEL, LEVEL_META, EVIDENCE_META, repoFor } from '../data/portfolioView';
import PortfolioDialog from '../components/PortfolioDialog';
import PortfolioImport from '../components/PortfolioImport';

export function PortfolioRow({ item, repo, onEdit, onDelete }) {
  const ev = EVIDENCE_META[item.evidenceLevel] || EVIDENCE_META.unverified;
  const lv = item.level ? LEVEL_META[item.level] : null;
  return (
    <li className="ai-attn__item">
      <div className="ai-pf__badges">
        <span className="ai-tag">{TYPE_LABEL[item.type]}</span>
        {lv && <Badge tone={lv.tone}>{lv.label}</Badge>}
      </div>
      <div className="ai-attn__main">
        <strong>{item.title}</strong>
        {item.body && <span className="ai-sub">{item.body}</span>}
        <span className="ai-sub">
          <Badge tone={ev.tone} icon={ev.icon} title={ev.help}>{ev.label}</Badge>{' '}
          {item.evidence ? `Evidence: ${item.evidence}` : 'No evidence recorded'}
          {item.evidenceCheckedAt ? <> · checked <time dateTime={item.evidenceCheckedAt} title={absoluteTime(`${item.evidenceCheckedAt}T00:00:00`)}>{item.evidenceCheckedAt}</time></> : ' · never checked'}
          {' · '}{STATUS_LABEL[item.status]}{item.source === 'import' ? ' · imported' : ''}
        </span>
        {item.repoName && <span className="ai-sub">Repository: {repo ? <a href={hrefTo(`/applications/${repo.id}`)}>{item.repoName}</a> : item.repoName}</span>}
      </div>
      <div className="ai-pf__actions">
        <IconButton icon="pencil" label={`Edit ${item.title}`} onClick={() => onEdit(item)} />
        <IconButton icon="trash" label={`Delete ${item.title}`} onClick={() => onDelete(item)} />
      </div>
    </li>
  );
}

export default function Portfolio({ reposRes, route }) {
  const toast = useToast();
  const tab = tabById(route.params.tab);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  const res = useResource((s) => portfolioApi.list({ type: tab.types.join(','), q: dq }, s), [tab.id, dq], { poll: false });
  const [editing, setEditing] = useState(null); // null | 'new' | item
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const repos = useMemo(() => (reposRes.data && reposRes.data.repositories) || [], [reposRes.data]);
  const repoNames = useMemo(() => repos.map((r) => r.name).sort(), [repos]);

  const remove = async () => {
    setBusy(true);
    try { await portfolioApi.remove(deleting.id); toast.success('Removed.'); res.reload(); setDeleting(null); }
    catch (err) { toast.error(`Not removed: ${err.message}`); } finally { setBusy(false); }
  };
  const countOf = (t) => (res.data ? t.types.length ? t.types.reduce((n, k) => n + (res.data.counts[k] || 0), 0) : Object.values(res.data.counts).reduce((a, b) => a + b, 0) : null);

  return (
    <>
      <div className="ai-page__head">
        <div>
          <h1 className="ai-page__title">Portfolio</h1>
          <p className="ai-page__sub">Decisions, risks, opportunities and ideas in one searchable place. Each item shows its evidence and when it was checked.</p>
        </div>
        <div className="ai-card__actions">
          <Button icon="plus" onClick={() => setImporting(true)}>Import</Button>
          <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>Add item</Button>
        </div>
      </div>
      <Card flush>
        <div className="ai-toolbar">
          <SearchBox value={q} onChange={setQ} label="Search the portfolio" placeholder="Search decisions, risks, ideas, repositories…" />
          <div className="ai-segment" role="group" aria-label="Kind of item">
            {TABS.map((t) => (
              <button key={t.id} type="button" aria-pressed={t.id === tab.id} onClick={() => route.replaceParams({ ...route.params, tab: t.id === 'all' ? undefined : t.id })}>
                {t.label}{countOf(t) !== null ? ` (${countOf(t)})` : ''}
              </button>
            ))}
          </div>
        </div>
        <DataGate res={res} what="the portfolio" skeleton={<TableSkeleton rows={4} />}>
          {({ items, counts }) => items.length ? (
            <ul className="ai-attn">
              {items.map((i) => <PortfolioRow key={i.id} item={i} repo={repoFor(repos, i.repoName)} onEdit={setEditing} onDelete={setDeleting} />)}
            </ul>
          ) : (
            <StateMessage icon="inbox" title={dq ? 'Nothing matches your search' : Object.values(counts).some(Boolean) ? 'Nothing in this view' : 'The portfolio is empty'}>
              {dq ? 'Try fewer or different words.' : Object.values(counts).some(Boolean) ? 'Choose another tab, or add an item.' : 'Add decisions, risks and ideas one at a time, or paste a list with Import. Nothing is added automatically.'}
            </StateMessage>
          )}
        </DataGate>
      </Card>
      <PortfolioDialog open={Boolean(editing)} item={editing && editing !== 'new' ? editing : null} repoNames={repoNames} onClose={() => setEditing(null)} onSaved={() => res.reload()} />
      <PortfolioImport open={importing} onClose={() => setImporting(false)} onDone={() => res.reload()} />
      <ConfirmDialog open={Boolean(deleting)} title="Remove this item?" confirmLabel="Remove" danger busy={busy} onConfirm={remove} onCancel={() => setDeleting(null)}>
        {deleting && <p>“{deleting.title}” will be removed from the portfolio. Nothing else is affected.</p>}
      </ConfirmDialog>
    </>
  );
}
