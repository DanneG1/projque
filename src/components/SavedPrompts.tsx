import { useState } from "react";
import type { SavedPrompt } from "../models";
import { useAppStore } from "../store/useAppStore";
import { Icon } from "./Icon";
import styles from "./SavedPrompts.module.css";

/** The user's own reusable prompts, next to the built-in guided actions.
 *  A prompt containing `{input}` asks for a description first. */
export function SavedPrompts({ projectId }: { projectId: string }) {
  const prompts = useAppStore((s) => s.settings?.prompts ?? []);
  const savePrompt = useAppStore((s) => s.savePrompt);
  const deletePrompt = useAppStore((s) => s.deletePrompt);
  const startAgentSession = useAppStore((s) => s.startAgentSession);

  const [editing, setEditing] = useState<SavedPrompt | "new" | null>(null);
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [asking, setAsking] = useState<SavedPrompt | null>(null);
  const [input, setInput] = useState("");
  const [manage, setManage] = useState(false);

  const openEditor = (p: SavedPrompt | "new") => {
    setAsking(null);
    setEditing(p);
    setLabel(p === "new" ? "" : p.label);
    setText(p === "new" ? "" : p.prompt);
  };

  const use = (p: SavedPrompt) => {
    setEditing(null);
    if (p.prompt.includes("{input}")) {
      setAsking(p);
      setInput("");
      return;
    }
    void startAgentSession(projectId, undefined, p.prompt);
  };

  const startWithInput = () => {
    if (!asking || !input.trim()) return;
    void startAgentSession(projectId, undefined, asking.prompt.split("{input}").join(input.trim()));
    setAsking(null);
  };

  const save = async () => {
    if (!label.trim() || !text.trim()) return;
    const ok = await savePrompt(editing === "new" || editing === null ? null : editing.id, label, text);
    if (ok) setEditing(null);
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        <span className={styles.caption}>Your prompts</span>
        {prompts.map((p) => (
          <span key={p.id} className={styles.chipWrap}>
            <button className={styles.chip} title={p.prompt} onClick={() => use(p)}>
              <Icon name="agent" size={12} /> {p.label}
            </button>
            {manage && (
              <>
                <button className={styles.mini} title="Edit" onClick={() => openEditor(p)}>
                  ✎
                </button>
                <button className={styles.mini} title="Delete" onClick={() => void deletePrompt(p.id)}>
                  ✕
                </button>
              </>
            )}
          </span>
        ))}
        <button className={styles.add} title="Save a prompt you use often" onClick={() => openEditor("new")}>
          + Save a prompt
        </button>
        {prompts.length > 0 && (
          <button className={styles.add} onClick={() => setManage((v) => !v)}>
            {manage ? "Done" : "Edit"}
          </button>
        )}
      </div>

      {editing && (
        <div className={styles.form}>
          <input
            className={styles.input}
            autoFocus
            placeholder="Name, e.g. “Make it mobile friendly”"
            value={label}
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
          />
          <textarea
            className={styles.textarea}
            rows={4}
            placeholder="What the agent should do. Write {input} where you want to be asked for details each time."
            value={text}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(null);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
            }}
          />
          <div className={styles.actions}>
            <span className={styles.hint}>Saved in your ProjQue settings, available in every project.</span>
            <button className="btn" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!label.trim() || !text.trim()} onClick={() => void save()}>
              Save
            </button>
          </div>
        </div>
      )}

      {asking && (
        <div className={styles.form}>
          <textarea
            className={styles.textarea}
            autoFocus
            rows={3}
            placeholder={`Details for “${asking.label}”`}
            value={input}
            maxLength={3000}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setAsking(null);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) startWithInput();
            }}
          />
          <div className={styles.actions}>
            <span className={styles.hint}>Replaces {"{input}"} in your prompt.</span>
            <button className="btn" onClick={() => setAsking(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!input.trim()} onClick={startWithInput}>
              Start agent
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
