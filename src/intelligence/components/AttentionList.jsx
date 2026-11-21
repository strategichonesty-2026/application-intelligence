import { Card } from '../ui/primitives';
import { Badge } from '../ui/StatusBadge';
import { StateMessage } from '../ui/StateMessage';
import { hrefTo } from '../data/useRoute';
import { absoluteTime, relativeTime } from '../data/format';

const TONE = { high: 'bad', medium: 'warn', low: 'neutral' };
const ICON = { high: 'octagon-alert', medium: 'alert-triangle', low: 'info' };

/** Turns the server's "/path?x=y" into a console link. */
export function linkFor(href) {
  const [path, query = ''] = String(href || '/').split('?');
  return hrefTo(path === '/' ? '' : path, Object.fromEntries(new URLSearchParams(query)));
}

/** What needs the owner's attention. Every item shows its evidence and when that evidence was read. */
export default function AttentionList({ data }) {
  const { items, total, numbers } = data;
  return (
    <>
      <Card title="Needs your attention" subtitle="Only things this console has actually checked or that you recorded. Anything not checked is never shown as fine." flush>
        {items.length ? (
          <ul className="ai-attn">
            {items.map((i) => (
              <li key={i.id} className="ai-attn__item">
                <Badge tone={TONE[i.level]} icon={ICON[i.level]}>{i.label}</Badge>
                <div className="ai-attn__main">
                  <strong>{i.title}</strong>
                  <span className="ai-sub">Evidence: {i.evidence}{i.checkedAt ? <> · read <time dateTime={i.checkedAt} title={absoluteTime(i.checkedAt)}>{relativeTime(i.checkedAt)}</time></> : null}</span>
                </div>
                <a className="ai-attn__act" href={linkFor(i.href)}>{i.action}</a>
              </li>
            ))}
            {total > items.length && <li className="ai-attn__more ai-muted">{total - items.length} more not shown.</li>}
          </ul>
        ) : (
          <StateMessage icon="check-circle" tone="ok" compact title="Nothing needs attention right now">
            Based on what this console has checked and what you have recorded. Anything not yet checked is not counted as fine.
          </StateMessage>
        )}
      </Card>
      <div className="ai-summary" role="group" aria-label="At a glance">
        {[['Repositories', numbers.repositories, 'found on GitHub'], ['Applications', numbers.confirmedApplications, 'confirmed by you'], ['Active', numbers.pushedLast14Days, 'pushed in the last 14 days'], ['Need a type', numbers.needType, 'not yet confirmed']].map(([label, value, note]) => (
          <div key={label} className="ai-stat ai-stat--neutral"><div className="ai-stat__label"><span>{label}</span></div><div className="ai-stat__value">{value}</div><div className="ai-stat__note">{note}</div></div>
        ))}
      </div>
    </>
  );
}
