import { useEffect, useState } from "react";
import { api } from "../api/ipc";
import type { BranchList, GitInfo } from "../models";
import { useAppStore } from "../store/useAppStore";
import styles from "./GitControls.module.css";

export function GitControls({
  projectId,
  gitInfo,
}: {
  projectId: string;
  gitInfo: GitInfo | undefined;
}) {
  const gitAvailable = useAppStore((s) => s.gitAvailable);
  const busy = useAppStore((s) => s.gitBusy[projectId] ?? false);
  const fetchRemote = useAppStore((s) => s.fetchRemote);
  const pullFf = useAppStore((s) => s.pullFf);
  const switchBranch = useAppStore((s) => s.switchBranch);
  const reportError = useAppStore((s) => s.reportError);

  const [branches, setBranches] = useState<BranchList | null>(null);

  const loadBranches = () => {
    api.gitBranches(projectId).then(setBranches).catch(reportError);
  };

  // Reload the branch list whenever git state changes (switch/fetch/pull).
  useEffect(() => {
    setBranches(null);
    if (gitAvailable && gitInfo?.state === "available") loadBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, gitInfo?.branch, gitInfo?.fetchedAt, gitAvailable]);

  if (!gitAvailable || !gitInfo || gitInfo.state !== "available") return null;

  const currentBranch = branches?.branches.find((b) => b.current)?.name ?? gitInfo.branch ?? "";
  const behind = gitInfo.behind ?? 0;
  const hasRemote = gitInfo.remoteUrl != null;

  return (
    <div className={styles.row}>
      {branches && branches.branches.length > 0 && (
        <label className={styles.branchWrap}>
          <span className={styles.label}>Branch</span>
          <select
            value={gitInfo.detached ? "" : currentBranch}
            disabled={busy}
            onChange={(e) => {
              if (e.target.value && e.target.value !== currentBranch) {
                void switchBranch(projectId, e.target.value);
              }
            }}
          >
            {gitInfo.detached && (
              <option value="" disabled>
                detached HEAD
              </option>
            )}
            {branches.branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
                {b.behind > 0 ? ` (↓${b.behind})` : ""}
                {b.ahead > 0 ? ` (↑${b.ahead})` : ""}
              </option>
            ))}
            {branches.remoteBranches.length > 0 && (
              <optgroup label="Remote (view only)">
                {branches.remoteBranches.map((name) => (
                  <option key={name} value="" disabled>
                    {name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
      )}
      {hasRemote && (
        <button
          className="btn"
          disabled={busy}
          title="git fetch --prune (contacts your remote)"
          onClick={() => void fetchRemote(projectId)}
        >
          {busy ? "Working…" : "Fetch"}
        </button>
      )}
      {hasRemote && behind > 0 && (
        <button
          className="btn"
          disabled={busy}
          title="git pull --ff-only"
          onClick={() => void pullFf(projectId)}
        >
          Pull ({behind} behind)
        </button>
      )}
    </div>
  );
}
