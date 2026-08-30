import { useEffect, useState } from "react";
import { api } from "../api/ipc";
import type { GitCommit, GitInfo, Snapshot } from "../models";
import { useAppStore } from "../store/useAppStore";
import { relativeTime } from "../utils/time";
import styles from "./HistoryPanel.module.css";

/** Commit history plus automatic backups, each restorable. Real git words,
 *  plain-language explanations - restore never loses anything (the current
 *  state is snapshotted first, and the old version lands as a new commit). */
export function HistoryPanel({
  projectId,
  gitInfo,
}: {
  projectId: string;
  gitInfo: GitInfo;
}) {
  const busy = useAppStore((s) => s.gitBusy[projectId] ?? false);
  const restoreVersion = useAppStore((s) => s.restoreVersion);
  const reportError = useAppStore((s) => s.reportError);
  const sessions = useAppStore((s) => s.sessions);

  const [open, setOpen] = useState(false);
  const [commits, setCommits] = useState<GitCommit[] | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);

  const hasRunningSession = sessions.some(
    (s) => s.projectId === projectId && s.status.state === "running",
  );

  const load = () => {
    api.gitHistory(projectId, 20).then(setCommits).catch(reportError);
    api.gitSnapshots(projectId).then(setSnapshots).catch(() => setSnapshots([]));
  };

  // Refresh after every git mutation (commit/restore bump fetchedAt).
  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, gitInfo.fetchedAt]);

  const restore = async (hash: string) => {
    setConfirming(null);
    if (await restoreVersion(projectId, hash)) load();
  };

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        History &amp; backups…
      </button>
    );
  }

  const row = (
    hash: string,
    shortHash: string,
    title: string,
    timestamp: number,
    isCurrent: boolean,
  ) => (
    <li key={hash} className={styles.item}>
      <span className={styles.subject} title={title}>
        {title}
      </span>
      <span className={styles.meta}>
        {shortHash} · {relativeTime(timestamp)}
      </span>
      {isCurrent ? (
        <span className={styles.current}>current</span>
      ) : confirming === hash ? (
        <span className={styles.confirm}>
          <button className="btn" disabled={busy} onClick={() => void restore(hash)}>
            {busy ? "Working…" : "Yes, restore"}
          </button>
          <button className="btn" onClick={() => setConfirming(null)}>
            Cancel
          </button>
        </span>
      ) : (
        <button
          className="btn"
          disabled={busy}
          title="Make your files match this version. Your current state is backed up automatically first - nothing is lost."
          onClick={() => setConfirming(hash)}
        >
          Restore
        </button>
      )}
    </li>
  );

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <h3 className={styles.title}>History</h3>
        <button className="btn" onClick={() => setOpen(false)}>
          Hide
        </button>
      </div>
      <p className={styles.hint}>
        Every commit is a version you can go back to. Restoring makes your
        files match that version - it is recorded as a new commit, and your
        current state is backed up first, so nothing is ever lost.
        {hasRunningSession && (
          <strong> An agent is running in this project - stop it before restoring.</strong>
        )}
      </p>
      {confirming && (
        <p className={styles.confirmHint}>
          Make your files match this version? Your current state is backed up
          automatically first.
        </p>
      )}
      {commits === null ? (
        <p className={styles.hint}>Loading…</p>
      ) : commits.length === 0 ? (
        <p className={styles.hint}>No commits yet.</p>
      ) : (
        <ul className={styles.list}>
          {commits.map((c, i) =>
            row(c.hash, c.shortHash, c.subject, c.timestamp, i === 0),
          )}
        </ul>
      )}
      {snapshots.length > 0 && (
        <>
          <h4 className={styles.subTitle}>Automatic backups</h4>
          <p className={styles.hint}>
            Taken before each agent session and each restore. Kept out of your
            commit history and never uploaded.
          </p>
          <ul className={styles.list}>
            {snapshots.map((s) => row(s.hash, s.shortHash, s.reason, s.timestamp, false))}
          </ul>
        </>
      )}
    </div>
  );
}
