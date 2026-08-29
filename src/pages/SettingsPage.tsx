import { useAppStore } from "../store/useAppStore";
import type { Theme } from "../models";
import styles from "./SettingsPage.module.css";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function SettingsPage() {
  const settings = useAppStore((s) => s.settings);
  const configStatus = useAppStore((s) => s.configStatus);
  const setDisplay = useAppStore((s) => s.setDisplay);
  const openConfigDir = useAppStore((s) => s.openConfigDir);
  const addProjectRoot = useAppStore((s) => s.addProjectRoot);
  const removeProjectRoot = useAppStore((s) => s.removeProjectRoot);
  const setScanDepth = useAppStore((s) => s.setScanDepth);

  if (!settings) return null;

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Settings</h1>

      <section className={styles.section}>
        <h2>Project folders</h2>
        {settings.projectRoots.length === 0 && (
          <p className={styles.hint}>
            No folders configured yet. These are the folders Projque scans for
            repositories.
          </p>
        )}
        {settings.projectRoots.map((root, i) => (
          <div key={root} className={styles.rootRow}>
            <code className={styles.path}>{root}</code>
            <button className="btn" onClick={() => void removeProjectRoot(i)}>
              Remove
            </button>
          </div>
        ))}
        <div>
          <button className="btn" onClick={() => void addProjectRoot()}>
            Add folder
          </button>
        </div>
        <label className={styles.row}>
          Scan depth
          <select
            value={settings.scanDepth}
            onChange={(e) => void setScanDepth(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5, 6].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className={styles.section}>
        <h2>Display</h2>
        <label className={styles.row}>
          <input
            type="checkbox"
            checked={settings.display.showArchived}
            onChange={(e) => setDisplay({ showArchived: e.target.checked })}
          />
          Show archived projects by default
        </label>
        <label className={styles.row}>
          Theme
          <select
            value={settings.display.theme}
            onChange={(e) => setDisplay({ theme: e.target.value as Theme })}
          >
            {THEMES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className={styles.section}>
        <h2>Configuration</h2>
        <p className={styles.hint}>
          All configuration is stored as plain JSON files, easy to inspect and
          back up:
        </p>
        {configStatus && <code className={styles.path}>{configStatus.configDir}</code>}
        <div>
          <button className="btn" onClick={openConfigDir}>
            Open config folder
          </button>
        </div>
      </section>
    </div>
  );
}
