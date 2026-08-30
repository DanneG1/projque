import { useEffect, useState } from "react";
import { api } from "../api/ipc";
import type { BranchList, FileDiff, GitInfo, GraphCommit } from "../models";
import { useAppStore } from "../store/useAppStore";
import { CommitGraph } from "./CommitGraph";
import { DiffView } from "./DiffView";
import styles from "./RepoPanel.module.css";

/** The advanced repository view (Sourcetree-style essentials): commit graph
 *  across all branches, per-commit and working-tree diffs, branch create,
 *  push, and merging the current branch into a chosen target. */
export function RepoPanel({
  projectId,
  gitInfo,
}: {
  projectId: string;
  gitInfo: GitInfo;
}) {
  const busy = useAppStore((s) => s.gitBusy[projectId] ?? false);
  const pushBranch = useAppStore((s) => s.pushBranch);
  const createBranch = useAppStore((s) => s.createBranch);
  const mergeInto = useAppStore((s) => s.mergeInto);
  const reportError = useAppStore((s) => s.reportError);

  const [commits, setCommits] = useState<GraphCommit[]>([]);
  const [branches, setBranches] = useState<BranchList | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff[] | null>(null);
  const [workdir, setWorkdir] = useState(false);
  const [newBranch, setNewBranch] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");

  // Reload graph + branches after every git mutation.
  useEffect(() => {
    api.gitGraph(projectId, 100).then(setCommits).catch(reportError);
    api.gitBranches(projectId).then(setBranches).catch(() => setBranches(null));
  }, [projectId, gitInfo.fetchedAt, reportError]);

  // Load the diff for the selection (a commit, or the working tree).
  useEffect(() => {
    setDiff(null);
    if (workdir) {
      api.gitWorkdirDiff(projectId).then(setDiff).catch(reportError);
    } else if (selected) {
      api.gitCommitDiff(projectId, selected).then(setDiff).catch(reportError);
    }
  }, [projectId, selected, workdir, gitInfo.fetchedAt, reportError]);

  const others = (branches?.branches ?? []).filter((b) => !b.current);
  const current = gitInfo.branch ?? "(detached)";
  const upstream = branches?.branches.find((b) => b.current)?.upstream ?? null;
  const ahead = gitInfo.ahead ?? 0;

  const submitBranch = async () => {
    const name = (newBranch ?? "").trim();
    if (!name) return;
    if (await createBranch(projectId, name)) setNewBranch(null);
  };

  const merge = async () => {
    if (!mergeTarget) return;
    const result = await mergeInto(projectId, mergeTarget);
    if (result !== null) setMergeTarget("");
    // Conflicts surface through the MergeBanner via refreshed GitInfo.
  };

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <span className={styles.currentBranch}>
          On <strong>{current}</strong>{" "}
          {upstream ? (
            <span className={styles.tracks} title={`Commits here are compared and pushed to ${upstream}`}>
              → {upstream}
            </span>
          ) : (
            gitInfo.remoteUrl && (
              <span
                className={styles.tracks}
                title="This branch only exists on your machine - the first Push publishes it to origin and connects them"
              >
                local only
              </span>
            )
          )}
        </span>

        {newBranch === null ? (
          <button className="btn" disabled={busy} onClick={() => setNewBranch("")}>
            New branch…
          </button>
        ) : (
          <span className={styles.inline}>
            <input
              className={styles.branchInput}
              autoFocus
              placeholder="e.g. feature/login"
              value={newBranch}
              maxLength={100}
              onChange={(e) => setNewBranch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitBranch();
                if (e.key === "Escape") setNewBranch(null);
              }}
            />
            <button className="btn" disabled={busy || !newBranch.trim()} onClick={() => void submitBranch()}>
              Create
            </button>
            <button className="btn" onClick={() => setNewBranch(null)}>
              Cancel
            </button>
          </span>
        )}

        {gitInfo.remoteUrl && (
          <button
            className="btn"
            disabled={busy}
            title={
              upstream
                ? `git push - upload your commits to ${upstream}`
                : "git push -u origin - publishes this branch to origin and sets it to track the remote copy"
            }
            onClick={() => void pushBranch(projectId)}
          >
            {busy ? "Working…" : ahead > 0 ? `Push (${ahead} ahead)` : "Push"}
          </button>
        )}

        {others.length > 0 && !gitInfo.mergeInProgress && (
          <span className={styles.inline}>
            <label className={styles.mergeLabel}>
              Merge {current} into
              <select
                value={mergeTarget}
                disabled={busy}
                onChange={(e) => setMergeTarget(e.target.value)}
              >
                <option value="">choose branch…</option>
                {others.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn"
              disabled={busy || !mergeTarget || gitInfo.dirty}
              title={
                gitInfo.dirty
                  ? "Commit your changes first - a merge from a clean state can always be safely undone"
                  : mergeTarget
                    ? `Brings your commits from ${current} into ${mergeTarget}; you'll end up on ${mergeTarget}`
                    : "Pick the branch to merge into"
              }
              onClick={() => void merge()}
            >
              Merge
            </button>
          </span>
        )}
      </div>
      {gitInfo.dirty && !gitInfo.mergeInProgress && (
        <p className={styles.hint}>
          Merging needs a clean state - commit your changes first, so a merge
          can always be undone safely.
        </p>
      )}

      <div className={styles.columns}>
        <div className={styles.graphCol}>
          {gitInfo.dirty && (
            <button
              className={styles.workdirBtn}
              data-selected={workdir || undefined}
              onClick={() => {
                setWorkdir(true);
                setSelected(null);
              }}
            >
              Uncommitted changes ({gitInfo.changedFiles} file
              {gitInfo.changedFiles === 1 ? "" : "s"})
            </button>
          )}
          <CommitGraph
            commits={commits}
            selected={selected}
            onSelect={(hash) => {
              setWorkdir(false);
              setSelected(hash);
            }}
          />
        </div>
        <div className={styles.diffCol}>
          {diff === null && (selected || workdir) ? (
            <p className={styles.hint}>Loading diff…</p>
          ) : diff !== null ? (
            <DiffView files={diff} />
          ) : (
            <p className={styles.hint}>
              Select a commit to see exactly what it changed.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
