import { useEffect, useRef, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { FilterTabs } from "../components/FilterTabs";
import { ProjectCard } from "../components/ProjectCard";
import { SearchBar } from "../components/SearchBar";
import { SparkBanner } from "../components/SparkBanner";
import { StreakChip } from "../components/StreakChip";
import { Icon } from "../components/Icon";
import { IdeasPanel } from "../components/IdeasPanel";
import { HealthCheckButton, HealthCheckPanel } from "../components/HealthCheck";
import { favoriteShortcuts } from "../utils/shortcuts";
import { useSortedProjects } from "../hooks/useSortedProjects";
import { useAppStore } from "../store/useAppStore";
import styles from "./ProjectListPage.module.css";

export function ProjectListPage() {
  const projects = useSortedProjects();
  const allProjects = useAppStore((s) => s.projects);
  const totalCount = allProjects.length;
  const addProjectManual = useAppStore((s) => s.addProjectManual);
  const addProjectRoot = useAppStore((s) => s.addProjectRoot);
  const runScan = useAppStore((s) => s.runScan);
  const setRoute = useAppStore((s) => s.setRoute);
  const refreshGit = useAppStore((s) => s.refreshGit);
  const gitAvailable = useAppStore((s) => s.gitAvailable);
  const setNewProjectOpen = useAppStore((s) => s.setNewProjectOpen);

  const searchRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation: / focuses search, arrows move, Enter opens.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT";
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typing) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((prev) => {
          const next =
            e.key === "ArrowDown"
              ? Math.min(prev + 1, projects.length - 1)
              : Math.max(prev - 1, 0);
          listRef.current
            ?.querySelectorAll("article")
            [next]?.scrollIntoView({ block: "nearest" });
          return next;
        });
      }
      if (e.key === "Enter" && selected >= 0 && projects[selected]) {
        setRoute({ page: "detail", projectId: projects[selected].id });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [projects, selected, setRoute]);

  const shortcuts = favoriteShortcuts(allProjects).map((p) => p.id);

  const scanFolder = async () => {
    // Onboarding shortcut: pick a root, then scan it right away.
    const added = await addProjectRoot();
    if (added) {
      setRoute({ page: "import" });
      await runScan();
    }
  };

  if (totalCount === 0) {
    return (
      <EmptyState title="Where do you keep your projects?">
        <p>
          Point ProjQue at a folder that contains your repositories, or add a
          single project manually.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" onClick={() => void scanFolder()}>
            Add project folder
          </button>
          <button className="btn" onClick={() => void addProjectManual()}>
            Add single project
          </button>
          <button className="btn" onClick={() => setNewProjectOpen(true)}>
            Start something new
          </button>
        </div>
      </EmptyState>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <SearchBar ref={searchRef} />
        <FilterTabs />
        <StreakChip />
        <div className={styles.spacer} />
        <button
          className="btn btn-ghost"
          title="Refresh git information"
          aria-label="Refresh"
          onClick={() => void refreshGit({ force: true })}
        >
          <Icon name="refresh" size={15} />
        </button>
        <HealthCheckButton />
        <button
          className="btn"
          onClick={() => {
            setRoute({ page: "import" });
            void runScan();
          }}
        >
          <Icon name="search" size={14} /> Scan folders
        </button>
        <button className="btn" onClick={() => void addProjectManual()}>
          <Icon name="plus" size={14} /> Add folder
        </button>
      </div>

      <HealthCheckPanel />

      <SparkBanner />

      <IdeasPanel projectId={null} heading="Idea inbox" />

      {!gitAvailable && (
        <p className={styles.gitNote}>
          Git was not found on this machine - branch and commit information is
          hidden. Everything else works.
        </p>
      )}

      {projects.length === 0 ? (
        <EmptyState title="No projects match" />
      ) : (
        <div className={styles.list} ref={listRef}>
          {projects.map((p, i) => {
            const shortcutIndex = shortcuts.indexOf(p.id);
            return (
              <ProjectCard
                key={p.id}
                project={p}
                selected={i === selected}
                shortcut={shortcutIndex >= 0 ? shortcutIndex + 1 : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
