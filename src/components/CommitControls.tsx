import { useState } from "react";
import { api } from "../api/ipc";
import type { GitInfo } from "../models";
import { useAppStore } from "../store/useAppStore";
import styles from "./CommitControls.module.css";

const SUGGESTION_MARKER = "SUGGESTED COMMIT MESSAGE:";

/** Split Claude's answer into the prose summary and the suggested message. */
function parseSummary(raw: string): { summary: string; suggestion: string | null } {
  const idx = raw.lastIndexOf(SUGGESTION_MARKER);
  if (idx === -1) return { summary: raw.trim(), suggestion: null };
  const suggestion = raw
    .slice(idx + SUGGESTION_MARKER.length)
    .split("\n")[0]
    .trim();
  return {
    summary: raw.slice(0, idx).trim(),
    suggestion: suggestion || null,
  };
}

export function CommitControls({
  projectId,
  gitInfo,
}: {
  projectId: string;
  gitInfo: GitInfo;
}) {
  const busy = useAppStore((s) => s.gitBusy[projectId] ?? false);
  const commitAll = useAppStore((s) => s.commitAll);
  const reportError = useAppStore((s) => s.reportError);

  const [message, setMessage] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  // During a merge the MergeBanner owns the commit step - a plain commit
  // here would silently become the merge commit.
  if (!gitInfo.dirty || gitInfo.mergeInProgress) return null;

  const count = gitInfo.changedFiles;

  const commit = async () => {
    if (!message.trim() || busy) return;
    if (await commitAll(projectId, message.trim())) {
      setMessage("");
      setSummary(null);
      setSuggestion(null);
    }
  };

  const summarize = async () => {
    setSummarizing(true);
    try {
      const parsed = parseSummary(await api.gitChangeSummary(projectId));
      setSummary(parsed.summary);
      setSuggestion(parsed.suggestion);
      if (parsed.suggestion && !message.trim()) setMessage(parsed.suggestion);
    } catch (err) {
      reportError(err);
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <div className={styles.panel}>
      <p className={styles.status}>
        {count} changed file{count === 1 ? "" : "s"} not committed yet
        <button
          className={`btn ${styles.explainBtn}`}
          disabled={summarizing}
          title="Ask Claude to explain the changes in plain language (uses your Claude Code account)"
          onClick={() => void summarize()}
        >
          {summarizing ? "Asking Claude…" : "What changed?"}
        </button>
      </p>
      {summary && <p className={styles.summary}>{summary}</p>}
      <div className={styles.row}>
        <input
          className={styles.message}
          type="text"
          placeholder="Describe this version, e.g. “Added the contact form”"
          value={message}
          maxLength={500}
          disabled={busy}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
          }}
        />
        <button
          className="btn"
          disabled={busy || !message.trim()}
          title="git commit - saves a snapshot of your project you can always return to"
          onClick={() => void commit()}
        >
          {busy ? "Working…" : "Commit"}
        </button>
      </div>
      <p className={styles.hint}>
        Commit - save a snapshot of your work you can return to at any time.
        {suggestion && suggestion !== message.trim() && (
          <button className={styles.useSuggestion} onClick={() => setMessage(suggestion)}>
            Use suggestion: “{suggestion}”
          </button>
        )}
      </p>
    </div>
  );
}
