import { useEffect, useState } from "react";
import { api } from "../api/ipc";
import type { DescriptionSource, ProjectDocument } from "../models";
import { useAppStore } from "../store/useAppStore";
import { CommitControls, SyncStatus } from "../components/CommitControls";
import { RoadmapPanel } from "../components/RoadmapPanel";
import { SetupPanel } from "../components/SetupPanel";
import { Icon } from "../components/Icon";
import { GitControls } from "../components/GitControls";
import { GithubPanel } from "../components/GithubPanel";
import { GuidedActions } from "../components/GuidedActions";
import { HistoryPanel } from "../components/HistoryPanel";
import { IdeasPanel } from "../components/IdeasPanel";
import { PublishPanel } from "../components/PublishPanel";
import { GitSummary } from "../components/GitSummary";
import { MarkdownView } from "../components/MarkdownView";
import { MergeBanner } from "../components/MergeBanner";
import { RepoPanel } from "../components/RepoPanel";
import { QuickActions } from "../components/QuickActions";
import { ActivityBar } from "../components/ActivityBar";
import { SuggestionList } from "../components/Suggestions";
import { TagEditor } from "../components/Tags";
import { TryIdea } from "../components/TryIdea";
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
  const [ideas, setIdeas] = useState<ProjectDocument | null>(null);
  const [showReadme, setShowReadme] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);
  const [showRepo, setShowRepo] = useState(false);
  const [prodDraft, setProdDraft] = useState<string | null>(null);
  const openExternalUrl = useAppStore((s) => s.openExternalUrl);

  const hasRoadmap = project?.hasRoadmap ?? false;
  const hasReadme = project?.hasReadme ?? false;
  const hasIdeas = project?.hasIdeas ?? false;
  const ideasVersion = useAppStore((s) => s.ideasVersion);
  const pathExists = project?.pathExists ?? false;

  useEffect(() => {
    setRoadmap(null);
    setReadme(null);
    setIdeas(null);
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
    if (hasIdeas) {
      api
        .projectDocument(projectId, "ideas")
        .then(setIdeas)
        .catch(reportError);
    }
  }, [projectId, pathExists, hasRoadmap, hasReadme, hasIdeas, ideasVersion, reportError]);

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

      <ActivityBar projectId={project.id} framed />

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
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>Tags</span>
          <TagEditor projectId={project.id} tags={project.tags} />
        </div>
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>Production</span>
          {prodDraft !== null ? (
            <input
              className={styles.prodInput}
              autoFocus
              type="text"
              placeholder="https://my-app.example.com"
              value={prodDraft}
              maxLength={2048}
              onChange={(e) => setProdDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setProdDraft(null);
                if (e.key === "Enter") {
                  void updateProject(project.id, { productionUrl: prodDraft.trim() });
                  setProdDraft(null);
                }
              }}
              onBlur={() => {
                void updateProject(project.id, { productionUrl: prodDraft.trim() });
                setProdDraft(null);
              }}
            />
          ) : project.productionUrl ? (
            <>
              <code
                className={styles.path}
                title="Click to edit"
                onClick={() => setProdDraft(project.productionUrl ?? "")}
              >
                {project.productionUrl}
              </code>
              <button
                className="btn"
                title="Open the live application in your browser"
                onClick={() => void openExternalUrl(project.productionUrl!)}
              >
                Open live <Icon name="external" size={12} />
              </button>
            </>
          ) : (
            <button
              className={styles.prodAdd}
              title="Where does this project run for real? Counts toward your contribution score."
              onClick={() => setProdDraft("")}
            >
              Add production URL…
            </button>
          )}
        </div>
        <QuickActions project={project} gitInfo={gitInfo} />
        {project.pathExists && <TryIdea project={project} gitInfo={gitInfo} />}
        {project.pathExists && <GuidedActions projectId={project.id} />}
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

      {project.pathExists && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Suggestions</h2>
          <SuggestionList project={project} />
        </section>
      )}

      {project.isGitRepo && gitInfo?.state === "available" && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Git</h2>
          <GitSummary info={gitInfo} />
          <GitControls projectId={project.id} gitInfo={gitInfo} />
          <MergeBanner projectId={project.id} gitInfo={gitInfo} />
          <CommitControls projectId={project.id} gitInfo={gitInfo} />
          <SyncStatus projectId={project.id} gitInfo={gitInfo} />
          <div className={styles.gitButtons}>
            <HistoryPanel projectId={project.id} gitInfo={gitInfo} />
            <button
              className="btn"
              data-active={showRepo || undefined}
              title="Commit graph, diffs, branches, merge and push"
              onClick={() => setShowRepo((v) => !v)}
            >
              <Icon name="branch" size={13} /> {showRepo ? "Hide git tools" : "Git tools"}
            </button>
          </div>
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

      {showRepo && project.isGitRepo && project.pathExists && gitInfo?.state === "available" && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Repository</h2>
            <button
              className="btn"
              title="The full git view: all repositories, branches, and diffs side by side"
              onClick={() => setRoute({ page: "git", projectId: project.id })}
            >
              Open Git view <Icon name="external" size={12} />
            </button>
          </div>
          <RepoPanel projectId={project.id} gitInfo={gitInfo} />
        </section>
      )}

      {project.pathExists && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Setup &amp; checks</h2>
          <SetupPanel project={project} />
        </section>
      )}

      {project.isGitRepo && <GithubPanel projectId={project.id} gitInfo={gitInfo} />}

      {project.isGitRepo && project.pathExists && gitInfo?.state === "available" && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Publish</h2>
          <PublishPanel projectId={project.id} gitInfo={gitInfo} />
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Roadmap</h2>
        {roadmap ? (
          <RoadmapPanel
            projectId={project.id}
            fileName={roadmap.fileName}
            fallbackMarkdown={roadmap.markdown}
            truncated={roadmap.truncated}
          />
        ) : (
          <p className={styles.faint}>No roadmap found.</p>
        )}
      </section>

      {ideas && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Ideas</h2>
          <IdeasPanel projectId={project.id} fallbackMarkdown={ideas.markdown} />
        </section>
      )}

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
