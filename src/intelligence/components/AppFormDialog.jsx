import { useEffect, useState } from 'react';
import { Dialog, ConfirmDialog } from '../ui/Dialog';
import { Button, Field } from '../ui/primitives';
import { monitoringApi } from '../data/api';
import { useToast } from '../ui/Toast';
import { MODE_LABEL, MODE_HELP } from '../data/format';

const EMPTY = {
  name: '', description: '', url: '', environment: 'production', checkType: 'homepage', checkPath: '/health',
  expectedStatus: 200, mode: 'manual', timeoutMs: 8000, slowThresholdMs: '', enabled: true,
};

function fromApplication(a) {
  return {
    name: a.name, description: a.description || '', url: a.url, environment: a.environment, checkType: a.check.type,
    checkPath: a.check.path || '/health', expectedStatus: a.check.expectedStatus, mode: a.mode || 'manual',
    timeoutMs: a.check.timeoutMs, slowThresholdMs: a.check.slowThresholdMs == null ? '' : a.check.slowThresholdMs, enabled: a.enabled,
  };
}

function validate(v) {
  const e = {};
  if (!v.name.trim()) e.name = 'Enter a name.';
  try {
    const u = new URL(v.url.trim());
    if (!['http:', 'https:'].includes(u.protocol)) e.url = 'Use an http:// or https:// address.';
    else if (u.username || u.password) e.url = 'Remove the username and password. Credentials must not be stored here.';
  } catch { e.url = 'Enter a full URL, for example https://app.example.com.'; }
  if (v.mode === 'manual_only' && v.checkType !== 'health_endpoint') e.checkType = 'A manual-only application must use a health endpoint check.';
  if (v.checkType === 'health_endpoint' && !String(v.checkPath).startsWith('/')) e.checkPath = 'The path must start with / (for example /health).';
  return e;
}

/** Register (application = null) or edit an application. */
export default function AppFormDialog({ open, application, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(application);
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (open) { setValues(application ? fromApplication(application) : EMPTY); setErrors({}); setServerError(''); setConfirming(false); }
  }, [open, application]);

  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const consequential = () => {
    if (!editing) return [];
    const o = fromApplication(application); const out = [];
    if (values.url.trim() !== o.url) out.push('the registered URL');
    if (values.checkType !== o.checkType) out.push('the check type');
    if (values.checkType === 'health_endpoint' && values.checkPath !== o.checkPath) out.push('the health endpoint path');
    if (o.enabled && !values.enabled) out.push('monitoring (it will be paused and no new checks will run)');
    return out;
  };

  const payload = () => ({
    name: values.name.trim(), description: values.description.trim(), url: values.url.trim(), environment: values.environment,
    checkType: values.checkType, checkPath: values.checkType === 'health_endpoint' ? values.checkPath.trim() : '',
    expectedStatus: Number(values.expectedStatus), mode: values.mode,
    timeoutMs: Number(values.timeoutMs), slowThresholdMs: values.slowThresholdMs === '' ? null : Number(values.slowThresholdMs), enabled: values.enabled,
  });

  const save = async () => {
    setBusy(true); setServerError('');
    try {
      const res = editing ? await monitoringApi.update(application.id, payload()) : await monitoringApi.register(payload());
      toast.success(editing ? `Saved changes to ${res.application.name}.` : `${res.application.name} is registered. ${res.application.mode === 'manual_only' ? 'It will only be checked when you click Check now.' : 'Its first check has run.'}`);
      setConfirming(false); onSaved(res.application); onClose();
    } catch (err) {
      setConfirming(false); setServerError(err.message);
    } finally { setBusy(false); }
  };

  const submit = (e) => {
    e.preventDefault();
    const found = validate(values); setErrors(found);
    if (Object.keys(found).length) return;
    if (consequential().length) setConfirming(true); else save();
  };

  const changes = consequential();
  return (
    <>
      <Dialog open={open && !confirming} onClose={busy ? () => {} : onClose} width={640} title={editing ? `Edit ${application.name}` : 'Register an application'}
        footer={(
          <>
            <Button onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" type="submit" form="ai-app-form" loading={busy}>{editing ? 'Save changes' : 'Register and run first check'}</Button>
          </>
        )}>
        <form id="ai-app-form" onSubmit={submit} noValidate>
          {serverError && <div className="ai-formerr" role="alert">{serverError}</div>}
          <div className="ai-form">
            <div className="ai-span"><Field label="Application name" error={errors.name}>
              {(p) => <input {...p} value={values.name} onChange={set('name')} maxLength={80} autoComplete="off" />}
            </Field></div>
            <div className="ai-span"><Field label="Description (optional)" hint="What the application does and who uses it.">
              {(p) => <textarea {...p} value={values.description} onChange={set('description')} maxLength={400} />}
            </Field></div>
            <div className="ai-span"><Field label="Application URL" error={errors.url} hint="The address people use. It is opened by the “Open application” action.">
              {(p) => <input {...p} type="url" inputMode="url" value={values.url} onChange={set('url')} placeholder="https://app.example.com" autoComplete="off" />}
            </Field></div>
            <Field label="Environment">
              {(p) => <select {...p} value={values.environment} onChange={set('environment')}>
                <option value="production">Production</option><option value="staging">Staging</option><option value="development">Development</option>
              </select>}
            </Field>
            <Field label="Check type" hint={values.checkType === 'homepage' ? 'Only proves the URL answers. It will show as “Reachable”, never “Healthy”.' : 'Checks a dedicated health endpoint and reads its status.'}>
              {(p) => <select {...p} value={values.checkType} onChange={set('checkType')}>
                <option value="homepage">Homepage reachability</option><option value="health_endpoint">Health endpoint</option>
              </select>}
            </Field>
            {values.checkType === 'health_endpoint' && (
              <div className="ai-span"><Field label="Health endpoint path" error={errors.checkPath} hint="Must return JSON such as {“status”: “ok”}. The response body is read but never stored.">
                {(p) => <input {...p} value={values.checkPath} onChange={set('checkPath')} placeholder="/health" autoComplete="off" />}
              </Field></div>
            )}
            <Field label="How it is checked" hint={MODE_HELP[values.mode]}>
              {(p) => <select {...p} value={values.mode} onChange={set('mode')}>
                {Object.keys(MODE_LABEL).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
              </select>}
            </Field>
            <Field label="Expected HTTP status">
              {(p) => <input {...p} type="number" min="100" max="599" value={values.expectedStatus} onChange={set('expectedStatus')} />}
            </Field>
            <Field label="Timeout (ms)" hint="No answer within this time counts as a failed check.">
              {(p) => <input {...p} type="number" min="1000" max="30000" step="500" value={values.timeoutMs} onChange={set('timeoutMs')} />}
            </Field>
            <Field label="Slow-response limit (ms, optional)" hint="Leave blank for none. Only set this once you have agreed what 'too slow' means for this application: slower answers then show as Degraded.">
              {(p) => <input {...p} type="number" min="100" max="30000" step="100" value={values.slowThresholdMs} onChange={set('slowThresholdMs')} placeholder="No limit" />}
            </Field>
            <div className="ai-span">
              <label className="ai-check"><input type="checkbox" checked={values.enabled} onChange={set('enabled')} />
                <span><strong>Monitoring enabled</strong><br /><span className="ai-muted">Untick to pause checks without losing history.</span></span>
              </label>
            </div>
          </div>
        </form>
      </Dialog>
      <ConfirmDialog open={open && confirming} title="Confirm monitoring change" confirmLabel="Apply change" busy={busy}
        onCancel={() => setConfirming(false)} onConfirm={save}>
        <p>You are changing {changes.join(', ')} for <strong>{application && application.name}</strong>.</p>
        <p className="ai-muted">Existing history stays, but the next check uses the new settings, so the application may briefly show a different status.</p>
      </ConfirmDialog>
    </>
  );
}
