export type Theme = "system" | "light" | "dark";

export interface ToolConfig {
  type: string;
  command?: string;
  args?: string[];
}

export interface DisplaySettings {
  showArchived: boolean;
  theme: Theme;
}

export interface Settings {
  configVersion: number;
  projectRoots: string[];
  scanDepth: number;
  editor: ToolConfig;
  terminal: ToolConfig;
  agent: ToolConfig;
  display: DisplaySettings;
  pathAdditions?: string[];
}

export type FileState =
  | { status: "ok" }
  | { status: "missing" }
  | { status: "recovered"; backupPath: string }
  | { status: "lockedNewerVersion"; found: number };

export interface ConfigStatus {
  configDir: string;
  settings: FileState;
}
