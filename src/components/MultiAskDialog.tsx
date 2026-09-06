import { useEffect, useState } from "react";
import type { SavedPrompt } from "../models";
import { useAppStore } from "../store/useAppStore";
import { Icon } from "./Icon";
import styles from "./MultiAskDialog.module.css";

const NO_PROMPTS: SavedPrompt[] = [];

const MAX = 8;

/** One prompt, several projects: starts an agent session in each (up to
 *  four shown side by side, the rest in the session list). */
export function MultiAskDialog() {
  const open = useAppStore((s) => s.multiAskOpen);
  const setOpen = useAppStore((s) => s.setMultiAskOpen);
  const projects = useAppStore((s) => s.projects);
  // Select the stable reference; defaulting inside the selector would hand
  // zustand a fresh array every render and loop forever.
  const savedPrompts = useAppStore((s) => s.settings?.prompts);
  const prompts = savedPrompts ?? NO_PROMPTS;
  const startMany = useAppStore((s) => s.startAgentsInProjects);
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  const eligible = projects
    .filter((p) => p.pathExists && p.status !== "archived")
    .sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => {
    if (!open) return;
    setPicked([]);
    setText("");
    setFilter("");
    setBusy(false);
  }, [open]);

  if (!open) return null;
  const close = () => setOpen(false);

  const toggle = (id: string) =>
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX ? prev : [...prev, id],
    );

  const shown = eligible.filter((p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase()));
  const canStart = !busy && picked.length > 0 && text.trim() !== "";

  const start = async () => {
    if (!canStart) return;
    setBusy(true);
    await startMany(picked, text.trim().slice(0, 4000));
    close();
  };

  return (
    <div className={styles.backdrop} onMouseDown={close}>
      <div
        className={styles.dialog}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void start();
        }}
      >
        <h2 className={styles.title}>
          <Icon name="agent" size={16} /> Ask several projects at once
        </h2>
        <textarea
          className={styles.text}
          value={text}
          autoFocus
          rows={3}
          placeholder="What should the agent do in each project? Example: “update the copyright year in the footer to 2026”"
          onChange={(e) => setText(e.target.value)}
        />
        {prompts.length > 0 && (
          <div className={styles.saved}>
            {prompts
              .filter((p) => !p.prompt.includes("{input}"))
              .map((p) => (
                <button key={p.id} className={styles.savedChip} title={p.prompt} onClick={() => setText(p.prompt)}>
                  {p.label}
                </button>
              ))}
          </div>
        )}
        <div className={styles.pickHead}>
          <span className={styles.field}>
            Projects <span className={styles.count}>{picked.length} of up to {MAX}</span>
          </span>
          <input
            className={styles.filter}
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <ul className={styles.list}>
          {shown.map((p) => {
            const on = picked.includes(p.id);
            return (
              <li key={p.id}>
                <label className={styles.item} data-on={on || undefined}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && picked.length >= MAX}
                    onChange={() => toggle(p.id)}
                  />
                  <span className={styles.name}>{p.name}</span>
                  {p.resolvedDescription && <span className={styles.desc}>{p.resolvedDescription}</span>}
                </label>
              </li>
            );
          })}
          {shown.length === 0 && <li className={styles.empty}>No project matches.</li>}
        </ul>
        <p className={styles.hint}>
          Each project gets its own agent session with a backup taken first, exactly like the Agent
          button. Up to four are shown side by side; the rest wait in the session list.
        </p>
        <div className={styles.actions}>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!canStart} onClick={() => void start()}>
            Start in {picked.length || ""} project{picked.length === 1 ? "" : "s"}{" "}
            <span className={styles.kbd}>⌘↩</span>
          </button>
        </div>
      </div>
    </div>
  );
}
