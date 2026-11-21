import { useEffect, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/primitives';
import { portfolioApi } from '../data/api';
import { useToast } from '../ui/Toast';
import { parseImport, importSummary, IMPORT_EXAMPLE } from '../data/portfolioView';

/** Paste a list of records, preview exactly what would happen, then add them. Nothing is written until you confirm. */
export default function PortfolioImport({ open, onClose, onDone }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setText(''); setPreview(null); setErr(''); } }, [open]);

  const run = async (dryRun) => {
    const parsed = parseImport(text);
    if (parsed.error) { setErr(parsed.error); setPreview(null); return; }
    setBusy(true); setErr('');
    try {
      const res = await portfolioApi.importItems(parsed.items, dryRun);
      if (dryRun) setPreview(res);
      else { toast.success(`Import finished: ${importSummary(res)}.`); onDone(); onClose(); }
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={busy ? () => {} : onClose} width={720} title="Import portfolio records"
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => run(true)} loading={busy && !preview} disabled={busy}>Preview</Button>
          <Button variant="primary" onClick={() => run(false)} loading={busy && Boolean(preview)} disabled={busy || !preview || !preview.added.length}>{preview ? `Add ${preview.added.length} record${preview.added.length === 1 ? '' : 's'}` : 'Add records'}</Button>
        </>
      )}>
      <p className="ai-sub" style={{ marginBottom: 8 }}>Paste a list of records as JSON. Every record is checked like a form entry; duplicates are skipped and nothing is overwritten. The records stay in this console’s database.</p>
      <div style={{ marginBottom: 8 }}><Button size="sm" onClick={() => { setText(IMPORT_EXAMPLE); setPreview(null); setErr(''); }}>Insert an example</Button></div>
      <textarea className="ai-import__box" aria-label="Records as JSON" rows={10} value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} spellCheck="false" />
      {err && <div className="ai-formerr" role="alert" style={{ marginTop: 8 }}>{err}</div>}
      {preview && (
        <div className="ai-callout ai-callout--neutral" style={{ marginTop: 8 }} role="status">
          <div>
            <strong>Preview: {importSummary(preview)}.</strong> Nothing has been saved yet.
            {preview.invalid.length > 0 && (
              <ul className="ai-bullets">{preview.invalid.map((x) => <li key={x.index}>Record {x.index + 1}{x.title ? ` (“${x.title}”)` : ''}: {x.errors.join(' ')}</li>)}</ul>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
