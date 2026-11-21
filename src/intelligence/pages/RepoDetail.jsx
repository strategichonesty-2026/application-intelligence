import { useEffect, useState } from 'react';
import Icon from '../ui/Icon';
import { Button, Card, Field, LinkButton } from '../ui/primitives';
import { Badge } from '../ui/StatusBadge';
import DataGate from '../ui/DataGate';
import { useToast } from '../ui/Toast';
import { useResource } from '../data/useResource';
import { reposApi } from '../data/api';
import { hrefTo } from '../data/useRoute';
import { absoluteTime, relativeTime, DASH } from '../data/format';
import { KIND_LABEL, KIND_ORDER, PRIORITIES, ACTIVITY_META, DEPLOY_META, healthMeta, daysText, readingOf } from '../data/repoView';

const When = ({ iso, empty = 'never' }) => (iso ? <time dateTime={iso} title={absoluteTime(iso)}>{relativeTime(iso)}</time> : <span className="ai-muted">{empty}</span>);

function Signal({ n, title, badge, rows, source, readAt, readLabel = 'read' }) {
  return (
    <section className="ai-signal" aria-label={title}>
      <header><h3>{n}. {title}</h3>{badge}</header>
      <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || <span className="ai-muted">{DASH}</span>}</dd></div>)}</dl>
      <p className="ai-sub">Source: {source} · {readLabel} {readAt ? <When iso={readAt} /> : 'never'}</p>
    </section>
  );
}

export function RepoDetailView({ repo, apps, onChanged }) {
  const toast = useToast();
  const [form, setForm] = useState({ purpose: repo.purpose.owner ? repo.purpose.value : '', liveUrl: repo.liveUrl || '', priorityNote: repo.priorityNote || '', appId: repo.appId || '' });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  useEffect(() => { setForm({ purpose: repo.purpose.owner ? repo.purpose.value : '', liveUrl: repo.liveUrl || '', priorityNote: repo.priorityNote || '', appId: repo.appId || '' }); }, [repo.id, repo.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (values, okText) => {
    setSaving(true); setErrors({});
    try { await reposApi.update(repo.id, values); toast.success(okText); onChanged(); }
    catch (err) { setErrors({ form: err.message }); toast.error(`Not saved: ${err.message}`); }
    finally { setSaving(false); }
  };
  const act = ACTIVITY_META[repo.activity.state] || ACTIVITY_META.unknown;
  const dep = DEPLOY_META[repo.deployment.state] || DEPLOY_META.unknown;
  const hl = healthMeta(repo.health.state);
  const typeLabel = repo.type.value ? KIND_LABEL[repo.type.value] : null;

  return (
    <>
      <a className="ai-back" href={hrefTo('/applications')}><Icon name="arrow-left" size={14} />Back to applications</a>
      <div className="ai-page__head">
        <div>
          <h1 className="ai-page__title" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {repo.name}
            {typeLabel ? <Badge tone={repo.type.confirmed ? 'ok' : 'neutral'}>{typeLabel}{repo.type.confirmed ? '' : ' (suggested)'}</Badge> : <Badge tone="warn">Needs a type</Badge>}
          </h1>
          <p className="ai-page__sub">{repo.purpose.value || 'No description yet. Add one below.'}</p>
        </div>
        <div className="ai-card__actions">
          <LinkButton external icon="external-link" href={repo.htmlUrl}>Open on GitHub</LinkButton>
          {repo.liveUrl && <LinkButton external icon="globe" href={repo.liveUrl}>Open live app</LinkButton>}
        </div>
      </div>

      <div className="ai-callout ai-callout--neutral" style={{ margin: '16px 0' }}><Icon name="info" size={18} /><div><strong>What this means.</strong> {readingOf(repo)}</div></div>

      <div className="ai-signals">
        <Signal n={1} title="Repository activity" badge={<Badge tone={act.tone} icon={act.icon}>{act.label}</Badge>} source="GitHub" readAt={repo.activity.readAt}
          rows={[['Last push', repo.activity.days !== null ? daysText(repo.activity.days) : null], ['Default branch', repo.activity.defaultBranch], ['Open pull requests', repo.activity.openPrs === null ? null : String(repo.activity.openPrs)]]} />
        <Signal n={2} title="Deployment status" badge={<Badge tone={dep.tone} icon={dep.icon}>{dep.label}</Badge>} source={repo.deployment.source} readAt={repo.deployment.checkedAt}
          rows={[['Platform', repo.deployment.platform], ['Evidence', repo.deployment.evidence], ['Live URL', repo.liveUrl ? <a href={repo.liveUrl} target="_blank" rel="noopener noreferrer">{repo.liveUrl}</a> : null]]} />
        <Signal n={3} title="Application health" badge={<Badge tone={hl.tone} icon={hl.icon}>{hl.label}</Badge>} source={repo.health.source} readAt={repo.health.lastCheckedAt} readLabel="last checked"
          rows={[['Linked application', repo.appId ? (apps.find((a) => a.id === repo.appId) || {}).name || 'Linked' : null], ['Note', repo.health.note]]} />
      </div>

      <div className="ai-two" style={{ marginTop: 16 }}>
        <Card title="Priority" subtitle="Your decision. The sync never changes it.">
          <div className="ai-segment" role="group" aria-label="Priority">
            {PRIORITIES.map((p) => (
              <button key={p.value} type="button" aria-pressed={repo.priority === p.value} disabled={saving} title={p.help}
                onClick={() => save({ priority: repo.priority === p.value ? null : p.value }, repo.priority === p.value ? 'Priority cleared.' : `Priority set to ${p.label}.`)}>{p.label}</button>
            ))}
          </div>
          <p className="ai-sub" style={{ marginTop: 8 }}>{repo.priority ? PRIORITIES.find((p) => p.value === repo.priority).help : 'Not set. Click one; click it again to clear.'}</p>

          <h3 className="ai-subhead">Type</h3>
          {repo.type.value && !repo.type.confirmed && (
            <p className="ai-sub">Suggested: <strong>{typeLabel}</strong>. {repo.type.evidence}</p>
          )}
          {!repo.type.value && <p className="ai-sub">{repo.type.evidence || 'No suggestion available.'}</p>}
          {repo.type.value && !repo.type.confirmed && <Button size="sm" variant="primary" disabled={saving} onClick={() => save({ kind: repo.type.value }, `Confirmed as ${typeLabel}.`)}>Confirm {typeLabel}</Button>}
          <div className="ai-segment" role="group" aria-label="Choose a type" style={{ marginTop: 8 }}>
            {KIND_ORDER.map((k) => <button key={k} type="button" aria-pressed={repo.type.confirmed && repo.type.value === k} disabled={saving} onClick={() => save({ kind: k }, `Type set to ${KIND_LABEL[k]}.`)}>{KIND_LABEL[k]}</button>)}
          </div>
        </Card>

        <Card title="About" subtitle="Read from the repository files; nothing here is checked against the running app.">
          <dl className="ai-facts">
            <div><dt>Stack</dt><dd>{repo.stack.length ? repo.stack.map((s) => <span key={s} className="ai-tag" style={{ marginRight: 4 }}>{s}</span>) : <span className="ai-muted">{DASH} not detected</span>}</dd></div>
            <div><dt>Main language</dt><dd>{repo.language || <span className="ai-muted">{DASH}</span>}</dd></div>
            <div><dt>Visibility</dt><dd><span className="ai-tag">{repo.visibility}</span></dd></div>
            <div><dt>Files last read</dt><dd><When iso={repo.scannedAt} /></dd></div>
          </dl>
        </Card>
      </div>

      <Card title="Your notes and links" subtitle="Saved only in this console. Never sent to GitHub." className="ai-mt">
        <form className="ai-form" onSubmit={(e) => { e.preventDefault(); save({ purpose: form.purpose, liveUrl: form.liveUrl, priorityNote: form.priorityNote, appId: form.appId || null }, 'Saved.'); }}>
          <Field label="What it is for" hint="Your own words. Shown instead of the suggestion read from the README.">
            {(p) => <textarea {...p} rows={2} maxLength={500} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />}
          </Field>
          <Field label="Live URL" hint="The address people use, https only. No keys or query strings.">
            {(p) => <input {...p} type="url" value={form.liveUrl} onChange={(e) => setForm({ ...form, liveUrl: e.target.value })} placeholder="https://" />}
          </Field>
          <Field label="Monitored application" hint="Link it to get a real health signal from the existing checker.">
            {(p) => (
              <select {...p} value={form.appId} onChange={(e) => setForm({ ...form, appId: e.target.value })}>
                <option value="">Not linked</option>
                {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
          </Field>
          <Field label="Why this priority" hint="One line for your future self.">
            {(p) => <input {...p} type="text" maxLength={500} value={form.priorityNote} onChange={(e) => setForm({ ...form, priorityNote: e.target.value })} />}
          </Field>
          {errors.form && <p className="ai-field__error" role="alert">{errors.form}</p>}
          <div><Button type="submit" variant="primary" loading={saving}>Save notes</Button></div>
        </form>
      </Card>
    </>
  );
}

export default function RepoDetail({ id, appsRes, reposRes }) {
  const res = useResource((s) => reposApi.get(id, s), [id]);
  const apps = (appsRes.data && appsRes.data.applications) || [];
  return (
    <DataGate res={res} what="this repository">
      {({ repository }) => <RepoDetailView repo={repository} apps={apps} onChanged={() => { res.reload(); reposRes.reload(); }} />}
    </DataGate>
  );
}
