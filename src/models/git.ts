export type GitState = "available" | "notARepository" | "gitMissing" | "error";

export interface GitCommit {
  hash: string;
  shortHash: string;
  subject: string;
  timestamp: number;
}

export interface GitInfo {
  projectId: string;
  state: GitState;
  branch: string | null;
  detached: boolean;
  changedFiles: number;
  dirty: boolean;
  hasUntracked: boolean;
  ahead: number | null;
  behind: number | null;
  lastCommit: GitCommit | null;
  remoteUrl: string | null;
  repositoryUrl: string | null;
  fetchedAt: number;
  error: string | null;
}

export interface GitAvailability {
  available: boolean;
  version: string | null;
}

export interface BranchInfo {
  name: string;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface BranchList {
  branches: BranchInfo[];
  remoteBranches: string[];
  detached: boolean;
}
