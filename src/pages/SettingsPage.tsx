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

  if (!settings) return null;

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Settings</h1>

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
