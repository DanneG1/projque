import { useEffect, useState } from "react";
import { api } from "../api/ipc";
import type { DescriptionSource, ProjectDocument } from "../models";
import { useAppStore } from "../store/useAppStore";
import { GitControls } from "../components/GitControls";
import { GithubPanel } from "../components/GithubPanel";
import { GitSummary } from "../components/GitSummary";
import { MarkdownView } from "../components/MarkdownView";
import { QuickActions } from "../components/QuickActions";
import { StatusSelect } from "../components/StatusSelect";
import { relativeTime } from "../utils/time";
import styles from "./ProjectDetailPage.module.css";

export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const project = useAppStore((s) => s.projects.find((p) => p.id === projectId));
  const gitInfo = useAppStore((s) => s.git[projectId]);
  const updateProject = useAppStore((s) => s.updateProject);
  const removeProject = useAppStore((s) => s.removeProject);
  const relocateProject = useAppStore((s) => s.relocateProject);
  const setRoute = useAppStore((s) => s.setRoute);
  const reportError = useAppStore((s) => s.reportError);
  const launch = useAppStore((s) => s.launch);

  const [roadmap, setRoadmap] = useState<ProjectDocument | null>(null);
  const [readme, setReadme] = useState<ProjectDocument | null>(null);
  const [showReadme, setShowReadme] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);

  const hasRoadmap = project?.hasRoadmap ?? false;
  const hasReadme = project?.hasReadme ?? false;
  const pathExists = project?.pathExists ?? false;

  useEffect(() => {
    setRoadmap(null);
    setReadme(null);
    setShowReadme(false);
    if (!pathExists) return;
    if (hasRoadmap) {
      api
        .projectDocument(projectId, "roadmap")
        .then(setRoadmap)
        .catch(reportError);
    }
    if (hasReadme) {
      api
        .projectDocument(projectId, "readme")
        .then(setReadme)
        .catch(reportError);
    }
  }, [projectId, pathExists, hasRoadmap, hasReadme, reportError]);

  if (!project) {
    return (
      <div className={styles.page}>
        <p>Project not found.</p>
        <button className="btn" onClick={() => setRoute({ page: "list" })}>
          Back to projects
        </button>
      </div>
    );
  }

  const commitDescription = () => {
    if (descriptionDraft === null) return;
    void updateProject(project.id, {
      description: descriptionDraft,
      descriptionSource: descriptionDraft.trim() ? "custom" : "none",
    });
    setDescriptionDraft(null);
  };

  return (
    <div className={styles.page}>
      <button className={styles.back} onClick={() => setRoute({ page: "list" })}>
        ← All projects
      </button>

      <header className={styles.header}>
        <button
          className={styles.star}
          data-active={project.favorite || undefined}
          aria-label={project.favorite ? "Remove favorite" : "Mark as favorite"}
          onClick={() => void updateProject(project.id, { favorite: !project.favorite })}
        >
          ★
        </button>
        <h1 className={styles.name}>{project.name}</h1>
        <StatusSelect
          value={project.status}
          onChange={(status) => void updateProject(project.id, { status })}
        />
      </header>

      <section className={styles.section}>
        {descriptionDraft !== null ? (
          <textarea
            className={styles.descriptionInput}
            value={descriptionDraft}
            autoFocus
            rows={2}
            onChange={(e) => setDescriptionDraft(e.target.value)}
            onBlur={commitDescription}
          />
        ) : (
          <p
            className={styles.description}
            data-placeholder={!project.resolvedDescription || undefined}
            onClick={() => setDescriptionDraft(project.description ?? "")}
            title="Click to edit description"
          >
            {project.resolvedDescription ?? "Add a description…"}
          </p>
        )}
        {hasReadme && (
          <label className={styles.readmeSource}>
            <input
              type="checkbox"
              checked={project.descriptionSource === "readme"}
              onChange={(e) =>
                void updateProject(project.id, {
                  descriptionSource: (e.target.checked
                    ? "readme"
                    : project.description
                      ? "custom"
                      : "none") as DescriptionSource,
                })
              }
            />
            Use README as description
          </label>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>Local path</span>
          <code className={styles.path}>{project.path}</code>
        </div>
        {gitInfo?.repositoryUrl && (
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Repository</span>
            <code className={styles.path}>{gitInfo.repositoryUrl}</code>
          </div>
        )}
        <QuickActions project={project} gitInfo={gitInfo} />
        {project.pathExists && (
          <button
            className={`btn ${styles.secondaryAction}`}
            title="Run the agent in your external terminal instead"
            onClick={() => void launch(project.id, "openAgent")}
          >
            Agent in external terminal
          </button>
        )}
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
      </section>

      {project.isGitRepo && gitInfo?.state === "available" && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Git</h2>
          <GitSummary info={gitInfo} />
          <GitControls projectId={project.id} gitInfo={gitInfo} />
          {gitInfo.lastCommit && (
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Last commit</span>
              <span>
                {gitInfo.lastCommit.subject}{" "}
                <span className={styles.faint}>
                  ({gitInfo.lastCommit.shortHash}, {relativeTime(gitInfo.lastCommit.timestamp)})
                </span>
              </span>
            </div>
          )}
        </section>
      )}

      {project.isGitRepo && <GithubPanel projectId={project.id} gitInfo={gitInfo} />}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Roadmap</h2>
        {roadmap ? (
          <>
            {roadmap.truncated && (
              <p className={styles.faint}>Large file — showing the first part only.</p>
            )}
            <MarkdownView markdown={roadmap.markdown} />
          </>
        ) : (
          <p className={styles.faint}>No roadmap found.</p>
        )}
      </section>

      {readme && (
        <section className={styles.section}>
          <button className="btn" onClick={() => setShowReadme((v) => !v)}>
            {showReadme ? "Hide README" : `Show ${readme.fileName}`}
          </button>
          {showReadme && <MarkdownView markdown={readme.markdown} />}
        </section>
      )}

      <section className={styles.section}>
        <button className="btn" onClick={() => void removeProject(project.id)}>
          Remove from ProjQue
        </button>
        <p className={styles.faint}>Removing a project never touches its files.</p>
      </section>
    </div>
  );
}
