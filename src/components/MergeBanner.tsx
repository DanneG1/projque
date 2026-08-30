import { useEffect, useState } from "react";
import { api } from "../api/ipc";
import type { GitInfo } from "../models";
import { useAppStore } from "../store/useAppStore";
import styles from "./MergeBanner.module.css";

/** Shown whenever a merge is stopped on conflicts - regardless of the
 *  advanced-git toggle, because the repo is in a state the user must exit
 *  through one of exactly two doors: complete (after resolving) or abort. */
export function MergeBanner({
  projectId,
  gitInfo,
}: {
  projectId: string;
  gitInfo: GitInfo;
}) {
  const busy = useAppStore((s) => s.gitBusy[projectId] ?? false);
  const mergeAbort = useAppStore((s) => s.mergeAbort);
  const mergeComplete = useAppStore((s) => s.mergeComplete);
  const startAgentSession = useAppStore((s) => s.startAgentSession);

  const [files, setFiles] = useState<string[]>([]);

  useEffect(() => {
    if (gitInfo.mergeInProgress) {
      api.gitConflicts(projectId).then(setFiles).catch(() => setFiles([]));
    }
  }, [projectId, gitInfo.mergeInProgress, gitInfo.fetchedAt]);

  if (!gitInfo.mergeInProgress) return null;

  const askAgent = () => {
    const list = files.slice(0, 20).join(", ");
    const prompt =
      `This project has a git merge in progress that stopped on conflicts` +
      (list ? ` in these files: ${list}.` : ".") +
      ` Open the conflicted files, resolve each conflict sensibly so both sides' ` +
      `intent is preserved, and remove all conflict markers. Do NOT run git commit - ` +
      `leave the resolved files for me to review and complete the merge myself. ` +
      `When done, explain the choices you made in simple language.`;
    void startAgentSession(projectId, undefined, prompt);
  };

  return (
    <div className={styles.banner}>
      <p className={styles.title}>Merge in progress - conflicts to resolve</p>
      <p className={styles.text}>
        Both branches changed the same lines. Fix the files below (open your
        editor, or let the agent help), then complete the merge. Nothing is
        final until you do - Abort returns everything to how it was before.
      </p>
      {files.length > 0 && (
        <ul className={styles.files}>
          {files.map((f) => (
            <li key={f}>
              <code>{f}</code>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.actions}>
        <button className="btn" disabled={busy} onClick={() => void mergeComplete(projectId)}>
          Complete merge
        </button>
        <button className="btn" disabled={busy} onClick={() => askAgent()}>
          Ask agent to resolve
        </button>
        <button className="btn" disabled={busy} onClick={() => void mergeAbort(projectId)}>
          Abort merge
        </button>
      </div>
    </div>
  );
}
