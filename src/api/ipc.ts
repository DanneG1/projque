// The only place invoke() is called. Components go through the store,
// the store goes through here. No paths or shell strings ever leave the
// frontend — commands take opaque IDs and typed enum values only.

import { invoke, type Channel } from "@tauri-apps/api/core";
import type {
  AddRootResult,
  AgentSessionView,
  BranchList,
  DoctorItem,
  FileDiff,
  GitCommit,
  GraphCommit,
  MergeOutcome,
  IdeaItem,
  PublishOutcome,
  PublishPreflight,
  Snapshot,
  ConfigStatus,
  DocKind,
  GhStatus,
  GitAvailability,
  GitInfo,
  ImportResult,
  ProjectDocument,
  ProjectPatch,
  ProjectView,
  LaunchAction,
  LauncherCatalog,
  PrStatus,
  RunTarget,
  ScanResult,
  Settings,
  Theme,
} from "../models";

export const api = {
  appConfigStatus: () => invoke<ConfigStatus>("app_config_status"),
  appOpenConfigDir: () => invoke<void>("app_open_config_dir"),
  settingsGet: () => invoke<Settings>("settings_get"),
  settingsSetDisplay: (patch: { showArchived?: boolean; theme?: Theme }) =>
    invoke<Settings>("settings_set_display", patch),

  projectsList: () => invoke<ProjectView[]>("projects_list"),
  projectAddManual: () => invoke<ProjectView | null>("project_add_manual"),
  projectUpdate: (id: string, patch: ProjectPatch) =>
    invoke<ProjectView>("project_update", { id, patch }),
  projectRemove: (id: string) => invoke<void>("project_remove", { id }),
  projectRelocate: (id: string) =>
    invoke<ProjectView | null>("project_relocate", { id }),

  settingsAddProjectRoot: () => invoke<AddRootResult>("settings_add_project_root"),
  settingsRemoveProjectRoot: (index: number) =>
    invoke<Settings>("settings_remove_project_root", { index }),
  settingsSetScanDepth: (depth: number) =>
    invoke<Settings>("settings_set_scan_depth", { depth }),
  discoveryScan: () => invoke<ScanResult>("discovery_scan"),
  discoveryImport: (candidateIds: string[]) =>
    invoke<ImportResult>("discovery_import", { candidateIds }),

  launcherCatalog: () => invoke<LauncherCatalog>("launcher_catalog"),
  settingsSetEditor: (kind: string) => invoke<Settings>("settings_set_editor", { kind }),
  settingsSetTerminal: (kind: string) => invoke<Settings>("settings_set_terminal", { kind }),
  settingsSetAgent: (kind: string) => invoke<Settings>("settings_set_agent", { kind }),
  projectLaunch: (id: string, action: LaunchAction) =>
    invoke<void>("project_launch", { id, action }),

  gitAvailability: () => invoke<GitAvailability>("git_availability"),
  gitInfoMany: (ids: string[], force: boolean) =>
    invoke<GitInfo[]>("git_info_many", { ids, force }),
  gitBranches: (id: string) => invoke<BranchList>("git_branches", { id }),
  gitFetch: (id: string) => invoke<GitInfo>("git_fetch", { id }),
  gitPullFf: (id: string) => invoke<GitInfo>("git_pull_ff", { id }),
  gitSwitch: (id: string, branch: string) =>
    invoke<GitInfo>("git_switch", { id, branch }),
  gitCommit: (id: string, message: string) =>
    invoke<GitInfo>("git_commit", { id, message }),
  gitHistory: (id: string, limit?: number) =>
    invoke<GitCommit[]>("git_history", { id, limit: limit ?? null }),
  gitSnapshots: (id: string) => invoke<Snapshot[]>("git_snapshots", { id }),
  gitRestore: (id: string, hash: string) =>
    invoke<GitInfo>("git_restore", { id, hash }),
  gitChangeSummary: (id: string) => invoke<string>("git_change_summary", { id }),
  gitGraph: (id: string, limit?: number) =>
    invoke<GraphCommit[]>("git_graph", { id, limit: limit ?? null }),
  gitCommitDiff: (id: string, hash: string) =>
    invoke<FileDiff[]>("git_commit_diff", { id, hash }),
  gitWorkdirDiff: (id: string) => invoke<FileDiff[]>("git_workdir_diff", { id }),
  gitBranchCreate: (id: string, name: string) =>
    invoke<GitInfo>("git_branch_create", { id, name }),
  gitBranchDelete: (id: string, branch: string) =>
    invoke<GitInfo>("git_branch_delete", { id, branch }),
  gitPush: (id: string) => invoke<GitInfo>("git_push", { id }),
  gitMergeInto: (id: string, target: string) =>
    invoke<MergeOutcome>("git_merge_into", { id, target }),
  gitMergeAbort: (id: string) => invoke<GitInfo>("git_merge_abort", { id }),
  gitMergeComplete: (id: string) => invoke<GitInfo>("git_merge_complete", { id }),
  gitConflicts: (id: string) => invoke<string[]>("git_conflicts", { id }),

  projectDocument: (id: string, kind: DocKind) =>
    invoke<ProjectDocument | null>("project_document", { id, kind }),
  openExternalUrl: (url: string) => invoke<void>("open_external_url", { url }),

  agentSessionStart: (
    projectId: string,
    agentKind: string | null,
    rows: number,
    cols: number,
    initialPrompt?: string,
  ) =>
    invoke<AgentSessionView>("agent_session_start", {
      projectId,
      agentKind,
      rows,
      cols,
      initialPrompt: initialPrompt ?? null,
    }),
  agentSessionsList: () => invoke<AgentSessionView[]>("agent_sessions_list"),
  agentSessionAttach: (sessionId: string, channel: Channel<unknown>) =>
    invoke<void>("agent_session_attach", { sessionId, channel }),
  agentSessionWrite: (sessionId: string, data: string) =>
    invoke<void>("agent_session_write", { sessionId, data }),
  agentSessionResize: (sessionId: string, rows: number, cols: number) =>
    invoke<void>("agent_session_resize", { sessionId, rows, cols }),
  agentSessionKill: (sessionId: string) =>
    invoke<void>("agent_session_kill", { sessionId }),
  agentSessionRemove: (sessionId: string) =>
    invoke<void>("agent_session_remove", { sessionId }),
  appConfirmQuit: () => invoke<void>("app_confirm_quit"),
  sessionsSetActive: (sessionIds: string[], appFocused: boolean) =>
    invoke<void>("sessions_set_active", { sessionIds, appFocused }),
  ideaCapture: (id: string | null, text: string) =>
    invoke<string>("idea_capture", { id, text }),
  appSetBadge: (count: number) => invoke<void>("app_set_badge", { count }),

  projectRunTargets: (id: string) =>
    invoke<RunTarget[]>("project_run_targets", { id }),
  runSessionStart: (projectId: string, targetId: string, rows: number, cols: number) =>
    invoke<AgentSessionView>("run_session_start", { projectId, targetId, rows, cols }),
  runSessionOpenUrl: (sessionId: string) =>
    invoke<void>("run_session_open_url", { sessionId }),

  githubStatus: () => invoke<GhStatus>("github_status"),
  githubPrStatus: (id: string) => invoke<PrStatus | null>("github_pr_status", { id }),
  githubOpenPr: (id: string) => invoke<void>("github_open_pr", { id }),
  projectCreate: (params: {
    name: string;
    description?: string;
    rootIndex: number;
    createRemote: boolean;
    private: boolean;
  }) =>
    invoke<{ project: ProjectView; remoteError: string | null }>("project_create", {
      name: params.name,
      description: params.description ?? null,
      rootIndex: params.rootIndex,
      createRemote: params.createRemote,
      private: params.private,
    }),
  projectClone: (url: string, rootIndex: number) =>
    invoke<ProjectView>("project_clone", { url, rootIndex }),

  publishPreflight: (id: string) =>
    invoke<PublishPreflight>("publish_preflight", { id }),
  publishRun: (id: string) => invoke<PublishOutcome>("publish_run", { id }),

  doctorStatus: () => invoke<DoctorItem[]>("doctor_status"),
  doctorFix: (kind: string) => invoke<void>("doctor_fix", { kind }),

  ideasList: (id: string | null) => invoke<IdeaItem[]>("ideas_list", { id }),
  ideaSetDone: (id: string | null, line: number, done: boolean) =>
    invoke<IdeaItem[]>("idea_set_done", { id, line, done }),
};
