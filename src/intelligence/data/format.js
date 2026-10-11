// Presentation helpers only: turn stored timestamps and numbers into readable text.
// A missing value always renders as an explicit dash, never as 0 or "just now".

export const DASH = '—';

export function relativeTime(iso, now = Date.now()) {
  if (!iso) return null;
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diff < 0) return 'just now';
  if (diff < 45) return 'just now';
  if (diff < 90) return '1 min ago';
  const mins = Math.round(diff / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function absoluteTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export function clockTime(iso) {
  if (!iso) return DASH;
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatMs(ms) {
  if (ms === null || ms === undefined) return DASH;
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

export function formatDuration(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  const secs = Math.max(0, Math.round((new Date(toIso) - new Date(fromIso)) / 1000));
  if (secs < 60) return `${secs} sec`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) return rem ? `${hrs} hr ${rem} min` : `${hrs} hr`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ${hrs % 24} hr`;
}

export function formatInterval(seconds) {
  if (seconds % 3600 === 0) return `${seconds / 3600} hr`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} sec`;
}

export const MODE_LABEL = {
  daily: 'Daily check, plus manual',
  manual: 'Manual (Check now / Check all)',
  manual_only: 'Manual only, this application alone',
};
export const MODE_HELP = {
  daily: 'Included in the optional daily check when the owner has switched it on, and in Check all.',
  manual: 'Checked only when you click Check now or Check all.',
  manual_only: 'Checked only when you click Check now on this application. Never included in Check all or any schedule.',
};

export function hostOf(url) {
  try { return new URL(url).host; } catch { return url; }
}
