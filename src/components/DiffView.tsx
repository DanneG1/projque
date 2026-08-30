import { useState } from "react";
import type { FileDiff } from "../models";
import styles from "./DiffView.module.css";

const STATUS_LABEL: Record<FileDiff["status"], string> = {
  added: "added",
  modified: "modified",
  deleted: "deleted",
  renamed: "renamed",
  untracked: "new, not tracked yet",
};

function lineClass(line: string): string {
  if (line.startsWith("@@")) return styles.hunk;
  if (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("new file") ||
    line.startsWith("deleted file") ||
    line.startsWith("rename ") ||
    line.startsWith("similarity ") ||
    line.startsWith("Binary files")
  ) {
    return styles.meta;
  }
  if (line.startsWith("+")) return styles.add;
  if (line.startsWith("-")) return styles.del;
  return styles.ctx;
}

function FileSection({ file, defaultOpen }: { file: FileDiff; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={styles.file}>
      <button className={styles.fileHead} onClick={() => setOpen((v) => !v)}>
        <span className={styles.chevron} data-open={open || undefined}>
          ▸
        </span>
        <span className={styles.path}>
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        <span className={styles.status} data-status={file.status}>
          {STATUS_LABEL[file.status]}
        </span>
      </button>
      {open && (
        <pre className={styles.patch}>
          {file.patch === "" ? (
            <span className={styles.meta}>(no textual changes to show)</span>
          ) : (
            file.patch.split("\n").map((line, i) => (
              <span key={i} className={lineClass(line)}>
                {line}
                {"\n"}
              </span>
            ))
          )}
          {file.truncated && <span className={styles.meta}>… (large file - diff shortened)</span>}
        </pre>
      )}
    </div>
  );
}

/** Read-only unified diff renderer. Content is plain text spans - never
 *  interpreted as markup. */
export function DiffView({ files }: { files: FileDiff[] }) {
  if (files.length === 0) {
    return <p className={styles.empty}>No changes.</p>;
  }
  const defaultOpen = files.length <= 8;
  return (
    <div className={styles.list}>
      {files.map((f, i) => (
        <FileSection key={`${f.path}-${i}`} file={f} defaultOpen={defaultOpen} />
      ))}
    </div>
  );
}
