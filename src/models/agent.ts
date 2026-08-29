export type SessionStatus =
  | { state: "running" }
  | { state: "exited"; code: number | null };

export interface AgentSessionView {
  sessionId: string;
  projectId: string;
  agentKind: string;
  agentLabel: string;
  startedAt: number;
  status: SessionStatus;
}
