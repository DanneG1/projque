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
  const git = useAppStore((s) => s.git);
  const sessions = useAppStore((s) => s.sessions);
  const showArchived = useAppStore((s) => s.settings?.display.showArchived ?? false);
  const filter = useAppStore((s) => s.filter);
  const query = useAppStore((s) => s.query);
  return useMemo(() => {
    let visible =
      showArchived || filter === "archived"
        ? projects
        : projects.filter((p) => p.status !== "archived");
    if (filter === "favorites") {
      visible = visible.filter((p) => p.favorite);
    } else if (filter !== "all") {
      visible = visible.filter((p) => p.status === filter);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      visible = visible.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.resolvedDescription ?? "").toLowerCase().includes(q) ||
          p.path.toLowerCase().includes(q),
      );
    }
    const lastActivity = (p: ProjectView) => git[p.id]?.lastCommit?.timestamp ?? 0;
    const running = (p: ProjectView) =>
      sessions.some((v) => v.projectId === p.id && v.status.state === "running");
    const attention = (p: ProjectView) =>
      sessions.some(
        (v) =>
          v.projectId === p.id &&
          v.status.state === "running" &&
          v.needsAttention,
      );
    // Live work floats to the top: sessions waiting on the user first,
    // then the pinned (favorite) row, then anything currently running.
    return [...visible].sort(
      (a, b) =>
        Number(attention(b)) - Number(attention(a)) ||
        Number(b.favorite) - Number(a.favorite) ||
        Number(running(b)) - Number(running(a)) ||
        statusRank(a) - statusRank(b) ||
        lastActivity(b) - lastActivity(a) ||
        a.name.localeCompare(b.name),
    );
  }, [projects, git, sessions, showArchived, filter, query]);
}
