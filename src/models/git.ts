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
  mergeInProgress: boolean;
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

/** Automatic working-tree snapshot on a hidden ref (refs/projque/snapshots). */
export interface Snapshot {
  hash: string;
  shortHash: string;
  reason: string;
  timestamp: number;
}

/** One node in the commit graph (git log --all --topo-order). */
export interface GraphCommit {
  hash: string;
  shortHash: string;
  parents: string[];
  subject: string;
  author: string;
  timestamp: number;
  refs: string[];
  isHead: boolean;
}

/** One file's part of a diff. Paths are repo-relative, display only. */
export interface FileDiff {
  path: string;
  oldPath: string | null;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  patch: string;
  truncated: boolean;
}

export type MergeOutcome =
  | { status: "merged" }
  | { status: "conflicts"; files: string[] };
