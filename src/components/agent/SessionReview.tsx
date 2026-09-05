import { useEffect, useState } from "react";
import { api } from "../../api/ipc";
import type { AgentSessionView, RunTarget, SecretFinding } from "../../models";
import { useAppStore } from "../../store/useAppStore";
import { parseSummary } from "../../utils/summary";
import { Icon } from "../Icon";
import styles from "./SessionReview.module.css";

type Phase = "loading" | "review" | "kept" | "undone" | "clean";

/** The "verify" half of prompt-and-verify: shown when an agent session ends.
 *  Explains what changed in plain language (Claude, via the same headless
 *  path as "What changed?"), then offers the four honest next moves: try it,
 *  keep it (commit), undo it (restore the pre-session point), or send the
 *  agent back in with a correction. */
export function SessionReview({
  session,
  onDismiss,
}: {
  session: AgentSessionView;
  onDismiss: () => void;
}) {
  const gitInfo = useAppStore((s) => s.git[session.projectId]);
  const busy = useAppStore((s) => s.gitBusy[session.projectId] ?? false);
  const commitAll = useAppStore((s) => s.commitAll);
  const undoSession = useAppStore((s) => s.undoSession);
  const startAgentSession = useAppStore((s) => s.startAgentSession);
  const startRunSession = useAppStore((s) => s.startRunSession);
  const reportError = useAppStore((s) => s.reportError);
  // Other agents still working in this project (parallel testers, a second
  // session): the changes aren't final yet, so hold the summary - and its
  // Claude usage - until they finish.
  const othersRunning = useAppStore((s) =>
    s.sessions.some(
      (v) =>
        v.projectId === session.projectId &&
        v.kind === "agent" &&
        v.sessionId !== session.sessionId &&
        v.status.state === "running",
    ),
  );

  const [phase, setPhase] = useState<Phase>("loading");
  const [summary, setSummary] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [findings, setFindings] = useState<SecretFinding[]>([]);
  const [runTarget, setRunTarget] = useState<RunTarget | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [fixOpen, setFixOpen] = useState(false);
  const [fixText, setFixText] = useState("");
  const [allowSecrets, setAllowSecrets] = useState(false);

  const changed = gitInfo?.changedFiles ?? 0;
  // Only trust git state fetched after the session ended (sessionExited
  // forces a refresh); a stale "clean" would hide the agent's changes.
  const [mountedAt] = useState(() => Math.floor(Date.now() / 1000) - 1);

  // If no fresh state arrives in time (remounted later, or refresh failed),
  // fall back to whatever we have; a project without git gets a plain
  // dismissible card rather than a spinner forever.
  const [trustStale, setTrustStale] = useState(false);
  useEffect(() => {
    if (phase !== "loading") return;
    const t = window.setTimeout(() => {
      setTrustStale(true);
      setPhase((p) => (p === "loading" && !useAppStore.getState().git[session.projectId] ? "clean" : p));
    }, 4000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Once we know whether anything changed, summarize (once) and load run targets.
  useEffect(() => {
    if (!gitInfo || phase !== "loading") return;
    if (gitInfo.fetchedAt < mountedAt && !trustStale) return;
    if (!gitInfo.dirty) {
      setPhase("clean");
      return;
    }
    let cancelled = false;
    setPhase("review");
    api
      .projectRunTargets(session.projectId)
      .then((targets) => !cancelled && setRunTarget(targets[0] ?? null))
      .catch(() => {});
    api
      .gitCommitPreflight(session.projectId)
      .then((pre) => !cancelled && setFindings(pre.findings))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gitInfo?.fetchedAt, phase, trustStale]);

  // The plain-language summary, once, when the project has settled.
  const [summaryRequested, setSummaryRequested] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const summarize = async () => {
    setSummaryRequested(true);
    setSummarizing(true);
    try {
      const parsed = parseSummary(await api.gitChangeSummary(session.projectId));
      setSummary(parsed.summary);
      if (parsed.suggestion) setMessage((m) => m || parsed.suggestion!);
    } catch (err) {
      reportError(err);
    } finally {
      setSummarizing(false);
    }
  };
  useEffect(() => {
    if (phase === "review" && !othersRunning && !summaryRequested) void summarize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, othersRunning, summaryRequested]);

  const keep = async () => {
    if (!message.trim() || busy) return;
    if (await commitAll(session.projectId, message.trim(), allowSecrets)) setPhase("kept");
  };

  const undo = async () => {
    if (!session.undoHash || busy) return;
    setConfirmUndo(false);
    if (await undoSession(session.projectId, session.undoHash)) setPhase("undone");
  };

  const sendBack = async () => {
    const text = fixText.trim();
    if (!text) return;
    const prompt =
      `The previous agent session in this project made changes` +
      (summary ? ` that were summarized as:\n\n${summary}\n\n` : `. `) +
      `The user tried the result and reports a problem:\n\n${text}\n\n` +
      `Find the cause and fix it. When you're done, explain what was wrong and what you changed in simple, non-technical language.`;
    setFixOpen(false);
    await startAgentSession(session.projectId, undefined, prompt);
  };

  if (phase === "loading") {
    return (
      <div className={styles.card}>
        <span className={styles.title}>Session finished - checking what changed…</span>
      </div>
    );
  }

  if (phase === "clean") {
    return (
      <div className={styles.card}>
        <span className={styles.title}>
          Session finished.{gitInfo ? " No files were changed." : ""}
        </span>
        <button className="btn" onClick={onDismiss}>
          <Icon name="close" size={13} /> Remove session
        </button>
      </div>
    );
  }

  if (phase === "kept" || phase === "undone") {
    return (
      <div className={styles.card} data-done>
        <span className={styles.title}>
          <Icon name="check" size={13} />{" "}
          {phase === "kept"
            ? "Committed. This version is saved in your project history."
            : "Undone. Your files are back to how they were before the session."}
        </span>
        <button className="btn" onClick={onDismiss}>
          <Icon name="close" size={13} /> Remove session
        </button>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className={styles.title}>
          Session finished - {changed} file{changed === 1 ? "" : "s"} changed
        </span>
        <span className={styles.subtitle}>
          Try it, then keep or undo. Nothing is final until you commit.
        </span>
      </div>

      {summary !== null ? (
        <p className={styles.summary}>{summary}</p>
      ) : summarizing ? (
        <p className={styles.summaryLoading}>Asking Claude to explain the changes…</p>
      ) : othersRunning ? (
        <p className={styles.summaryLoading}>
          Other agents are still working in this project - the summary comes when they finish.{" "}
          <button className={styles.inlineBtn} onClick={() => void summarize()}>
            Explain now
          </button>
        </p>
      ) : (
        <p className={styles.summaryLoading}>
          <button className={styles.inlineBtn} onClick={() => void summarize()}>
            What changed?
          </button>
        </p>
      )}

      {findings.length > 0 && (
        <p className={styles.block}>
          <strong>Hold on:</strong> something that looks like a password or API key is in{" "}
          {findings
            .slice(0, 3)
            .map((f) => f.file)
            .join(", ")}
          . Committing would keep it in your history forever - ask the agent to move it to a
          .env file first, or undo.
          <label className={styles.override}>
            <input
              type="checkbox"
              checked={allowSecrets}
              onChange={(e) => setAllowSecrets(e.target.checked)}
            />
            I checked - this is not a real secret. Allow the commit.
          </label>
        </p>
      )}

      <div className={styles.actions}>
        {runTarget && (
          <button
            className="btn"
            title={`Start the project (${runTarget.label}) so you can try the result`}
            onClick={() => void startRunSession(session.projectId, runTarget.targetId)}
          >
            <Icon name="run" size={12} /> Try it
          </button>
        )}
        <button
          className="btn"
          data-active={fixOpen || undefined}
          title="Tell the agent what's wrong; it starts a new session with that context"
          onClick={() => {
            setFixOpen((v) => !v);
            setConfirmUndo(false);
          }}
        >
          <Icon name="agent" size={12} /> Something's off…
        </button>
        <span className={styles.spacer} />
        {session.undoHash && (
          <button
            className="btn"
            disabled={busy}
            title="Put every file back to how it was before this session. The current state is backed up first."
            onClick={() => {
              setConfirmUndo(true);
              setFixOpen(false);
            }}
          >
            Undo session
          </button>
        )}
      </div>

      {confirmUndo && (
        <div className={styles.confirm}>
          <span>
            Undo everything this session did? Files it created are removed too. Your current
            state is backed up automatically, so this can itself be undone from History.
          </span>
          <button className="btn" disabled={busy} onClick={() => void undo()}>
            {busy ? "Working…" : "Yes, undo"}
          </button>
          <button className="btn" onClick={() => setConfirmUndo(false)}>
            Cancel
          </button>
        </div>
      )}

      {fixOpen && (
        <div className={styles.fix}>
          <textarea
            className={styles.fixInput}
            autoFocus
            rows={2}
            maxLength={3000}
            placeholder="What isn't right? Describe what you saw and what you expected."
            value={fixText}
            onChange={(e) => setFixText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setFixOpen(false);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void sendBack();
            }}
          />
          <button className="btn" disabled={!fixText.trim()} onClick={() => void sendBack()}>
            Send the agent back in
          </button>
        </div>
      )}

      <div className={styles.keepRow}>
        <input
          className={styles.message}
          type="text"
          placeholder="Describe this version, e.g. “Added the contact form”"
          value={message}
          maxLength={500}
          disabled={busy}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void keep();
          }}
        />
        <button
          className="btn"
          disabled={busy || !message.trim() || (findings.length > 0 && !allowSecrets)}
          title="git commit - saves this version in your project history"
          onClick={() => void keep()}
        >
          {busy ? "Working…" : "Keep (commit)"}
        </button>
      </div>
    </div>
  );
}
