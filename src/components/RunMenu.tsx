import { useEffect, useRef, useState } from "react";
import { api } from "../api/ipc";
import type { RunTarget } from "../models";
import { useAppStore } from "../store/useAppStore";
import { IconButton } from "./IconButton";
import styles from "./RunMenu.module.css";

export function RunMenu({ projectId, disabled }: { projectId: string; disabled: boolean }) {
  const startRunSession = useAppStore((s) => s.startRunSession);
  const reportError = useAppStore((s) => s.reportError);
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<RunTarget[] | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open) {
      setTargets(null);
      api.projectRunTargets(projectId).then(setTargets).catch(reportError);
    }
    setOpen((v) => !v);
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <IconButton icon="run" tip="Run app" accent disabled={disabled} onClick={toggle} />
      {open && (
        <div className={styles.menu} role="menu">
          {targets === null && <div className={styles.hint}>Detecting…</div>}
          {targets?.length === 0 && (
            <div className={styles.hint}>No run targets found in this project.</div>
          )}
          {targets?.map((t) => (
            <button
              key={t.targetId}
              className={styles.item}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void startRunSession(projectId, t.targetId);
              }}
            >
              <span className={styles.label}>{t.label}</span>
              {t.detail && <span className={styles.detail}>{t.detail}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
