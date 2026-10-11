import { formatMs, absoluteTime } from '../data/format';

const W = 640; const H = 180; const PAD = { l: 48, r: 12, t: 12, b: 26 };

function niceMax(v) {
  const steps = [100, 200, 500, 1000, 2000, 5000, 10000, 30000];
  return steps.find((s) => s >= v * 1.1) || Math.ceil(v * 1.1);
}

/**
 * Response-time history from real check records. Rendered only when there are
 * enough measured points to show a shape; the caller shows an explanatory state
 * otherwise. Failed checks (no response) are marked on the baseline, not drawn
 * as 0 ms.
 */
export default function ResponseChart({ points, slowThresholdMs }) {
  const measured = points.filter((p) => p.responseMs !== null && p.responseMs !== undefined);
  const failed = points.filter((p) => p.outcome === 'failed' && (p.responseMs === null || p.responseMs === undefined));
  const t0 = new Date(points[0].checkedAt).getTime();
  const t1 = new Date(points[points.length - 1].checkedAt).getTime();
  const span = Math.max(1, t1 - t0);
  const maxMs = niceMax(Math.max(...measured.map((p) => p.responseMs), slowThresholdMs || 0));
  const x = (iso) => PAD.l + ((new Date(iso).getTime() - t0) / span) * (W - PAD.l - PAD.r);
  const y = (ms) => PAD.t + (1 - ms / maxMs) * (H - PAD.t - PAD.b);
  const line = measured.map((p, i) => `${i ? 'L' : 'M'}${x(p.checkedAt).toFixed(1)},${y(p.responseMs).toFixed(1)}`).join(' ');
  const sorted = measured.map((p) => p.responseMs).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const ticks = [0, 0.5, 1].map((f) => Math.round(maxMs * f));
  const fmtT = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="ai-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Response time over ${measured.length} checks. Median ${median} milliseconds, fastest ${sorted[0]}, slowest ${sorted[sorted.length - 1]}. ${failed.length} checks received no response.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#e3e6ec" />
            <text className="ai-chart__axis" x={PAD.l - 8} y={y(t) + 4} textAnchor="end">{t >= 1000 ? `${t / 1000}s` : `${t}ms`}</text>
          </g>
        ))}
        {slowThresholdMs && slowThresholdMs < maxMs && (
          <g>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(slowThresholdMs)} y2={y(slowThresholdMs)} stroke="#d97706" strokeDasharray="4 4" />
            <text className="ai-chart__axis" x={W - PAD.r} y={y(slowThresholdMs) - 4} textAnchor="end">slow limit {formatMs(slowThresholdMs)}</text>
          </g>
        )}
        <path d={line} fill="none" stroke="#1d3f8f" strokeWidth="2" strokeLinejoin="round" />
        {measured.length <= 60 && measured.map((p) => (
          <circle key={p.checkedAt} cx={x(p.checkedAt)} cy={y(p.responseMs)} r="2.5" fill="#1d3f8f"><title>{`${absoluteTime(p.checkedAt)}: ${p.responseMs} ms`}</title></circle>
        ))}
        {failed.map((p) => (
          <g key={`f${p.checkedAt}`} stroke="#dc2626" strokeWidth="2" strokeLinecap="round">
            <title>{`${absoluteTime(p.checkedAt)}: no response`}</title>
            <path d={`M${x(p.checkedAt) - 3},${H - PAD.b - 7} l6,6 m0,-6 l-6,6`} />
          </g>
        ))}
        <text className="ai-chart__axis" x={PAD.l} y={H - 6}>{fmtT(t0)}</text>
        <text className="ai-chart__axis" x={W - PAD.r} y={H - 6} textAnchor="end">{fmtT(t1)}</text>
      </svg>
      <div className="ai-chart__summary">
        <span>Median <strong>{formatMs(median)}</strong></span>
        <span>Fastest <strong>{formatMs(sorted[0])}</strong></span>
        <span>Slowest <strong>{formatMs(sorted[sorted.length - 1])}</strong></span>
        <span><strong>{measured.length}</strong> checks measured</span>
        {failed.length > 0 && <span><strong>{failed.length}</strong> with no response (marked ×)</span>}
      </div>
    </div>
  );
}
