import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api/ipc";
import { useAppStore } from "../store/useAppStore";
import { TerminalPane } from "../components/agent/TerminalPane";
import { Toasts } from "../components/Toasts";
import { Icon } from "../components/Icon";
import type { AgentSessionView, SessionPulse } from "../models";
import { applyAppearance } from "../utils/appearance";
import styles from "./SessionWindow.module.css";

/** A detached window showing exactly one session. Same store, same
 *  components, its own webview: it loads what it needs, mirrors the
 *  session events, and reports its own focus so attention is never raised
 *  for a session the user is looking at here. */
export function SessionWindow({ sessionId }: { sessionId: string }) {
  const session = useAppStore((s) => s.sessions.find((v) => v.sessionId === sessionId));
  const initialized = useAppStore((s) => s.initialized);
  const theme = useAppStore((s) => s.settings?.display.theme ?? "system");
  const style = useAppStore((s) => s.settings?.display.style ?? "classic");

  useEffect(() => {
    void (async () => {
      try {
        const [settings, projects, sessions] = await Promise.all([
          api.settingsGet(),
          api.projectsList(),
          api.agentSessionsList(),
        ]);
        useAppStore.setState({ settings, projects, sessions, initialized: true });
      } catch {
        useAppStore.setState({ initialized: true });
      }
    })();
  }, []);

  useEffect(() => {
    const disposers: Promise<() => void>[] = [
      listen<AgentSessionView>("agent:session-exited", (e) => useAppStore.getState().sessionExited(e.payload)),
      listen<{ sessionId: string; url: string }>("agent:session-url", (e) =>
        useAppStore.getState().sessionUrlDetected(e.payload.sessionId, e.payload.url),
      ),
      listen<{ sessionId: string }>("agent:session-error", (e) =>
        useAppStore.getState().sessionErrorDetected(e.payload.sessionId),
      ),
      listen<AgentSessionView>("agent:session-attention", (e) => useAppStore.getState().sessionAttention(e.payload)),
      listen<SessionPulse[]>("agent:sessions-pulse", (e) => useAppStore.getState().setPulses(e.payload)),
    ];
    return () => {
      for (const d of disposers) void d.then((fn) => fn());
    };
  }, []);

  // This window's own focus report (per-window on the backend).
  useEffect(() => {
    const report = () => void api.sessionsSetActive([sessionId], document.hasFocus()).catch(() => {});
    report();
    window.addEventListener("focus", report);
    window.addEventListener("blur", report);
    return () => {
      window.removeEventListener("focus", report);
      window.removeEventListener("blur", report);
    };
  }, [sessionId]);

  useEffect(() => applyAppearance(theme, style), [theme, style]);

  if (!initialized) return null;
  if (!session) {
    return (
      <div className={styles.missing}>
        <p>This session is no longer available.</p>
        <button className="btn" onClick={() => void api.sessionWindowClose(null)}>
          Close window
        </button>
      </div>
    );
  }

  return (
    <div className={styles.window}>
      <div className={styles.bar}>
        <span className={styles.title}>
          {session.agentLabel} - {session.projectLabel}
        </span>
        <div className={styles.spacer} />
        <button className="btn" title="Show this session in the main window again" onClick={() => void api.sessionWindowClose(null)}>
          <Icon name="split" size={13} /> Back to main window
        </button>
      </div>
      <TerminalPane session={session} />
      <Toasts />
    </div>
  );
}
