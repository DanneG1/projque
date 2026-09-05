import type { ProjectView } from "../models";
import type { Route } from "../store/useAppStore";
import type { AgentSessionView } from "../models";

/** Favorites in stable (alphabetical) order, mapped to ⌘1–⌘9. */
export function favoriteShortcuts(projects: ProjectView[]): ProjectView[] {
  return projects
    .filter((p) => p.favorite && p.status !== "archived")
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 9);
}

/** The session panes currently on screen. The split view shows when at
 *  least two grid members exist and the routed session is one of them (or
 *  no specific session is routed); selecting a non-member in the sidebar
 *  temporarily shows that session alone, and selecting any member returns
 *  to the grid. */
export function visibleSessionIds(state: {
  route: Route;
  sessions: AgentSessionView[];
  gridIds: string[];
  /** Sessions shown in their own window - not visible here. */
  detachedIds?: string[];
}): string[] {
  if (state.route.page !== "agents" || state.sessions.length === 0) return [];
  const detached = state.detachedIds ?? [];
  const grid = state.gridIds.filter((id) =>
    state.sessions.some((v) => v.sessionId === id),
  );
  const routeId = state.route.sessionId;
  const routed = state.sessions.find((v) => v.sessionId === routeId);
  if (grid.length >= 2 && (!routed || grid.includes(routed.sessionId))) {
    return grid.filter((id) => !detached.includes(id));
  }
  const active = routed ?? state.sessions[state.sessions.length - 1];
  return detached.includes(active.sessionId) ? [] : [active.sessionId];
}
