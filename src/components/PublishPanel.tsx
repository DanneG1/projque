import { useState } from "react";
import { api } from "../api/ipc";
import type { GitInfo, PublishOutcome, PublishPreflight } from "../models";
import { useAppStore } from "../store/useAppStore";
import styles from "./PublishPanel.module.css";

/** One-click "put it on the internet": push to GitHub and enable GitHub
 *  Pages. Free tier only, explicit consent, hard-blocked on secret-looking
 *  content. The dialog states plainly what becomes public and that it costs
 *  nothing. */
export function PublishPanel({
  projectId,
  gitInfo,
}: {
  projectId: string;
  gitInfo: GitInfo;
}) {
  const openExternalUrl = useAppStore((s) => s.openExternalUrl);
  const reportError = useAppStore((s) => s.reportError);
  const refreshGit = useAppStore((s) => s.refreshGit);

  const [open, setOpen] = useState(false);
  const [preflight, setPreflight] = useState<PublishPreflight | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null);

  const show = async () => {
    setOpen(true);
    setOutcome(null);
    setPreflight(null);
    try {
      setPreflight(await api.publishPreflight(projectId));
    } catch (err) {
      reportError(err);
      setOpen(false);
    }
  };

  const publish = async () => {
    setBusy(true);
    try {
      setOutcome(await api.publishRun(projectId));
      void refreshGit({ force: true });
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const blocked =
    preflight !== null &&
    (!preflight.ghInstalled ||
      !preflight.ghAuthenticated ||
      !preflight.hasCommits ||
      preflight.findings.length > 0 ||
      (!preflight.hasRemote && preflight.nameProblem !== null));

  return (
    <>
      <div className={styles.row}>
        <button className="btn" onClick={() => void show()}>
          {gitInfo.remoteUrl ? "Publish update…" : "Publish to the internet…"}
        </button>
        <span className={styles.rowHint}>
          Free hosting on GitHub Pages for public projects.
        </span>
      </div>

      {open && (
        <div className={styles.backdrop} onMouseDown={() => !busy && setOpen(false)}>
          <div
            className={styles.dialog}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) setOpen(false);
            }}
          >
            <h2 className={styles.title}>Publish to the internet</h2>

            {preflight === null && <p className={styles.hint}>Checking your project…</p>}

            {preflight !== null && outcome === null && (
              <>
                <ul className={styles.consent}>
                  <li>
                    Your code will be <strong>publicly visible</strong> on the
                    internet (a public GitHub repository).
                  </li>
                  <li>
                    <strong>This is free.</strong> GitHub Pages has no charges
                    for public projects — no payment details exist anywhere in
                    this flow.
                  </li>
                  <li>Publishing uses your own GitHub account.</li>
                </ul>

                {!preflight.ghInstalled && (
                  <p className={styles.problem}>
                    The GitHub CLI (gh) is not installed. See Setup check in
                    Settings.
                  </p>
                )}
                {preflight.ghInstalled && !preflight.ghAuthenticated && (
                  <p className={styles.problem}>
                    Your GitHub account is not connected yet. Use Setup check in
                    Settings to log in.
                  </p>
                )}
                {!preflight.hasCommits && (
                  <p className={styles.problem}>
                    Nothing committed yet — commit your work first (the Git
                    section above).
                  </p>
                )}
                {!preflight.hasRemote && preflight.nameProblem !== null && (
                  <p className={styles.problem}>
                    The project folder name can't be used as a repository name:{" "}
                    {preflight.nameProblem}
                  </p>
                )}

                {preflight.findings.length > 0 && (
                  <div className={styles.problem}>
                    <strong>
                      Publishing is blocked — these files look like they contain
                      secrets (passwords or API keys):
                    </strong>
                    <ul className={styles.findings}>
                      {preflight.findings.map((f, i) => (
                        <li key={i}>
                          <code>{f.file}</code>
                          {f.line > 0 ? ` line ${f.line}` : ""} — {f.kind}
                        </li>
                      ))}
                    </ul>
                    <p className={styles.hint}>
                      A leaked key can cost you real money. Ask your agent to
                      move secrets out of the code (into an ignored .env file),
                      commit, then try again.
                    </p>
                  </div>
                )}

                {preflight.dirty && (
                  <p className={styles.warn}>
                    You have uncommitted changes — only committed work is
                    published.
                  </p>
                )}
                <p className={styles.hint}>
                  {preflight.staticPath
                    ? `Your web page will be served from ${
                        preflight.staticPath === "/" ? "the project folder" : "the docs folder"
                      } (index.html found).`
                    : "No index.html found: the code is published to GitHub, but there is no web page to host. Projects that need a server can't be hosted on GitHub Pages."}
                </p>

                <div className={styles.actions}>
                  <button className="btn" disabled={busy} onClick={() => setOpen(false)}>
                    Cancel
                  </button>
                  <button
                    className="btn"
                    disabled={busy || blocked}
                    onClick={() => void publish()}
                  >
                    {busy
                      ? "Publishing…"
                      : preflight.staticPath
                        ? "Publish publicly (free)"
                        : "Publish code only (free)"}
                  </button>
                </div>
              </>
            )}

            {outcome !== null && (
              <>
                <p className={styles.success}>Published!</p>
                {outcome.pagesUrl && (
                  <p className={styles.hint}>
                    Your site:&nbsp;<code>{outcome.pagesUrl}</code>
                    <br />
                    The first deployment can take a minute or two before the
                    page goes live.
                  </p>
                )}
                {outcome.pagesError && (
                  <p className={styles.warn}>
                    The code was pushed, but the website could not be enabled:{" "}
                    {outcome.pagesError}
                  </p>
                )}
                <div className={styles.actions}>
                  {outcome.repoUrl && (
                    <button
                      className="btn"
                      onClick={() => void openExternalUrl(outcome.repoUrl!)}
                    >
                      Open repository
                    </button>
                  )}
                  {outcome.pagesUrl && (
                    <button
                      className="btn"
                      onClick={() => void openExternalUrl(outcome.pagesUrl!)}
                    >
                      Open site
                    </button>
                  )}
                  <button className="btn" onClick={() => setOpen(false)}>
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
