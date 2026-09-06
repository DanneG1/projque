import { useState } from "react";
import type { ProjectView } from "../models";
import { useAppStore } from "../store/useAppStore";
import { Icon } from "./Icon";
import { StatusBadge } from "./StatusBadge";
import { QuickActions } from "./QuickActions";
import { GitSummary } from "./GitSummary";
import { ActivityBar } from "./ActivityBar";
import { SuggestionLine } from "./Suggestions";
import { TagChips } from "./Tags";
import { relativeTime } from "../utils/time";
import { useT } from "../i18n";
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
  // Select the stable array reference and derive locally - returning a fresh
  // .filter() array from the selector would make the store subscription loop.
  const allSessions = useAppStore((s) => s.sessions);
  const sessions = allSessions.filter(
    (v) => v.projectId === project.id && v.status.state === "running",
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const t = useT();

  const attention = sessions.some((v) => v.needsAttention);

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
        aria-label={project.favorite ? t("Remove favorite") : t("Mark as favorite")}
        onClick={() => void updateProject(project.id, { favorite: !project.favorite })}
      >
        <Icon name="star" size={15} style={{ fill: project.favorite ? "currentColor" : "none" }} />
      </button>

      <div className={styles.row1}>
        <h3
          className={styles.name}
          onClick={() => setRoute({ page: "detail", projectId: project.id })}
          title={t("Open project details")}
        >
          {project.name}
        </h3>
        {shortcut !== undefined && (
          <span className={styles.kbdHint} title={`Jump here with ⌘${shortcut}`}>
            ⌘{shortcut}
          </span>
        )}
        {project.productionUrl && (
          <span className={styles.live} title={`Live at ${project.productionUrl}`}>
            live
          </span>
        )}
        {project.lastVerified && (
          <span
            className={styles.verified}
            data-failed={!project.lastVerified.passed || undefined}
            title={
              project.lastVerified.passed
                ? `All checks passed ${relativeTime(project.lastVerified.at)}`
                : `Some checks failed ${relativeTime(project.lastVerified.at)}`
            }
          >
            {project.lastVerified.passed ? "✓ verified" : "✗ checks"}
          </span>
        )}
        <StatusBadge status={project.status} />
        <TagChips tags={project.tags ?? []} />
        {project.experiment && (
          <span className={styles.verified} title={`Trying an idea on ${project.experiment.branch}: ${project.experiment.label}`}>
            🔥 trying
          </span>
        )}
        {attention && (
          <span className={styles.badge} data-attn onClick={() => setRoute({ page: "agents" })}>
            ⚡ {t("needs you")}
          </span>
        )}
      </div>

      {editing ? (
        <input
          className={styles.descInput}
          value={draft}
          autoFocus
          placeholder={t("Short description")}
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
          title={t("Click to edit description")}
        >
          {project.resolvedDescription ?? t("Add a description…")}
        </p>
      )}

      {project.isGitRepo && <GitSummary info={gitInfo} />}

      <ActivityBar projectId={project.id} compact />
      {project.pathExists && <SuggestionLine project={project} />}

      {!project.pathExists ? (
        <div className={styles.missing}>
          <Icon name="locate" size={14} /> {t("Project folder could not be found.")}
          <button className="btn" onClick={() => void relocateProject(project.id)}>{t("Locate")}</button>
          <button className="btn" onClick={() => void removeProject(project.id)}>{t("Remove")}</button>
        </div>
      ) : (
        <QuickActions project={project} gitInfo={gitInfo} />
      )}

      <button
        className={styles.open}
        aria-label={t("Open details")}
        onClick={() => setRoute({ page: "detail", projectId: project.id })}
      >
        <Icon name="chevron" size={16} />
      </button>
    </article>
  );
}
