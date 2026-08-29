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
  resolvedDescription?: string;
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
