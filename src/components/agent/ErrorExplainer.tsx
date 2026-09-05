import { useState } from "react";
import { api } from "../../api/ipc";
import type { AgentSessionView } from "../../models";
import { useAppStore } from "../../store/useAppStore";
import { parseExplanation } from "../../utils/summary";
import { Icon } from "../Icon";
import styles from "./ErrorExplainer.module.css";

/** "Explain this error": the backend reads the session's own output tail
 *  and asks Claude (headless, explicit click) for a plain-language
 *  explanation. The follow-up hands the same excerpt to a new agent
 *  session with a fix request. */
export function ErrorExplainer({ session }: { session: AgentSessionView }) {
  const startAgentSession = useAppStore((s) => s.startAgentSession);
  const reportError = useAppStore((s) => s.reportError);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [todo, setTodo] = useState<string | null>(null);
  const [excerpt, setExcerpt] = useState<string | null>(null);

  const explain = async () => {
    setOpen(true);
    if (text || loading) return;
    setLoading(true);
    try {
      const result = await api.sessionExplainError(session.sessionId);
      const parsed = parseExplanation(result.explanation);
      setText(parsed.summary);
      setTodo(parsed.suggestion);
      setExcerpt(result.excerpt);
    } catch (err) {
      reportError(err);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const askAgent = () => {
    const prompt =
      `Running this project (${session.agentLabel}) printed an error. Here is the end of the output:\n\n` +
      `${(excerpt ?? "").slice(0, 2500)}\n\n` +
      (text ? `A plain-language reading of it: ${text}\n\n` : "") +
      `Find the cause and fix it. When you're done, explain what was wrong and what you changed in simple, non-technical language.`;
    void startAgentSession(session.projectId, undefined, prompt);
  };

  return (
    <>
      <button
        className={`btn ${styles.trigger}`}
        title="Ask Claude to explain the error in plain language (uses your Claude Code account)"
        onClick={() => void explain()}
      >
        <Icon name="idea" size={13} /> Explain this error
      </button>
      {open && (
        <div className={styles.popover}>
          <div className={styles.head}>
            <strong>What went wrong</strong>
            <button className={styles.close} aria-label="Close" onClick={() => setOpen(false)}>
              <Icon name="close" size={14} />
            </button>
          </div>
          {loading ? (
            <p className={styles.faint}>Asking Claude…</p>
          ) : (
            <>
              {text && <p className={styles.body}>{text}</p>}
              {todo && (
                <p className={styles.todo}>
                  <strong>What to do:</strong> {todo}
                </p>
              )}
              <div className={styles.actions}>
                <button className="btn" onClick={askAgent}>
                  <Icon name="agent" size={12} /> Ask the agent to fix it
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
