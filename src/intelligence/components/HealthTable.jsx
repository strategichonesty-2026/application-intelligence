import { useMemo, useState, useEffect } from 'react';
import Icon from '../ui/Icon';
import { Button, LinkButton, Select, SearchBox, Tip } from '../ui/primitives';
import { StatusBadge } from '../ui/StatusBadge';
import { StateMessage } from '../ui/StateMessage';
import { absoluteTime, relativeTime, formatMs, hostOf, DASH } from '../data/format';
import { STATUS_FILTERS, STATUS_RANK, matchesStatusFilter } from '../data/statusMeta';
import { hrefTo } from '../data/useRoute';

const PAGE_SIZE = 25;

const COLUMNS = [
  { key: 'name', label: 'Application' },
  { key: 'status', label: 'Status' },
  { key: 'lastCheckedAt', label: 'Last checked' },
  { key: 'lastSuccessAt', label: 'Last successful check' },
  { key: 'responseMs', label: 'Response time', num: true },
  { key: 'incident', label: 'Latest incident' },
];

function sortValue(app, key) {
  switch (key) {
    case 'name': return app.name.toLowerCase();
    case 'status': return STATUS_RANK[app.status] ?? 9;
    case 'incident': return app.latestIncident ? new Date(app.latestIncident.firstDetectedAt).getTime() : 0;
    default: return app[key] ? (typeof app[key] === 'number' ? app[key] : new Date(app[key]).getTime()) : null;
  }
}

function Time({ iso, empty = 'Never' }) {
  if (!iso) return <span className="ai-muted">{empty}</span>;
  return <time dateTime={iso} title={absoluteTime(iso)}>{relativeTime(iso)}</time>;
}

function IncidentCell({ incident }) {
  if (!incident) return <span className="ai-muted">None recorded</span>;
  const open = incident.status === 'open';
  return (
    <div className="ai-incident-cell">
      <span title={incident.summary}>{open ? 'Open: ' : 'Resolved: '}{incident.summary}</span>
      <span className="ai-sub">{open ? 'Detected ' : 'Detected '}<Time iso={incident.firstDetectedAt} /></span>
    </div>
  );
}

/**
 * The primary monitoring view. Presentation only: it receives applications that
 * already carry a derived status and applies filter/sort/page on them.
 */
export default function HealthTable({ apps, filters, onFilters, emptyAction, onCheck, checkingId }) {
  const [sort, setSort] = useState({ key: 'status', dir: 'asc' });
  const [page, setPage] = useState(1);
  const status = filters.status || 'all';
  const env = filters.env || 'all';
  const q = filters.q || '';

  useEffect(() => { setPage(1); }, [status, env, q]);

  const environments = useMemo(() => [...new Set(apps.map((a) => a.environment))].sort(), [apps]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = apps.filter((a) =>
      matchesStatusFilter(a, status) && (env === 'all' || a.environment === env) &&
      (!needle || a.name.toLowerCase().includes(needle)));
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sort.key); const bv = sortValue(b, sort.key);
      if (av === null && bv === null) return a.name.localeCompare(b.name);
      if (av === null) return 1; // missing values always last
      if (bv === null) return -1;
      return (av < bv ? -1 : av > bv ? 1 : a.name.localeCompare(b.name)) * dir;
    });
  }, [apps, status, env, q, sort]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const filtered = status !== 'all' || env !== 'all' || q.trim() !== '';

  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'status' ? 'asc' : 'desc' }));

  return (
    <div>
      <div className="ai-toolbar" role="search" aria-label="Filter applications">
        <SearchBox value={q} onChange={(v) => onFilters({ q: v })} label="Search applications by name" placeholder="Search by application name" />
        <Select label="Status" value={status} onChange={(v) => onFilters({ status: v })} options={STATUS_FILTERS} />
        <Select label="Environment" value={env} onChange={(v) => onFilters({ env: v })}
          options={[{ value: 'all', label: 'All environments' }, ...environments.map((e) => ({ value: e, label: e[0].toUpperCase() + e.slice(1) }))]} />
        {filtered && <Button variant="ghost" size="sm" icon="x" onClick={() => onFilters({ status: 'all', env: 'all', q: '' })}>Clear filters</Button>}
      </div>

      {rows.length === 0 ? (
        filtered ? (
          <StateMessage icon="search" title="No applications match these filters" compact
            action={<Button onClick={() => onFilters({ status: 'all', env: 'all', q: '' })}>Clear filters</Button>}>
            {q.trim() ? `Nothing is named like “${q.trim()}”` : 'No application has this status'}{env !== 'all' ? ` in ${env}` : ''}. Check the spelling or widen the filters.
          </StateMessage>
        ) : emptyAction
      ) : (
        <>
          <div className="ai-tablewrap">
            <table className="ai-table ai-table--cards">
              <caption className="ai-visually-hidden">Application health, {rows.length} applications</caption>
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} scope="col" className={c.num ? 'ai-num' : ''}
                      aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button type="button" onClick={() => toggleSort(c.key)}>
                        {c.label}
                        <Icon name={sort.key === c.key ? (sort.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'chevrons-up-down'} size={12} />
                      </button>
                    </th>
                  ))}
                  <th scope="col" className="ai-num">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.id}>
                    <td className="ai-cell-first">
                      <div className="ai-cell-app">
                        <a href={hrefTo(`/applications/${encodeURIComponent(a.id)}`)}>{a.name}</a>
                        <small><span className="ai-tag">{a.environment}</span> {hostOf(a.url)}</small>
                      </div>
                    </td>
                    <td data-label="Status">
                      <StatusBadge app={a} withHelp />
                      <span className="ai-sub">{a.check.typeLabel}</span>
                    </td>
                    <td data-label="Last checked"><Time iso={a.lastCheckedAt} empty="Not yet" /></td>
                    <td data-label="Last successful"><Time iso={a.lastSuccessAt} empty="Never" /></td>
                    <td data-label="Response time" className="ai-num">
                      {a.responseMs === null || a.responseMs === undefined
                        ? <Tip text="No response was received on the latest check, so no time was measured."><span className="ai-muted">{DASH}</span></Tip>
                        : formatMs(a.responseMs)}
                    </td>
                    <td data-label="Latest incident"><IncidentCell incident={a.latestIncident} /></td>
                    <td className="ai-cell-actions">
                      <div className="ai-actions">
                        {onCheck && <Button size="sm" icon="refresh" loading={checkingId === a.id} disabled={!a.enabled || Boolean(checkingId)} onClick={() => onCheck(a)} aria-label={`Check ${a.name} now`}>Check now</Button>}
                        <LinkButton size="sm" href={a.url} external aria-label={`Open ${a.name} in a new tab`}>Open application</LinkButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ai-pager">
            <span aria-live="polite">
              {rows.length === apps.length ? `${rows.length} application${rows.length === 1 ? '' : 's'}` : `${rows.length} of ${apps.length} applications`}
              {pageCount > 1 ? ` · page ${page} of ${pageCount}` : ''}
            </span>
            {pageCount > 1 && (
              <div>
                <Button size="sm" icon="chevron-left" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button size="sm" disabled={page === pageCount} onClick={() => setPage((p) => p + 1)}>Next <Icon name="chevron-right" /></Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
