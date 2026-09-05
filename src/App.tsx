import { lazy, Suspense, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api/ipc";
import { useAppStore } from "./store/useAppStore";
import { ProjectListPage } from "./pages/ProjectListPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ImportPage } from "./pages/ImportPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { GitPage } from "./pages/GitPage";
import { ProgressPage } from "./pages/ProgressPage";
import { QuitConfirmDialog } from "./components/agent/QuitConfirmDialog";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { IdeaCaptureDialog } from "./components/IdeaCaptureDialog";
import { favoriteShortcuts, visibleSessionIds } from "./utils/shortcuts";
import { Icon } from "./components/Icon";
import { ErrorBoundary } from "./components/ErrorBoundary";
import logoUrl from "./assets/logo.png";
import type { AgentSessionView, SessionPulse } from "./models";

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
  const attentionCount = useAppStore(
    (s) => s.sessions.filter((v) => v.needsAttention).length,
  );

  // Keep the backend informed of focus so attention isn't raised for what
  // the user is already looking at (every visible pane in split view).
  useEffect(() => {
    const report = () => {
      const state = useAppStore.getState();
      void api
        .sessionsSetActive(visibleSessionIds(state), document.hasFocus())
        .catch(() => {});
    };
    window.addEventListener("focus", report);
    window.addEventListener("blur", report);
    return () => {
      window.removeEventListener("focus", report);
      window.removeEventListener("blur", report);
    };
  }, []);

  useEffect(() => {
    void init();
  }, [init]);

  // Mirror the attention count on the dock/taskbar badge.
  useEffect(() => {
    void api.appSetBadge(attentionCount).catch(() => {});
  }, [attentionCount]);

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
      listen<{ sessionId: string }>("agent:session-error", (event) => {
        useAppStore.getState().sessionErrorDetected(event.payload.sessionId);
      }),
      listen<AgentSessionView>("agent:session-attention", (event) => {
        useAppStore.getState().sessionAttention(event.payload);
      }),
      listen<SessionPulse[]>("agent:sessions-pulse", (event) => {
        useAppStore.getState().setPulses(event.payload);
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
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        if (e.key >= "1" && e.key <= "9") {
          const target =
            favoriteShortcuts(useAppStore.getState().projects)[Number(e.key) - 1];
          if (target) {
            e.preventDefault();
            setRoute({ page: "detail", projectId: target.id });
          }
          return;
        }
        if (e.key === "k") {
          e.preventDefault();
          useAppStore.getState().setIdeaOpen(true);
          return;
        }
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
    // Notify any open terminals to recolor (manager self-subscribes) without
    // importing the terminal module here - that would recreate a circular
    // chunk dependency that leaves manager's bindings in the TDZ.
    window.dispatchEvent(new Event("projque:themechange"));
    if (theme === "system") {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => window.dispatchEvent(new Event("projque:themechange"));
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }
  }, [theme]);

  if (!initialized) return null;

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <button className={styles.brand} onClick={() => setRoute({ page: "list" })}>
          <img className={styles.glyph} src={logoUrl} alt="" /> ProjQue
        </button>
        {route.page !== "list" && (
          <button
            className="btn btn-ghost"
            onClick={() => setRoute({ page: "list" })}
            title="Back to projects (Esc)"
          >
            <Icon name="chevron" size={15} style={{ transform: "scaleX(-1)" }} /> Projects
          </button>
        )}
        <div className={styles.spacer} />
        <button
          className="btn"
          title="Capture an idea (⌘K)"
          onClick={() => useAppStore.getState().setIdeaOpen(true)}
        >
          <Icon name="idea" size={14} /> Idea
        </button>
        <button
          className="btn btn-primary"
          onClick={() => useAppStore.getState().setNewProjectOpen(true)}
        >
          <Icon name="plus" size={14} /> New
        </button>
        <button
          className="btn"
          title="Git - branches, commits, merges and pushes across your projects"
          data-active={route.page === "git" || undefined}
          onClick={() => setRoute({ page: "git" })}
        >
          <Icon name="branch" size={14} /> Git
        </button>
        <button
          className="btn"
          data-attn={attentionCount > 0 || undefined}
          title={attentionCount > 0 ? "A session needs your attention" : undefined}
          onClick={() => setRoute({ page: "agents" })}
        >
          Sessions{runningSessions > 0 ? ` ${runningSessions}` : ""}
          {attentionCount > 0 && <span className={styles.attnFlag}>waiting</span>}
        </button>
        <button
          className="btn btn-ghost"
          aria-label="Settings"
          data-active={route.page === "settings" || undefined}
          onClick={() =>
            setRoute(route.page === "settings" ? { page: "list" } : { page: "settings" })
          }
        >
          <Icon name="settings" size={16} />
        </button>
      </header>
      <ConfigRecoveryBanner />
      <main className={styles.main}>
        <ErrorBoundary key={route.page} onReset={() => setRoute({ page: "list" })}>
          {route.page === "list" && <ProjectListPage />}
          {route.page === "settings" && <SettingsPage />}
          {route.page === "import" && <ImportPage />}
          {route.page === "detail" && <ProjectDetailPage projectId={route.projectId} />}
          {route.page === "git" && <GitPage projectId={route.projectId} />}
          {route.page === "progress" && <ProgressPage />}
          {route.page === "agents" && (
            <Suspense fallback={null}>
              <AgentsPage sessionId={route.sessionId} />
            </Suspense>
          )}
        </ErrorBoundary>
      </main>
      <Toasts />
      <QuitConfirmDialog />
      <NewProjectDialog />
      <IdeaCaptureDialog />
    </div>
  );
}
