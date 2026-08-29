import { create } from "zustand";
import { api } from "../api/ipc";
import { parseAppError, userMessage, type AppError } from "../api/errors";
import type { ConfigStatus, ProjectPatch, ProjectView, Settings, Theme } from "../models";

export type Route =
  | { page: "list" }
  | { page: "settings" };

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

  init: () => Promise<void>;
  addProjectManual: () => Promise<void>;
  updateProject: (id: string, patch: ProjectPatch) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  relocateProject: (id: string) => Promise<void>;
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
