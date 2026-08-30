import { useEffect, useMemo, useState } from "react";
import { api } from "../api/ipc";
import type { BranchList, FileDiff, GhStatus, GraphCommit, PrStatus } from "../models";
import { useAppStore } from "../store/useAppStore";
import { CommitControls } from "../components/CommitControls";
import { CommitGraph } from "../components/CommitGraph";
import { DiffView } from "../components/DiffView";
import { Icon } from "../components/Icon";
import { MergeBanner } from "../components/MergeBanner";
import { relativeTime } from "../utils/time";
import styles from "./GitPage.module.css";

/** The standalone git client view: pick any git project on the left, work
 *  with branches / commits / merges / pushes in the middle, read diffs on
 *  the right. Same safe verbs as everywhere else - no rewriting, no forcing. */
export function GitPage({ projectId }: { projectId?: string }) {
  const projects = useAppStore((s) => s.projects);
  const git = useAppStore((s) => s.git);
  const setRoute = useAppStore((s) => s.setRoute);
  const refreshGit = useAppStore((s) => s.refreshGit);
  const reportError = useAppStore((s) => s.reportError);
  const notifyBusy = useAppStore((s) => s.gitBusy);
  const switchBranch = useAppStore((s) => s.switchBranch);
  const fetchRemote = useAppStore((s) => s.fetchRemote);
  const pullFf = useAppStore((s) => s.pullFf);
  const pushBranch = useAppStore((s) => s.pushBranch);
  const createBranch = useAppStore((s) => s.createBranch);
  const deleteBranch = useAppStore((s) => s.deleteBranch);
  const mergeInto = useAppStore((s) => s.mergeInto);

  const repos = useMemo(
    () =>
      projects
        .filter((p) => p.isGitRepo && p.pathExists)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [projects],
  );

  const selectedId = projectId && repos.some((r) => r.id === projectId)
    ? projectId
    : repos[0]?.id;
  const project = repos.find((r) => r.id === selectedId);
  const gitInfo = selectedId ? git[selectedId] : undefined;
  const busy = selectedId ? (notifyBusy[selectedId] ?? false) : false;

  const [branches, setBranches] = useState<BranchList | null>(null);
  const [commits, setCommits] = useState<GraphCommit[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [workdir, setWorkdir] = useState(false);
  const [diff, setDiff] = useState<FileDiff[] | null>(null);
  const [newBranch, setNewBranch] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [gh, setGh] = useState<GhStatus | null>(null);
  const [pr, setPr] = useState<PrStatus | null | "unloaded">("unloaded");
  const [prBusy, setPrBusy] = useState(false);

  useEffect(() => {
    void refreshGit();
    api.githubStatus().then(setGh).catch(() => setGh(null));
  }, [refreshGit]);

  // Per-repo data, reloaded after every git mutation (fetchedAt bumps).
  useEffect(() => {
    setSelected(null);
    setWorkdir(false);
    setMergeTarget("");
    setNewBranch(null);
    setPr("unloaded");
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    api.gitGraph(selectedId, 150).then(setCommits).catch(reportError);
    api.gitBranches(selectedId).then(setBranches).catch(() => setBranches(null));
  }, [selectedId, gitInfo?.fetchedAt, reportError]);

  useEffect(() => {
    setDiff(null);
    if (!selectedId) return;
    if (workdir) {
      api.gitWorkdirDiff(selectedId).then(setDiff).catch(reportError);
    } else if (selected) {
      api.gitCommitDiff(selectedId, selected).then(setDiff).catch(reportError);
    }
  }, [selectedId, selected, workdir, gitInfo?.fetchedAt, reportError]);

  if (repos.length === 0) {
    return (
      <div className={styles.empty}>
        <p>No git projects yet - import or create a project first.</p>
        <button className="btn" onClick={() => setRoute({ page: "list" })}>
          Back to projects
        </button>
      </div>
    );
  }

  const locals = branches?.branches ?? [];
  const current = locals.find((b) => b.current)?.name ?? gitInfo?.branch ?? "";
  const others = locals.filter((b) => !b.current);
  const upstream = locals.find((b) => b.current)?.upstream ?? null;
  const ahead = gitInfo?.ahead ?? 0;
  const behind = gitInfo?.behind ?? 0;
  const hasRemote = gitInfo?.remoteUrl != null;
  const selectedCommit = commits.find((c) => c.hash === selected) ?? null;

  const submitBranch = async () => {
    const name = (newBranch ?? "").trim();
    if (!name || !selectedId) return;
    if (await createBranch(selectedId, name)) setNewBranch(null);
  };

  const checkPr = async () => {
    if (!selectedId) return;
    setPrBusy(true);
    try {
      setPr(await api.githubPrStatus(selectedId));
    } catch (err) {
      reportError(err);
    } finally {
      setPrBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      {/* ------------------------------------------------ left rail */}
      <aside className={styles.rail}>
        <h2 className={styles.railTitle}>Repositories</h2>
        <ul className={styles.repoList}>
          {repos.map((r) => {
            const info = git[r.id];
            return (
              <li key={r.id}>
                <button
                  className={styles.repoBtn}
                  data-active={r.id === selectedId || undefined}
                  onClick={() => setRoute({ page: "git", projectId: r.id })}
                >
                  <span className={styles.repoName}>{r.name}</span>
                  <span className={styles.repoMeta}>
                    {info?.branch ?? ""}
                    {info?.dirty ? " ●" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {project && (
          <>
            <h2 className={styles.railTitle}>Branches</h2>
            <ul className={styles.branchList}>
              {locals.map((b) => (
                <li key={b.name} className={styles.branchRow}>
                  <button
                    className={styles.branchBtn}
                    data-current={b.current || undefined}
                    disabled={busy || b.current}
                    title={
                      (b.current ? "Current branch" : `git switch ${b.name}`) +
                      (b.upstream
                        ? ` - tracks ${b.upstream}`
                        : " - local only, not on the remote yet")
                    }
                    onClick={() => void switchBranch(project.id, b.name)}
                  >
                    <Icon name="branch" size={12} />
                    <span className={styles.branchName}>{b.name}</span>
                    {!b.upstream && hasRemote && (
                      <span className={styles.localOnly}>local</span>
                    )}
                    {b.ahead > 0 && <span className={styles.track}>↑{b.ahead}</span>}
                    {b.behind > 0 && <span className={styles.track}>↓{b.behind}</span>}
                  </button>
                  {!b.current && (
                    <button
                      className={styles.branchDelete}
                      disabled={busy}
                      title={`git branch -d ${b.name} - refuses if unmerged work would be lost`}
                      aria-label={`Delete branch ${b.name}`}
                      onClick={() => void deleteBranch(project.id, b.name)}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {newBranch === null ? (
              <button className={styles.railAction} onClick={() => setNewBranch("")}>
                <Icon name="plus" size={12} /> New branch
              </button>
            ) : (
              <div className={styles.newBranch}>
                <input
                  autoFocus
                  placeholder="feature/…"
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
              </div>
            )}
            {(branches?.remoteBranches.length ?? 0) > 0 && (
              <>
                <h2 className={styles.railTitle}>Remote</h2>
                <ul className={styles.remoteList}>
                  {branches!.remoteBranches.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </aside>

      {/* ------------------------------------------------ center */}
      <section className={styles.center}>
        {project && gitInfo?.state === "available" ? (
          <>
            <div className={styles.toolbar}>
              <span className={styles.repoTitle}>
                <button
                  className={styles.projectLink}
                  title="Open project page"
                  onClick={() => setRoute({ page: "detail", projectId: project.id })}
                >
                  {project.name}
                </button>
                {" on "}
                <strong>{current || "(detached)"}</strong>{" "}
                {current &&
                  (upstream ? (
                    <span
                      className={styles.tracks}
                      title={`Commits here are compared and pushed to ${upstream}`}
                    >
                      → {upstream}
                    </span>
                  ) : (
                    hasRemote && (
                      <span
                        className={styles.tracks}
                        title="This branch only exists on your machine - the first Push publishes it to origin and connects them"
                      >
                        local only
                      </span>
                    )
                  ))}
              </span>
              {hasRemote && (
                <button className="btn" disabled={busy} title="git fetch --prune" onClick={() => void fetchRemote(project.id)}>
                  Fetch
                </button>
              )}
              {hasRemote && behind > 0 && (
                <button className="btn" disabled={busy} title="git pull --ff-only" onClick={() => void pullFf(project.id)}>
                  Pull ({behind})
                </button>
              )}
              {hasRemote && (
                <button
                  className="btn"
                  disabled={busy}
                  title={
                    upstream
                      ? `git push - upload your commits to ${upstream}`
                      : "git push -u origin - publishes this branch to origin and sets it to track the remote copy"
                  }
                  onClick={() => void pushBranch(project.id)}
                >
                  {ahead > 0 ? `Push (${ahead})` : "Push"}
                </button>
              )}
              {others.length > 0 && !gitInfo.mergeInProgress && current && (
                <span className={styles.mergeGroup}>
                  <label className={styles.mergeLabel}>
                    Merge <strong>{current}</strong> into
                    <select value={mergeTarget} disabled={busy} onChange={(e) => setMergeTarget(e.target.value)}>
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
                        ? "Commit your changes first - a merge from a clean state can always be undone"
                        : mergeTarget
                          ? `Brings your commits from ${current} into ${mergeTarget}; you'll end up on ${mergeTarget}`
                          : "Pick the branch to merge into"
                    }
                    onClick={() => void mergeInto(project.id, mergeTarget).then(() => setMergeTarget(""))}
                  >
                    Merge
                  </button>
                </span>
              )}
              <span className={styles.spacer} />
              {gh?.installed && gh.authenticated && hasRemote && (
                <span className={styles.prGroup}>
                  {pr !== "unloaded" && pr !== null && (
                    <>
                      <span className={styles.prState} data-state={pr.state.toLowerCase()}>
                        {pr.state}
                      </span>
                      {pr.checksTotal > 0 && (
                        <span className={styles.prChecks} data-passing={pr.checksPassing || undefined}>
                          {pr.checksPassing ? "✓" : "✗"} {pr.checksTotal} checks
                        </span>
                      )}
                      <button className="btn" onClick={() => void api.githubOpenPr(project.id)}>
                        Open PR
                      </button>
                    </>
                  )}
                  {pr === null && <span className={styles.prNone}>no open PR</span>}
                  <button className="btn" disabled={prBusy} title="Ask GitHub about the current branch's pull request" onClick={() => void checkPr()}>
                    {prBusy ? "Checking…" : "PR & CI"}
                  </button>
                </span>
              )}
            </div>

            <MergeBanner projectId={project.id} gitInfo={gitInfo} />
            <CommitControls projectId={project.id} gitInfo={gitInfo} />

            {gitInfo.dirty && !gitInfo.mergeInProgress && (
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
          </>
        ) : (
          <p className={styles.hint}>
            {project ? "Loading repository…" : "Select a repository."}
          </p>
        )}
      </section>

      {/* ------------------------------------------------ diff */}
      <section className={styles.diff}>
        {workdir && <h3 className={styles.diffTitle}>Uncommitted changes</h3>}
        {selectedCommit && (
          <div className={styles.diffHead}>
            <h3 className={styles.diffTitle}>{selectedCommit.subject}</h3>
            <p className={styles.diffMeta}>
              {selectedCommit.author} · {selectedCommit.shortHash} ·{" "}
              {relativeTime(selectedCommit.timestamp)}
            </p>
          </div>
        )}
        {diff === null && (selected || workdir) ? (
          <p className={styles.hint}>Loading diff…</p>
        ) : diff !== null ? (
          <DiffView files={diff} />
        ) : (
          <p className={styles.hint}>Select a commit to see what it changed.</p>
        )}
      </section>
    </div>
  );
}
