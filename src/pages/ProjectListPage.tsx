import { EmptyState } from "../components/EmptyState";

export function ProjectListPage() {
  return (
    <EmptyState title="No projects yet">
      <p>
        Add a folder of projects to scan for repositories, or add a single
        project manually. (Coming in the next milestone.)
      </p>
    </EmptyState>
  );
}
