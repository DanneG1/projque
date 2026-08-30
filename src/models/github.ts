export interface GhStatus {
  installed: boolean;
  authenticated: boolean;
}

export interface PrStatus {
  title: string;
  url: string;
  state: string;
  checksPassing: boolean | null;
  checksTotal: number;
}

export interface SecretFinding {
  /** Repository-relative path - display only. */
  file: string;
  /** 1-based line, 0 when the finding is about the file itself. */
  line: number;
  kind: string;
}

export interface PublishPreflight {
  ghInstalled: boolean;
  ghAuthenticated: boolean;
  hasRemote: boolean;
  hasCommits: boolean;
  dirty: boolean;
  /** "/" or "/docs" when the project looks like a static site. */
  staticPath: string | null;
  nameProblem: string | null;
  findings: SecretFinding[];
}

export interface PublishOutcome {
  repoUrl: string | null;
  pagesUrl: string | null;
  pagesError: string | null;
}

export interface DoctorItem {
  id: string;
  label: string;
  ok: boolean;
  detail: string | null;
  fixable: boolean;
}
