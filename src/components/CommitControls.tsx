import { useEffect, useState } from "react";
import { api } from "../api/ipc";
import type { CommitPreflight, DeployInfo, GitInfo } from "../models";
import { useAppStore } from "../store/useAppStore";
import { parseSummary } from "../utils/summary";
import { Icon } from "./Icon";
import styles from "./CommitControls.module.css";

/** Does pushing the current branch start a deployment, per the project's
 *  own pipeline files? (Unknown branch list = the pipeline says "on push"
 *  without a filter, so every branch counts.) */
export function pushDeploys(deploy: DeployInfo | null, branch: string | null): boolean {
  if (!deploy || !deploy.onPush) return false;
  if (deploy.branches.length === 0) return true;
  return branch !== null && deploy.branches.includes(branch);
}

export function CommitControls({
  projectId,
  gitInfo,
}: {
  projectId: string;
  gitInfo: GitInfo;
}) {
  const busy = useAppStore((s) => s.gitBusy[projectId] ?? false);
  const commitAll = useAppStore((s) => s.commitAll);
  const commitAndPush = useAppStore((s) => s.commitAndPush);
  const fixIgnores = useAppStore((s) => s.fixIgnores);
  const reportError = useAppStore((s) => s.reportError);

  const [message, setMessage] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [preflight, setPreflight] = useState<CommitPreflight | null>(null);
  const [deploy, setDeploy] = useState<DeployInfo | null>(null);
  const [confirmDeploy, setConfirmDeploy] = useState(false);
  // The user's explicit "I checked - this is not a real secret".
  const [allowSecrets, setAllowSecrets] = useState(false);

  const dirty = gitInfo.dirty && !gitInfo.mergeInProgress;

  // Re-run the safety checks whenever the working tree changes.
  useEffect(() => {
    if (!dirty) {
      setPreflight(null);
      return;
    }
    let cancelled = false;
    api
      .gitCommitPreflight(projectId)
      .then((p) => !cancelled && setPreflight(p))
      .catch(() => !cancelled && setPreflight(null));
    setAllowSecrets(false);
    return () => {
      cancelled = true;
    };
  }, [projectId, gitInfo.fetchedAt, dirty]);

  useEffect(() => {
    let cancelled = false;
    api
      .projectDeployInfo(projectId)
      .then((d) => !cancelled && setDeploy(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // During a merge the MergeBanner owns the commit step - a plain commit
  // here would silently become the merge commit.
  if (!dirty) return null;

  const count = gitInfo.changedFiles;
  const hasFindings = (preflight?.findings.length ?? 0) > 0;
  const blocked = hasFindings && !allowSecrets;
  const hasRemote = gitInfo.remoteUrl != null;
  const deploys = pushDeploys(deploy, gitInfo.branch);

  const reset = () => {
    setMessage("");
    setSummary(null);
    setSuggestion(null);
    setConfirmDeploy(false);
  };

  const commit = async () => {
    if (!message.trim() || busy || blocked) return;
    if (await commitAll(projectId, message.trim(), allowSecrets)) reset();
  };

  const commitPush = async () => {
    if (!message.trim() || busy || blocked) return;
    if (deploys && !confirmDeploy) {
      setConfirmDeploy(true);
      return;
    }
    if (await commitAndPush(projectId, message.trim(), allowSecrets)) reset();
  };

  const summarize = async () => {
    setSummarizing(true);
    try {
      const parsed = parseSummary(await api.gitChangeSummary(projectId));
      setSummary(parsed.summary);
      setSuggestion(parsed.suggestion);
      if (parsed.suggestion && !message.trim()) setMessage(parsed.suggestion);
    } catch (err) {
      reportError(err);
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <div className={styles.panel}>
      <p className={styles.status}>
        {count} changed file{count === 1 ? "" : "s"} not committed yet
        <button
          className={`btn ${styles.explainBtn}`}
          disabled={summarizing}
          title="Ask Claude to explain the changes in plain language (uses your Claude Code account)"
          onClick={() => void summarize()}
        >
          {summarizing ? "Asking Claude…" : "What changed?"}
        </button>
      </p>
      {summary && <p className={styles.summary}>{summary}</p>}

      {preflight && preflight.findings.length > 0 && (
        <div className={styles.block}>
          <strong>Commit blocked - this looks like a password or API key:</strong>
          <ul className={styles.findings}>
            {preflight.findings.slice(0, 6).map((f) => (
              <li key={`${f.file}:${f.line}`}>
                <code>{f.file}</code>
                {f.line > 0 ? ` line ${f.line}` : ""} - {f.kind}
              </li>
            ))}
          </ul>
          <span className={styles.blockHint}>
            Once committed it stays in your history forever, even if you delete it later. Move it
            to a <code>.env</code> file (ask the agent: “move my secrets out of the code into a
            .env file”) and it will be ignored automatically.
          </span>
          <label className={styles.override}>
            <input
              type="checkbox"
              checked={allowSecrets}
              onChange={(e) => setAllowSecrets(e.target.checked)}
            />
            I checked - this is not a real secret (an example, a test value, or a placeholder).
            Commit anyway.
          </label>
        </div>
      )}

      {preflight && preflight.ignoreWarnings.length > 0 && (
        <div className={styles.warn}>
          <span>
            Some of these files don't usually belong in git:{" "}
            {preflight.ignoreWarnings.map((w, i) => (
              <span key={w.kind}>
                {i > 0 ? ", " : ""}
                <strong>{w.label}</strong> ({w.files} file{w.files === 1 ? "" : "s"}, e.g.{" "}
                <code>{w.example}</code>)
              </span>
            ))}
            .
          </span>
          <button
            className="btn"
            disabled={busy}
            title="Add them to .gitignore so they stay out of every commit (the files themselves are untouched)"
            onClick={() =>
              void fixIgnores(
                projectId,
                preflight.ignoreWarnings.map((w) => w.kind),
              )
            }
          >
            Leave them out
          </button>
        </div>
      )}

      <div className={styles.row}>
        <input
          className={styles.message}
          type="text"
          placeholder="Describe this version, e.g. “Added the contact form”"
          value={message}
          maxLength={500}
          disabled={busy}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
          }}
        />
        <button
          className="btn"
          disabled={busy || !message.trim() || blocked}
          title="git commit - saves a version of your project you can always return to (stays on this computer)"
          onClick={() => void commit()}
        >
          {busy ? "Working…" : "Commit"}
        </button>
        {hasRemote && (
          <button
            className="btn"
            disabled={busy || !message.trim() || blocked}
            data-active={confirmDeploy || undefined}
            title={
              deploys
                ? "git commit + git push - pushing this branch deploys to production"
                : "git commit + git push - save the version and upload it to your repository"
            }
            onClick={() => void commitPush()}
          >
            <Icon name="fetch" size={12} /> Commit &amp; push
          </button>
        )}
      </div>

      {confirmDeploy && (
        <div className={styles.deployConfirm}>
          <span>
            <strong>Heads up: this goes live.</strong> {deploy?.summary}. Pushing{" "}
            <code>{gitInfo.branch}</code> will deploy this version to production.
          </span>
          <button className="btn" disabled={busy} onClick={() => void commitPush()}>
            {busy ? "Working…" : "Push and deploy"}
          </button>
          <button className="btn" onClick={() => setConfirmDeploy(false)}>
            Cancel
          </button>
        </div>
      )}

      <p className={styles.hint}>
        Commit - save a version of your work you can return to at any time.
        {hasRemote && " Commit & push also uploads it to your repository."}
        {suggestion && suggestion !== message.trim() && (
          <button className={styles.useSuggestion} onClick={() => setMessage(suggestion)}>
            Use suggestion: “{suggestion}”
          </button>
        )}
      </p>
    </div>
  );
}

/** The clean-tree states, in plain words: unpushed commits, newer commits
 *  online, or in sync. Push is deploy-aware like Commit & push. */
export function SyncStatus({
  projectId,
  gitInfo,
}: {
  projectId: string;
  gitInfo: GitInfo;
}) {
  const busy = useAppStore((s) => s.gitBusy[projectId] ?? false);
  const commitAndPush = useAppStore((s) => s.commitAndPush);
  const pullFf = useAppStore((s) => s.pullFf);
  const backupToGithub = useAppStore((s) => s.backupToGithub);
  const [deploy, setDeploy] = useState<DeployInfo | null>(null);
  const [confirmDeploy, setConfirmDeploy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .projectDeployInfo(projectId)
      .then((d) => !cancelled && setDeploy(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (gitInfo.dirty || gitInfo.mergeInProgress) return null;
  if (gitInfo.remoteUrl == null) {
    if (!gitInfo.lastCommit) return null;
    return (
      <p className={styles.sync}>
        This project only exists on this computer.
        <button
          className="btn"
          disabled={busy}
          title="Create a private repository under your GitHub account and push (needs the gh tool, signed in)"
          onClick={() => void backupToGithub(projectId)}
        >
          {busy ? "Backing up…" : "Back up to GitHub (private)"}
        </button>
      </p>
    );
  }
  const ahead = gitInfo.ahead ?? 0;
  const behind = gitInfo.behind ?? 0;
  const deploys = pushDeploys(deploy, gitInfo.branch);

  const push = async () => {
    if (deploys && !confirmDeploy) {
      setConfirmDeploy(true);
      return;
    }
    setConfirmDeploy(false);
    await commitAndPush(projectId, null);
  };

  if (ahead === 0 && behind === 0) {
    return (
      <p className={styles.sync} data-ok>
        <Icon name="check" size={12} /> Everything is committed and in sync with your repository.
      </p>
    );
  }

  return (
    <div className={styles.syncPanel}>
      {ahead > 0 && (
        <p className={styles.sync}>
          {ahead} commit{ahead === 1 ? "" : "s"} not yet pushed to your repository.
          <button
            className="btn"
            disabled={busy}
            title={deploys ? "git push - pushing this branch deploys to production" : "git push - upload your commits"}
            onClick={() => void push()}
          >
            <Icon name="fetch" size={12} /> Push
          </button>
        </p>
      )}
      {behind > 0 && (
        <p className={styles.sync}>
          {behind} newer commit{behind === 1 ? "" : "s"} online that you don't have yet.
          <button className="btn" disabled={busy} title="git pull --ff-only" onClick={() => void pullFf(projectId)}>
            Pull
          </button>
        </p>
      )}
      {confirmDeploy && (
        <div className={styles.deployConfirm}>
          <span>
            <strong>Heads up: this goes live.</strong> {deploy?.summary}. Pushing{" "}
            <code>{gitInfo.branch}</code> will deploy to production.
          </span>
          <button className="btn" disabled={busy} onClick={() => void push()}>
            {busy ? "Working…" : "Push and deploy"}
          </button>
          <button className="btn" onClick={() => setConfirmDeploy(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
