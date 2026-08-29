import { useEffect } from "react";
import { useAppStore } from "./store/useAppStore";
import { ProjectListPage } from "./pages/ProjectListPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ConfigRecoveryBanner } from "./components/ConfigRecoveryBanner";
import { Toasts } from "./components/Toasts";
import styles from "./App.module.css";

export default function App() {
  const route = useAppStore((s) => s.route);
  const setRoute = useAppStore((s) => s.setRoute);
  const init = useAppStore((s) => s.init);
  const initialized = useAppStore((s) => s.initialized);
  const theme = useAppStore((s) => s.settings?.display.theme ?? "system");

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (theme === "system") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
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
        <button
          className="btn"
          aria-label="Settings"
          onClick={() =>
            setRoute(route.page === "settings" ? { page: "list" } : { page: "settings" })
          }
        >
          {route.page === "settings" ? "Back" : "Settings"}
        </button>
      </header>
      <ConfigRecoveryBanner />
      <main className={styles.main}>
        {route.page === "list" && <ProjectListPage />}
        {route.page === "settings" && <SettingsPage />}
      </main>
      <Toasts />
    </div>
  );
}
