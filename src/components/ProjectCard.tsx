import { useState } from "react";
import type { ProjectView } from "../models";
import { useAppStore } from "../store/useAppStore";
import { StatusBadge } from "./StatusBadge";
import { StatusSelect } from "./StatusSelect";
import { QuickActions } from "./QuickActions";
import { GitSummary } from "./GitSummary";
import styles from "./ProjectCard.module.css";

export function ProjectCard({
  project,
  selected,
}: {
  project: ProjectView;
  selected?: boolean;
}) {
  const updateProject = useAppStore((s) => s.updateProject);
  const removeProject = useAppStore((s) => s.removeProject);
  const relocateProject = useAppStore((s) => s.relocateProject);
  const gitInfo = useAppStore((s) => s.git[project.id]);
  const setRoute = useAppStore((s) => s.setRoute);
  const runningAgents = useAppStore(
    (s) =>
      s.sessions.filter(
        (v) => v.projectId === project.id && v.status.state === "running",
      ).length,
  );
  const [editingDescription, setEditingDescription] = useState(false);
  const [draft, setDraft] = useState("");

  const startEditDescription = () => {
    setDraft(project.description ?? "");
    setEditingDescription(true);
  };

  const commitDescription = () => {
    setEditingDescription(false);
    void updateProject(project.id, {
      description: draft,
      descriptionSource: draft.trim() ? "custom" : "none",
    });
  };

  return (
    <article
      className={styles.card}
      data-missing={!project.pathExists || undefined}
      data-selected={selected || undefined}
    >
      <div className={styles.topRow}>
        <button
          className={styles.star}
          data-active={project.favorite || undefined}
          aria-label={project.favorite ? "Remove favorite" : "Mark as favorite"}
          onClick={() => void updateProject(project.id, { favorite: !project.favorite })}
        >
          ★
        </button>
        <h3
          className={styles.name}
          onClick={() => setRoute({ page: "detail", projectId: project.id })}
          title="Open project details"
        >
          {project.name}
        </h3>
        <StatusBadge status={project.status} />
        {runningAgents > 0 && (
          <span
            className={styles.agentBadge}
            title={`${runningAgents} agent session(s) running`}
            onClick={() => setRoute({ page: "agents" })}
          >
            ⚡ {runningAgents}
          </span>
        )}
        <div className={styles.spacer} />
        <StatusSelect
          value={project.status}
          onChange={(status) => void updateProject(project.id, { status })}
        />
      </div>

      {editingDescription ? (
        <input
          className={styles.descriptionInput}
          value={draft}
          autoFocus
          placeholder="Short description"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDescription}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitDescription();
            if (e.key === "Escape") setEditingDescription(false);
          }}
        />
      ) : (
        <p
          className={styles.description}
          data-placeholder={!project.resolvedDescription || undefined}
          onClick={startEditDescription}
          title="Click to edit description"
        >
          {project.resolvedDescription ?? "Add a description…"}
        </p>
      )}

      {project.isGitRepo && <GitSummary info={gitInfo} />}

      <div className={styles.pathRow}>
        <code className={styles.path}>{project.path}</code>
      </div>

      <QuickActions project={project} gitInfo={gitInfo} />

      {!project.pathExists && (
        <div className={styles.missing}>
          Project folder could not be found.
          <button className="btn" onClick={() => void relocateProject(project.id)}>
            Locate folder
          </button>
          <button className="btn" onClick={() => void removeProject(project.id)}>
            Remove project
          </button>
        </div>
      )}
    </article>
  );
}
