export interface DiscoveredRepo {
  candidateId: string;
  name: string;
  displayPath: string;
  rootIndex: number;
  depth: number;
  alreadyImported: boolean;
  isGit: boolean;
}

export interface ScanIssue {
  path: string;
  detail: string;
}

export interface ScanResult {
  candidates: DiscoveredRepo[];
  rootsScanned: string[];
  errors: ScanIssue[];
  truncated: boolean;
  durationMs: number;
}

export interface ImportResult {
  imported: import("./project").ProjectView[];
  skippedDuplicates: string[];
  failed: ScanIssue[];
}

export interface AddRootResult {
  settings: import("./settings").Settings;
  added: boolean;
}
