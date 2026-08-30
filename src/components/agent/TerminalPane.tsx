import { useEffect, useRef, useState } from "react";
import type { AgentSessionView } from "../../models";
import { useAppStore } from "../../store/useAppStore";
import { Icon } from "../Icon";
import { disposeTerminal, fitTerminal, mountTerminal, unmountTerminal } from "../../terminal/manager";
import styles from "./TerminalPane.module.css";

function portOf(url: string | null): string {
  const m = url?.match(/:(\d+)/);
  return m ? m[1] : "";
}

export function TerminalPane({
  session,
  grid = false,
  autoFocus = true,
}: {
  session: AgentSessionView;
  /** Rendered as one pane of the split view. */
  grid?: boolean;
  autoFocus?: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const project = useAppStore((s) => s.projects.find((p) => p.id === session.projectId));
  const openSessionUrl = useAppStore((s) => s.openSessionUrl);
  const openExternalUrl = useAppStore((s) => s.openExternalUrl);
  const toggleGridSession = useAppStore((s) => s.toggleGridSession);
  const killSession = useAppStore((s) => s.killSession);
  const removeSession = useAppStore((s) => s.removeSession);
  const [manual, setManual] = useState(false);
  const [port, setPort] = useState("");

  // Visible-session reporting lives in AgentsPage, which knows the full set
  // of panes on screen; this component only mounts its terminal.
  useEffect(() => {
    const parent = mountRef.current;
    if (!parent) return;
    mountTerminal(session.sessionId, parent, autoFocus);
    const observer = new ResizeObserver(() => fitTerminal(session.sessionId));
    observer.observe(parent);
    return () => {
      observer.disconnect();
      unmountTerminal(session.sessionId);
    };
  }, [session.sessionId, autoFocus]);

  const isRun = session.kind === "run";
  const openManual = () => {
    const p = port.trim().replace(/[^\d]/g, "");
    if (p) void openExternalUrl(`http://localhost:${p}`);
  };

  return (
    <div className={styles.pane} data-terminal-pane data-grid={grid || undefined}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>
          {session.agentLabel}
          {project && <span className={styles.headerProject}> — {project.name}</span>}
        </span>
        {session.status.state === "running" && (
          <button
            className={`btn ${styles.stopBtn}`}
            title={session.kind === "run" ? "Stop this run" : "Stop this agent"}
            onClick={() => void killSession(session.sessionId)}
          >
            <Icon name="stop" size={13} /> Stop
          </button>
        )}
        {grid && (
          <button
            className={styles.gridRemove}
            title="Remove this pane from the split view"
            onClick={() => toggleGridSession(session.sessionId)}
          >
            <Icon name="close" size={14} />
          </button>
        )}
        {isRun && (
          <div className={styles.browserControls}>
            {session.detectedUrl ? (
              <button
                className="btn"
                title={session.detectedUrl}
                onClick={() => void openSessionUrl(session.sessionId)}
              >
                <Icon name="external" size={14} /> Open {session.detectedUrl.replace(/^https?:\/\//, "")}
              </button>
            ) : manual ? (
              <span className={styles.manual}>
                <span className={styles.manualPrefix}>localhost:</span>
                <input
                  className={styles.portInput}
                  value={port}
                  autoFocus
                  placeholder="5173"
                  inputMode="numeric"
                  onChange={(e) => setPort(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && openManual()}
                />
                <button className="btn" disabled={!port.trim()} onClick={openManual}>
                  <Icon name="external" size={14} /> Open
                </button>
              </span>
            ) : (
              <button
                className="btn btn-ghost"
                title="Open a localhost port in your browser"
                onClick={() => {
                  setPort(portOf(session.detectedUrl));
                  setManual(true);
                }}
              >
                <Icon name="external" size={14} /> Open in browser…
              </button>
            )}
          </div>
        )}
      </div>
      <div className={styles.mount} ref={mountRef} />
      {session.status.state === "exited" && (
        <div className={styles.exitedBar}>
          <span className={styles.exitedText}>
            {session.agentLabel} exited
            {session.status.code != null ? ` with code ${session.status.code}` : ""} — the
            output above is preserved until you remove the session.
          </span>
          <button
            className="btn"
            onClick={() => {
              disposeTerminal(session.sessionId);
              void removeSession(session.sessionId);
            }}
          >
            <Icon name="close" size={13} /> Remove session
          </button>
        </div>
      )}
    </div>
  );
}
