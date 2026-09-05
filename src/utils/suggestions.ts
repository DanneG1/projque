import type { GitInfo, ProjectStatus, ProjectView } from "../models";

/** What a suggestion offers to do. Executed by the Suggestions component
 *  through the store - this module stays pure and testable. */
export type SuggestionAction =
  | { kind: "detail"; label: string }
  | { kind: "audit"; label: string }
  | { kind: "push"; label: string }
  | { kind: "pull"; label: string }
  | { kind: "tests"; label: string }
  | { kind: "agent"; label: string; prompt: string }
  | { kind: "backup"; label: string }
  | { kind: "status"; label: string; status: ProjectStatus };

export interface Suggestion {
  /** Stable per rule; snoozes key on `${projectId}:${id}`. */
  id: string;
  /** Lower = shown first. */
  priority: number;
  title: string;
  detail?: string;
  action: SuggestionAction;
}

const DAY = 86400;
export const AUDIT_STALE_DAYS = 30;
export const QUIET_DAYS = 21;

function days(from: number, now: number): number {
  return Math.floor((now - from) / DAY);
}

function n(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

const README_PROMPT =
  "Write a README.md for this project for someone who has never seen it: what it does, how to run it, and how it is organized. Keep it short and plain. Do not change any other files.";

const GIT_INIT_PROMPT =
  "This project is not under version control yet. Initialize a git repository here, add a sensible .gitignore for this kind of project (build output, dependencies, environment files with secrets), and make one initial commit of the current files. Explain in one or two plain sentences what that gives the user.";

/** Rules over data the app already holds - no extra IPC. Returns
 *  suggestions sorted by priority; the caller filters snoozed ones. */
export function suggestionsFor(
  project: ProjectView,
  git: GitInfo | undefined,
  nowSecs: number = Date.now() / 1000,
): Suggestion[] {
  const out: Suggestion[] = [];
  if (!project.pathExists || project.status === "archived") return out;

  const g = git && git.state === "available" ? git : undefined;
  const active = project.status === "active" || project.status === "maintenance";
  const lastCommit = g?.lastCommit?.timestamp ?? null;

  if (g?.mergeInProgress) {
    out.push({
      id: "merge",
      priority: 5,
      title: "A merge is waiting to be finished",
      detail: "Resolve the conflicts (or ask the agent to), then complete or abort it.",
      action: { kind: "detail", label: "Open" },
    });
  }

  if (project.lastVerified && !project.lastVerified.passed) {
    out.push({
      id: "checks-failed",
      priority: 10,
      title: "Some checks failed last time",
      detail: `Tests were run ${daysAgo(project.lastVerified.at, nowSecs)}. Fix them, or ask the agent to.`,
      action: project.hasRunTargets
        ? { kind: "tests", label: "Run tests again" }
        : { kind: "detail", label: "Open" },
    });
  }

  const audit = project.lastAudit;
  if (audit && audit.total > 0) {
    const severe = audit.critical + audit.high;
    out.push({
      id: "vulns",
      priority: severe > 0 ? 8 : 12,
      title: `${audit.total} known ${audit.total === 1 ? "vulnerability" : "vulnerabilities"} in packages`,
      detail:
        (severe > 0 ? `${n(severe, "serious one")}. ` : "") +
        (audit.fixable > 0
          ? `${audit.fixable} can be updated safely.`
          : "None can be updated automatically - ask the agent."),
      action: { kind: "detail", label: "Review" },
    });
  }

  if (g?.dirty && g.changedFiles > 0) {
    const stale = lastCommit !== null && nowSecs - lastCommit > 2 * DAY;
    out.push({
      id: "uncommitted",
      priority: stale ? 15 : 20,
      title: `${n(g.changedFiles, "changed file")} not committed`,
      detail: stale
        ? `Nothing has been committed for ${daysAgo(lastCommit!, nowSecs).replace(" ago", "")}. Committing keeps a version you can go back to.`
        : "Committing keeps a version you can go back to.",
      action: { kind: "detail", label: "Commit" },
    });
  }

  if (g && g.remoteUrl === null && g.lastCommit && (active || project.status === "paused" || project.status === "done")) {
    out.push({
      id: "no-remote",
      priority: 18,
      title: "Only exists on this computer",
      detail: "A private GitHub repository is a free backup - if this disk dies, the project is gone.",
      action: { kind: "backup", label: "Back up to GitHub" },
    });
  }

  if (g && (g.ahead ?? 0) > 0) {
    out.push({
      id: "unpushed",
      priority: 25,
      title: `${n(g.ahead!, "commit")} not pushed yet`,
      detail: "Your latest work only exists on this computer.",
      action: { kind: "push", label: "Push" },
    });
  }

  if (g && (g.behind ?? 0) > 0) {
    out.push({
      id: "behind",
      priority: 30,
      title: `${n(g.behind!, "newer commit")} online`,
      detail: "Pull them in before you continue, so you build on the latest version.",
      action: { kind: "pull", label: "Pull" },
    });
  }

  if (project.auditable && project.status !== "idea") {
    if (!audit) {
      out.push({
        id: "audit-never",
        priority: 35,
        title: "Packages never checked for vulnerabilities",
        detail: "A quick check tells you whether any package this project uses has a known security problem.",
        action: { kind: "audit", label: "Check now" },
      });
    } else if (days(audit.at, nowSecs) >= AUDIT_STALE_DAYS) {
      out.push({
        id: "audit-stale",
        priority: 40,
        title: `Long time since the last package check`,
        detail: `Last checked ${daysAgo(audit.at, nowSecs)}. New vulnerabilities are published every week.`,
        action: { kind: "audit", label: "Check again" },
      });
    }
  }

  if (
    project.lastVerified?.passed &&
    project.hasRunTargets &&
    lastCommit !== null &&
    lastCommit > project.lastVerified.at
  ) {
    out.push({
      id: "verify-stale",
      priority: 45,
      title: "Changed since it was last verified",
      detail: `Commits landed after the checks passed ${daysAgo(project.lastVerified.at, nowSecs)}.`,
      action: { kind: "tests", label: "Run tests" },
    });
  }

  if (!project.isGitRepo && (active || project.status === "paused")) {
    out.push({
      id: "no-git",
      priority: 50,
      title: "No version history yet",
      detail: "Without git there is nothing to go back to if something breaks.",
      action: { kind: "agent", label: "Start history", prompt: GIT_INIT_PROMPT },
    });
  }

  if (project.status === "done" && !project.productionUrl) {
    out.push({
      id: "no-url",
      priority: 55,
      title: "Where does it run?",
      detail: "Add the production URL so you can open it from here.",
      action: { kind: "detail", label: "Add URL" },
    });
  }

  if (project.isGitRepo && !project.hasReadme && (active || project.status === "done")) {
    out.push({
      id: "no-readme",
      priority: 60,
      title: "No README",
      detail: "A short README helps future you (and the agent) understand the project.",
      action: { kind: "agent", label: "Write one", prompt: README_PROMPT },
    });
  }

  if (project.status === "active" && lastCommit !== null && days(lastCommit, nowSecs) >= QUIET_DAYS) {
    out.push({
      id: "quiet",
      priority: 65,
      title: `Quiet for ${n(days(lastCommit, nowSecs), "day")}`,
      detail: "Still active? Marking it paused keeps the list honest.",
      action: { kind: "status", label: "Mark paused", status: "paused" },
    });
  }

  if (project.status === "idea" && g?.lastCommit) {
    out.push({
      id: "idea-has-code",
      priority: 68,
      title: "This idea has code now",
      detail: `Last commit ${daysAgo(g.lastCommit.timestamp, nowSecs)}.`,
      action: { kind: "status", label: "Mark active", status: "active" },
    });
  }

  if (!project.resolvedDescription) {
    out.push({
      id: "no-description",
      priority: 70,
      title: "Add a short description",
      detail: "One line about what this project is.",
      action: { kind: "detail", label: "Add" },
    });
  }

  out.sort((a, b) => a.priority - b.priority);
  return out;
}

function daysAgo(unixSecs: number, nowSecs: number): string {
  const d = days(unixSecs, nowSecs);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  const months = Math.round(d / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

// ---------------------------------------------------------------------------
// Snoozing: a dismissed suggestion stays hidden for a week, per project and
// rule, in localStorage (decorative state - losing it is harmless).

const SNOOZE_KEY = "projque:snoozed";
const SNOOZE_MS = 7 * 86400 * 1000;
export const SNOOZE_EVENT = "projque:snooze";

function readSnoozes(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return {};
    const now = Date.now();
    const live: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && v > now) live[k] = v;
    }
    return live;
  } catch {
    return {};
  }
}

export function isSnoozed(projectId: string, id: string): boolean {
  return `${projectId}:${id}` in readSnoozes();
}

export function snooze(projectId: string, id: string): void {
  try {
    const all = readSnoozes();
    all[`${projectId}:${id}`] = Date.now() + SNOOZE_MS;
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable - the suggestion just comes back next time
  }
  window.dispatchEvent(new Event(SNOOZE_EVENT));
}
