import { useEffect, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button, Field } from '../ui/primitives';
import { monitoringApi } from '../data/api';
import { useToast } from '../ui/Toast';
import { CREDENTIAL_STATUS, VERIFICATION, MIGRATION } from '../data/inventoryView';

const EMPTY = {
  name: '', provider: '', environment: 'production', applications: '', envVarName: '', purpose: '', permissions: '', storageReference: '',
  status: 'unknown', verification: 'unknown', lastVerifiedAt: '', lastRotatedAt: '', nextReviewAt: '', evidence: '',
  migrationNotes: '', revocationImpact: '', rotationStep: '', rollbackNotes: '', consumers: [],
};
const EMPTY_CONSUMER = { name: '', environment: 'production', authMethod: '', verification: 'unknown', migration: 'unknown', impact: '' };
const csv = (s) => String(s).split(',').map((x) => x.trim()).filter(Boolean);

const from = (c) => ({
  ...EMPTY, ...c, applications: (c.applications || []).join(', '), rotationStep: c.rotationStep == null ? '' : String(c.rotationStep),
  lastVerifiedAt: c.lastVerifiedAt || '', lastRotatedAt: c.lastRotatedAt || '', nextReviewAt: c.nextReviewAt || '',
  consumers: (c.consumers || []).map((x) => ({ ...EMPTY_CONSUMER, ...x })),
});

/** Add / edit a credential RECORD. It holds names and references only; the form says so and the server enforces it. */
export default function CredentialDialog({ open, credential, onClose, onSaved }) {
  const toast = useToast();
  const [v, setV] = useState(EMPTY);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setV(credential ? from(credential) : EMPTY); setErr(''); } }, [open, credential]);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const setConsumer = (i, k, val) => setV((x) => ({ ...x, consumers: x.consumers.map((c, j) => (j === i ? { ...c, [k]: val } : c)) }));

  const submit = async (e) => {
    e.preventDefault();
    if (!v.name.trim()) { setErr('Enter a name for this credential.'); return; }
    setBusy(true); setErr('');
    const body = {
      name: v.name, provider: v.provider, environment: v.environment, applications: csv(v.applications), envVarName: v.envVarName,
      purpose: v.purpose, permissions: v.permissions, storageReference: v.storageReference, status: v.status, verification: v.verification,
      lastVerifiedAt: v.lastVerifiedAt || null, lastRotatedAt: v.lastRotatedAt || null, nextReviewAt: v.nextReviewAt || null, evidence: v.evidence,
      migrationNotes: v.migrationNotes, revocationImpact: v.revocationImpact, rollbackNotes: v.rollbackNotes,
      rotationStep: v.rotationStep === '' ? null : Number(v.rotationStep), consumers: v.consumers.filter((c) => c.name.trim()),
    };
    try {
      const res = await monitoringApi.saveCredential(credential ? credential.id : null, body);
      toast.success(`Saved ${res.credential.name}.`); onSaved(); onClose();
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={busy ? () => {} : onClose} width={760} title={credential ? `Edit ${credential.name}` : 'Add a credential record'}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" form="ai-cred-form" loading={busy}>Save record</Button></>}>
      <form id="ai-cred-form" onSubmit={submit} noValidate>
        <div className="ai-callout ai-callout--warn" style={{ marginBottom: 12 }}>
          <div><strong>Never paste a secret value here.</strong> Record the variable <em>name</em> and where the value is kept (for example “password manager entry ‘Media Studio API key’”). Anything that looks like a key, token or password is rejected. Recording a status does not rotate, revoke or verify anything: it is your note of what happened.</div>
        </div>
        {err && <div className="ai-formerr" role="alert">{err}</div>}
        <div className="ai-form">
          <Field label="Credential name">{(p) => <input {...p} value={v.name} onChange={set('name')} maxLength={120} autoComplete="off" />}</Field>
          <Field label="Provider">{(p) => <input {...p} value={v.provider} onChange={set('provider')} maxLength={80} autoComplete="off" />}</Field>
          <Field label="Environment">{(p) => <select {...p} value={v.environment} onChange={set('environment')}>{['production', 'staging', 'development', 'all'].map((e) => <option key={e} value={e}>{e}</option>)}</select>}</Field>
          <Field label="Environment variable name" hint="The variable NAME only (e.g. SOME_SERVICE_KEY), never its value.">{(p) => <input {...p} value={v.envVarName} onChange={set('envVarName')} maxLength={80} autoComplete="off" spellCheck="false" />}</Field>
          <div className="ai-span"><Field label="Associated applications" hint="Comma separated.">{(p) => <input {...p} value={v.applications} onChange={set('applications')} autoComplete="off" />}</Field></div>
          <div className="ai-span"><Field label="Purpose">{(p) => <input {...p} value={v.purpose} onChange={set('purpose')} maxLength={500} autoComplete="off" />}</Field></div>
          <div className="ai-span"><Field label="Permissions / scope">{(p) => <input {...p} value={v.permissions} onChange={set('permissions')} maxLength={500} autoComplete="off" />}</Field></div>
          <div className="ai-span"><Field label="Where the value is stored (reference only)" hint="A location, never the value.">{(p) => <input {...p} value={v.storageReference} onChange={set('storageReference')} maxLength={300} autoComplete="off" />}</Field></div>
          <Field label="Status">{(p) => <select {...p} value={v.status} onChange={set('status')}>{Object.entries(CREDENTIAL_STATUS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select>}</Field>
          <Field label="How sure are you?" hint="“Verified” needs evidence and a date.">{(p) => <select {...p} value={v.verification} onChange={set('verification')}>{Object.entries(VERIFICATION).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select>}</Field>
          <Field label="Last verified">{(p) => <input {...p} type="date" value={v.lastVerifiedAt} onChange={set('lastVerifiedAt')} />}</Field>
          <Field label="Last rotated" hint="Only if it really happened; needs evidence.">{(p) => <input {...p} type="date" value={v.lastRotatedAt} onChange={set('lastRotatedAt')} />}</Field>
          <Field label="Next review">{(p) => <input {...p} type="date" value={v.nextReviewAt} onChange={set('nextReviewAt')} />}</Field>
          <Field label="Rotation order (1 = first)">{(p) => <input {...p} type="number" min="1" max="99" value={v.rotationStep} onChange={set('rotationStep')} />}</Field>
          <div className="ai-span"><Field label="Evidence" hint="What you checked and where (e.g. “Railway variables page, 2026-10-12”).">{(p) => <textarea {...p} value={v.evidence} onChange={set('evidence')} maxLength={1000} />}</Field></div>
          <div className="ai-span"><Field label="Migration notes">{(p) => <textarea {...p} value={v.migrationNotes} onChange={set('migrationNotes')} maxLength={1500} />}</Field></div>
          <div className="ai-span"><Field label="Impact if revoked">{(p) => <textarea {...p} value={v.revocationImpact} onChange={set('revocationImpact')} maxLength={1000} />}</Field></div>
          <div className="ai-span"><Field label="Rollback notes">{(p) => <textarea {...p} value={v.rollbackNotes} onChange={set('rollbackNotes')} maxLength={1500} />}</Field></div>
        </div>
        <h3 style={{ margin: '16px 0 6px', fontSize: 14 }}>Known consumers</h3>
        {v.consumers.map((c, i) => (
          <fieldset key={i} className="ai-consumer">
            <legend className="ai-visually-hidden">Consumer {i + 1}</legend>
            <div className="ai-form">
              <Field label="Consumer (app or service)">{(p) => <input {...p} value={c.name} onChange={(e) => setConsumer(i, 'name', e.target.value)} maxLength={120} />}</Field>
              <Field label="Authentication method">{(p) => <input {...p} value={c.authMethod} onChange={(e) => setConsumer(i, 'authMethod', e.target.value)} maxLength={120} />}</Field>
              <Field label="Environment">{(p) => <select {...p} value={c.environment} onChange={(e) => setConsumer(i, 'environment', e.target.value)}>{['production', 'staging', 'development', 'all'].map((e) => <option key={e} value={e}>{e}</option>)}</select>}</Field>
              <Field label="Evidence level">{(p) => <select {...p} value={c.verification} onChange={(e) => setConsumer(i, 'verification', e.target.value)}>{Object.entries(VERIFICATION).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select>}</Field>
              <Field label="Migration">{(p) => <select {...p} value={c.migration} onChange={(e) => setConsumer(i, 'migration', e.target.value)}>{Object.entries(MIGRATION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</Field>
              <Field label="Impact if this changes">{(p) => <input {...p} value={c.impact} onChange={(e) => setConsumer(i, 'impact', e.target.value)} maxLength={400} />}</Field>
            </div>
            <Button size="sm" variant="ghost" icon="trash" onClick={() => setV((x) => ({ ...x, consumers: x.consumers.filter((_, j) => j !== i) }))}>Remove consumer</Button>
          </fieldset>
        ))}
        <Button size="sm" icon="plus" onClick={() => setV((x) => ({ ...x, consumers: [...x.consumers, { ...EMPTY_CONSUMER }] }))}>Add consumer</Button>
      </form>
    </Dialog>
  );
}
