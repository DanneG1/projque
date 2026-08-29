import { useEffect, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import styles from "./SessionList.module.css";

function elapsed(startedAt: number, now: number): string {
  const s = Math.max(0, Math.floor(now / 1000 - startedAt));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function SessionList({ activeId }: { activeId: string }) {
  const sessions = useAppStore((s) => s.sessions);
  const projects = useAppStore((s) => s.projects);
  const setRoute = useAppStore((s) => s.setRoute);
  const killSession = useAppStore((s) => s.killSession);
  const removeSession = useAppStore((s) => s.removeSession);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <aside className={styles.sidebar}>
      {sessions.map((session) => {
        const project = projects.find((p) => p.id === session.projectId);
        const running = session.status.state === "running";
        return (
          <div
            key={session.sessionId}
            className={styles.item}
            data-active={session.sessionId === activeId || undefined}
            onClick={() => setRoute({ page: "agents", sessionId: session.sessionId })}
          >
            <span className={styles.dot} data-running={running || undefined} />
            <div className={styles.itemBody}>
              <div className={styles.project}>{project?.name ?? session.projectId}</div>
              <div className={styles.meta}>
                {session.agentLabel}
                {running
                  ? ` · ${elapsed(session.startedAt, now)}`
                  : session.status.state === "exited"
                    ? ` · exited${session.status.code != null ? ` (${session.status.code})` : ""}`
                    : ""}
              </div>
            </div>
            {running ? (
              <button
                className={styles.itemAction}
                title="Stop this agent"
                onClick={(e) => {
                  e.stopPropagation();
                  void killSession(session.sessionId);
                }}
              >
                ⏹
              </button>
            ) : (
              <button
                className={styles.itemAction}
                title="Remove this session"
                onClick={(e) => {
                  e.stopPropagation();
                  void removeSession(session.sessionId);
                }}
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
    </aside>
  );
}
