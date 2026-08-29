import { useAppStore } from "../store/useAppStore";
import styles from "./ConfigRecoveryBanner.module.css";

export function ConfigRecoveryBanner() {
  const status = useAppStore((s) => s.configStatus);
  const openConfigDir = useAppStore((s) => s.openConfigDir);
  if (!status) return null;

  const fileState = status.settings;
  if (fileState.status === "recovered") {
    return (
      <div className={styles.banner}>
        <span>
          <strong>settings.json couldn't be read</strong> and was backed up to{" "}
          <code>{fileState.backupPath}</code>. Your data is safe.
        </span>
        <button className="btn" onClick={openConfigDir}>
          Open config folder
        </button>
      </div>
    );
  }
  if (fileState.status === "lockedNewerVersion") {
    return (
      <div className={styles.banner}>
        <span>
          <strong>Settings were written by a newer Projque</strong> (config version{" "}
          {fileState.found}). Settings are read-only until you update the app.
        </span>
      </div>
    );
  }
  return null;
}
