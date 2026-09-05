import { useEffect, useState } from "react";
import { api } from "../api/ipc";
import type { CustomCommand } from "../models";
import { useAppStore } from "../store/useAppStore";
import { Icon } from "./Icon";
import styles from "./CustomCommandsPanel.module.css";

/** Commands the project itself defines in projque.json. Each one shows
 *  exactly what it runs and must be allowed once before it can run - a
 *  cloned repository never gets to run anything on its own say-so. */
export function CustomCommandsPanel({ projectId }: { projectId: string }) {
  const startRunSession = useAppStore((s) => s.startRunSession);
  const reportError = useAppStore((s) => s.reportError);
  const sessions = useAppStore((s) => s.sessions);
  const [commands, setCommands] = useState<CustomCommand[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCommands(null);
    api.projectCustomCommands(projectId).then((c) => !cancelled && setCommands(c)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!commands || commands.length === 0) return null;

  const setApproved = async (c: CustomCommand, approved: boolean) => {
    try {
      const view = await api.projectCommandApprove(projectId, c.hash, approved);
      useAppStore.setState((s) => ({ projects: s.projects.map((p) => (p.id === view.id ? view : p)) }));
      setCommands((all) => (all ?? []).map((x) => (x.hash === c.hash ? { ...x, approved } : x)));
    } catch (err) {
      reportError(err);
    }
  };

  const running = (c: CustomCommand) =>
    sessions.some((v) => v.projectId === projectId && v.targetId === `custom:${c.id}` && v.status.state === "running");

  return (
    <div className={styles.row}>
      <span className={styles.label}>Commands</span>
      <div className={styles.body}>
        <span className={styles.text}>
          This project defines its own commands in <code>projque.json</code>. Each runs only after you allow it.
        </span>
        <ul className={styles.list}>
          {commands.map((c) => (
            <li key={c.id} className={styles.item} data-approved={c.approved || undefined}>
              <span className={styles.name}>{c.label}</span>
              <code className={styles.cmd}>
                {c.program} {c.args.join(" ")}
              </code>
              {c.approved ? (
                <>
                  <button
                    className="btn"
                    disabled={running(c)}
                    onClick={() => void startRunSession(projectId, `custom:${c.id}`)}
                  >
                    <Icon name="run" size={12} /> {running(c) ? "Running…" : "Run"}
                  </button>
                  <button className={styles.link} title="Ask again before running this" onClick={() => void setApproved(c, false)}>
                    Revoke
                  </button>
                </>
              ) : (
                <button
                  className="btn"
                  title="Allow this exact command in this project. If the project changes it, you will be asked again."
                  onClick={() => void setApproved(c, true)}
                >
                  Allow
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
