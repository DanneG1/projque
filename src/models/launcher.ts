export type LaunchAction =
  | "openFolder"
  | "openEditor"
  | "openTerminal"
  | "openRepository"
  | "openAgent";

export interface CatalogEntry {
  kind: string;
  label: string;
  program: string;
  installed: boolean;
}

export interface LauncherCatalog {
  platform: string;
  editors: CatalogEntry[];
  terminals: CatalogEntry[];
  agents: CatalogEntry[];
}
