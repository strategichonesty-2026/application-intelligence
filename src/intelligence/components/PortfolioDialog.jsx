import { useEffect, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button, Field } from '../ui/primitives';
import { portfolioApi } from '../data/api';
import { useToast } from '../ui/Toast';
import { TYPE_LABEL, STATUS_LABEL, LEVEL_META, EVIDENCE_META } from '../data/portfolioView';

const EMPTY = { type: 'decision', title: '', body: '', repoName: '', status: 'open', level: '', evidence: '', evidenceLevel: 'unverified', evidenceCheckedAt: '' };

/** Add or edit one portfolio record. Notes only: the form says so and the server refuses anything secret-shaped. */
export default function PortfolioDialog({ open, item, repoNames = [], onClose, onSaved }) {
  const toast = useToast();
  const fromItem = (it) => (it ? { ...EMPTY, ...it, level: it.level || '', evidenceCheckedAt: it.evidenceCheckedAt || '' } : EMPTY);
  const [v, setV] = useState(() => fromItem(item));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setV(fromItem(item)); setErr(''); } }, [open, item]);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!v.title.trim()) { setErr('Enter a title.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await portfolioApi.save(item ? item.id : null, { type: v.type, title: v.title, body: v.body, repoName: v.repoName, status: v.status, level: v.level || null, evidence: v.evidence, evidenceLevel: v.evidenceLevel, evidenceCheckedAt: v.evidenceCheckedAt || null });
      toast.success(`Saved “${res.item.title}”.`); onSaved(); onClose();
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={busy ? () => {} : onClose} width={680} title={item ? 'Edit portfolio item' : 'Add to the portfolio'}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" form="ai-pf-form" loading={busy}>Save</Button></>}>
      <form id="ai-pf-form" onSubmit={submit} noValidate>
        <div className="ai-callout ai-callout--warn" style={{ marginBottom: 12 }}><div><strong>Notes only.</strong> Never paste a key, token or password. Anything that looks like one is refused.</div></div>
        {err && <div className="ai-formerr" role="alert">{err}</div>}
        <div className="ai-form">
          <Field label="Kind">{(p) => <select {...p} value={v.type} onChange={set('type')}>{Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</Field>
          <Field label="Status">{(p) => <select {...p} value={v.status} onChange={set('status')}>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</Field>
          <div className="ai-span"><Field label="Title">{(p) => <input {...p} value={v.title} onChange={set('title')} maxLength={200} autoComplete="off" />}</Field></div>
          <div className="ai-span"><Field label="Details">{(p) => <textarea {...p} value={v.body} onChange={set('body')} maxLength={3000} rows={3} />}</Field></div>
          <Field label="Repository" hint="Optional. Pick one so the item links to it.">{(p) => (<><input {...p} list="ai-pf-repos" value={v.repoName} onChange={set('repoName')} maxLength={100} autoComplete="off" /><datalist id="ai-pf-repos">{repoNames.map((n) => <option key={n} value={n} />)}</datalist></>)}</Field>
          <Field label="Level" hint="For risks and issues.">{(p) => <select {...p} value={v.level} onChange={set('level')}><option value="">Not set</option>{Object.entries(LEVEL_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select>}</Field>
          <Field label="How sure are you?" hint="“Verified” needs evidence and a date.">{(p) => <select {...p} value={v.evidenceLevel} onChange={set('evidenceLevel')}>{Object.entries(EVIDENCE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select>}</Field>
          <Field label="Date checked">{(p) => <input {...p} type="date" value={v.evidenceCheckedAt} onChange={set('evidenceCheckedAt')} />}</Field>
          <div className="ai-span"><Field label="Evidence" hint="What you checked and where.">{(p) => <textarea {...p} value={v.evidence} onChange={set('evidence')} maxLength={1000} rows={2} />}</Field></div>
        </div>
      </form>
    </Dialog>
  );
}
