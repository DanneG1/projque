export type ProjectStatus =
  | "idea"
  | "active"
  | "paused"
  | "maintenance"
  | "done"
  | "archived";

export type DescriptionSource = "custom" | "readme" | "none";

export interface ProjectView {
  id: string;
  name: string;
  path: string;
  status: ProjectStatus;
  favorite: boolean;
  description?: string;
  descriptionSource: DescriptionSource;
  roadmapFile?: string;
  productionUrl?: string;
  /** Free-form labels for filtering (lowercase, short). */
  tags: string[];
  lastVerified?: Verification;
  lastCleanup?: Cleanup;
  lastAudit?: AuditStamp;
  /** "Try an idea safely" in progress. */
  experiment?: Experiment;
  pathExists: boolean;
  isGitRepo: boolean;
  hasReadme: boolean;
  hasRoadmap: boolean;
  hasIdeas: boolean;
  hasRunTargets: boolean;
  /** The built-in package vulnerability check works here. */
  auditable: boolean;
  resolvedDescription?: string;
}

export type DocKind = "roadmap" | "readme" | "ideas";

export interface ProjectDocument {
  fileName: string;
  markdown: string;
  truncated: boolean;
}

export interface ProjectPatch {
  name?: string;
  status?: ProjectStatus;
  favorite?: boolean;
  description?: string;
  descriptionSource?: DescriptionSource;
  roadmapFile?: string;
  productionUrl?: string;
  tags?: string[];
}

export const STATUS_ORDER: ProjectStatus[] = [
  "active",
  "idea",
  "maintenance",
  "paused",
  "done",
  "archived",
];

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  idea: "Idea",
  active: "Active",
  paused: "Paused",
  maintenance: "Maintenance",
  done: "Done",
  archived: "Archived",
};

/** One checklist entry in IDEAS.md. `line` is the item's 0-based line number. */
export interface IdeaItem {
  line: number;
  text: string;
  done: boolean;
  date: string | null;
}

export interface Verification {
  at: number;
  passed: boolean;
}

export interface DeployInfo {
  detected: boolean;
  provider: string | null;
  summary: string;
  branches: string[];
  onPush: boolean;
  evidence: string[];
  readmeMentionsDeploy: boolean;
}

export interface ToolCheck {
  tool: string;
  label: string;
  reason: string;
  found: boolean;
  version: string | null;
  wanted: string | null;
  hint: string;
}

export interface Cleanup {
  at: number;
  commit: string | null;
}

export interface DebtInfo {
  commitsSince: number;
  linesChanged: number;
  filesChanged: number;
  lastCleanupAt: number | null;
  nudge: boolean;
  windowFallback: boolean;
}

export interface Experiment {
  label: string;
  base: string;
  branch: string;
  startedAt: number;
}

export interface EnvKey {
  key: string;
  expected: boolean;
  set: boolean;
  masked: string | null;
  hint: string | null;
}

export interface EnvStatus {
  exampleFile: string | null;
  hasEnv: boolean;
  keys: EnvKey[];
  missing: number;
  ignored: boolean;
}

export interface DiskEntry {
  /** Project-relative folder, display only (and the clean key). */
  rel: string;
  label: string;
  bytes: number;
}

export interface DiskUsage {
  totalBytes: number;
  entries: DiskEntry[];
}

export interface AuditStamp {
  at: number;
  total: number;
  fixable: number;
  critical: number;
  high: number;
}

export interface AuditItem {
  name: string;
  severity: string;
  title: string;
  range: string;
  /** "yes" (non-breaking fix) | "major" (breaking upgrade) | "no" */
  fix: string;
  direct: boolean;
}

export interface AuditReport {
  manager: string;
  total: number;
  critical: number;
  high: number;
  moderate: number;
  low: number;
  info: number;
  fixable: number;
  needsMajor: number;
  dependencies: number;
  items: AuditItem[];
  canAutoFix: boolean;
}

export interface AuditSupport {
  manager: string;
  supported: boolean;
  reason: string | null;
}
