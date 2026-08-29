import { useEffect, useState } from "react";
import { api } from "../api/ipc";
import type { GhStatus, GitInfo, PrStatus } from "../models";
import { useAppStore } from "../store/useAppStore";
import styles from "./GithubPanel.module.css";

export function GithubPanel({
  projectId,
  gitInfo,
}: {
  projectId: string;
  gitInfo: GitInfo | undefined;
}) {
  const reportError = useAppStore((s) => s.reportError);
  const [gh, setGh] = useState<GhStatus | null>(null);
  const [pr, setPr] = useState<PrStatus | null | "unloaded">("unloaded");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.githubStatus().then(setGh).catch(() => setGh(null));
    setPr("unloaded");
  }, [projectId]);

  if (!gh?.installed || !gh.authenticated || !gitInfo?.remoteUrl) return null;

  const check = async () => {
    setBusy(true);
    try {
      setPr(await api.githubPrStatus(projectId));
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>GitHub</h2>
      <div className={styles.row}>
        <button className="btn" disabled={busy} onClick={() => void check()}>
          {busy ? "Checking…" : "Check PR & CI"}
        </button>
        {pr !== "unloaded" && pr === null && (
          <span className={styles.muted}>No open PR for this branch.</span>
        )}
        {pr !== "unloaded" && pr !== null && (
          <>
            <span className={styles.prTitle} title={pr.title}>
              {pr.title}
            </span>
            <span className={styles.state} data-state={pr.state.toLowerCase()}>
              {pr.state}
            </span>
            {pr.checksTotal > 0 && (
              <span
                className={styles.checks}
                data-passing={pr.checksPassing || undefined}
              >
                {pr.checksPassing ? "✓" : "✗"} {pr.checksTotal} checks
              </span>
            )}
            <button className="btn" onClick={() => void api.githubOpenPr(projectId)}>
              Open PR
            </button>
          </>
        )}
      </div>
    </section>
  );
}
