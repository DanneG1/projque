import { useAppStore } from "../../store/useAppStore";
import styles from "./QuitConfirmDialog.module.css";

export function QuitConfirmDialog() {
  const quitPrompt = useAppStore((s) => s.quitPrompt);
  const setQuitPrompt = useAppStore((s) => s.setQuitPrompt);
  const confirmQuit = useAppStore((s) => s.confirmQuit);

  if (quitPrompt === null) return null;

  return (
    <div className={styles.backdrop} onClick={() => setQuitPrompt(null)}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Quit ProjQue?</h2>
        <p>
          {quitPrompt} agent {quitPrompt === 1 ? "session is" : "sessions are"} still
          running and will be stopped.
        </p>
        <div className={styles.actions}>
          <button className="btn" autoFocus onClick={() => setQuitPrompt(null)}>
            Keep running
          </button>
          <button className="btn btn-primary" onClick={() => void confirmQuit()}>
            Stop agents and quit
          </button>
        </div>
      </div>
    </div>
  );
}
