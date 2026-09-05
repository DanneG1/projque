import { useAppStore } from "../store/useAppStore";
import { DiskOverview } from "../components/DiskPanel";
import type { CatalogEntry, Theme } from "../models";
import { DoctorPanel } from "../components/DoctorPanel";
import { LANGUAGES, useT } from "../i18n";
import styles from "./SettingsPage.module.css";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function SettingsPage() {
  const settings = useAppStore((s) => s.settings);
  const configStatus = useAppStore((s) => s.configStatus);
  const setDisplay = useAppStore((s) => s.setDisplay);
  const setNotifications = useAppStore((s) => s.setNotifications);
  const t = useT();
  const openConfigDir = useAppStore((s) => s.openConfigDir);
  const addProjectRoot = useAppStore((s) => s.addProjectRoot);
  const removeProjectRoot = useAppStore((s) => s.removeProjectRoot);
  const setScanDepth = useAppStore((s) => s.setScanDepth);
  const catalog = useAppStore((s) => s.catalog);
  const setTool = useAppStore((s) => s.setTool);

  if (!settings) return null;

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>{t("Settings")}</h1>

      <section className={styles.section}>
        <h2>{t("Project folders")}</h2>
        {settings.projectRoots.length === 0 && (
          <p className={styles.hint}>
            No folders configured yet. These are the folders ProjQue scans for
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
        <h2>{t("Setup check")}</h2>
        <p className={styles.hint}>
          Everything ProjQue builds on, checked on this machine. Fix the items
          marked ✗ to unlock agents, commits, and publishing.
        </p>
        <DoctorPanel />
      </section>

      <section className={styles.section}>
        <h2>{t("Tools")}</h2>
        <ToolSelect
          label="Editor"
          entries={catalog?.editors ?? []}
          value={settings.editor.type}
          onChange={(kind) => void setTool("editor", kind)}
        />
        <ToolSelect
          label="Terminal"
          entries={catalog?.terminals ?? []}
          value={settings.terminal.type}
          onChange={(kind) => void setTool("terminal", kind)}
        />
        <ToolSelect
          label="Agent"
          entries={catalog?.agents ?? []}
          value={settings.agent.type}
          onChange={(kind) => void setTool("agent", kind)}
        />
        <p className={styles.hint}>
          Tools are chosen from a fixed, audited list - ProjQue never runs
          arbitrary commands. Greyed-out entries were not found on this
          machine.
        </p>
      </section>

      <section className={styles.section}>
        <h2>{t("Display")}</h2>
        <label className={styles.row}>
          {t("Language")}
          <select
            value={settings.display.language ?? "system"}
            onChange={(e) => setDisplay({ language: e.target.value })}
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.row}>
          <input
            type="checkbox"
            checked={settings.display.showArchived}
            onChange={(e) => setDisplay({ showArchived: e.target.checked })}
          />
          {t("Show archived projects by default")}
        </label>
        <label className={styles.row}>
          {t("Theme")}
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
        <h2>{t("Notifications")}</h2>
        <label className={styles.row}>
          <input
            type="checkbox"
            checked={settings.notifications.system}
            onChange={(e) => setNotifications({ system: e.target.checked })}
          />
          {t("System notifications when ProjQue is in the background (agent finished or waiting, test results)")}
        </label>
        <label className={styles.row}>
          <input
            type="checkbox"
            disabled={!settings.notifications.system}
            checked={settings.notifications.quietHours}
            onChange={(e) => setNotifications({ quietHours: e.target.checked })}
          />
          Quiet hours - no system notifications from
          <select
            disabled={!settings.notifications.system || !settings.notifications.quietHours}
            value={settings.notifications.quietFrom}
            onChange={(e) => setNotifications({ quietFrom: Number(e.target.value) })}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
          to
          <select
            disabled={!settings.notifications.system || !settings.notifications.quietHours}
            value={settings.notifications.quietTo}
            onChange={(e) => setNotifications({ quietTo: Number(e.target.value) })}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </label>
        <p className={styles.hint}>
          {t("In-app toasts and the notification bell are always on; this only controls what reaches the system notification center.")}
        </p>
      </section>

      <section className={styles.section}>
        <h2>{t("Disk space")}</h2>
        <p className={styles.hint}>
          Installed packages, build output and caches add up across many projects. Everything
          listed here is recreated the next time a project is installed or built - your code and
          history are never touched.
        </p>
        <DiskOverview />
      </section>

      <section className={styles.section}>
        <h2>{t("Configuration")}</h2>
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

function ToolSelect(props: {
  label: string;
  entries: CatalogEntry[];
  value: string;
  onChange: (kind: string) => void;
}) {
  const known = props.entries.some((e) => e.kind === props.value);
  return (
    <label className={styles.row}>
      {props.label}
      <select value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {!known && (
          <option value={props.value} disabled>
            {props.value} (unrecognized)
          </option>
        )}
        {props.entries.map((e) => (
          <option key={e.kind} value={e.kind}>
            {e.label}
            {e.installed ? "" : " (not installed)"}
          </option>
        ))}
      </select>
    </label>
  );
}
