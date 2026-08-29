import { lazy, Suspense, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "./store/useAppStore";
import { ProjectListPage } from "./pages/ProjectListPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ImportPage } from "./pages/ImportPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { QuitConfirmDialog } from "./components/agent/QuitConfirmDialog";
import type { AgentSessionView } from "./models";

const AgentsPage = lazy(() =>
  import("./pages/AgentsPage").then((m) => ({ default: m.AgentsPage })),
);
import { ConfigRecoveryBanner } from "./components/ConfigRecoveryBanner";
import { Toasts } from "./components/Toasts";
import styles from "./App.module.css";

export default function App() {
  const route = useAppStore((s) => s.route);
  const setRoute = useAppStore((s) => s.setRoute);
  const init = useAppStore((s) => s.init);
  const initialized = useAppStore((s) => s.initialized);
  const theme = useAppStore((s) => s.settings?.display.theme ?? "system");

  const refreshGit = useAppStore((s) => s.refreshGit);
  const runningSessions = useAppStore(
    (s) => s.sessions.filter((v) => v.status.state === "running").length,
  );

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const disposers: Promise<() => void>[] = [
      listen<AgentSessionView>("agent:session-exited", (event) => {
        useAppStore.getState().sessionExited(event.payload);
      }),
      listen<number>("app:confirm-quit", (event) => {
        useAppStore.getState().setQuitPrompt(event.payload);
      }),
      listen<{ sessionId: string; url: string }>("agent:session-url", (event) => {
        useAppStore
          .getState()
          .sessionUrlDetected(event.payload.sessionId, event.payload.url);
      }),
    ];
    return () => {
      for (const d of disposers) void d.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const onFocus = () => void refreshGit();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshGit]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "," && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setRoute({ page: "settings" });
        return;
      }
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT";
      if (e.key === "Escape" && !typing && route.page !== "list") {
        setRoute({ page: "list" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [route, setRoute]);

  useEffect(() => {
    if (theme === "system") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
    // Recolor live terminals; the module is only loaded once a session exists.
    void import("./terminal/manager").then((m) => m.applyTheme());
    if (theme === "system") {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => void import("./terminal/manager").then((m) => m.applyTheme());
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }
  }, [theme]);

  if (!initialized) return null;

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <button
          className={styles.brand}
          onClick={() => setRoute({ page: "list" })}
        >
          Projque
        </button>
        <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn"
          onClick={() => setRoute({ page: "agents" })}
        >
          Sessions{runningSessions > 0 ? ` (${runningSessions})` : ""}
        </button>
        <button
          className="btn"
          aria-label="Settings"
          onClick={() =>
            setRoute(route.page === "settings" ? { page: "list" } : { page: "settings" })
          }
        >
          {route.page === "settings" ? "Back" : "Settings"}
        </button>
        </div>
      </header>
      <ConfigRecoveryBanner />
      <main className={styles.main}>
        {route.page === "list" && <ProjectListPage />}
        {route.page === "settings" && <SettingsPage />}
        {route.page === "import" && <ImportPage />}
        {route.page === "detail" && <ProjectDetailPage projectId={route.projectId} />}
        {route.page === "agents" && (
          <Suspense fallback={null}>
            <AgentsPage sessionId={route.sessionId} />
          </Suspense>
        )}
      </main>
      <Toasts />
      <QuitConfirmDialog />
    </div>
  );
}
