import { useAppStore } from "../store/useAppStore";
import type { CatalogEntry, Theme } from "../models";
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
  const catalog = useAppStore((s) => s.catalog);
  const setTool = useAppStore((s) => s.setTool);

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
        <h2>Tools</h2>
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
          Tools are chosen from a fixed, audited list — Projque never runs
          arbitrary commands. Greyed-out entries were not found on this
          machine.
        </p>
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
