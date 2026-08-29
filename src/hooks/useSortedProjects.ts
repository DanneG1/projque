import { useMemo } from "react";
import { useAppStore } from "../store/useAppStore";
import { STATUS_ORDER, type ProjectView } from "../models";

function statusRank(p: ProjectView): number {
  return STATUS_ORDER.indexOf(p.status);
}

/** Spec ordering: favorites first, then status group, then name.
 *  (Latest git activity within a group lands with the git milestone.) */
export function useSortedProjects(): ProjectView[] {
  const projects = useAppStore((s) => s.projects);
  const showArchived = useAppStore((s) => s.settings?.display.showArchived ?? false);
  return useMemo(() => {
    const visible = showArchived
      ? projects
      : projects.filter((p) => p.status !== "archived");
    return [...visible].sort(
      (a, b) =>
        Number(b.favorite) - Number(a.favorite) ||
        statusRank(a) - statusRank(b) ||
        a.name.localeCompare(b.name),
    );
  }, [projects, showArchived]);
}
