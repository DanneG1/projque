import { create } from "zustand";
import { api } from "../api/ipc";
import { parseAppError, userMessage, type AppError } from "../api/errors";
import type {
  ConfigStatus,
  ProjectPatch,
  ProjectView,
  ScanResult,
  Settings,
  Theme,
} from "../models";

export type Route =
  | { page: "list" }
  | { page: "settings" }
  | { page: "import" };

export interface Toast {
  id: number;
  title: string;
  detail?: string;
}

interface AppStore {
  route: Route;
  settings: Settings | null;
  configStatus: ConfigStatus | null;
  projects: ProjectView[];
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
  setRoute: (route: Route) => void;
  setDisplay: (patch: { showArchived?: boolean; theme?: Theme }) => Promise<void>;
  openConfigDir: () => Promise<void>;
  reportError: (err: unknown) => AppError;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;

export const useAppStore = create<AppStore>((set, get) => ({
  route: { page: "list" },
  settings: null,
  configStatus: null,
  projects: [],
  toasts: [],
  initialized: false,
  scan: { result: null, selected: new Set<string>(), scanning: false, importing: false },

  init: async () => {
    try {
      const [settings, configStatus, projects] = await Promise.all([
        api.settingsGet(),
        api.appConfigStatus(),
        api.projectsList(),
      ]);
      set({ settings, configStatus, projects, initialized: true });
    } catch (err) {
      get().reportError(err);
      set({ initialized: true });
    }
  },

  addProjectManual: async () => {
    try {
      const added = await api.projectAddManual();
      if (added) set((s) => ({ projects: [...s.projects, added] }));
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
      set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
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

  reportError: (err) => {
    const appError = parseAppError(err);
    const msg = userMessage(appError);
    const toast: Toast = { id: ++toastSeq, ...msg };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    setTimeout(() => get().dismissToast(toast.id), 6000);
    return appError;
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
