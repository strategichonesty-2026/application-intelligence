import { useEffect, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button, Field } from '../ui/primitives';
import { monitoringApi } from '../data/api';
import { useToast } from '../ui/Toast';
import { FREQUENCY, PRICE_BASIS, CAP_STATUS, SUB_STATUS } from '../data/inventoryView';

const EMPTY = { provider: '', service: '', applications: '', plan: '', price: '', currency: 'USD', priceBasis: 'unknown', billingFrequency: 'unknown', renewalDate: '', trialEndsAt: '', usageLimits: '', spendingCap: '', capStatus: 'unknown', status: 'unknown', accountUrl: '', notes: '', lastVerifiedAt: '' };
const csv = (s) => String(s).split(',').map((x) => x.trim()).filter(Boolean);
const from = (s) => ({ ...EMPTY, ...s, applications: (s.applications || []).join(', '), price: s.price == null ? '' : String(s.price), renewalDate: s.renewalDate || '', trialEndsAt: s.trialEndsAt || '', lastVerifiedAt: s.lastVerifiedAt || '' });

export default function SubscriptionDialog({ open, subscription, onClose, onSaved }) {
  const toast = useToast();
  const [v, setV] = useState(EMPTY); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setV(subscription ? from(subscription) : EMPTY); setErr(''); } }, [open, subscription]);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (!v.provider.trim()) { setErr('Enter the provider.'); return; }
    setBusy(true); setErr('');
    const body = { ...v, applications: csv(v.applications), price: v.price === '' ? null : Number(v.price), renewalDate: v.renewalDate || null, trialEndsAt: v.trialEndsAt || null, lastVerifiedAt: v.lastVerifiedAt || null };
    try {
      const res = await monitoringApi.saveSubscription(subscription ? subscription.id : null, body);
      toast.success(`Saved ${res.subscription.provider}.`); onSaved(); onClose();
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={busy ? () => {} : onClose} width={720} title={subscription ? `Edit ${subscription.provider}` : 'Add a subscription record'}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" form="ai-sub-form" loading={busy}>Save record</Button></>}>
      <form id="ai-sub-form" onSubmit={submit} noValidate>
        <div className="ai-callout" style={{ marginBottom: 12 }}><div>These figures are what you type in. They are not read from any provider or bank. Mark a price “Verified” only if you checked it on the provider’s billing page.</div></div>
        {err && <div className="ai-formerr" role="alert">{err}</div>}
        <div className="ai-form">
          <Field label="Provider">{(p) => <input {...p} value={v.provider} onChange={set('provider')} maxLength={80} autoComplete="off" />}</Field>
          <Field label="Service / product">{(p) => <input {...p} value={v.service} onChange={set('service')} maxLength={120} autoComplete="off" />}</Field>
          <div className="ai-span"><Field label="Associated applications" hint="Comma separated.">{(p) => <input {...p} value={v.applications} onChange={set('applications')} autoComplete="off" />}</Field></div>
          <Field label="Plan / tier">{(p) => <input {...p} value={v.plan} onChange={set('plan')} maxLength={120} autoComplete="off" />}</Field>
          <Field label="Status">{(p) => <select {...p} value={v.status} onChange={set('status')}>{Object.entries(SUB_STATUS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select>}</Field>
          <Field label="Price">{(p) => <input {...p} type="number" min="0" step="0.01" value={v.price} onChange={set('price')} />}</Field>
          <Field label="Currency">{(p) => <input {...p} value={v.currency} onChange={set('currency')} maxLength={3} autoComplete="off" />}</Field>
          <Field label="Billing frequency">{(p) => <select {...p} value={v.billingFrequency} onChange={set('billingFrequency')}>{Object.entries(FREQUENCY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</Field>
          <Field label="Is the price verified?">{(p) => <select {...p} value={v.priceBasis} onChange={set('priceBasis')}>{Object.entries(PRICE_BASIS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</Field>
          <Field label="Renewal date">{(p) => <input {...p} type="date" value={v.renewalDate} onChange={set('renewalDate')} />}</Field>
          <Field label="Trial ends">{(p) => <input {...p} type="date" value={v.trialEndsAt} onChange={set('trialEndsAt')} />}</Field>
          <div className="ai-span"><Field label="Usage limits">{(p) => <input {...p} value={v.usageLimits} onChange={set('usageLimits')} maxLength={500} autoComplete="off" />}</Field></div>
          <Field label="Spending cap / alert (as configured)">{(p) => <input {...p} value={v.spendingCap} onChange={set('spendingCap')} maxLength={300} autoComplete="off" />}</Field>
          <Field label="Cap status">{(p) => <select {...p} value={v.capStatus} onChange={set('capStatus')}>{Object.entries(CAP_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</Field>
          <div className="ai-span"><Field label="Billing / account page" hint="Plain https address, no query string.">{(p) => <input {...p} type="url" value={v.accountUrl} onChange={set('accountUrl')} placeholder="https://" autoComplete="off" />}</Field></div>
          <Field label="Last verified">{(p) => <input {...p} type="date" value={v.lastVerifiedAt} onChange={set('lastVerifiedAt')} />}</Field>
          <div className="ai-span"><Field label="Notes">{(p) => <textarea {...p} value={v.notes} onChange={set('notes')} maxLength={1500} />}</Field></div>
        </div>
      </form>
    </Dialog>
  );
}
