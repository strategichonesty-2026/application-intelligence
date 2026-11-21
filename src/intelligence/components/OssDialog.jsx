import { useEffect, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button, Field } from '../ui/primitives';
import { ossApi } from '../data/api';
import { useToast } from '../ui/Toast';
import { LICENSE_META, MAINTENANCE_META, EFFORT_LABEL, DECISION_META } from '../data/ossView';

const EMPTY = { name: '', url: '', gap: '', repoName: '', license: '', licenseClass: 'unknown', commercialNote: '', maintenance: 'unknown', lastRelease: '', securityNote: '', effort: 'unknown', decision: 'to_evaluate', verifiedSource: '', verifiedAt: '' };
const fromItem = (p) => (p ? { ...EMPTY, ...p, lastRelease: p.lastRelease || '', verifiedAt: p.verifiedAt || '' } : EMPTY);

/** Add or edit one library entry. Every fact defaults to "not checked"; "verified" needs a source and a date. */
export default function OssDialog({ open, project, repoNames = [], onClose, onSaved }) {
  const toast = useToast();
  const [v, setV] = useState(() => fromItem(project));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setV(fromItem(project)); setErr(''); } }, [open, project]);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const pick = (k, map) => (p) => <select {...p} value={v[k]} onChange={set(k)}>{Object.entries(map).map(([id, m]) => <option key={id} value={id}>{typeof m === 'string' ? m : m.label}</option>)}</select>;

  const submit = async (e) => {
    e.preventDefault();
    if (!v.name.trim()) { setErr('Enter a name.'); return; }
    setBusy(true); setErr('');
    try {
      const body = { ...v, lastRelease: v.lastRelease || null, verifiedAt: v.verifiedAt || null };
      const res = await ossApi.save(project ? project.id : null, body);
      toast.success(`Saved “${res.project.name}”.`); onSaved(); onClose();
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={busy ? () => {} : onClose} width={720} title={project ? 'Edit library entry' : 'Add an open-source project'}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" form="ai-oss-form" loading={busy}>Save</Button></>}>
      <form id="ai-oss-form" onSubmit={submit} noValidate>
        <div className="ai-callout ai-callout--warn" style={{ marginBottom: 12 }}><div><strong>Only record what you have checked.</strong> Leave a field as “not checked” if you are unsure. Nothing is looked up for you, and no key or password belongs here.</div></div>
        {err && <div className="ai-formerr" role="alert">{err}</div>}
        <div className="ai-form">
          <div className="ai-span"><Field label="Project name">{(p) => <input {...p} value={v.name} onChange={set('name')} maxLength={120} autoComplete="off" />}</Field></div>
          <div className="ai-span"><Field label="Link" hint="https://… (optional)">{(p) => <input {...p} type="url" value={v.url} onChange={set('url')} maxLength={300} autoComplete="off" />}</Field></div>
          <div className="ai-span"><Field label="Gap it would fill">{(p) => <input {...p} value={v.gap} onChange={set('gap')} maxLength={500} />}</Field></div>
          <Field label="For repository" hint="Optional.">{(p) => (<><input {...p} list="ai-oss-repos" value={v.repoName} onChange={set('repoName')} maxLength={100} autoComplete="off" /><datalist id="ai-oss-repos">{repoNames.map((n) => <option key={n} value={n} />)}</datalist></>)}</Field>
          <Field label="Decision">{pick('decision', DECISION_META)}</Field>
          <Field label="Licence name" hint="For example MIT.">{(p) => <input {...p} value={v.license} onChange={set('license')} maxLength={80} />}</Field>
          <Field label="Licence type">{pick('licenseClass', LICENSE_META)}</Field>
          <div className="ai-span"><Field label="Commercial-use note">{(p) => <input {...p} value={v.commercialNote} onChange={set('commercialNote')} maxLength={500} />}</Field></div>
          <Field label="Maintenance">{pick('maintenance', MAINTENANCE_META)}</Field>
          <Field label="Last release">{(p) => <input {...p} type="date" value={v.lastRelease} onChange={set('lastRelease')} />}</Field>
          <Field label="Integration effort">{pick('effort', EFFORT_LABEL)}</Field>
          <div className="ai-span"><Field label="Security note">{(p) => <input {...p} value={v.securityNote} onChange={set('securityNote')} maxLength={500} />}</Field></div>
          <Field label="Checked where?" hint="Needed with the date. Leave both empty if not checked.">{(p) => <input {...p} value={v.verifiedSource} onChange={set('verifiedSource')} maxLength={300} />}</Field>
          <Field label="Date checked">{(p) => <input {...p} type="date" value={v.verifiedAt} onChange={set('verifiedAt')} />}</Field>
        </div>
      </form>
    </Dialog>
  );
}
