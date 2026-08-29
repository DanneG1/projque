import { EmptyState } from "../components/EmptyState";
import { ProjectCard } from "../components/ProjectCard";
import { useSortedProjects } from "../hooks/useSortedProjects";
import { useAppStore } from "../store/useAppStore";
import styles from "./ProjectListPage.module.css";

export function ProjectListPage() {
  const projects = useSortedProjects();
  const totalCount = useAppStore((s) => s.projects.length);
  const addProjectManual = useAppStore((s) => s.addProjectManual);
  const addProjectRoot = useAppStore((s) => s.addProjectRoot);
  const runScan = useAppStore((s) => s.runScan);
  const setRoute = useAppStore((s) => s.setRoute);

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
          Point Projque at a folder that contains your repositories, or add a
          single project manually.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" onClick={() => void scanFolder()}>
            Add project folder
          </button>
          <button className="btn" onClick={() => void addProjectManual()}>
            Add single project
          </button>
        </div>
      </EmptyState>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <span className={styles.count}>
          {projects.length} {projects.length === 1 ? "project" : "projects"}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn"
            onClick={() => {
              setRoute({ page: "import" });
              void runScan();
            }}
          >
            Scan folders
          </button>
          <button className="btn" onClick={() => void addProjectManual()}>
            Add project
          </button>
        </div>
      </div>
      <div className={styles.list}>
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </div>
    </div>
  );
}
