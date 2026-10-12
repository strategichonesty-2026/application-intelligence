import { useState } from 'react';
import { Button, Card } from '../ui/primitives';
import { Badge } from '../ui/StatusBadge';
import { Banner } from '../ui/StateMessage';
import { monitoringApi } from '../data/api';

const QUICK = [
  { label: "What's wrong?", q: "What's wrong?" },
  { label: 'Apps', q: 'Are my apps up?' },
  { label: 'Keys', q: 'Any problems with my keys?' },
  { label: 'Money', q: 'What do I pay for, anything due?' },
];
const SEV = {
  critical: { label: 'Critical', tone: 'bad', icon: 'octagon-alert' },
  attention: { label: 'Needs attention', tone: 'warn', icon: 'alert-triangle' },
  info: { label: 'Good to know', tone: 'neutral', icon: 'info' },
};

/** Ask in plain words. The answer comes from your own records by fixed rules: no AI, no cost, no outside call. */
export default function AskPanel() {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const ask = async (q) => {
    setBusy(true); setError(null);
    try { setResult(await monitoringApi.ask(q)); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const submit = (e) => { e.preventDefault(); ask(question || "What's wrong?"); };

  return (
    <Card title="Ask: what is wrong?" subtitle="Type a question or tap a button. The answer is worked out from your own records. It does not use AI and costs nothing.">
      <form onSubmit={submit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input type="text" aria-label="Your question" placeholder="What's wrong? What am I missing?" maxLength={300} value={question}
          onChange={(e) => setQuestion(e.target.value)} style={{ flex: '1 1 220px', minHeight: 36, padding: '0 10px' }} />
        <Button variant="primary" type="submit" loading={busy}>Ask</Button>
      </form>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {QUICK.map((c) => <Button key={c.label} size="sm" onClick={() => { setQuestion(c.q); ask(c.q); }}>{c.label}</Button>)}
      </div>
      {error && <div style={{ marginTop: 12 }}><Banner tone="bad">{error}</Banner></div>}
      {result && (
        <div style={{ marginTop: 14 }} aria-live="polite">
          <Banner tone={result.level === 'critical' ? 'bad' : result.level === 'attention' ? 'warn' : 'info'}>{result.headline}</Banner>
          {result.items.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {result.items.map((i, n) => {
                const m = SEV[i.severity];
                return (
                  <li key={n} style={{ borderTop: '1px solid var(--ai-border, #e5e7eb)', paddingTop: 10 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><Badge tone={m.tone} icon={m.icon}>{m.label}</Badge><strong>{i.title}</strong></div>
                    {i.detail ? <p className="ai-field__hint" style={{ margin: '4px 0 0' }}>{i.detail}</p> : null}
                    <p style={{ margin: '4px 0 0' }}><strong>To do:</strong> {i.action}</p>
                  </li>
                );
              })}
            </ul>
          )}
          {result.notes.map((t, n) => <p key={n} className="ai-field__hint" style={{ marginTop: 8 }}>{t}</p>)}
        </div>
      )}
    </Card>
  );
}
