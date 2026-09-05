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
  const tagFilter = useAppStore((s) => s.tagFilter);
  const sort = useAppStore((s) => s.sort);
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
    if (tagFilter) {
      visible = visible.filter((p) => p.tags.includes(tagFilter));
    }
    const q = query.trim().toLowerCase();
    if (q) {
      // "#tag" searches tags only.
      const tagQuery = q.startsWith("#") ? q.slice(1) : null;
      visible = visible.filter((p) =>
        tagQuery !== null
          ? p.tags.some((t) => t.includes(tagQuery))
          : p.name.toLowerCase().includes(q) ||
            (p.resolvedDescription ?? "").toLowerCase().includes(q) ||
            p.path.toLowerCase().includes(q) ||
            p.tags.some((t) => t.includes(q)),
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
    // Live work floats to the top whatever the sort: sessions waiting on
    // the user first, then anything currently running.
    const live = (a: ProjectView, b: ProjectView) =>
      Number(attention(b)) - Number(attention(a)) || Number(running(b)) - Number(running(a));
    if (sort === "recent") {
      return [...visible].sort(
        (a, b) => live(a, b) || lastActivity(b) - lastActivity(a) || a.name.localeCompare(b.name),
      );
    }
    if (sort === "name") {
      return [...visible].sort((a, b) => live(a, b) || a.name.localeCompare(b.name));
    }
    // "smart": the pinned (favorite) row, then status group, then recency.
    return [...visible].sort(
      (a, b) =>
        live(a, b) ||
        Number(b.favorite) - Number(a.favorite) ||
        statusRank(a) - statusRank(b) ||
        lastActivity(b) - lastActivity(a) ||
        a.name.localeCompare(b.name),
    );
  }, [projects, git, sessions, showArchived, filter, tagFilter, sort, query]);
}
