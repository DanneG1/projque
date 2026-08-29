import type { GitInfo, ProjectView } from "../models";
import { useAppStore } from "../store/useAppStore";
import styles from "./QuickActions.module.css";

export function QuickActions({
  project,
  gitInfo,
}: {
  project: ProjectView;
  gitInfo?: GitInfo;
}) {
  const launch = useAppStore((s) => s.launch);
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
        title="Open the configured coding agent in a terminal here"
        onClick={() => void launch(project.id, "openAgent")}
      >
        Agent
      </button>
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
