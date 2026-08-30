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
  pathExists: boolean;
  isGitRepo: boolean;
  hasReadme: boolean;
  hasRoadmap: boolean;
  hasIdeas: boolean;
  hasRunTargets: boolean;
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
