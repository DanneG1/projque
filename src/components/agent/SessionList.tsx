import { useEffect, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { disposeTerminal } from "../../terminal/manager";
import { Icon } from "../Icon";
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
  const gridIds = useAppStore((s) => s.gridIds);
  const toggleGridSession = useAppStore((s) => s.toggleGridSession);
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
        const inGrid = gridIds.includes(session.sessionId);
        return (
          <div
            key={session.sessionId}
            className={styles.item}
            data-active={session.sessionId === activeId || undefined}
            data-grid={inGrid || undefined}
            onClick={() => setRoute({ page: "agents", sessionId: session.sessionId })}
          >
            <div className={styles.itemBody}>
              <div className={styles.project}>
                {project?.name ?? session.projectId}
                <span className={styles.tag} data-state={tagState(session)}>
                  {tagLabel(session)}
                </span>
              </div>
              <div className={styles.meta}>
                {session.agentLabel}
                {running
                  ? ` · ${elapsed(session.startedAt, now)}`
                  : session.status.state === "exited"
                    ? ` · exited${session.status.code != null ? ` (${session.status.code})` : ""}`
                    : ""}
              </div>
            </div>
            <button
              className={styles.itemAction}
              data-on={inGrid || undefined}
              title={inGrid ? "Remove from split view" : "Show in split view"}
              onClick={(e) => {
                e.stopPropagation();
                toggleGridSession(session.sessionId);
              }}
            >
              <Icon name="split" size={15} />
            </button>
            {running ? (
              <button
                className={styles.itemAction}
                data-danger
                title="Stop this agent"
                onClick={(e) => {
                  e.stopPropagation();
                  void killSession(session.sessionId);
                }}
              >
                <Icon name="stop" size={16} />
              </button>
            ) : (
              <button
                className={styles.itemAction}
                title="Remove this session"
                onClick={(e) => {
                  e.stopPropagation();
                  disposeTerminal(session.sessionId);
                  void removeSession(session.sessionId);
                }}
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        );
      })}
    </aside>
  );
}

function tagState(session: { kind: string; status: { state: string }; needsAttention: boolean }): string {
  if (session.status.state === "exited") return "exited";
  if (session.needsAttention) return "waiting";
  if (session.kind === "run") return "run";
  return "live";
}

function tagLabel(session: { kind: string; status: { state: string }; needsAttention: boolean }): string {
  if (session.status.state === "exited") return "exited";
  if (session.needsAttention) return "waiting";
  if (session.kind === "run") return "run";
  return "live";
}
