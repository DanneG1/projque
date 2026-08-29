import type { GitInfo, ProjectView } from "../models";
import { useAppStore } from "../store/useAppStore";
import { RunMenu } from "./RunMenu";
import styles from "./QuickActions.module.css";

export function QuickActions({
  project,
  gitInfo,
}: {
  project: ProjectView;
  gitInfo?: GitInfo;
}) {
  const launch = useAppStore((s) => s.launch);
  const startAgentSession = useAppStore((s) => s.startAgentSession);
  const disabled = !project.pathExists;

  return (
    <div className={styles.row}>
      <button
        className="btn"
        disabled={disabled}
        onClick={() => void launch(project.id, "openFolder")}
      >
        Folder
      </button>
      <button
        className="btn"
        disabled={disabled}
        onClick={() => void launch(project.id, "openEditor")}
      >
        Editor
      </button>
      <button
        className="btn"
        disabled={disabled}
        onClick={() => void launch(project.id, "openTerminal")}
      >
        Terminal
      </button>
      <button
        className="btn"
        disabled={disabled}
        title="Start the configured coding agent in an embedded terminal"
        onClick={() => void startAgentSession(project.id)}
      >
        Agent
      </button>
      {project.hasRunTargets && <RunMenu projectId={project.id} disabled={disabled} />}
      {gitInfo?.repositoryUrl && (
        <button
          className="btn"
          disabled={disabled}
          title={gitInfo.repositoryUrl}
          onClick={() => void launch(project.id, "openRepository")}
        >
          Repository
        </button>
      )}
    </div>
  );
}
