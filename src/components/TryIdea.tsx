import { useState } from "react";
import type { GitInfo, ProjectView } from "../models";
import { useAppStore } from "../store/useAppStore";
import { relativeTime } from "../utils/time";
import { Icon } from "./Icon";
import styles from "./TryIdea.module.css";

function experimentPrompt(idea: string): string {
  return (
    `Try out the following idea in this project. This is an experiment on its own branch, so be bold - the user can keep or throw away the whole result afterwards with one click:\n\n${idea}\n\n` +
    `Implement it completely and make sure it works with the rest of the project. Do not commit - ProjQue handles that when the user decides to keep it. When you're done, explain in simple, non-technical language what you built and what the user should look at to judge it.`
  );
}

/** "Try an idea safely": a throwaway branch the agent works on. While one
 *  is in progress this shows a banner with Keep / Throw away; otherwise a
 *  button + form to start one. Needs a clean tracked tree to start, so
 *  throwing away can never lose earlier work. */
export function TryIdea({ project, gitInfo }: { project: ProjectView; gitInfo: GitInfo | undefined }) {
  const startExperiment = useAppStore((s) => s.startExperiment);
  const keepExperiment = useAppStore((s) => s.keepExperiment);
  const discardExperiment = useAppStore((s) => s.discardExperiment);
  const startAgentSession = useAppStore((s) => s.startAgentSession);
  const busy = useAppStore((s) => s.gitBusy[project.id] ?? false);
  const sessions = useAppStore((s) => s.sessions);
  const [open, setOpen] = useState(false);
  const [idea, setIdea] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const exp = project.experiment;
  const agentRunning = sessions.some(
    (v) => v.projectId === project.id && v.kind === "agent" && v.status.state === "running",
  );

  if (exp) {
    const onBranch = gitInfo?.branch === exp.branch;
    const changed = gitInfo?.dirty ? gitInfo.changedFiles : 0;
    return (
      <div className={styles.banner}>
        <div className={styles.head}>
          <Icon name="flame" size={15} className={styles.glyph} />
          <div className={styles.text}>
            <div className={styles.title}>
              Trying an idea: <em>{exp.label}</em>
            </div>
            <div className={styles.meta}>
              Started {relativeTime(exp.startedAt)} on its own branch{" "}
              <code>{exp.branch}</code>
              {changed > 0 ? ` · ${changed} changed file${changed === 1 ? "" : "s"}` : ""}
              {agentRunning ? " · the agent is still working" : ""}
              {!onBranch && gitInfo?.branch ? ` · you are on ${gitInfo.branch} - switch back to decide` : ""}
            </div>
          </div>
        </div>
        <div className={styles.actions}>
          <button
            className="btn btn-primary"
            disabled={busy || !onBranch || agentRunning}
            title={`Commit the result and merge it into ${exp.base}`}
            onClick={() => void keepExperiment(project.id)}
          >
            {busy ? "Working…" : "Keep it"}
          </button>
          {confirmDiscard ? (
            <>
              <span className={styles.confirm}>
                Go back to <code>{exp.base}</code> as if this never happened? (The attempt stays in History.)
              </span>
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  setConfirmDiscard(false);
                  void discardExperiment(project.id);
                }}
              >
                Yes, throw it away
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirmDiscard(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              className="btn"
              disabled={busy || !onBranch || agentRunning}
              title={`Return to ${exp.base} unchanged; the attempt is kept under History`}
              onClick={() => setConfirmDiscard(true)}
            >
              Throw it away
            </button>
          )}
          <button
            className="btn"
            disabled={agentRunning}
            title="Continue with the agent on this branch"
            onClick={() =>
              void startAgentSession(
                project.id,
                undefined,
                `Continue the experiment "${exp.label}" on this branch. Ask what the user wants changed if it is not obvious from the current state. Do not commit.`,
              )
            }
          >
            <Icon name="agent" size={12} /> Continue
          </button>
        </div>
      </div>
    );
  }

  const canStart = project.isGitRepo && gitInfo?.state === "available" && !!gitInfo.branch && !gitInfo.mergeInProgress;
  if (!canStart) return null;
  const blocked = gitInfo.dirty && gitInfo.changedFiles > 0;

  if (!open) {
    return (
      <button
        className={styles.launch}
        title="Let the agent build something on a separate branch - keep it or throw it away afterwards with one click"
        onClick={() => setOpen(true)}
      >
        <Icon name="flame" size={13} /> Try an idea safely
      </button>
    );
  }

  const start = async () => {
    const text = idea.trim();
    if (!text || busy) return;
    const ok = await startExperiment(project.id, text.slice(0, 200), experimentPrompt(text.slice(0, 3000)));
    if (ok) {
      setOpen(false);
      setIdea("");
    }
  };

  return (
    <div className={styles.form}>
      <div className={styles.formHead}>
        <Icon name="flame" size={14} className={styles.glyph} />
        <strong>Try an idea safely</strong>
        <span className={styles.meta}>
          The agent works on a separate branch. Afterwards you <em>keep</em> the result or{" "}
          <em>throw it away</em> - your current version is never touched.
        </span>
      </div>
      {blocked && (
        <p className={styles.warn}>
          Commit your current changes first, so the experiment starts from a saved version.
        </p>
      )}
      <textarea
        className={styles.input}
        autoFocus
        value={idea}
        placeholder="What do you want to try? Example: “a dark mode toggle in the header”"
        onChange={(e) => setIdea(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void start();
        }}
      />
      <div className={styles.formActions}>
        <button className="btn btn-primary" disabled={busy || blocked || !idea.trim()} onClick={() => void start()}>
          {busy ? "Preparing…" : "Start experiment"}
        </button>
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
