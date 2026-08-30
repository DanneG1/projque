import type { GitInfo } from "../models";
import { Icon } from "./Icon";
import { relativeTime } from "../utils/time";
import styles from "./GitSummary.module.css";

export function GitSummary({ info }: { info: GitInfo | undefined }) {
  if (!info) return <div className={styles.row} aria-hidden />;
  if (info.state === "notARepository")
    return <div className={styles.row}><span className={styles.faint}>Not a git repository</span></div>;
  if (info.state === "gitMissing") return null;
  if (info.state === "error")
    return <div className={styles.row}><span className={styles.faint}>git information unavailable</span></div>;

  const branch = info.detached ? "detached HEAD" : (info.branch ?? "");
  return (
    <div className={styles.row}>
      {branch && (
        <span className={styles.branch}>
          <Icon name="branch" size={12} /> {branch}
        </span>
      )}
      {info.dirty ? (
        <span className={styles.dirty}>{info.changedFiles} changed</span>
      ) : (
        <span className={styles.clean}>clean</span>
      )}
      {info.behind != null && info.behind > 0 && <span className={styles.sync}>↓{info.behind}</span>}
      {info.ahead != null && info.ahead > 0 && <span className={styles.sync}>↑{info.ahead}</span>}
      {info.lastCommit && (
        <>
          <span className={styles.sep}>·</span>
          <span className={styles.commit} title={info.lastCommit.subject}>
            {info.lastCommit.subject} — {relativeTime(info.lastCommit.timestamp)}
          </span>
        </>
      )}
    </div>
  );
}
