import { useEffect, useState } from "react";
import { api } from "../api/ipc";
import type { EnvStatus } from "../models";
import { useAppStore } from "../store/useAppStore";
import { Icon } from "./Icon";
import styles from "./EnvPanel.module.css";

/** "This project needs 3 settings before it runs": .env.example vs .env,
 *  with a masked editor that writes into .env only. */
export function EnvPanel({ projectId, isGitRepo }: { projectId: string; isGitRepo: boolean }) {
  const reportError = useAppStore((s) => s.reportError);
  const fixIgnores = useAppStore((s) => s.fixIgnores);
  const [status, setStatus] = useState<EnvStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [newKey, setNewKey] = useState("");

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    setOpen(false);
    api.projectEnvStatus(projectId).then((s) => !cancelled && setStatus(s)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!status || (!status.exampleFile && !status.hasEnv)) return null;

  const save = async (key: string) => {
    try {
      setStatus(await api.projectEnvSet(projectId, key, value));
      setEditing(null);
      setValue("");
      setNewKey("");
    } catch (err) {
      reportError(err);
    }
  };

  const summary =
    status.missing > 0
      ? `${status.missing} setting${status.missing === 1 ? "" : "s"} from ${status.exampleFile} still missing: ${status.keys
          .filter((k) => k.expected && !k.set)
          .map((k) => k.key)
          .join(", ")}`
      : status.exampleFile
        ? `All ${status.keys.filter((k) => k.expected).length} settings from ${status.exampleFile} are filled in.`
        : `${status.keys.length} setting${status.keys.length === 1 ? "" : "s"} in .env.`;

  return (
    <div className={styles.row} data-alert={status.missing > 0 || undefined}>
      <span className={styles.label}>Settings</span>
      <div className={styles.body}>
        <span className={styles.text} data-ok={status.missing === 0 || undefined}>
          {status.missing === 0 && <Icon name="check" size={12} />} {summary}
        </span>
        {isGitRepo && status.hasEnv && !status.ignored && (
          <span className={styles.warn}>
            <code>.env</code> is not ignored by git - it could end up in a commit.
            <button className="btn" onClick={() => void fixIgnores(projectId, ["envFiles"])}>
              Ignore it
            </button>
          </span>
        )}
        {open && (
          <ul className={styles.list}>
            {status.keys.map((k) => (
              <li key={k.key} className={styles.item} data-missing={(k.expected && !k.set) || undefined}>
                <code className={styles.key}>{k.key}</code>
                {editing === k.key ? (
                  <span className={styles.edit}>
                    <input
                      className={styles.input}
                      type="password"
                      autoFocus
                      value={value}
                      placeholder={k.hint ?? "value"}
                      onChange={(e) => setValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void save(k.key);
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                    <button className="btn" onClick={() => void save(k.key)}>
                      Save
                    </button>
                    <button className="btn btn-ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <>
                    <span className={styles.value}>
                      {k.set ? k.masked : <em>not set</em>}
                      {k.hint && !k.set && <span className={styles.hint}> - {k.hint}</span>}
                      {!k.expected && <span className={styles.hint}> - not in the example file</span>}
                    </span>
                    <button
                      className={styles.link}
                      onClick={() => {
                        setEditing(k.key);
                        setValue("");
                      }}
                    >
                      {k.set ? "Change" : "Set"}
                    </button>
                  </>
                )}
              </li>
            ))}
            <li className={styles.item}>
              <input
                className={styles.keyInput}
                placeholder="NEW_SETTING"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
              />
              {editing === "__new__" ? (
                <span className={styles.edit}>
                  <input
                    className={styles.input}
                    type="password"
                    autoFocus
                    value={value}
                    placeholder="value"
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newKey) void save(newKey);
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                  <button className="btn" disabled={!newKey} onClick={() => void save(newKey)}>
                    Save
                  </button>
                </span>
              ) : (
                <button className={styles.link} disabled={!newKey} onClick={() => setEditing("__new__")}>
                  Add
                </button>
              )}
            </li>
          </ul>
        )}
      </div>
      <button className="btn" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide" : status.missing > 0 ? "Fill in" : "Show"}
      </button>
    </div>
  );
}
