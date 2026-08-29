// The only place invoke() is called. Components go through the store,
// the store goes through here. No paths or shell strings ever leave the
// frontend — commands take opaque IDs and typed enum values only.

import { invoke } from "@tauri-apps/api/core";
import type {
  AddRootResult,
  ConfigStatus,
  ImportResult,
  ProjectPatch,
  ProjectView,
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
};
