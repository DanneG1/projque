import { useAppStore } from "../store/useAppStore";
import styles from "./Toasts.module.css";

export function Toasts() {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className={styles.stack} role="status">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={styles.toast}
          data-variant={t.variant}
          data-clickable={t.onClick ? true : undefined}
          role={t.onClick ? "button" : undefined}
          onClick={() => {
            dismiss(t.id);
            t.onClick?.();
          }}
        >
          <div className={styles.title}>{t.title}</div>
          {t.detail && <div className={styles.detail}>{t.detail}</div>}
          {t.onClick && <div className={styles.hint}>Click to open</div>}
        </div>
      ))}
    </div>
  );
}
