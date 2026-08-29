import { create } from "zustand";
import { api } from "../api/ipc";
import { parseAppError, userMessage, type AppError } from "../api/errors";
import type {
  ConfigStatus,
  ProjectStatus,
  GitInfo,
  LaunchAction,
  LauncherCatalog,
  ProjectPatch,
  ProjectView,
  ScanResult,
  Settings,
  Theme,
} from "../models";

export type Route =
  | { page: "list" }
  | { page: "settings" }
  | { page: "import" }
  | { page: "detail"; projectId: string };

export type ProjectFilter = "all" | "favorites" | ProjectStatus;

export interface Toast {
  id: number;
  title: string;
  detail?: string;
  variant: "error" | "info";
}

interface AppStore {
  route: Route;
  settings: Settings | null;
  configStatus: ConfigStatus | null;
  catalog: LauncherCatalog | null;
  projects: ProjectView[];
  git: Record<string, GitInfo>;
  gitAvailable: boolean;
  filter: ProjectFilter;
  query: string;
  gitBusy: Record<string, boolean>;
  toasts: Toast[];
  initialized: boolean;
  scan: {
    result: ScanResult | null;
    selected: Set<string>;
    scanning: boolean;
    importing: boolean;
  };

  init: () => Promise<void>;
  addProjectManual: () => Promise<void>;
  updateProject: (id: string, patch: ProjectPatch) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  relocateProject: (id: string) => Promise<void>;
  addProjectRoot: () => Promise<boolean>;
  removeProjectRoot: (index: number) => Promise<void>;
  setScanDepth: (depth: number) => Promise<void>;
  runScan: () => Promise<void>;
  toggleCandidate: (id: string) => void;
  setAllCandidates: (selected: boolean) => void;
  importSelected: () => Promise<void>;
  setTool: (tool: "editor" | "terminal" | "agent", kind: string) => Promise<void>;
  launch: (id: string, action: LaunchAction) => Promise<void>;
  openExternalUrl: (url: string) => Promise<void>;
  refreshGit: (opts?: { force?: boolean }) => Promise<void>;
  setFilter: (filter: ProjectFilter) => void;
  setQuery: (query: string) => void;
  fetchRemote: (id: string) => Promise<void>;
  pullFf: (id: string) => Promise<void>;
  switchBranch: (id: string, branch: string) => Promise<boolean>;
  setRoute: (route: Route) => void;
  setDisplay: (patch: { showArchived?: boolean; theme?: Theme }) => Promise<void>;
  openConfigDir: () => Promise<void>;
  reportError: (err: unknown) => AppError;
  notify: (title: string, detail?: string) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;

export const useAppStore = create<AppStore>((set, get) => ({
  route: { page: "list" },
  settings: null,
  configStatus: null,
  catalog: null,
  projects: [],
  git: {},
  gitAvailable: true,
  filter: "all",
  query: "",
  gitBusy: {},
  toasts: [],
  initialized: false,
  scan: { result: null, selected: new Set<string>(), scanning: false, importing: false },

  init: async () => {
    try {
      const [settings, configStatus, projects, catalog] = await Promise.all([
        api.settingsGet(),
        api.appConfigStatus(),
        api.projectsList(),
        api.launcherCatalog(),
      ]);
      set({ settings, configStatus, projects, catalog, initialized: true });
      void get().refreshGit();
    } catch (err) {
      get().reportError(err);
      set({ initialized: true });
    }
  },

  addProjectManual: async () => {
    try {
      const added = await api.projectAddManual();
      if (added) {
        set((s) => ({ projects: [...s.projects, added] }));
        void get().refreshGit();
      }
    } catch (err) {
      get().reportError(err);
    }
  },

  updateProject: async (id, patch) => {
    try {
      const updated = await api.projectUpdate(id, patch);
      set((s) => ({ projects: s.projects.map((p) => (p.id === id ? updated : p)) }));
    } catch (err) {
      get().reportError(err);
    }
  },

  removeProject: async (id) => {
    try {
      await api.projectRemove(id);
      set((s) => ({
        projects: s.projects.filter((p) => p.id !== id),
        route:
          s.route.page === "detail" && s.route.projectId === id
            ? { page: "list" }
            : s.route,
      }));
    } catch (err) {
      get().reportError(err);
    }
  },

  relocateProject: async (id) => {
    try {
      const updated = await api.projectRelocate(id);
      if (updated) {
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? updated : p)) }));
      }
    } catch (err) {
      get().reportError(err);
    }
  },

  setRoute: (route) => set({ route }),

  setDisplay: async (patch) => {
    try {
      const settings = await api.settingsSetDisplay(patch);
      set({ settings });
    } catch (err) {
      get().reportError(err);
    }
  },

  openConfigDir: async () => {
    try {
      await api.appOpenConfigDir();
    } catch (err) {
      get().reportError(err);
    }
  },

  addProjectRoot: async () => {
    try {
      const { settings, added } = await api.settingsAddProjectRoot();
      set({ settings });
      return added;
    } catch (err) {
      get().reportError(err);
      return false;
    }
  },

  removeProjectRoot: async (index) => {
    try {
      const settings = await api.settingsRemoveProjectRoot(index);
      set({ settings });
    } catch (err) {
      get().reportError(err);
    }
  },

  setScanDepth: async (depth) => {
    try {
      const settings = await api.settingsSetScanDepth(depth);
      set({ settings });
    } catch (err) {
      get().reportError(err);
    }
  },

  runScan: async () => {
    set((s) => ({ scan: { ...s.scan, scanning: true } }));
    try {
      const result = await api.discoveryScan();
      const selected = new Set(
        result.candidates
          .filter((c) => !c.alreadyImported)
          .map((c) => c.candidateId),
      );
      set({ scan: { result, selected, scanning: false, importing: false } });
    } catch (err) {
      get().reportError(err);
      set((s) => ({ scan: { ...s.scan, scanning: false } }));
    }
  },

  toggleCandidate: (id) => {
    set((s) => {
      const selected = new Set(s.scan.selected);
      if (selected.has(id)) {
        selected.delete(id);
      } else {
        selected.add(id);
      }
      return { scan: { ...s.scan, selected } };
    });
  },

  setAllCandidates: (allSelected) => {
    set((s) => {
      const selected = allSelected
        ? new Set(
            (s.scan.result?.candidates ?? [])
              .filter((c) => !c.alreadyImported)
              .map((c) => c.candidateId),
          )
        : new Set<string>();
      return { scan: { ...s.scan, selected } };
    });
  },

  importSelected: async () => {
    const ids = [...get().scan.selected];
    if (ids.length === 0) return;
    set((s) => ({ scan: { ...s.scan, importing: true } }));
    try {
      const result = await api.discoveryImport(ids);
      set((s) => ({
        projects: [...s.projects, ...result.imported],
        scan: { result: null, selected: new Set<string>(), scanning: false, importing: false },
        route: { page: "list" },
      }));
      void get().refreshGit();
      if (result.failed.length > 0) {
        get().reportError({
          kind: "io",
          detail: `${result.failed.length} project(s) could not be imported.`,
        });
      }
    } catch (err) {
      get().reportError(err);
      set((s) => ({ scan: { ...s.scan, importing: false } }));
    }
  },

  setTool: async (tool, kind) => {
    try {
      const call =
        tool === "editor"
          ? api.settingsSetEditor
          : tool === "terminal"
            ? api.settingsSetTerminal
            : api.settingsSetAgent;
      const settings = await call(kind);
      set({ settings });
    } catch (err) {
      get().reportError(err);
    }
  },

  launch: async (id, action) => {
    try {
      await api.projectLaunch(id, action);
    } catch (err) {
      get().reportError(err);
    }
  },

  openExternalUrl: async (url) => {
    try {
      await api.openExternalUrl(url);
    } catch (err) {
      get().reportError(err);
    }
  },

  refreshGit: async (opts) => {
    try {
      const availability = await api.gitAvailability();
      set({ gitAvailable: availability.available });
      if (!availability.available) return;
      const ids = get()
        .projects.filter((p) => p.pathExists && p.isGitRepo)
        .map((p) => p.id);
      if (ids.length === 0) return;
      const infos = await api.gitInfoMany(ids, opts?.force ?? false);
      set((s) => {
        const git = { ...s.git };
        for (const info of infos) git[info.projectId] = info;
        return { git };
      });
    } catch (err) {
      get().reportError(err);
    }
  },

  setFilter: (filter) => set({ filter }),
  setQuery: (query) => set({ query }),

  fetchRemote: async (id) => {
    set((s) => ({ gitBusy: { ...s.gitBusy, [id]: true } }));
    try {
      const before = get().git[id]?.behind ?? null;
      const info = await api.gitFetch(id);
      set((s) => ({ git: { ...s.git, [id]: info } }));
      const behind = info.behind ?? 0;
      get().notify(
        behind > 0
          ? `Fetched — ${behind} commit${behind === 1 ? "" : "s"} behind`
          : before === null || behind === 0
            ? "Fetched — up to date"
            : "Fetched",
      );
    } catch (err) {
      get().reportError(err);
    } finally {
      set((s) => ({ gitBusy: { ...s.gitBusy, [id]: false } }));
    }
  },

  pullFf: async (id) => {
    set((s) => ({ gitBusy: { ...s.gitBusy, [id]: true } }));
    try {
      const before = get().git[id]?.behind ?? 0;
      const info = await api.gitPullFf(id);
      set((s) => ({ git: { ...s.git, [id]: info } }));
      get().notify(
        before > 0
          ? `Pulled ${before} commit${before === 1 ? "" : "s"}`
          : "Already up to date",
      );
    } catch (err) {
      get().reportError(err);
    } finally {
      set((s) => ({ gitBusy: { ...s.gitBusy, [id]: false } }));
    }
  },

  switchBranch: async (id, branch) => {
    set((s) => ({ gitBusy: { ...s.gitBusy, [id]: true } }));
    try {
      const info = await api.gitSwitch(id, branch);
      set((s) => ({ git: { ...s.git, [id]: info } }));
      get().notify(`Switched to ${branch}`);
      return true;
    } catch (err) {
      get().reportError(err);
      return false;
    } finally {
      set((s) => ({ gitBusy: { ...s.gitBusy, [id]: false } }));
    }
  },

  reportError: (err) => {
    const appError = parseAppError(err);
    const msg = userMessage(appError);
    const toast: Toast = { id: ++toastSeq, variant: "error", ...msg };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    setTimeout(() => get().dismissToast(toast.id), 6000);
    return appError;
  },

  notify: (title, detail) => {
    const toast: Toast = { id: ++toastSeq, variant: "info", title, detail };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    setTimeout(() => get().dismissToast(toast.id), 4000);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
