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

export interface ErrorExplanation {
  explanation: string;
  excerpt: string;
}

export interface RunTarget {
  targetId: string;
  label: string;
  runner: string;
  detail?: string;
}
