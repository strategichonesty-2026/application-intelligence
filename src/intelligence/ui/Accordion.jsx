import { useCallback, useState } from 'react';
import Icon from './Icon';
import { Button } from './primitives';

/** Which accordion rows are open. Keeping it in one place lets "Expand all" / "Collapse all" work. */
export function useOpenSet(initial = []) {
  const [open, setOpen] = useState(() => new Set(initial));
  const set = useCallback((id, value) => setOpen((s) => { if (s.has(id) === value) return s; const n = new Set(s); if (value) n.add(id); else n.delete(id); return n; }), []);
  const expand = useCallback((ids) => setOpen(new Set(ids)), []);
  const collapse = useCallback(() => setOpen(new Set()), []);
  return { isOpen: (id) => open.has(id), set, expand, collapse };
}

/** One row: a summary line that is always visible, and details that open on click (native <details>, so keyboard and screen readers work). */
export function AccordionItem({ id, state, summary, children }) {
  return (
    <details className="ai-acc" open={state.isOpen(id)} onToggle={(e) => state.set(id, e.currentTarget.open)}>
      <summary className="ai-acc__sum">
        <Icon name="chevron-right" size={16} className="ai-acc__chev" />
        <span className="ai-acc__line">{summary}</span>
      </summary>
      <div className="ai-acc__body">{children}</div>
    </details>
  );
}

export function AccordionBar({ ids, state, label }) {
  return (
    <div className="ai-acc__bar">
      <span className="ai-muted">{label}</span>
      <span style={{ display: 'flex', gap: 6 }}>
        <Button size="sm" onClick={() => state.expand(ids)}>Expand all</Button>
        <Button size="sm" onClick={state.collapse}>Collapse all</Button>
      </span>
    </div>
  );
}
