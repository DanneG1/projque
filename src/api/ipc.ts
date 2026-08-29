// The only place invoke() is called. Components go through the store,
// the store goes through here. No paths or shell strings ever leave the
// frontend — commands take opaque IDs and typed enum values only.

import { invoke } from "@tauri-apps/api/core";
import type {
  AddRootResult,
  ConfigStatus,
  DocKind,
  GitAvailability,
  GitInfo,
  ImportResult,
  ProjectDocument,
  ProjectPatch,
  ProjectView,
  LaunchAction,
  LauncherCatalog,
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

  projectDocument: (id: string, kind: DocKind) =>
    invoke<ProjectDocument | null>("project_document", { id, kind }),
  openExternalUrl: (url: string) => invoke<void>("open_external_url", { url }),
};
