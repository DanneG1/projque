import { useEffect, useState } from "react";
import { api } from "../api/ipc";
import type { TranscriptMeta } from "../models";
import { useAppStore } from "../store/useAppStore";
import { formatBytes, relativeTime } from "../utils/time";
import { Icon } from "./Icon";
import styles from "./TranscriptsPanel.module.css";

/** Past agent sessions for this project: what happened, summarized on
 *  request, so nobody has to remember what was done two sessions ago. */
export function TranscriptsPanel({ projectId }: { projectId: string }) {
  const reportError = useAppStore((s) => s.reportError);
  const sessions = useAppStore((s) => s.sessions);
  const [items, setItems] = useState<TranscriptMeta[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Re-list whenever a session of this project ends.
  const exitedKey = sessions
    .filter((v) => v.projectId === projectId && v.status.state === "exited")
    .map((v) => v.sessionId)
    .join(",");
  useEffect(() => {
    let cancelled = false;
    api.transcriptsList(projectId).then((t) => !cancelled && setItems(t)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, exitedKey]);

  if (!items || items.length === 0) return null;

  const summarize = async (file: string) => {
    setBusy(file);
    try {
      const summary = await api.transcriptSummarize(projectId, file);
      setItems((all) => (all ?? []).map((t) => (t.file === file ? { ...t, summary } : t)));
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (file: string) => {
    try {
      await api.transcriptDelete(projectId, file);
      setItems((all) => (all ?? []).filter((t) => t.file !== file));
    } catch (err) {
      reportError(err);
    }
  };

  const shown = open ? items : items.slice(0, 3);

  return (
    <section className={styles.section}>
      <div className={styles.head}>
        <h2 className={styles.title}>Past sessions</h2>
        <span className={styles.muted}>{items.length} saved</span>
        <div className={styles.spacer} />
        <button className="btn btn-ghost" title="Open the transcripts folder" onClick={() => void api.transcriptsOpenFolder(projectId)}>
          <Icon name="folder" size={13} />
        </button>
      </div>
      <ul className={styles.list}>
        {shown.map((t) => (
          <li key={t.file} className={styles.item}>
            <div className={styles.row}>
              <span className={styles.when}>{relativeTime(t.startedAt)}</span>
              <span className={styles.agent}>{t.agentLabel}</span>
              <span className={styles.muted}>{formatBytes(t.bytes)}</span>
              <div className={styles.spacer} />
              {!t.summary && (
                <button
                  className="btn"
                  disabled={busy === t.file}
                  title="Ask Claude what happened in this session (uses your Claude Code account)"
                  onClick={() => void summarize(t.file)}
                >
                  {busy === t.file ? "Asking Claude…" : "What did we do?"}
                </button>
              )}
              <button className={styles.link} title="Delete this transcript" onClick={() => void remove(t.file)}>
                ✕
              </button>
            </div>
            {t.summary && <pre className={styles.summary}>{t.summary}</pre>}
          </li>
        ))}
      </ul>
      {items.length > 3 && (
        <button className={styles.link} onClick={() => setOpen((v) => !v)}>
          {open ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </section>
  );
}
