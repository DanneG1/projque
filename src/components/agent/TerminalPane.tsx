import { useEffect, useRef } from "react";
import type { AgentSessionView } from "../../models";
import { fitTerminal, mountTerminal, unmountTerminal } from "../../terminal/manager";
import styles from "./TerminalPane.module.css";

export function TerminalPane({ session }: { session: AgentSessionView }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = mountRef.current;
    if (!parent) return;
    mountTerminal(session.sessionId, parent);
    const observer = new ResizeObserver(() => fitTerminal(session.sessionId));
    observer.observe(parent);
    return () => {
      observer.disconnect();
      unmountTerminal(session.sessionId);
    };
  }, [session.sessionId]);

  return (
    <div className={styles.pane} data-terminal-pane>
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
