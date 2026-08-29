import { useEffect, useRef } from "react";
import type { AgentSessionView } from "../../models";
import { useAppStore } from "../../store/useAppStore";
import { Icon } from "../Icon";
import { fitTerminal, mountTerminal, unmountTerminal } from "../../terminal/manager";
import styles from "./TerminalPane.module.css";

export function TerminalPane({ session }: { session: AgentSessionView }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const project = useAppStore((s) => s.projects.find((p) => p.id === session.projectId));
  const openSessionUrl = useAppStore((s) => s.openSessionUrl);
  const setActiveSession = useAppStore((s) => s.setActiveSession);

  useEffect(() => {
    const parent = mountRef.current;
    if (!parent) return;
    mountTerminal(session.sessionId, parent);
    setActiveSession(session.sessionId);
    const observer = new ResizeObserver(() => fitTerminal(session.sessionId));
    observer.observe(parent);
    return () => {
      observer.disconnect();
      unmountTerminal(session.sessionId);
      setActiveSession(null);
    };
  }, [session.sessionId, setActiveSession]);

  return (
    <div className={styles.pane} data-terminal-pane>
      <div className={styles.header}>
        <span className={styles.headerLabel}>
          {session.agentLabel}
          {project && <span className={styles.headerProject}> — {project.name}</span>}
        </span>
        {session.kind === "run" && session.detectedUrl && (
          <button
            className="btn"
            title={session.detectedUrl}
            onClick={() => void openSessionUrl(session.sessionId)}
          >
            <Icon name="external" size={14} /> Open in browser
          </button>
        )}
      </div>
      <div className={styles.mount} ref={mountRef} />
      {session.status.state === "exited" && (
        <div className={styles.exitedBar}>
          {session.agentLabel} exited
          {session.status.code != null ? ` with code ${session.status.code}` : ""} — the
          output above is preserved until you remove the session.
        </div>
      )}
    </div>
  );
}
