import { useState } from 'react';
import { Button } from '../ui/primitives';
import { Banner } from '../ui/StateMessage';
import { useToast } from '../ui/Toast';
import { reposApi } from '../data/api';
import { absoluteTime, relativeTime } from '../data/format';

/** GitHub sync: when it last ran, what it found, and the manual button. Read-only toward GitHub. */
export default function SyncBar({ sync, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const last = sync && sync.last;
  const run = async () => {
    setBusy(true);
    try {
      const { sync: s } = await reposApi.sync();
      toast.success(`Sync finished: ${s.found} repositories found, ${s.scanned} read${s.errors.length ? `, ${s.errors.length} could not be read` : ''}.`);
    } catch (err) { toast.error(`The sync could not be completed: ${err.message}`); }
    finally { setBusy(false); onDone(); }
  };
  if (sync && !sync.configured) {
    return (
      <Banner tone="warn">
        <strong>GitHub is not connected yet.</strong> Repositories appear after the server owner adds a read-only token (GITHUB_TOKEN) to the server settings. Nothing is requested from GitHub until then.
      </Banner>
    );
  }
  return (
    <div className="ai-syncbar">
      <div>
        <strong>{last && last.finishedAt ? <>Last sync <time dateTime={last.finishedAt} title={absoluteTime(last.finishedAt)}>{relativeTime(last.finishedAt)}</time></> : 'Never synced'}</strong>
        <span className="ai-sub">
          {last && last.ok ? `${last.found} repositories found for ${last.owner}` : last ? `Failed: ${(last.errors.find((e) => e.message) || {}).message || 'see the status above'}. Earlier data is kept.` : `Reads repositories owned by ${sync ? sync.owner : 'your organization'}. Read-only.`}
        </span>
      </div>
      <Button variant="primary" icon="refresh" loading={busy} onClick={run}>Sync now</Button>
    </div>
  );
}
