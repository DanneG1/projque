export type Theme = "system" | "light" | "dark";

/** Visual style on top of light/dark. Mirrors `STYLES` in settings/mod.rs. */
export type Style = "classic" | "glass" | "flat" | "brutalist" | "neumorphic" | "terminal";
export const STYLES: Style[] = ["classic", "glass", "flat", "brutalist", "neumorphic", "terminal"];

export interface ToolConfig {
  type: string;
  command?: string;
  args?: string[];
}

export interface DisplaySettings {
  showArchived: boolean;
  theme: Theme;
  /** "system" | "en" | "sv" */
  language: string;
  style: Style;
}

export interface NotificationSettings {
  /** System (OS) notifications on/off. Toasts and the inbox are always on. */
  system: boolean;
  quietHours: boolean;
  /** Hours 0-23, local time; quietFrom > quietTo wraps past midnight. */
  quietFrom: number;
  quietTo: number;
}

export interface SavedPrompt {
  id: string;
  label: string;
  /** `{input}` asks for a description when the prompt is used. */
  prompt: string;
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
  prompts?: SavedPrompt[];
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
