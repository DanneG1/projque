import { useEffect, useState } from "react";
import { api } from "../api/ipc";
import type { DoctorItem } from "../models";
import { useAppStore } from "../store/useAppStore";
import styles from "./DoctorPanel.module.css";

/** Setup check: is everything ProjQue builds on actually working on this
 *  machine? Each failing item explains the fix in plain language; where a
 *  guided fix exists (GitHub login) one click opens the user's terminal with
 *  the right command already running. */
export function DoctorPanel() {
  const notify = useAppStore((s) => s.notify);
  const reportError = useAppStore((s) => s.reportError);

  const [items, setItems] = useState<DoctorItem[] | null>(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      setItems(await api.doctorStatus());
    } catch (err) {
      reportError(err);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fix = async (item: DoctorItem) => {
    try {
      await api.doctorFix(item.id);
      notify(
        "Terminal opened",
        "Follow the steps in the terminal window, then come back and press Check again.",
      );
    } catch (err) {
      reportError(err);
    }
  };

  return (
    <div className={styles.panel}>
      {items === null ? (
        <p className={styles.hint}>Checking…</p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id} className={styles.item}>
              <span className={styles.mark} data-ok={item.ok || undefined}>
                {item.ok ? "✓" : "✗"}
              </span>
              <span className={styles.label}>{item.label}</span>
              {item.fixable && (
                <button className="btn" onClick={() => void fix(item)}>
                  Fix…
                </button>
              )}
              {item.detail && <span className={styles.detail}>{item.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      <div>
        <button className="btn" disabled={checking} onClick={() => void check()}>
          {checking ? "Checking…" : "Check again"}
        </button>
      </div>
    </div>
  );
}
