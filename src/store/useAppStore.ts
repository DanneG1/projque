import { create } from "zustand";
import { api } from "../api/ipc";
import { parseAppError, userMessage, type AppError } from "../api/errors";
import { computeActivity } from "../utils/activity";
import { collectCelebrations } from "../utils/celebrate";
import { CLEANUP_PROMPT } from "../utils/prompts";
import type {
  ActivitySummary,
  AgentSessionView,
  AuditReport,
  ConfigStatus,
  ProjectStatus,
  GitInfo,
  LaunchAction,
  LauncherCatalog,
  ProjectPatch,
  ProjectView,
  ScanResult,
  SessionPulse,
  Settings,
  Theme,
} from "../models";

export type Route =
  | { page: "list" }
  | { page: "settings" }
  | { page: "import" }
  | { page: "detail"; projectId: string }
  | { page: "git"; projectId?: string }
  | { page: "progress" }
  | { page: "agents"; sessionId?: string };

export type ProjectFilter = "all" | "favorites" | ProjectStatus;

export interface Toast {
  id: number;
  title: string;
  detail?: string;
  variant: "error" | "info" | "attention" | "success";
  /** Clicking the toast goes somewhere (and dismisses it). */
  onClick?: () => void;
}

interface NotifyOptions {
  variant?: Toast["variant"];
  onClick?: () => void;
  /** Milliseconds before auto-dismiss (default 4000). */
  ttl?: number;
}

/** One "check all projects" pass. Results land in `audits`; this tracks
 *  progress and remembers which projects were clean before any fix, so the
 *  commit offer never sweeps up unrelated uncommitted work. */
export interface AuditSweep {
  status: "idle" | "running" | "done";
  /** Projects included, in check order. */
  ids: string[];
  done: number;
  /** Project currently being checked. */
  current: string | null;
  errors: Record<string, string>;
  /** Working tree was clean when the sweep started. */
  cleanBefore: Record<string, boolean>;
  /** Projects an "Update safely" run was started for during this sweep. */
  fixed: Record<string, boolean>;
  /** Projects whose update was committed from the sweep summary. */
  committed: Record<string, boolean>;
  cancel: boolean;
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
  sessions: AgentSessionView[];
  /** Liveness per running session, refreshed by the backend ticker. */
  pulses: Record<string, SessionPulse>;
  /** Labeled in-flight work per project that is not a session (e.g.
   *  "Checking packages"); drives the activity bars. */
  busy: Record<string, string>;
  /** Last package check per project this run (the stamp lives on the project). */
  audits: Record<string, AuditReport>;
  sweep: AuditSweep;
  /** Sessions shown together in the split view (order = pane order, max 4). */
  gridIds: string[];
  /** Local activity data for streaks/progress, briefly cached. */
  activity: { summary: ActivitySummary; fetchedAt: number } | null;
  /** Set when something was just celebrated - the Progress page shows
   *  confetti while this is fresh. */
  celebratedAt: number | null;
  quitPrompt: number | null;
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
  /** Commit everything with a message. Resolves true on success. */
  commitAll: (id: string, message: string, allowSecrets?: boolean) => Promise<boolean>;
  /** Restore an earlier version (commit or snapshot) as a new commit. */
  restoreVersion: (id: string, hash: string) => Promise<boolean>;
  pushBranch: (id: string) => Promise<boolean>;
  createBranch: (id: string, name: string) => Promise<boolean>;
  deleteBranch: (id: string, branch: string) => Promise<boolean>;
  /** Merge the CURRENT branch into `target`. "merged" | "conflicts" | null (error). */
  mergeInto: (id: string, target: string) => Promise<"merged" | "conflicts" | null>;
  mergeAbort: (id: string) => Promise<boolean>;
  mergeComplete: (id: string) => Promise<boolean>;
  loadActivity: (opts?: { force?: boolean }) => Promise<void>;
  refreshSessions: () => Promise<void>;
  startAgentSession: (
    projectId: string,
    agentKind?: string,
    initialPrompt?: string,
  ) => Promise<void>;
  /** Start one agent session per roleplay tester (max 4) and show them
   *  side by side in the grid view. */
  startRoleplayTest: (
    projectId: string,
    testers: { label: string; prompt: string }[],
  ) => Promise<void>;
  /** Stamp the tidy-up baseline (now, HEAD) and start the cleanup agent. */
  startCleanup: (projectId: string) => Promise<void>;
  newProjectOpen: boolean;
  setNewProjectOpen: (open: boolean) => void;
  /** Prefill for the new-project dialog (e.g. starting from a general idea). */
  newProjectSeed: string | null;
  setNewProjectSeed: (seed: string | null) => void;
  ideaOpen: boolean;
  setIdeaOpen: (open: boolean) => void;
  /** Bumped whenever an idea is saved, so open views can refetch IDEAS.md. */
  ideasVersion: number;
  /** projectId null = general idea (saved app-wide, not in any project). */
  captureIdea: (projectId: string | null, text: string) => Promise<boolean>;
  startRunSession: (
    projectId: string,
    targetId: string,
    opts?: { navigate?: boolean },
  ) => Promise<void>;
  openSessionUrl: (sessionId: string) => Promise<void>;
  sessionUrlDetected: (sessionId: string, url: string) => void;
  sessionErrorDetected: (sessionId: string) => void;
  /** Commit (when a message is given) then ff-only pull and push, as one action. */
  commitAndPush: (id: string, message: string | null, allowSecrets?: boolean) => Promise<boolean>;
  fixIgnores: (id: string, kinds: string[]) => Promise<boolean>;
  /** Create a private GitHub repository for a project with no remote and push. */
  backupToGithub: (id: string) => Promise<boolean>;
  /** Undo everything an agent session did: restore its pre-session point,
   *  removing files it created (the current state is snapshotted first). */
  undoSession: (projectId: string, undoHash: string) => Promise<boolean>;
  sessionAttention: (view: AgentSessionView) => void;
  setPulses: (pulses: SessionPulse[]) => void;
  setBusy: (projectId: string, label: string | null) => void;
  /** Run the package vulnerability check (explicit click - contacts the registry). */
  runAudit: (projectId: string, opts?: { quiet?: boolean }) => Promise<AuditReport | null>;
  /** Check every auditable project in turn (explicit click, one at a time). */
  auditAll: () => Promise<void>;
  cancelSweep: () => void;
  dismissSweep: () => void;
  /** Start "Update safely" for a project found in the sweep, staying on this page. */
  sweepFix: (projectId: string) => Promise<void>;
  /** Commit a package update made by the sweep with a fixed message. */
  sweepCommit: (projectId: string) => Promise<boolean>;
  /** Start the project's test command as a run session, if it has one. */
  runTests: (projectId: string) => Promise<void>;
  clearSessionAttention: (sessionId: string) => void;
  setVisibleSessions: (sessionIds: string[]) => void;
  toggleGridSession: (sessionId: string) => void;
  killSession: (sessionId: string) => Promise<void>;
  removeSession: (sessionId: string) => Promise<void>;
  sessionExited: (view: AgentSessionView) => void;
  setQuitPrompt: (count: number | null) => void;
  confirmQuit: () => Promise<void>;
  setRoute: (route: Route) => void;
  setDisplay: (patch: { showArchived?: boolean; theme?: Theme }) => Promise<void>;
  openConfigDir: () => Promise<void>;
  reportError: (err: unknown) => AppError;
  notify: (title: string, detail?: string, opts?: NotifyOptions) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;

function emptySweep(): AuditSweep {
  return {
    status: "idle",
    ids: [],
    done: 0,
    current: null,
    errors: {},
    cleanBefore: {},
    fixed: {},
    committed: {},
    cancel: false,
  };
}

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
  sessions: [],
  pulses: {},
  busy: {},
  audits: {},
  sweep: emptySweep(),
  gridIds: [],
  activity: null,
  celebratedAt: null,
  quitPrompt: null,
  newProjectOpen: false,
  newProjectSeed: null,
  ideaOpen: false,
  ideasVersion: 0,
  toasts: [],
  initialized: false,
  scan: { result: null, selected: new Set<string>(), scanning: false, importing: false },

  init: async () => {
    try {
      const [settings, configStatus, projects, catalog, sessions] = await Promise.all([
        api.settingsGet(),
        api.appConfigStatus(),
        api.projectsList(),
        api.launcherCatalog(),
        api.agentSessionsList(),
      ]);
      set({ settings, configStatus, projects, catalog, sessions, initialized: true });
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
          ? `Fetched - ${behind} commit${behind === 1 ? "" : "s"} behind`
          : before === null || behind === 0
            ? "Fetched - up to date"
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

  commitAll: async (id, message, allowSecrets = false) => {
    set((s) => ({ gitBusy: { ...s.gitBusy, [id]: true } }));
    try {
      const info = await api.gitCommit(id, message, allowSecrets);
      // A fresh commit changes streaks/points - recompute on next look.
      set((s) => ({ git: { ...s.git, [id]: info }, activity: null }));
      get().notify("Committed", "Your work is saved in the project history.");
      return true;
    } catch (err) {
      get().reportError(err);
      return false;
    } finally {
      set((s) => ({ gitBusy: { ...s.gitBusy, [id]: false } }));
    }
  },

  restoreVersion: async (id, hash) => {
    set((s) => ({ gitBusy: { ...s.gitBusy, [id]: true } }));
    try {
      const info = await api.gitRestore(id, hash);
      set((s) => ({ git: { ...s.git, [id]: info } }));
      get().notify(
        "Version restored",
        "Your previous state was backed up automatically first.",
      );
      return true;
    } catch (err) {
      get().reportError(err);
      return false;
    } finally {
      set((s) => ({ gitBusy: { ...s.gitBusy, [id]: false } }));
    }
  },


  pushBranch: async (id) => {
    set((s) => ({ gitBusy: { ...s.gitBusy, [id]: true } }));
    try {
      const info = await api.gitPush(id);
      set((s) => ({ git: { ...s.git, [id]: info } }));
      get().notify("Pushed", `${info.branch ?? "branch"} is up to date on origin.`);
      return true;
    } catch (err) {
      get().reportError(err);
      return false;
    } finally {
      set((s) => ({ gitBusy: { ...s.gitBusy, [id]: false } }));
    }
  },

  createBranch: async (id, name) => {
    set((s) => ({ gitBusy: { ...s.gitBusy, [id]: true } }));
    try {
      const info = await api.gitBranchCreate(id, name);
      set((s) => ({ git: { ...s.git, [id]: info } }));
      get().notify(`Created and switched to ${name}`);
      return true;
    } catch (err) {
      get().reportError(err);
      return false;
    } finally {
      set((s) => ({ gitBusy: { ...s.gitBusy, [id]: false } }));
    }
  },

  deleteBranch: async (id, branch) => {
    set((s) => ({ gitBusy: { ...s.gitBusy, [id]: true } }));
    try {
      const info = await api.gitBranchDelete(id, branch);
      set((s) => ({ git: { ...s.git, [id]: info } }));
      get().notify(`Deleted branch ${branch}`);
      return true;
    } catch (err) {
      get().reportError(err);
      return false;
    } finally {
      set((s) => ({ gitBusy: { ...s.gitBusy, [id]: false } }));
    }
  },

  mergeInto: async (id, target) => {
    const source = get().git[id]?.branch ?? "current branch";
    set((s) => ({ gitBusy: { ...s.gitBusy, [id]: true } }));
    try {
      const outcome = await api.gitMergeInto(id, target);
      await get().refreshGit({ force: true });
      if (outcome.status === "merged") {
        set({ activity: null });
        get().notify(`Merged ${source} into ${target}`, `You are now on ${target}.`);
        return "merged";
      }
      return "conflicts";
    } catch (err) {
      get().reportError(err);
      return null;
    } finally {
      set((s) => ({ gitBusy: { ...s.gitBusy, [id]: false } }));
    }
  },

  mergeAbort: async (id) => {
    set((s) => ({ gitBusy: { ...s.gitBusy, [id]: true } }));
    try {
      const info = await api.gitMergeAbort(id);
      set((s) => ({ git: { ...s.git, [id]: info } }));
      get().notify("Merge aborted", "Everything is back to the state before the merge.");
      return true;
    } catch (err) {
      get().reportError(err);
      return false;
    } finally {
      set((s) => ({ gitBusy: { ...s.gitBusy, [id]: false } }));
    }
  },

  mergeComplete: async (id) => {
    set((s) => ({ gitBusy: { ...s.gitBusy, [id]: true } }));
    try {
      const info = await api.gitMergeComplete(id);
      set((s) => ({ git: { ...s.git, [id]: info } }));
      get().notify("Merge completed");
      return true;
    } catch (err) {
      get().reportError(err);
      return false;
    } finally {
      set((s) => ({ gitBusy: { ...s.gitBusy, [id]: false } }));
    }
  },

  loadActivity: async (opts) => {
    const cached = get().activity;
    if (!opts?.force && cached && Date.now() - cached.fetchedAt < 60_000) return;
    try {
      const summary = await api.activitySummary();
      set({ activity: { summary, fetchedAt: Date.now() } });
      // Celebrate anything genuinely new (achievements, level-ups, records).
      const done = get().projects.filter((p) => p.status === "done").length;
      const live = get().projects.filter((p) => p.productionUrl).length;
      const messages = collectCelebrations(
        computeActivity(summary, { doneProjects: done, liveProjects: live }),
      );
      if (messages.length > 0) {
        set({ celebratedAt: Date.now() });
        for (const m of messages) get().notify(m.title, m.detail);
      }
    } catch {
      // Progress is decorative - never toast about it.
    }
  },

  refreshSessions: async () => {
    try {
      const sessions = await api.agentSessionsList();
      set({ sessions });
    } catch (err) {
      get().reportError(err);
    }
  },

  setNewProjectOpen: (open) => set({ newProjectOpen: open }),

  setNewProjectSeed: (seed) => set({ newProjectSeed: seed }),

  setIdeaOpen: (open) => set({ ideaOpen: open }),

  captureIdea: async (projectId, text) => {
    try {
      const fileName = await api.ideaCapture(projectId, text);
      const project = projectId
        ? get().projects.find((p) => p.id === projectId)
        : null;
      get().notify(
        `Idea saved`,
        projectId ? `${project?.name ?? projectId}/${fileName}` : "General ideas",
      );
      set((s) => ({
        ideasVersion: s.ideasVersion + 1,
        projects: projectId
          ? s.projects.map((p) => (p.id === projectId ? { ...p, hasIdeas: true } : p))
          : s.projects,
      }));
      return true;
    } catch (err) {
      get().reportError(err);
      return false;
    }
  },

  startAgentSession: async (projectId, agentKind, initialPrompt) => {
    try {
      // Start at a sensible default size; the terminal's fit() corrects it
      // immediately after mount. (Avoids importing the terminal module here,
      // which would recreate a circular chunk dependency.)
      const session = await api.agentSessionStart(
        projectId,
        agentKind ?? null,
        30,
        100,
        initialPrompt,
      );
      set((s) => ({
        sessions: [...s.sessions, session],
        route: { page: "agents", sessionId: session.sessionId },
      }));
    } catch (err) {
      get().reportError(err);
    }
  },

  startRoleplayTest: async (projectId, testers) => {
    // Sessions start one at a time (each takes a working-tree snapshot);
    // whatever started successfully still goes into the grid.
    const started: AgentSessionView[] = [];
    for (const t of testers.slice(0, 4)) {
      try {
        started.push(
          await api.agentSessionStart(projectId, null, 30, 100, t.prompt, t.label),
        );
      } catch (err) {
        get().reportError(err);
      }
    }
    if (started.length === 0) return;
    set((s) => ({
      sessions: [...s.sessions, ...started],
      gridIds: started.length >= 2 ? started.map((v) => v.sessionId) : [],
      route: { page: "agents", sessionId: started[0].sessionId },
    }));
  },

  startCleanup: async (projectId) => {
    try {
      const updated = await api.projectMarkCleanup(projectId);
      set((s) => ({ projects: s.projects.map((p) => (p.id === updated.id ? updated : p)) }));
    } catch (err) {
      get().reportError(err);
    }
    await get().startAgentSession(projectId, undefined, CLEANUP_PROMPT);
  },

  startRunSession: async (projectId, targetId, opts) => {
    try {
      const session = await api.runSessionStart(projectId, targetId, 30, 100);
      set((s) => ({
        sessions: [...s.sessions, session],
        route:
          opts?.navigate === false ? s.route : { page: "agents", sessionId: session.sessionId },
      }));
    } catch (err) {
      get().reportError(err);
    }
  },

  openSessionUrl: async (sessionId) => {
    try {
      await api.runSessionOpenUrl(sessionId);
    } catch (err) {
      get().reportError(err);
    }
  },

  sessionErrorDetected: (sessionId) => {
    set((s) => ({
      sessions: s.sessions.map((v) =>
        v.sessionId === sessionId ? { ...v, errorDetected: true } : v,
      ),
    }));
  },

  commitAndPush: async (id, message, allowSecrets = false) => {
    set((s) => ({ gitBusy: { ...s.gitBusy, [id]: true } }));
    try {
      const [outcome, info] = await api.gitSync(id, message, allowSecrets);
      set((s) => ({ git: { ...s.git, [id]: info }, activity: outcome.committed ? null : s.activity }));
      const parts: string[] = [];
      if (outcome.committed) parts.push("committed");
      if (outcome.pulled > 0) parts.push(`pulled ${outcome.pulled} newer commit${outcome.pulled === 1 ? "" : "s"}`);
      parts.push("pushed");
      get().notify(
        outcome.committed ? "Committed & pushed" : "Pushed",
        `${parts.join(", ")} - ${info.branch ?? "your branch"} is up to date online.`,
      );
      return true;
    } catch (err) {
      get().reportError(err);
      return false;
    } finally {
      set((s) => ({ gitBusy: { ...s.gitBusy, [id]: false } }));
    }
  },

  fixIgnores: async (id, kinds) => {
    set((s) => ({ gitBusy: { ...s.gitBusy, [id]: true } }));
    try {
      const info = await api.gitIgnoreFix(id, kinds);
      set((s) => ({ git: { ...s.git, [id]: info } }));
      get().notify("Updated .gitignore", "Those files will stay out of your commits.");
      return true;
    } catch (err) {
      get().reportError(err);
      return false;
    } finally {
      set((s) => ({ gitBusy: { ...s.gitBusy, [id]: false } }));
    }
  },

  backupToGithub: async (id) => {
    set((s) => ({ gitBusy: { ...s.gitBusy, [id]: true } }));
    try {
      const [url, info] = await api.githubBackup(id);
      set((s) => ({ git: { ...s.git, [id]: info } }));
      get().notify("Backed up to GitHub", `Private repository created${url ? ` at ${url}` : ""}.`, {
        variant: "success",
        ttl: 8000,
        onClick: url ? () => void get().openExternalUrl(url) : undefined,
      });
      return true;
    } catch (err) {
      get().reportError(err);
      return false;
    } finally {
      set((s) => ({ gitBusy: { ...s.gitBusy, [id]: false } }));
    }
  },

  undoSession: async (projectId, undoHash) => {
    set((s) => ({ gitBusy: { ...s.gitBusy, [projectId]: true } }));
    try {
      const info = await api.gitRestore(projectId, undoHash, true);
      set((s) => ({ git: { ...s.git, [projectId]: info } }));
      get().notify(
        "Session undone",
        "Your files are back to how they were before the agent started. The undone state was backed up first.",
      );
      return true;
    } catch (err) {
      get().reportError(err);
      return false;
    } finally {
      set((s) => ({ gitBusy: { ...s.gitBusy, [projectId]: false } }));
    }
  },

  sessionUrlDetected: (sessionId, url) => {
    set((s) => ({
      sessions: s.sessions.map((v) =>
        v.sessionId === sessionId ? { ...v, detectedUrl: url } : v,
      ),
    }));
  },

  sessionAttention: (view) => {
    set((s) => ({
      sessions: s.sessions.map((v) => (v.sessionId === view.sessionId ? view : v)),
    }));
    // The backend only raises this when the user is not looking at the
    // session, so an in-app pointer to it is always useful.
    get().notify(`${view.agentLabel} is waiting for you`, view.projectLabel, {
      variant: "attention",
      ttl: 8000,
      onClick: () => get().setRoute({ page: "agents", sessionId: view.sessionId }),
    });
  },

  setPulses: (pulses) => {
    const next: Record<string, SessionPulse> = {};
    for (const p of pulses) next[p.sessionId] = p;
    set({ pulses: next });
  },

  setBusy: (projectId, label) => {
    set((s) => {
      const busy = { ...s.busy };
      if (label) busy[projectId] = label;
      else delete busy[projectId];
      return { busy };
    });
  },

  runTests: async (projectId) => {
    try {
      const target = await api.projectTestTarget(projectId);
      if (!target) {
        get().notify("No test command found", "Ask the agent to add tests to this project.", {
          onClick: () => get().setRoute({ page: "detail", projectId }),
        });
        return;
      }
      await get().startRunSession(projectId, target.targetId);
    } catch (err) {
      get().reportError(err);
    }
  },

  runAudit: async (projectId, opts) => {
    if (get().busy[projectId]) return null;
    const project = get().projects.find((p) => p.id === projectId);
    const name = project?.name ?? "project";
    get().setBusy(projectId, "Checking packages");
    try {
      const [report, updated] = await api.projectAuditRun(projectId);
      set((s) => ({
        audits: { ...s.audits, [projectId]: report },
        projects: s.projects.map((p) => (p.id === updated.id ? updated : p)),
      }));
      if (opts?.quiet) return report;
      const goto = () => get().setRoute({ page: "detail", projectId });
      if (report.total === 0) {
        get().notify(`${name}: no known vulnerabilities`, `${report.dependencies} packages checked.`, {
          variant: "success",
          onClick: goto,
        });
      } else {
        get().notify(
          `${name}: ${report.total} known ${report.total === 1 ? "vulnerability" : "vulnerabilities"}`,
          report.fixable > 0
            ? `${report.fixable} can be updated safely - open the project to update.`
            : "Open the project to see what to do.",
          { variant: "attention", ttl: 8000, onClick: goto },
        );
      }
      return report;
    } catch (err) {
      if (opts?.quiet) throw err;
      get().reportError(err);
      return null;
    } finally {
      get().setBusy(projectId, null);
    }
  },

  auditAll: async () => {
    if (get().sweep.status === "running") return;
    const ids = get()
      .projects.filter((p) => p.pathExists && p.auditable && p.status !== "archived")
      .map((p) => p.id);
    if (ids.length === 0) {
      get().notify("Nothing to check", "No project here uses a package manager the check supports.");
      return;
    }
    // Fresh git state first: the commit offer later depends on knowing
    // which projects were clean before anything was updated.
    await get().refreshGit({ force: true });
    const cleanBefore: Record<string, boolean> = {};
    for (const id of ids) cleanBefore[id] = !(get().git[id]?.dirty ?? true);
    set({ sweep: { ...emptySweep(), status: "running", ids, cleanBefore } });

    for (const id of ids) {
      if (get().sweep.cancel) break;
      set((s) => ({ sweep: { ...s.sweep, current: id } }));
      try {
        await get().runAudit(id, { quiet: true });
      } catch (err) {
        const message = userMessage(parseAppError(err));
        set((s) => ({
          sweep: { ...s.sweep, errors: { ...s.sweep.errors, [id]: message.detail ?? message.title } },
        }));
      }
      set((s) => ({ sweep: { ...s.sweep, done: s.sweep.done + 1, current: null } }));
    }

    const sweep = get().sweep;
    set({ sweep: { ...sweep, status: "done", current: null } });
    const checked = sweep.ids.slice(0, sweep.done);
    const affected = checked.filter((id) => (get().audits[id]?.total ?? 0) > 0);
    const fixable = affected.reduce((n, id) => n + (get().audits[id]?.fixable ?? 0), 0);
    if (affected.length === 0) {
      get().notify(
        "All packages look fine",
        `${checked.length} project${checked.length === 1 ? "" : "s"} checked, no known vulnerabilities.`,
        { variant: "success" },
      );
    } else {
      get().notify(
        `${affected.length} project${affected.length === 1 ? " has" : "s have"} vulnerable packages`,
        fixable > 0
          ? `${fixable} can be updated safely - see the summary on the projects page.`
          : "See the summary on the projects page.",
        { variant: "attention", ttl: 8000, onClick: () => get().setRoute({ page: "list" }) },
      );
    }
  },

  cancelSweep: () => set((s) => ({ sweep: { ...s.sweep, cancel: true } })),

  dismissSweep: () => set({ sweep: emptySweep() }),

  sweepFix: async (projectId) => {
    set((s) => ({ sweep: { ...s.sweep, fixed: { ...s.sweep.fixed, [projectId]: true } } }));
    await get().startRunSession(projectId, "audit:fix", { navigate: false });
  },

  sweepCommit: async (projectId) => {
    const ok = await get().commitAll(projectId, "Update vulnerable packages");
    if (ok) {
      set((s) => ({ sweep: { ...s.sweep, committed: { ...s.sweep.committed, [projectId]: true } } }));
    }
    return ok;
  },

  clearSessionAttention: (sessionId) => {
    set((s) => ({
      sessions: s.sessions.map((v) =>
        v.sessionId === sessionId ? { ...v, needsAttention: false } : v,
      ),
    }));
  },

  setVisibleSessions: (sessionIds) => {
    void api.sessionsSetActive(sessionIds, document.hasFocus()).catch(() => {});
    if (sessionIds.length > 0) {
      set((s) => ({
        sessions: s.sessions.map((v) =>
          sessionIds.includes(v.sessionId) ? { ...v, needsAttention: false } : v,
        ),
      }));
    }
  },

  toggleGridSession: (sessionId) => {
    const { gridIds, notify } = get();
    if (gridIds.includes(sessionId)) {
      set({ gridIds: gridIds.filter((id) => id !== sessionId) });
      return;
    }
    if (gridIds.length >= 4) {
      notify("Split view shows up to 4 sessions");
      return;
    }
    set({ gridIds: [...gridIds, sessionId] });
  },

  killSession: async (sessionId) => {
    try {
      await api.agentSessionKill(sessionId);
    } catch (err) {
      get().reportError(err);
    }
  },

  removeSession: async (sessionId) => {
    try {
      await api.agentSessionRemove(sessionId);
      set((s) => ({
        sessions: s.sessions.filter((v) => v.sessionId !== sessionId),
        gridIds: s.gridIds.filter((id) => id !== sessionId),
        route:
          s.route.page === "agents" && s.route.sessionId === sessionId
            ? { page: "agents" }
            : s.route,
      }));
    } catch (err) {
      get().reportError(err);
    }
  },

  sessionExited: (view) => {
    set((s) => ({
      sessions: s.sessions.map((v) => (v.sessionId === view.sessionId ? view : v)),
    }));
    set((s) => {
      if (!(view.sessionId in s.pulses)) return {};
      const pulses = { ...s.pulses };
      delete pulses[view.sessionId];
      return { pulses };
    });
    const code = view.status.state === "exited" ? view.status.code : null;
    const isTestRun = view.kind === "run" && view.targetId?.startsWith("test:");
    const openSession = () => get().setRoute({ page: "agents", sessionId: view.sessionId });
    const route = get().route;
    const viewingIt = route.page === "agents" && route.sessionId === view.sessionId;
    if (view.kind === "agent") {
      const dirty = get().git[view.projectId]?.dirty;
      if (!viewingIt) {
        get().notify(
          `${view.agentLabel} finished - ${view.projectLabel}`,
          code === 0 || code === null
            ? dirty
              ? "Changes are waiting for your review."
              : "Open the session to see what happened."
            : `Stopped with code ${code}. Open the session to see why.`,
          { variant: code === 0 || code === null ? "success" : "error", ttl: 8000, onClick: openSession },
        );
      }
    } else if (view.targetId === "audit:fix") {
      // `npm audit fix` exits 1 whenever vulnerabilities remain, even after
      // installing every safe update - so judge by what changed on disk,
      // not by the exit code. The refresh is also what makes the new
      // package-lock show up as something to commit.
      void get()
        .refreshGit({ force: true })
        .then(() => {
          // The sweep summary shows counts; refresh them (the Packages row
          // on the project page does the same when it is open).
          if (get().sweep.fixed[view.projectId]) {
            void get().runAudit(view.projectId, { quiet: true }).catch(() => {});
          }
          const info = get().git[view.projectId];
          const changed = info?.dirty ? info.changedFiles : 0;
          const goto = () => get().setRoute({ page: "detail", projectId: view.projectId });
          if (changed > 0) {
            get().notify(
              "Packages updated",
              `${view.projectLabel}: ${changed} changed file${changed === 1 ? "" : "s"} ready to commit. Run the tests first if you have them.`,
              { variant: "success", ttl: 8000, onClick: goto },
            );
          } else {
            get().notify(
              "No packages could be updated safely",
              `${view.projectLabel}: the remaining fixes need a bigger upgrade - ask the agent from the Packages row.`,
              { variant: "attention", ttl: 8000, onClick: goto },
            );
          }
        });
    } else if (isTestRun) {
      // A test run's exit code is its verdict; stamp it on the project.
      const passed = code === 0;
      api
        .projectMarkVerified(view.projectId, passed)
        .then((updated) =>
          set((s) => ({ projects: s.projects.map((p) => (p.id === updated.id ? updated : p)) })),
        )
        .catch(() => {});
      get().notify(
        passed ? "All checks passed" : "Some checks failed",
        passed
          ? `${view.projectLabel} is verified.`
          : `${view.projectLabel}: look at the output, or ask the agent to fix it.`,
        { variant: passed ? "success" : "error", ttl: 8000, onClick: openSession },
      );
    } else if (code !== null && code !== 0) {
      get().notify(`${view.agentLabel} exited (code ${code})`, view.projectLabel, {
        variant: "error",
        onClick: openSession,
      });
    }
    // The post-session review needs fresh git state for this project; a
    // dev server or test run can also leave files behind, so always refresh.
    if (view.targetId !== "audit:fix") void get().refreshGit({ force: true });
  },

  setQuitPrompt: (count) => set({ quitPrompt: count }),

  confirmQuit: async () => {
    try {
      await api.appConfirmQuit();
    } catch (err) {
      get().reportError(err);
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

  notify: (title, detail, opts) => {
    const toast: Toast = {
      id: ++toastSeq,
      variant: opts?.variant ?? "info",
      title,
      detail,
      onClick: opts?.onClick,
    };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    setTimeout(() => get().dismissToast(toast.id), opts?.ttl ?? 4000);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
