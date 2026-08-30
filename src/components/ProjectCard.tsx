import { useState } from "react";
import type { ProjectView } from "../models";
import { useAppStore } from "../store/useAppStore";
import { Icon } from "./Icon";
import { StatusBadge } from "./StatusBadge";
import { QuickActions } from "./QuickActions";
import { GitSummary } from "./GitSummary";
import styles from "./ProjectCard.module.css";

export function ProjectCard({
  project,
  selected,
  shortcut,
}: {
  project: ProjectView;
  selected?: boolean;
  /** 1–9 when this favorite is reachable via ⌘n. */
  shortcut?: number;
}) {
  const updateProject = useAppStore((s) => s.updateProject);
  const removeProject = useAppStore((s) => s.removeProject);
  const relocateProject = useAppStore((s) => s.relocateProject);
  const gitInfo = useAppStore((s) => s.git[project.id]);
  const setRoute = useAppStore((s) => s.setRoute);
  // Select the stable array reference and derive locally — returning a fresh
  // .filter() array from the selector would make the store subscription loop.
  const allSessions = useAppStore((s) => s.sessions);
  const sessions = allSessions.filter(
    (v) => v.projectId === project.id && v.status.state === "running",
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const attention = sessions.some((v) => v.needsAttention);
  const runSession = sessions.find((v) => v.kind === "run");
  const agentCount = sessions.filter((v) => v.kind === "agent").length;

  const startEdit = () => {
    setDraft(project.description ?? "");
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
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
      <button
        className={styles.star}
        data-on={project.favorite || undefined}
        aria-label={project.favorite ? "Remove favorite" : "Mark as favorite"}
        onClick={() => void updateProject(project.id, { favorite: !project.favorite })}
      >
        <Icon name="star" size={15} style={{ fill: project.favorite ? "currentColor" : "none" }} />
      </button>

      <div className={styles.row1}>
        <h3
          className={styles.name}
          onClick={() => setRoute({ page: "detail", projectId: project.id })}
          title="Open project details"
        >
          {project.name}
        </h3>
        {shortcut !== undefined && (
          <span className={styles.kbdHint} title={`Jump here with ⌘${shortcut}`}>
            ⌘{shortcut}
          </span>
        )}
        <StatusBadge status={project.status} />
        {attention ? (
          <span className={styles.badge} data-attn onClick={() => setRoute({ page: "agents" })}>
            ⚡ needs you
          </span>
        ) : runSession ? (
          <span className={styles.badge} onClick={() => setRoute({ page: "agents", sessionId: runSession.sessionId })}>
            ▶ running{runSession.detectedUrl ? ` · ${portOf(runSession.detectedUrl)}` : ""}
          </span>
        ) : agentCount > 0 ? (
          <span className={styles.badge} onClick={() => setRoute({ page: "agents" })}>
            ⚡ {agentCount}
          </span>
        ) : null}
      </div>

      {editing ? (
        <input
          className={styles.descInput}
          value={draft}
          autoFocus
          placeholder="Short description"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <p
          className={styles.desc}
          data-placeholder={!project.resolvedDescription || undefined}
          onClick={startEdit}
          title="Click to edit description"
        >
          {project.resolvedDescription ?? "Add a description…"}
        </p>
      )}

      {project.isGitRepo && <GitSummary info={gitInfo} />}

      {!project.pathExists ? (
        <div className={styles.missing}>
          <Icon name="locate" size={14} /> Project folder could not be found.
          <button className="btn" onClick={() => void relocateProject(project.id)}>Locate</button>
          <button className="btn" onClick={() => void removeProject(project.id)}>Remove</button>
        </div>
      ) : (
        <QuickActions project={project} gitInfo={gitInfo} />
      )}

      <button
        className={styles.open}
        aria-label="Open details"
        onClick={() => setRoute({ page: "detail", projectId: project.id })}
      >
        <Icon name="chevron" size={16} />
      </button>
    </article>
  );
}

function portOf(url: string): string {
  const m = url.match(/:(\d+)/);
  return m ? `:${m[1]}` : "open";
}
