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
}

export interface RunTarget {
  targetId: string;
  label: string;
  runner: string;
  detail?: string;
}
