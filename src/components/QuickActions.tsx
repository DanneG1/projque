import type { GitInfo, ProjectView } from "../models";
import { useAppStore } from "../store/useAppStore";
import { IconButton } from "./IconButton";
import { OverflowMenu, type MenuItem } from "./OverflowMenu";
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
  const fetchRemote = useAppStore((s) => s.fetchRemote);
  const removeProject = useAppStore((s) => s.removeProject);
  const disabled = !project.pathExists;

  const overflow: MenuItem[] = [
    { icon: "terminal", label: "Open terminal", onClick: () => void launch(project.id, "openTerminal") },
    { icon: "agent", label: "Agent in external terminal", onClick: () => void launch(project.id, "openAgent") },
  ];
  if (gitInfo?.repositoryUrl) {
    overflow.push({ icon: "repo", label: "Open repository", onClick: () => void launch(project.id, "openRepository") });
  }
  overflow.push({ icon: "trash", label: "Remove from ProjQue", danger: true, onClick: () => void removeProject(project.id) });

  return (
    <div className={styles.row}>
      <IconButton icon="folder" tip="Open folder" disabled={disabled} onClick={() => void launch(project.id, "openFolder")} />
      <IconButton icon="editor" tip="Open in editor" accent disabled={disabled} onClick={() => void launch(project.id, "openEditor")} />
      <IconButton icon="agent" tip="Start agent" accent disabled={disabled} onClick={() => void startAgentSession(project.id)} />
      {project.hasRunTargets && <RunMenu projectId={project.id} disabled={disabled} />}
      <span className={styles.div} />
      <OverflowMenu items={overflow} />
      <span className={styles.grow} />
      {gitInfo?.repositoryUrl && (
        <IconButton icon="fetch" tip="Fetch" disabled={disabled} onClick={() => void fetchRemote(project.id)} />
      )}
    </div>
  );
}
