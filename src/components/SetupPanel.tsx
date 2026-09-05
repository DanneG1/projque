import { useEffect, useState } from "react";
import { api } from "../api/ipc";
import type { DebtInfo, DeployInfo, ProjectView, RunTarget, ToolCheck } from "../models";
import { useAppStore } from "../store/useAppStore";
import { relativeTime } from "../utils/time";
import { AuditPanel } from "./AuditPanel";
import { DiskRow } from "./DiskPanel";
import { EnvPanel } from "./EnvPanel";
import { OutdatedPanel } from "./OutdatedPanel";
import { Icon } from "./Icon";
import styles from "./SetupPanel.module.css";

/** The project's health at a glance for someone who won't read the code:
 *  which tools it needs (and whether they're installed), whether its checks
 *  pass, and how it gets to production. Everything here is read-only
 *  detection; the actions hand off to the agent or to a run session. */
export function SetupPanel({ project }: { project: ProjectView }) {
  const startAgentSession = useAppStore((s) => s.startAgentSession);
  const startRunSession = useAppStore((s) => s.startRunSession);
  const startCleanup = useAppStore((s) => s.startCleanup);
  const sessions = useAppStore((s) => s.sessions);
  const gitInfo = useAppStore((s) => s.git[project.id]);

  const [tools, setTools] = useState<ToolCheck[] | null>(null);
  const [testTarget, setTestTarget] = useState<RunTarget | null>(null);
  const [deploy, setDeploy] = useState<DeployInfo | null>(null);
  const [debt, setDebt] = useState<DebtInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTools(null);
    setTestTarget(null);
    setDeploy(null);
    api.projectDoctor(project.id).then((t) => !cancelled && setTools(t)).catch(() => {});
    api.projectTestTarget(project.id).then((t) => !cancelled && setTestTarget(t)).catch(() => {});
    api.projectDeployInfo(project.id).then((d) => !cancelled && setDeploy(d)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  // Churn changes with every commit and every tidy-up stamp.
  useEffect(() => {
    if (!project.isGitRepo) return;
    let cancelled = false;
    api.projectDebt(project.id).then((d) => !cancelled && setDebt(d)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project.id, project.isGitRepo, gitInfo?.fetchedAt, project.lastCleanup?.at]);

  const testing = sessions.some(
    (s) =>
      s.projectId === project.id &&
      s.kind === "run" &&
      s.targetId?.startsWith("test:") &&
      s.status.state === "running",
  );
  const missing = (tools ?? []).filter((t) => !t.found);

  const askInstall = () => {
    const list = missing.map((t) => `- ${t.label} (${t.tool}), needed because of ${t.reason}. ${t.hint}`).join("\n");
    void startAgentSession(
      project.id,
      undefined,
      `This project needs tools that are not installed on this computer:\n\n${list}\n\nHelp the user install them. For each one, first explain in plain language what it is and how you would install it, then ask for a go-ahead before running any install command. Do not change the project's files.`,
    );
  };

  const explainDeploy = () => {
    void startAgentSession(
      project.id,
      undefined,
      `Explain to someone who is not a programmer how this project gets to production: look at the README, any deployment workflows (.github/workflows), and hosting configuration files. Cover: where it runs, what triggers a deployment (for example pushing to a branch), roughly how long it takes, how to see whether a deployment succeeded, and whether any step could cost money. Do not change any files and do not run any deployment.`,
    );
  };

  const nothingToShow =
    tools !== null &&
    tools.length === 0 &&
    testTarget === null &&
    deploy !== null &&
    !deploy.detected &&
    !project.isGitRepo;
  if (nothingToShow) return null;

  const churn = debt
    ? `${debt.commitsSince} commit${debt.commitsSince === 1 ? "" : "s"} and ~${debt.linesChanged.toLocaleString()} changed lines`
    : null;

  return (
    <div className={styles.panel}>
      {debt && (
        <div className={styles.row} data-nudge={debt.nudge || undefined}>
          <span className={styles.label}>Code health</span>
          <span className={styles.deploy}>
            {debt.nudge ? (
              <>
                <strong>Worth a tidy-up?</strong> {churn}{" "}
                {debt.lastCleanupAt
                  ? `since the last one (${relativeTime(debt.lastCleanupAt)})`
                  : "in the last 30 days"}
                . Agent sessions add code faster than they remove it - a tidy-up keeps
                the project easy to change.
              </>
            ) : debt.lastCleanupAt ? (
              <>
                Last tidy-up {relativeTime(debt.lastCleanupAt)}
                {debt.commitsSince > 0 ? ` - ${churn} since` : " - nothing changed since"}.
              </>
            ) : (
              <>Not tidied yet - {churn ?? "little"} in the last 30 days.</>
            )}
          </span>
          <button
            className="btn"
            title="Start the agent on removing dead code and simplifying - it won't change what the project does, and you review the result before keeping it"
            onClick={() => void startCleanup(project.id)}
          >
            <Icon name="agent" size={12} /> Tidy up
          </button>
        </div>
      )}
      {tools && tools.length > 0 && (
        <div className={styles.row}>
          <span className={styles.label}>Needs</span>
          <span className={styles.tools}>
            {tools.map((t) => (
              <span
                key={t.tool}
                className={styles.tool}
                data-ok={t.found || undefined}
                title={
                  t.found
                    ? `${t.label}${t.version ? ` ${t.version}` : ""} - because of ${t.reason}${t.wanted ? `. Project asks for ${t.wanted}` : ""}`
                    : `${t.label} is not installed - ${t.hint}`
                }
              >
                <Icon name={t.found ? "check" : "close"} size={11} />
                {t.label}
                {t.found && t.version && <span className={styles.version}>{t.version}</span>}
              </span>
            ))}
          </span>
          {missing.length > 0 && (
            <button className="btn" title="Start the agent with the list of missing tools" onClick={askInstall}>
              <Icon name="agent" size={12} /> Help me install {missing.length === 1 ? "it" : "them"}
            </button>
          )}
        </div>
      )}

      <EnvPanel projectId={project.id} isGitRepo={project.isGitRepo} />

      <AuditPanel project={project} />

      <OutdatedPanel project={project} />

      <DiskRow projectId={project.id} />

      {testTarget && (
        <div className={styles.row}>
          <span className={styles.label}>Checks</span>
          <span className={styles.verified}>
            {project.lastVerified ? (
              <span data-passed={project.lastVerified.passed || undefined} className={styles.verdict}>
                <Icon name={project.lastVerified.passed ? "check" : "close"} size={11} />
                {project.lastVerified.passed ? "All checks passed" : "Some checks failed"}{" "}
                <span className={styles.faint}>{relativeTime(project.lastVerified.at)}</span>
              </span>
            ) : (
              <span className={styles.faint}>Not run yet</span>
            )}
          </span>
          <button
            className="btn"
            disabled={testing}
            title={`${testTarget.label} - runs the project's own automated checks`}
            onClick={() => void startRunSession(project.id, testTarget.targetId)}
          >
            <Icon name="run" size={12} /> {testing ? "Running checks…" : "Run tests"}
          </button>
        </div>
      )}

      {deploy && deploy.detected && (
        <div className={styles.row}>
          <span className={styles.label}>Deployment</span>
          <span className={styles.deploy} title={deploy.evidence.join(", ")}>
            {deploy.summary}
            {deploy.onPush && deploy.branches.length > 0 && (
              <span className={styles.deployWarn}>
                {" "}
                - pushing{" "}
                {deploy.branches.map((b, i) => (
                  <span key={b}>
                    {i > 0 ? ", " : ""}
                    <code>{b}</code>
                  </span>
                ))}{" "}
                goes live
              </span>
            )}
          </span>
          <button className="btn" title="Ask the agent to explain how deployment works here - nothing is changed" onClick={explainDeploy}>
            <Icon name="agent" size={12} /> Explain
          </button>
        </div>
      )}
    </div>
  );
}
