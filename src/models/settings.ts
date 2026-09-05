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

export interface NotificationSettings {
  /** System (OS) notifications on/off. Toasts and the inbox are always on. */
  system: boolean;
  quietHours: boolean;
  /** Hours 0-23, local time; quietFrom > quietTo wraps past midnight. */
  quietFrom: number;
  quietTo: number;
}

export interface Settings {
  configVersion: number;
  projectRoots: string[];
  scanDepth: number;
  editor: ToolConfig;
  terminal: ToolConfig;
  agent: ToolConfig;
  display: DisplaySettings;
  notifications: NotificationSettings;
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
  projects: FileState;
}
