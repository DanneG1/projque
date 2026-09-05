import { useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import { visibleSessionIds } from "../utils/shortcuts";
import { SessionList } from "../components/agent/SessionList";
import { TerminalPane } from "../components/agent/TerminalPane";
import { EmptyState } from "../components/EmptyState";
import styles from "./AgentsPage.module.css";

export function AgentsPage({ sessionId }: { sessionId?: string }) {
  const sessions = useAppStore((s) => s.sessions);
  const gridIds = useAppStore((s) => s.gridIds);
  const detachedIds = useAppStore((s) => s.detachedIds);
  const reattachSession = useAppStore((s) => s.reattachSession);
  const setRoute = useAppStore((s) => s.setRoute);
  const setVisibleSessions = useAppStore((s) => s.setVisibleSessions);

  // Report which panes are on screen so the backend never raises attention
  // for a session the user is already watching.
  const route = useAppStore((s) => s.route);
  const visibleKey = visibleSessionIds({ route, sessions, gridIds, detachedIds }).join(",");
  useEffect(() => {
    setVisibleSessions(visibleKey ? visibleKey.split(",") : []);
    return () => setVisibleSessions([]);
  }, [visibleKey, setVisibleSessions]);

  if (sessions.length === 0) {
    return (
      <EmptyState title="No sessions">
        <p>
          Use the <strong>Agent</strong> button on any project to start a coding
          agent, or <strong>▶ Run</strong> to start the application itself -
          both run right here inside ProjQue.
        </p>
        <button className="btn" onClick={() => setRoute({ page: "list" })}>
          Back to projects
        </button>
      </EmptyState>
    );
  }

  const active =
    sessions.find((s) => s.sessionId === sessionId) ?? sessions[sessions.length - 1];
  const visible = visibleSessionIds({ route, sessions, gridIds });
  const panes = visible
    .map((id) => sessions.find((s) => s.sessionId === id))
    .filter((s) => s !== undefined);
  const gridMode = panes.length >= 2;
  const focusId = visible.includes(active.sessionId) ? active.sessionId : visible[0];

  const detachedPane = (id: string) => (
    <div className={styles.detached} key={id}>
      <p>This session is open in its own window.</p>
      <button className="btn" onClick={() => void reattachSession(id)}>
        Bring it back here
      </button>
    </div>
  );

  return (
    <div className={styles.layout}>
      <SessionList activeId={active.sessionId} />
      {gridMode ? (
        <div className={styles.grid} data-count={panes.length}>
          {panes.map((session) =>
            detachedIds.includes(session.sessionId) ? (
              detachedPane(session.sessionId)
            ) : (
              <TerminalPane
                key={session.sessionId}
                session={session}
                grid
                autoFocus={session.sessionId === focusId}
              />
            ),
          )}
        </div>
      ) : detachedIds.includes((panes[0] ?? active).sessionId) ? (
        detachedPane((panes[0] ?? active).sessionId)
      ) : (
        <TerminalPane session={panes[0] ?? active} />
      )}
    </div>
  );
}
