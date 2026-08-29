import { EmptyState } from "../components/EmptyState";
import { ProjectCard } from "../components/ProjectCard";
import { useSortedProjects } from "../hooks/useSortedProjects";
import { useAppStore } from "../store/useAppStore";
import styles from "./ProjectListPage.module.css";

export function ProjectListPage() {
  const projects = useSortedProjects();
  const totalCount = useAppStore((s) => s.projects.length);
  const addProjectManual = useAppStore((s) => s.addProjectManual);

  if (totalCount === 0) {
    return (
      <EmptyState title="Where do you keep your projects?">
        <p>Add a single project to get started.</p>
        <button className="btn btn-primary" onClick={() => void addProjectManual()}>
          Add project
        </button>
      </EmptyState>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <span className={styles.count}>
          {projects.length} {projects.length === 1 ? "project" : "projects"}
        </span>
        <button className="btn" onClick={() => void addProjectManual()}>
          Add project
        </button>
      </div>
      <div className={styles.list}>
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </div>
    </div>
  );
}
