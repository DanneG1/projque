// The only place invoke() is called. Components go through the store,
// the store goes through here. No paths or shell strings ever leave the
// frontend - commands take opaque IDs and typed enum values only.

import { invoke, type Channel } from "@tauri-apps/api/core";
import type {
  ActivitySummary,
  AddRootResult,
  AgentSessionView,
  AuditReport,
  AuditSupport,
  DiskUsage,
  EnvStatus,
  OutdatedReport,
  TranscriptMeta,
  BranchList,
  CommitPreflight,
  DebtInfo,
  DeployInfo,
  DoctorItem,
  ErrorExplanation,
  SyncOutcome,
  ToolCheck,
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
  settingsSetNotifications: (patch: {
    system?: boolean;
    quietHours?: boolean;
    quietFrom?: number;
    quietTo?: number;
  }) => invoke<Settings>("settings_set_notifications", patch),
  settingsPromptSave: (id: string | null, label: string, prompt: string) =>
    invoke<Settings>("settings_prompt_save", { id, label, prompt }),
  settingsPromptDelete: (id: string) => invoke<Settings>("settings_prompt_delete", { id }),

  projectsList: () => invoke<ProjectView[]>("projects_list"),
  watchSync: () => invoke<void>("watch_sync"),
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
  gitCommit: (id: string, message: string, allowSecrets = false) =>
    invoke<GitInfo>("git_commit", { id, message, allowSecrets }),
  gitHistory: (id: string, limit?: number) =>
    invoke<GitCommit[]>("git_history", { id, limit: limit ?? null }),
  gitSnapshots: (id: string) => invoke<Snapshot[]>("git_snapshots", { id }),
  gitRestore: (id: string, hash: string, discardNew = false) =>
    invoke<GitInfo>("git_restore", { id, hash, discardNew }),
  gitSync: (id: string, message: string | null, allowSecrets = false) =>
    invoke<[SyncOutcome, GitInfo]>("git_sync", { id, message, allowSecrets }),
  gitCommitPreflight: (id: string) =>
    invoke<CommitPreflight>("git_commit_preflight", { id }),
  gitIgnoreFix: (id: string, kinds: string[]) =>
    invoke<GitInfo>("git_ignore_fix", { id, kinds }),
  gitChangeSummary: (id: string) => invoke<string>("git_change_summary", { id }),
  gitCommitMessage: (id: string) => invoke<string>("git_commit_message", { id }),
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
    sessionLabel?: string,
  ) =>
    invoke<AgentSessionView>("agent_session_start", {
      projectId,
      agentKind,
      rows,
      cols,
      initialPrompt: initialPrompt ?? null,
      sessionLabel: sessionLabel ?? null,
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
  githubBackup: (id: string) => invoke<[string, GitInfo]>("github_backup", { id }),
  experimentStart: (id: string, label: string) =>
    invoke<[ProjectView, GitInfo]>("experiment_start", { id, label }),
  experimentKeep: (id: string) =>
    invoke<[MergeOutcome, ProjectView, GitInfo]>("experiment_keep", { id }),
  projectEnvStatus: (id: string) => invoke<EnvStatus>("project_env_status", { id }),
  projectEnvSet: (id: string, key: string, value: string) =>
    invoke<EnvStatus>("project_env_set", { id, key, value }),
  transcriptsList: (id: string) => invoke<TranscriptMeta[]>("transcripts_list", { id }),
  transcriptSummarize: (id: string, file: string) =>
    invoke<string>("transcript_summarize", { id, file }),
  transcriptDelete: (id: string, file: string) => invoke<void>("transcript_delete", { id, file }),
  transcriptsOpenFolder: (id: string) => invoke<void>("transcripts_open_folder", { id }),
  projectDiskUsage: (id: string) => invoke<DiskUsage>("project_disk_usage", { id }),
  projectDiskClean: (id: string, rels: string[]) =>
    invoke<number>("project_disk_clean", { id, rels }),
  experimentDiscard: (id: string) =>
    invoke<[ProjectView, GitInfo]>("experiment_discard", { id }),

  activitySummary: () => invoke<ActivitySummary>("activity_summary"),
  doctorStatus: () => invoke<DoctorItem[]>("doctor_status"),
  doctorFix: (kind: string) => invoke<void>("doctor_fix", { kind }),

  projectTestTarget: (id: string) =>
    invoke<RunTarget | null>("project_test_target", { id }),
  projectMarkVerified: (id: string, passed: boolean) =>
    invoke<ProjectView>("project_mark_verified", { id, passed }),
  projectDeployInfo: (id: string) => invoke<DeployInfo>("project_deploy_info", { id }),
  projectDebt: (id: string) => invoke<DebtInfo>("project_debt", { id }),
  projectOutdated: (id: string) => invoke<OutdatedReport>("project_outdated", { id }),
  projectAuditSupport: (id: string) => invoke<AuditSupport>("project_audit_support", { id }),
  projectAuditRun: (id: string) =>
    invoke<[AuditReport, ProjectView]>("project_audit_run", { id }),
  projectMarkCleanup: (id: string) => invoke<ProjectView>("project_mark_cleanup", { id }),
  projectDoctor: (id: string) => invoke<ToolCheck[]>("project_doctor", { id }),
  sessionExplainError: (sessionId: string) =>
    invoke<ErrorExplanation>("session_explain_error", { sessionId }),
  roadmapItems: (id: string) => invoke<IdeaItem[]>("roadmap_items", { id }),
  roadmapSetDone: (id: string, line: number, done: boolean) =>
    invoke<IdeaItem[]>("roadmap_set_done", { id, line, done }),

  ideasList: (id: string | null) => invoke<IdeaItem[]>("ideas_list", { id }),
  ideaSetDone: (id: string | null, line: number, done: boolean) =>
    invoke<IdeaItem[]>("idea_set_done", { id, line, done }),
};
