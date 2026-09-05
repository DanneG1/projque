/** Raw local activity data from the backend (activity_summary). */
export interface ProjectActivity {
  projectId: string;
  /** Commit times (unix seconds) in the last ~53 weeks. */
  commitTimestamps: number[];
  /** All-time commit count across branches. */
  totalCommits: number;
}

export interface SessionRecord {
  projectId: string;
  /** "agent" | "run" */
  kind: string;
  startedAt: number;
  endedAt: number;
}

export interface ActivitySummary {
  projects: ProjectActivity[];
  ideasOpen: number;
  ideasDone: number;
  /** Finished sessions, for time-on-project. */
  sessions: SessionRecord[];
}
