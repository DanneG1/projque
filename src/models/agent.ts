export type SessionStatus =
  | { state: "running" }
  | { state: "exited"; code: number | null };

export type SessionKind = "agent" | "run";

export interface AgentSessionView {
  sessionId: string;
  projectId: string;
  /** Display name of the project, for notifications and pane headers. */
  projectLabel: string;
  kind: SessionKind;
  agentKind: string;
  agentLabel: string;
  startedAt: number;
  status: SessionStatus;
  detectedUrl: string | null;
  needsAttention: boolean;
  /** Agent sessions: commit to restore to undo everything the session did. */
  undoHash: string | null;
  /** Run sessions: the run target that was started ("test:*" = a test run). */
  targetId: string | null;
  /** Run sessions: error-shaped output was seen. */
  errorDetected: boolean;
}

/** Liveness of a running session, pushed every ~2s while anything runs. */
export interface SessionPulse {
  sessionId: string;
  /** Seconds since the last output byte; null = nothing yet. */
  idleSecs: number | null;
  /** Output is flowing right now. */
  working: boolean;
}

/** A saved agent session transcript (app config dir, never in the project). */
export interface TranscriptMeta {
  file: string;
  agentLabel: string;
  startedAt: number;
  bytes: number;
  summary: string | null;
}

export interface ErrorExplanation {
  explanation: string;
  excerpt: string;
}

/** A command a project defines in projque.json; runs only once approved. */
export interface CustomCommand {
  id: string;
  label: string;
  program: string;
  args: string[];
  hash: string;
  approved: boolean;
}

export interface RunTarget {
  targetId: string;
  label: string;
  runner: string;
  detail?: string;
}
