import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import Icon from './Icon';

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

// Confirmation / failure feedback for actions. Announced politely to screen readers.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((tone, message) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-2), { id, tone, message }]);
    setTimeout(() => dismiss(id), tone === 'bad' ? 9000 : 5000);
  }, [dismiss]);

  const api = useMemo(() => ({
    success: (m) => push('ok', m), error: (m) => push('bad', m), info: (m) => push('info', m),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ai-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`ai-toast ai-toast--${t.tone}`}>
            <Icon name={t.tone === 'ok' ? 'check-circle' : t.tone === 'bad' ? 'x-circle' : 'info'} size={18} />
            <span>{t.message}</span>
            <button type="button" className="ai-iconbtn" aria-label="Dismiss message" onClick={() => dismiss(t.id)}><Icon name="x" size={16} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
