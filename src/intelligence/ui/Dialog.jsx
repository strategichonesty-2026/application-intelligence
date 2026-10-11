import { useEffect, useRef } from 'react';
import Icon from './Icon';
import { Button } from './primitives';

// Built on the native <dialog>: the browser provides the focus trap, Escape to
// close, inert background and focus return. We only style it and wire onClose.
export function Dialog({ open, title, onClose, children, footer, width = 520, labelledBy = 'ai-dialog-title' }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref} className="ai-dialog" style={{ maxWidth: width }} aria-labelledby={labelledBy}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      {open && (
        <div className="ai-dialog__panel">
          <header className="ai-dialog__head">
            <h2 id={labelledBy}>{title}</h2>
            <button type="button" className="ai-iconbtn" aria-label="Close dialog" onClick={onClose}><Icon name="x" size={18} /></button>
          </header>
          <div className="ai-dialog__body">{children}</div>
          {footer && <footer className="ai-dialog__foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

// For consequential changes only: deleting, pausing, repointing a check.
export function ConfirmDialog({ open, title, children, confirmLabel, danger = false, busy = false, onConfirm, onCancel }) {
  return (
    <Dialog
      open={open} title={title} onClose={busy ? () => {} : onCancel} labelledBy="ai-confirm-title" width={460}
      footer={(
        <>
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      )}
    >
      {children}
    </Dialog>
  );
}
