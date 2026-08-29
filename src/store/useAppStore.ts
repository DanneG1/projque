import { create } from "zustand";
import { api } from "../api/ipc";
import { parseAppError, userMessage, type AppError } from "../api/errors";
import type { ConfigStatus, Settings, Theme } from "../models";

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
  toasts: Toast[];
  initialized: boolean;

  init: () => Promise<void>;
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
  toasts: [],
  initialized: false,

  init: async () => {
    try {
      const [settings, configStatus] = await Promise.all([
        api.settingsGet(),
        api.appConfigStatus(),
      ]);
      set({ settings, configStatus, initialized: true });
    } catch (err) {
      get().reportError(err);
      set({ initialized: true });
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
