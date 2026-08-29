import { useEffect, useState } from "react";
import { api } from "../api/ipc";
import type { GhStatus } from "../models";
import { useAppStore } from "../store/useAppStore";
import styles from "./NewProjectDialog.module.css";

type Mode = "create" | "clone";

export function NewProjectDialog() {
  const open = useAppStore((s) => s.newProjectOpen);
  const setOpen = useAppStore((s) => s.setNewProjectOpen);
  const settings = useAppStore((s) => s.settings);
  const addProjectRoot = useAppStore((s) => s.addProjectRoot);
  const startAgentSession = useAppStore((s) => s.startAgentSession);
  const reportError = useAppStore((s) => s.reportError);
  const notify = useAppStore((s) => s.notify);
  const setRoute = useAppStore((s) => s.setRoute);

  const [mode, setMode] = useState<Mode>("create");
  const [gh, setGh] = useState<GhStatus | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rootIndex, setRootIndex] = useState(0);
  const [createRemote, setCreateRemote] = useState(false);
  const [isPrivate, setIsPrivate] = useState(true);
  const [withAgent, setWithAgent] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [cloneUrl, setCloneUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const roots = settings?.projectRoots ?? [];
  const agentLabel = settings?.agent.type ?? "agent";

  useEffect(() => {
    if (open) {
      api.githubStatus().then(setGh).catch(() => setGh(null));
      setRootIndex(0);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const ghReady = gh?.installed === true && gh?.authenticated === true;

  const submitCreate = async () => {
    setBusy(true);
    try {
      const view = await api.projectCreate({
        name: name.trim(),
        description: description.trim() || undefined,
        rootIndex,
        createRemote: createRemote && ghReady,
        private: isPrivate,
      });
      useAppStore.setState((s) => ({ projects: [...s.projects, view] }));
      notify(`Created ${view.name}`);
      setOpen(false);
      setName("");
      setDescription("");
      if (withAgent && prompt.trim()) {
        await startAgentSession(view.id, undefined, prompt.trim());
      } else {
        setRoute({ page: "detail", projectId: view.id });
      }
      setPrompt("");
      void useAppStore.getState().refreshGit();
    } catch (err) {
      reportError(err);
      // The project may still have been created locally (e.g. gh failed).
      void api.projectsList().then((projects) => useAppStore.setState({ projects }));
    } finally {
      setBusy(false);
    }
  };

  const submitClone = async () => {
    setBusy(true);
    try {
      const view = await api.projectClone(cloneUrl.trim(), rootIndex);
      useAppStore.setState((s) => ({ projects: [...s.projects, view] }));
      notify(`Cloned ${view.name}`);
      setOpen(false);
      setCloneUrl("");
      setRoute({ page: "detail", projectId: view.id });
      void useAppStore.getState().refreshGit();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} onClick={() => !busy && setOpen(false)}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.tabs}>
          <button
            className={styles.tab}
            data-active={mode === "create" || undefined}
            onClick={() => setMode("create")}
          >
            Create new
          </button>
          <button
            className={styles.tab}
            data-active={mode === "clone" || undefined}
            onClick={() => setMode("clone")}
          >
            Clone existing
          </button>
        </div>

        {roots.length === 0 ? (
          <div className={styles.field}>
            <p className={styles.hint}>
              First, choose a folder where your projects live.
            </p>
            <button className="btn" onClick={() => void addProjectRoot()}>
              Add project folder
            </button>
          </div>
        ) : (
          <label className={styles.field}>
            Location
            <select
              value={rootIndex}
              onChange={(e) => setRootIndex(Number(e.target.value))}
            >
              {roots.map((root, i) => (
                <option key={root} value={i}>
                  {root}
                </option>
              ))}
            </select>
          </label>
        )}

        {mode === "create" ? (
          <>
            <label className={styles.field}>
              Name
              <input
                autoFocus
                value={name}
                placeholder="my-new-project"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className={styles.field}>
              Description
              <input
                value={description}
                placeholder="What is this project? (optional)"
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <div className={styles.field}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  disabled={!ghReady}
                  checked={createRemote && ghReady}
                  onChange={(e) => setCreateRemote(e.target.checked)}
                />
                Create GitHub repository
                {!ghReady && (
                  <span className={styles.hint}>
                    {gh?.installed
                      ? "(run 'gh auth login' first)"
                      : "(install the GitHub CLI first)"}
                  </span>
                )}
              </label>
              {createRemote && ghReady && (
                <div className={styles.radios}>
                  <label className={styles.check}>
                    <input
                      type="radio"
                      checked={isPrivate}
                      onChange={() => setIsPrivate(true)}
                    />
                    Private
                  </label>
                  <label className={styles.check}>
                    <input
                      type="radio"
                      checked={!isPrivate}
                      onChange={() => setIsPrivate(false)}
                    />
                    Public
                  </label>
                </div>
              )}
            </div>
            <div className={styles.field}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={withAgent}
                  onChange={(e) => setWithAgent(e.target.checked)}
                />
                Start {agentLabel} with a kickoff prompt
              </label>
              {withAgent && (
                <textarea
                  className={styles.prompt}
                  rows={3}
                  value={prompt}
                  placeholder="e.g. Scaffold a Vite + React + TypeScript app with a simple landing page"
                  onChange={(e) => setPrompt(e.target.value)}
                />
              )}
            </div>
            <div className={styles.actions}>
              <button className="btn" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !name.trim() || roots.length === 0}
                onClick={() => void submitCreate()}
              >
                {busy ? "Creating…" : "Create project"}
              </button>
            </div>
          </>
        ) : (
          <>
            <label className={styles.field}>
              Repository URL
              <input
                autoFocus
                value={cloneUrl}
                placeholder="https://github.com/user/repo or git@github.com:user/repo.git"
                onChange={(e) => setCloneUrl(e.target.value)}
              />
            </label>
            <div className={styles.actions}>
              <button className="btn" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !cloneUrl.trim() || roots.length === 0}
                onClick={() => void submitClone()}
              >
                {busy ? "Cloning…" : "Clone and import"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
