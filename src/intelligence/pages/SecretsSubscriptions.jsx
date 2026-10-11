import { useMemo, useState } from 'react';
import { Button, Card, Select, SearchBox } from '../ui/primitives';
import { Badge } from '../ui/StatusBadge';
import { Banner, StateMessage } from '../ui/StateMessage';
import { ConfirmDialog } from '../ui/Dialog';
import DataGate, { TableSkeleton } from '../ui/DataGate';
import Icon from '../ui/Icon';
import { useToast } from '../ui/Toast';
import { useResource } from '../data/useResource';
import { monitoringApi } from '../data/api';
import { absoluteTime } from '../data/format';
import CredentialDialog from '../components/CredentialDialog';
import SubscriptionDialog from '../components/SubscriptionDialog';
import {
  CREDENTIAL_STATUS, VERIFICATION, MIGRATION, READINESS, SUB_STATUS, FREQUENCY, PRICE_BASIS, CAP_STATUS,
  filterCredentials, sortCredentials, filterSubscriptions, sortSubscriptions, uniqueSorted, money, costLines,
} from '../data/inventoryView';

const TABS = [['overview', 'Overview'], ['credentials', 'Credentials'], ['subscriptions', 'Subscriptions'], ['dependencies', 'Dependencies']];
const opt = (map, all) => [{ value: 'all', label: all }, ...Object.entries(map).map(([value, m]) => ({ value, label: m.label || m }))];

const VerBadge = ({ level }) => { const m = VERIFICATION[level] || VERIFICATION.unknown; return <Badge tone={m.tone} icon={m.icon} title={m.help}>{m.label}</Badge>; };
const CredBadge = ({ status }) => { const m = CREDENTIAL_STATUS[status] || CREDENTIAL_STATUS.unknown; return <Badge tone={m.tone} icon={m.icon}>{m.label}</Badge>; };
const D = ({ v, empty = 'Not recorded' }) => (v ? <time dateTime={v} title={absoluteTime(`${v}T00:00:00Z`)}>{v}</time> : <span className="ai-muted">{empty}</span>);

function Overview({ data, go }) {
  const { credentials: cs, costs, upcoming } = data.summary;
  const lines = costLines(costs);
  return (
    <>
      <div className="ai-summary" role="group" aria-label="Credential summary">
        <div className="ai-stat ai-stat--neutral"><div className="ai-stat__label">Credential records</div><div className="ai-stat__value">{cs.total}</div><div className="ai-stat__note">{cs.verification.verified} verified, {cs.verification.inferred} inferred, {cs.verification.unknown} unknown</div></div>
        <div className="ai-stat ai-stat--bad"><div className="ai-stat__label">Exposed</div><div className="ai-stat__value">{cs.byStatus.exposed}</div><div className="ai-stat__note">Known or believed visible to others</div></div>
        <div className="ai-stat ai-stat--warn"><div className="ai-stat__label">Rotation required</div><div className="ai-stat__value">{cs.byStatus.rotation_required}</div><div className="ai-stat__note">{cs.byStatus.pending_migration} pending migration</div></div>
        <div className="ai-stat ai-stat--info"><div className="ai-stat__label">Unknown status</div><div className="ai-stat__value">{cs.byStatus.unknown}</div><div className="ai-stat__note">{cs.byStatus.active} active, {cs.byStatus.revoked} revoked</div></div>
      </div>
      <div className="ai-two" style={{ marginTop: 16 }}>
        <Card title="Needs review or rotation" subtitle="From the status and review dates you recorded." flush>
          {cs.needsReview.length ? (
            <ul className="ai-list">{cs.needsReview.map((r) => (
              <li key={r.id}><button type="button" className="ai-linkbtn" onClick={() => go('credentials', { q: r.name })}>{r.name}</button> <CredBadge status={r.status} />{r.reason === 'review_due' && <Badge tone="warn" icon="clock">Review due</Badge>}</li>))}</ul>
          ) : <StateMessage icon="check-circle" compact title="Nothing flagged">No credential is marked exposed, rotation-required, pending migration, or overdue for review.</StateMessage>}
        </Card>
        <Card title="Subscriptions and known costs" subtitle="Manually maintained. Not read from any billing system." flush>
          <div style={{ padding: 16 }}>
            <p><strong>{costs.total}</strong> subscription record{costs.total === 1 ? '' : 's'}: {costs.activeCount} active, {costs.unknownStatus} status unknown, {costs.cancelledCount} cancelled.</p>
            {lines.length ? lines.map((l) => (
              <dl key={l.currency} className="ai-facts" style={{ marginTop: 8 }}>
                <div><dt>{l.currency} per month</dt><dd>{money(l.monthlyVerified, l.currency)} verified{l.monthlyEstimated ? <> + {money(l.monthlyEstimated, l.currency)} estimated</> : null}</dd></div>
                <div><dt>{l.currency} per year</dt><dd>{money(l.annualVerified, l.currency)} verified{l.annualEstimated ? <> + {money(l.annualEstimated, l.currency)} estimated</> : null}</dd></div>
              </dl>)) : <p className="ai-muted">No active subscription has a recorded price yet, so no cost can be shown.</p>}
            <p className="ai-field__hint" style={{ marginTop: 8 }}>Left out of the totals: {costs.missingPrice} active with no usable price, {costs.usageBased} usage-based, {costs.unknownStatus} of unknown status. Amounts in different currencies are never added together.</p>
          </div>
        </Card>
      </div>
      <Card title="Upcoming renewals and trial expirations" subtitle="Within 45 days, plus any date already passed." flush>
        {upcoming.length ? (
          <div className="ai-tablewrap"><table className="ai-table"><thead><tr><th scope="col">Service</th><th scope="col">Event</th><th scope="col">Date</th><th scope="col">When</th></tr></thead>
            <tbody>{upcoming.map((u) => (<tr key={`${u.id}-${u.kind}`}><td>{u.provider}{u.service ? ` · ${u.service}` : ''}</td><td>{u.kind === 'renewal' ? 'Renewal' : 'Trial ends'}</td><td><D v={u.date} /></td>
              <td>{u.overdue ? <Badge tone="warn" icon="alert-triangle">Date passed {-u.daysAway} d ago: check it</Badge> : u.daysAway === 0 ? 'Today' : `In ${u.daysAway} days`}</td></tr>))}</tbody></table></div>
        ) : <StateMessage icon="inbox" compact title="Nothing coming up">No renewal or trial date falls in the next 45 days (or none has been recorded).</StateMessage>}
      </Card>
    </>
  );
}

function CredentialsTab({ data, params, setParams, onEdit, onDelete }) {
  const [sort, setSort] = useState({ key: 'status', dir: 'asc' });
  const f = { q: params.q || '', status: params.status || 'all', provider: params.provider || 'all', application: params.app || 'all', verification: params.ver || 'all' };
  const rows = useMemo(() => sortCredentials(filterCredentials(data.credentials, f), sort.key, sort.dir), [data.credentials, f.q, f.status, f.provider, f.application, f.verification, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const providers = uniqueSorted(data.credentials.map((c) => c.provider));
  const apps = uniqueSorted(data.credentials.flatMap((c) => c.applications));
  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  const th = (key, label) => (<th scope="col" aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" onClick={() => toggle(key)}>{label}<Icon name={sort.key === key ? (sort.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'chevrons-up-down'} size={12} /></button></th>);
  return (
    <Card flush>
      <div className="ai-toolbar" role="search" aria-label="Filter credentials">
        <SearchBox value={f.q} onChange={(v) => setParams({ q: v })} label="Search credentials" placeholder="Name, provider, variable, app" />
        <Select label="Status" value={f.status} onChange={(v) => setParams({ status: v })} options={opt(CREDENTIAL_STATUS, 'All statuses')} />
        <Select label="Provider" value={f.provider} onChange={(v) => setParams({ provider: v })} options={[{ value: 'all', label: 'All providers' }, ...providers.map((p) => ({ value: p, label: p }))]} />
        <Select label="Application" value={f.application} onChange={(v) => setParams({ app: v })} options={[{ value: 'all', label: 'All applications' }, ...apps.map((p) => ({ value: p, label: p }))]} />
        <Select label="Evidence" value={f.verification} onChange={(v) => setParams({ ver: v })} options={opt(VERIFICATION, 'Any evidence level')} />
      </div>
      {rows.length === 0 ? <StateMessage icon="search" compact title={data.credentials.length ? 'No credential matches these filters' : 'No credential records yet'}>{data.credentials.length ? 'Clear a filter or change the search.' : 'Add the credentials your applications use. Record names and storage locations only, never values.'}</StateMessage> : (
        <div className="ai-tablewrap"><table className="ai-table ai-table--cards">
          <caption className="ai-visually-hidden">Credential records, {rows.length} shown</caption>
          <thead><tr>{th('name', 'Credential')}{th('status', 'Status')}<th scope="col">Evidence</th><th scope="col">Used by</th>{th('lastVerifiedAt', 'Last verified')}{th('lastRotatedAt', 'Last rotated')}{th('nextReviewAt', 'Next review')}<th scope="col" className="ai-num">Actions</th></tr></thead>
          <tbody>{rows.map((c) => (
            <tr key={c.id}>
              <td className="ai-cell-first"><div className="ai-cell-app"><strong>{c.name}</strong><small>{c.provider || 'Provider not recorded'} · <span className="ai-tag">{c.environment}</span>{c.envVarName ? <> · <code>{c.envVarName}</code></> : null}</small>{c.storageReference && <small>Kept in: {c.storageReference}</small>}</div></td>
              <td data-label="Status"><CredBadge status={c.status} /></td>
              <td data-label="Evidence"><VerBadge level={c.verification} />{c.evidence && <span className="ai-sub" title={c.evidence}>{c.evidence.length > 60 ? `${c.evidence.slice(0, 60)}…` : c.evidence}</span>}</td>
              <td data-label="Used by">{(c.applications || []).length ? c.applications.join(', ') : <span className="ai-muted">Not recorded</span>}</td>
              <td data-label="Last verified"><D v={c.lastVerifiedAt} empty="Never" /></td>
              <td data-label="Last rotated"><D v={c.lastRotatedAt} empty="Not recorded" /></td>
              <td data-label="Next review"><D v={c.nextReviewAt} empty="None set" /></td>
              <td className="ai-cell-actions"><div className="ai-actions"><Button size="sm" icon="pencil" onClick={() => onEdit(c)} aria-label={`Edit ${c.name}`}>Edit</Button><Button size="sm" icon="trash" onClick={() => onDelete({ kind: 'credential', record: c })} aria-label={`Delete record ${c.name}`}>Delete</Button></div></td>
            </tr>))}</tbody></table></div>)}
    </Card>
  );
}

function SubscriptionsTab({ data, params, setParams, onEdit, onDelete }) {
  const [sort, setSort] = useState({ key: 'provider', dir: 'asc' });
  const f = { q: params.q || '', status: params.status || 'all', frequency: params.freq || 'all' };
  const rows = useMemo(() => sortSubscriptions(filterSubscriptions(data.subscriptions, f), sort.key, sort.dir), [data.subscriptions, f.q, f.status, f.frequency, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  const th = (key, label, num) => (<th scope="col" className={num ? 'ai-num' : ''} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" onClick={() => toggle(key)}>{label}<Icon name={sort.key === key ? (sort.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'chevrons-up-down'} size={12} /></button></th>);
  return (
    <Card flush>
      <div className="ai-toolbar" role="search" aria-label="Filter subscriptions">
        <SearchBox value={f.q} onChange={(v) => setParams({ q: v })} label="Search subscriptions" placeholder="Provider, service, plan, app" />
        <Select label="Status" value={f.status} onChange={(v) => setParams({ status: v })} options={opt(SUB_STATUS, 'All statuses')} />
        <Select label="Billing" value={f.frequency} onChange={(v) => setParams({ freq: v })} options={opt(FREQUENCY, 'Any frequency')} />
      </div>
      {rows.length === 0 ? <StateMessage icon="inbox" compact title={data.subscriptions.length ? 'No subscription matches these filters' : 'No subscription records yet'}>{data.subscriptions.length ? 'Clear a filter or change the search.' : 'Add the paid services your apps use. Leave the price blank until you have checked it on the provider’s billing page.'}</StateMessage> : (
        <div className="ai-tablewrap"><table className="ai-table ai-table--cards">
          <caption className="ai-visually-hidden">Subscription records, {rows.length} shown</caption>
          <thead><tr>{th('provider', 'Service')}{th('status', 'Status')}<th scope="col">Plan</th>{th('price', 'Price', true)}{th('renewalDate', 'Renewal')}<th scope="col">Cap / alert</th><th scope="col">Used by</th><th scope="col" className="ai-num">Actions</th></tr></thead>
          <tbody>{rows.map((s) => { const st = SUB_STATUS[s.status] || SUB_STATUS.unknown; return (
            <tr key={s.id}>
              <td className="ai-cell-first"><div className="ai-cell-app"><strong>{s.provider}</strong><small>{s.service || 'Service not recorded'}</small>{s.accountUrl && <small><a href={s.accountUrl} target="_blank" rel="noopener noreferrer">Billing page <Icon name="external-link" size={11} /></a></small>}</div></td>
              <td data-label="Status"><Badge tone={st.tone}>{st.label}</Badge></td>
              <td data-label="Plan">{s.plan || <span className="ai-muted">Not recorded</span>}</td>
              <td data-label="Price" className="ai-num">{s.price == null ? <span className="ai-muted">{s.billingFrequency === 'usage' ? 'Usage-based' : 'Unknown'}</span> : <>{money(s.price, s.currency)} <span className="ai-sub">{FREQUENCY[s.billingFrequency]} · {PRICE_BASIS[s.priceBasis]}</span></>}</td>
              <td data-label="Renewal"><D v={s.renewalDate} empty="Not recorded" />{s.trialEndsAt && <span className="ai-sub">Trial ends <D v={s.trialEndsAt} /></span>}</td>
              <td data-label="Cap / alert">{s.spendingCap || <span className="ai-muted">None recorded</span>}<span className="ai-sub">Cap: {CAP_STATUS[s.capStatus]}</span></td>
              <td data-label="Used by">{(s.applications || []).join(', ') || <span className="ai-muted">Not recorded</span>}</td>
              <td className="ai-cell-actions"><div className="ai-actions"><Button size="sm" icon="pencil" onClick={() => onEdit(s)} aria-label={`Edit ${s.provider}`}>Edit</Button><Button size="sm" icon="trash" onClick={() => onDelete({ kind: 'subscription', record: s })} aria-label={`Delete record ${s.provider}`}>Delete</Button></div></td>
            </tr>); })}</tbody></table></div>)}
    </Card>
  );
}

function DependenciesTab({ data }) {
  const byId = Object.fromEntries(data.credentials.map((c) => [c.id, c]));
  const ordered = [...data.dependencies].sort((a, b) => (a.rotationStep || 999) - (b.rotationStep || 999) || a.name.localeCompare(b.name));
  if (!ordered.length) return <Card><StateMessage icon="inbox" compact title="No credentials recorded">Add credential records first; their consumers appear here.</StateMessage></Card>;
  return (
    <>
      <Banner tone="info" icon="info">Rotation order is the number you recorded (1 first). Rotate a credential only when it shows “Ready”. Receivers that check a key must accept the new value before senders start using it. Nothing on this page rotates or revokes anything.</Banner>
      {ordered.map((d) => {
        const c = byId[d.id]; const r = READINESS[d.readiness];
        return (
          <Card key={d.id} title={<>{d.rotationStep ? `${d.rotationStep}. ` : ''}{d.name}</>} subtitle={c && c.envVarName ? `Variable name: ${c.envVarName}` : undefined} actions={<><CredBadge status={c.status} /><Badge tone={r.tone} title={r.help}>{r.label}</Badge></>}>
            {d.consumers.length ? (
              <div className="ai-tablewrap"><table className="ai-table ai-table--cards"><thead><tr><th scope="col">Consumer</th><th scope="col">Environment</th><th scope="col">Authentication</th><th scope="col">Evidence</th><th scope="col">Migration</th><th scope="col">Impact if changed</th></tr></thead>
                <tbody>{d.consumers.map((x, i) => (<tr key={i}><td className="ai-cell-first">{x.name}</td><td data-label="Environment">{x.environment}</td><td data-label="Authentication">{x.authMethod || <span className="ai-muted">Not recorded</span>}</td><td data-label="Evidence"><VerBadge level={x.verification} /></td><td data-label="Migration">{MIGRATION[x.migration]}</td><td data-label="Impact">{x.impact || <span className="ai-muted">Not recorded</span>}</td></tr>))}</tbody></table></div>
            ) : <p className="ai-muted">No consumers recorded. Find them before changing this credential.</p>}
            {d.blockers.length > 0 && <div className="ai-callout ai-callout--bad" style={{ marginTop: 10 }}><Icon name="octagon-alert" size={18} /><div><strong>Do not rotate yet.</strong> Not migrated or unconfirmed: {d.blockers.map((b) => b.name).join(', ')}.</div></div>}
            <dl className="ai-facts" style={{ marginTop: 10 }}>
              <div><dt>Impact if revoked</dt><dd>{d.impactIfRevoked || <span className="ai-muted">Not recorded</span>}</dd></div>
              <div><dt>Rollback</dt><dd>{d.rollbackNotes || <span className="ai-muted">Not recorded</span>}</dd></div>
              {c.migrationNotes && <div><dt>Migration notes</dt><dd>{c.migrationNotes}</dd></div>}
            </dl>
          </Card>);
      })}
    </>
  );
}

export default function SecretsSubscriptions({ route }) {
  const toast = useToast();
  const res = useResource((s) => monitoringApi.inventory(s), []);
  const tab = TABS.some(([id]) => id === route.params.tab) ? route.params.tab : 'overview';
  const [credDialog, setCredDialog] = useState({ open: false, record: null });
  const [subDialog, setSubDialog] = useState({ open: false, record: null });
  const [del, setDel] = useState(null); const [busy, setBusy] = useState(false);
  const setParams = (patch) => route.replaceParams({ ...route.params, ...patch });
  const go = (t, extra = {}) => route.replaceParams({ tab: t, ...extra });

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await (del.kind === 'credential' ? monitoringApi.deleteCredential(del.record.id) : monitoringApi.deleteSubscription(del.record.id));
      toast.success('Record deleted. Nothing was changed at the provider.'); res.reload(); setDel(null);
    } catch (e) { toast.error(`Could not delete the record: ${e.message}`); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="ai-page__head">
        <div>
          <h1 className="ai-page__title">Secrets &amp; Subscriptions</h1>
          <p className="ai-page__sub">A hand-kept register of which credentials exist, who depends on them, and what you pay for. It stores <strong>no secret values</strong> and is not connected to any provider or billing system.</p>
        </div>
        <div className="ai-card__actions">
          <Button icon="plus" onClick={() => setCredDialog({ open: true, record: null })}>Add credential</Button>
          <Button icon="plus" onClick={() => setSubDialog({ open: true, record: null })}>Add subscription</Button>
        </div>
      </div>
      <div role="tablist" aria-label="Secrets and subscriptions views" className="ai-tabs">
        {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => go(id)}>{label}</button>)}
      </div>
      <DataGate res={res} what="the inventory" skeleton={<TableSkeleton rows={5} />}>
        {(data) => (
          <>
            <Banner tone="info" icon="info">{data.notice} Last read <time dateTime={data.generatedAt}>{absoluteTime(data.generatedAt)}</time>.</Banner>
            {tab === 'overview' && <Overview data={data} go={go} />}
            {tab === 'credentials' && <CredentialsTab data={data} params={route.params} setParams={setParams} onEdit={(r) => setCredDialog({ open: true, record: r })} onDelete={setDel} />}
            {tab === 'subscriptions' && <SubscriptionsTab data={data} params={route.params} setParams={setParams} onEdit={(r) => setSubDialog({ open: true, record: r })} onDelete={setDel} />}
            {tab === 'dependencies' && <DependenciesTab data={data} />}
          </>
        )}
      </DataGate>
      <CredentialDialog open={credDialog.open} credential={credDialog.record} onClose={() => setCredDialog({ open: false, record: null })} onSaved={res.reload} />
      <SubscriptionDialog open={subDialog.open} subscription={subDialog.record} onClose={() => setSubDialog({ open: false, record: null })} onSaved={res.reload} />
      <ConfirmDialog open={Boolean(del)} title="Delete this record?" confirmLabel="Delete record" danger busy={busy} onConfirm={confirmDelete} onCancel={() => setDel(null)}>
        This removes only the entry in this register. It does not rotate, revoke or cancel anything at the provider.
      </ConfirmDialog>
    </>
  );
}
