import { useAppStore } from "../store/useAppStore";
import { SessionList } from "../components/agent/SessionList";
import { TerminalPane } from "../components/agent/TerminalPane";
import { EmptyState } from "../components/EmptyState";
import styles from "./AgentsPage.module.css";

export function AgentsPage({ sessionId }: { sessionId?: string }) {
  const sessions = useAppStore((s) => s.sessions);
  const setRoute = useAppStore((s) => s.setRoute);

  if (sessions.length === 0) {
    return (
      <EmptyState title="No sessions">
        <p>
          Use the <strong>Agent</strong> button on any project to start a coding
          agent, or <strong>▶ Run</strong> to start the application itself —
          both run right here inside Projque.
        </p>
        <button className="btn" onClick={() => setRoute({ page: "list" })}>
          Back to projects
        </button>
      </EmptyState>
    );
  }

  const active =
    sessions.find((s) => s.sessionId === sessionId) ?? sessions[sessions.length - 1];

  return (
    <div className={styles.layout}>
      <SessionList activeId={active.sessionId} />
      <TerminalPane session={active} />
    </div>
  );
}
