import { useEffect, useState } from "react";
import { api } from "../api/ipc";
import type { IdeaItem } from "../models";
import { useAppStore } from "../store/useAppStore";
import { MarkdownView } from "./MarkdownView";
import styles from "./IdeasPanel.module.css";

/** IDEAS.md as a working to-do list: tick ideas off, or hand one straight
 *  to the agent. "Build this" starts a session whose prompt includes marking
 *  the idea done in IDEAS.md when it's finished and verified. */
export function IdeasPanel({
  projectId,
  fallbackMarkdown,
  heading,
}: {
  /** null = the general idea list (app-wide, not tied to a project). */
  projectId: string | null;
  /** Rendered when IDEAS.md has no checklist items (hand-written file). */
  fallbackMarkdown?: string;
  /** Optional section heading, rendered only when there are items. */
  heading?: string;
}) {
  const ideasVersion = useAppStore((s) => s.ideasVersion);
  const startAgentSession = useAppStore((s) => s.startAgentSession);
  const setNewProjectOpen = useAppStore((s) => s.setNewProjectOpen);
  const setNewProjectSeed = useAppStore((s) => s.setNewProjectSeed);
  const reportError = useAppStore((s) => s.reportError);

  const [items, setItems] = useState<IdeaItem[] | null>(null);

  useEffect(() => {
    api.ideasList(projectId).then(setItems).catch(reportError);
  }, [projectId, ideasVersion, reportError]);

  if (items === null) return null;
  if (items.length === 0) {
    return fallbackMarkdown ? <MarkdownView markdown={fallbackMarkdown} /> : null;
  }

  const toggle = async (item: IdeaItem) => {
    try {
      setItems(await api.ideaSetDone(projectId, item.line, !item.done));
    } catch (err) {
      reportError(err);
      // Positional conflict (file edited elsewhere): reload the list.
      api.ideasList(projectId).then(setItems).catch(() => {});
    }
  };

  const startAsProject = (item: IdeaItem) => {
    setNewProjectSeed(item.text);
    setNewProjectOpen(true);
  };

  const build = (item: IdeaItem) => {
    if (projectId === null) return;
    const prompt =
      `Implement this idea from the project's IDEAS.md file:\n\n"${item.text}"\n\n` +
      `When it is implemented and verified working, edit IDEAS.md and mark the idea as ` +
      `done by changing its "- [ ]" to "- [x]". Afterwards, briefly explain what you ` +
      `built in simple, non-technical language.`;
    void startAgentSession(projectId, undefined, prompt);
  };

  return (
    <>
      {heading && <h2 className={styles.heading}>{heading}</h2>}
      <ul className={styles.list}>
      {items.map((item) => (
        <li key={`${item.line}-${item.text}`} className={styles.item} data-done={item.done || undefined}>
          <input
            type="checkbox"
            checked={item.done}
            onChange={() => void toggle(item)}
            aria-label={item.done ? "Mark idea as not done" : "Mark idea as done"}
          />
          <span className={styles.text}>{item.text}</span>
          {item.date && <span className={styles.date}>{item.date}</span>}
          {!item.done && projectId !== null && (
            <button
              className="btn"
              title="Start the agent with this idea"
              onClick={() => build(item)}
            >
              Build this
            </button>
          )}
          {!item.done && projectId === null && (
            <button
              className="btn"
              title="Create a new project starting from this idea"
              onClick={() => startAsProject(item)}
            >
              Start as project…
            </button>
          )}
        </li>
      ))}
      </ul>
    </>
  );
}
