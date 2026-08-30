import { useEffect, useRef, useState } from "react";
import type { AgentSessionView } from "../../models";
import { useAppStore } from "../../store/useAppStore";
import { Icon } from "../Icon";
import { fitTerminal, mountTerminal, unmountTerminal } from "../../terminal/manager";
import styles from "./TerminalPane.module.css";

function portOf(url: string | null): string {
  const m = url?.match(/:(\d+)/);
  return m ? m[1] : "";
}

export function TerminalPane({ session }: { session: AgentSessionView }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const project = useAppStore((s) => s.projects.find((p) => p.id === session.projectId));
  const openSessionUrl = useAppStore((s) => s.openSessionUrl);
  const openExternalUrl = useAppStore((s) => s.openExternalUrl);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const [manual, setManual] = useState(false);
  const [port, setPort] = useState("");

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

  const isRun = session.kind === "run";
  const openManual = () => {
    const p = port.trim().replace(/[^\d]/g, "");
    if (p) void openExternalUrl(`http://localhost:${p}`);
  };

  return (
    <div className={styles.pane} data-terminal-pane>
      <div className={styles.header}>
        <span className={styles.headerLabel}>
          {session.agentLabel}
          {project && <span className={styles.headerProject}> — {project.name}</span>}
        </span>
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
          {session.agentLabel} exited
          {session.status.code != null ? ` with code ${session.status.code}` : ""} — the
          output above is preserved until you remove the session.
        </div>
      )}
    </div>
  );
}
