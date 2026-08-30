import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { Icon } from "./Icon";
import styles from "./IdeaCaptureDialog.module.css";

// Remembered across openings so consecutive ideas land in the same place.
let lastProjectId: string | null = null;

/** Sentinel select value for "not tied to a project". Project ids are
 *  kebab-case slugs, so this can never collide. */
const GENERAL = "__general__";

export function IdeaCaptureDialog() {
  const open = useAppStore((s) => s.ideaOpen);
  const setOpen = useAppStore((s) => s.setIdeaOpen);
  const projects = useAppStore((s) => s.projects);
  const route = useAppStore((s) => s.route);
  const captureIdea = useAppStore((s) => s.captureIdea);

  const [projectId, setProjectId] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const eligible = projects
    .filter((p) => p.pathExists)
    .sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => {
    if (!open) return;
    // Default to the project on screen, else the last one used.
    const routeProject =
      route.page === "detail" &&
      eligible.some((p) => p.id === route.projectId)
        ? route.projectId
        : null;
    const remembered =
      lastProjectId === GENERAL ||
      (lastProjectId && eligible.some((p) => p.id === lastProjectId))
        ? lastProjectId
        : null;
    setProjectId(routeProject ?? remembered ?? eligible[0]?.id ?? GENERAL);
    setText("");
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const close = () => setOpen(false);
  const canSave = !busy && projectId !== "" && text.trim() !== "";
  const targetId = projectId === GENERAL ? null : projectId;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    const ok = await captureIdea(targetId, text.trim());
    if (ok) {
      lastProjectId = projectId;
      close();
    } else {
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} onMouseDown={close}>
      <div
        className={styles.dialog}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
        }}
      >
        <h2 className={styles.title}>
          <Icon name="idea" size={16} /> Capture an idea
        </h2>
        <textarea
          ref={textRef}
          className={styles.text}
          value={text}
          autoFocus
          rows={3}
          placeholder="What if…"
          onChange={(e) => setText(e.target.value)}
        />
        <label className={styles.field}>
          Save to
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value={GENERAL}>No project — general idea</option>
            {eligible.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <p className={styles.hint}>
          {targetId === null
            ? "Saved to your general idea list on the Projects page — maybe a future project."
            : <>Appended to the project’s <code>IDEAS.md</code> — agents and future you will find it there.</>}
        </p>
        <div className={styles.actions}>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!canSave} onClick={() => void save()}>
            Save idea <span className={styles.kbd}>⌘↩</span>
          </button>
        </div>
      </div>
    </div>
  );
}
