import type { GitInfo } from "../models";
import { relativeTime } from "../utils/time";
import styles from "./GitSummary.module.css";

export function GitSummary({ info }: { info: GitInfo | undefined }) {
  if (!info) {
    return <div className={styles.row} aria-hidden />;
  }
  if (info.state === "notARepository" || info.state === "gitMissing") {
    return null;
  }
  if (info.state === "error") {
    return <div className={styles.row}>git information unavailable</div>;
  }

  const branch = info.detached ? "detached HEAD" : (info.branch ?? "");
  const tree = info.dirty
    ? `${info.changedFiles} modified ${info.changedFiles === 1 ? "file" : "files"}`
    : "clean";

  return (
    <div className={styles.row}>
      {branch && <span className={styles.branch}>{branch}</span>}
      <span className={styles.sep}>·</span>
      <span data-dirty={info.dirty || undefined} className={styles.tree}>
        {tree}
      </span>
      {info.ahead != null && info.ahead > 0 && <span className={styles.sync}>↑{info.ahead}</span>}
      {info.behind != null && info.behind > 0 && <span className={styles.sync}>↓{info.behind}</span>}
      {info.lastCommit && (
        <>
          <span className={styles.sep}>·</span>
          <span className={styles.commit} title={info.lastCommit.subject}>
            {info.lastCommit.subject}
          </span>
          <span className={styles.time}>{relativeTime(info.lastCommit.timestamp)}</span>
        </>
      )}
    </div>
  );
}
