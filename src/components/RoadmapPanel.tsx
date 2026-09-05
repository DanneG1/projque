import { useEffect, useState } from "react";
import { api } from "../api/ipc";
import type { IdeaItem } from "../models";
import { useAppStore } from "../store/useAppStore";
import { MarkdownView } from "./MarkdownView";
import styles from "./IdeasPanel.module.css";

/** The roadmap as a working list: checklist items (`- [ ]`) get a checkbox
 *  and "Build this", exactly like IDEAS.md. A prose-only roadmap renders as
 *  markdown, as before. */
export function RoadmapPanel({
  projectId,
  fileName,
  fallbackMarkdown,
  truncated,
}: {
  projectId: string;
  fileName: string;
  fallbackMarkdown: string;
  truncated: boolean;
}) {
  const startAgentSession = useAppStore((s) => s.startAgentSession);
  const reportError = useAppStore((s) => s.reportError);
  const gitInfo = useAppStore((s) => s.git[projectId]);
  const [items, setItems] = useState<IdeaItem[] | null>(null);

  // Reload when the working tree changes (an agent may have ticked items).
  useEffect(() => {
    api.roadmapItems(projectId).then(setItems).catch(reportError);
  }, [projectId, gitInfo?.fetchedAt, reportError]);

  if (items === null) return null;
  if (items.length === 0) {
    return (
      <>
        {truncated && <p className={styles.faint}>Large file - showing the first part only.</p>}
        <MarkdownView markdown={fallbackMarkdown} />
      </>
    );
  }

  const toggle = async (item: IdeaItem) => {
    try {
      setItems(await api.roadmapSetDone(projectId, item.line, !item.done));
    } catch (err) {
      reportError(err);
      api.roadmapItems(projectId).then(setItems).catch(() => {});
    }
  };

  const build = (item: IdeaItem) => {
    const prompt =
      `Implement this item from the project's roadmap (${fileName}):\n\n"${item.text}"\n\n` +
      `When it is implemented and verified working, edit ${fileName} and mark the item as ` +
      `done by changing its "- [ ]" to "- [x]". Afterwards, briefly explain what you ` +
      `built in simple, non-technical language.`;
    void startAgentSession(projectId, undefined, prompt);
  };

  const open = items.filter((i) => !i.done).length;

  return (
    <>
      <p className={styles.faint}>
        {open === 0 ? "Everything on the roadmap is done." : `${open} of ${items.length} still to do.`}
      </p>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={`${item.line}-${item.text}`} className={styles.item} data-done={item.done || undefined}>
            <input
              type="checkbox"
              checked={item.done}
              onChange={() => void toggle(item)}
              aria-label={item.done ? "Mark as not done" : "Mark as done"}
            />
            <span className={styles.text}>{item.text}</span>
            {!item.done && (
              <button className="btn" title="Start the agent with this roadmap item" onClick={() => build(item)}>
                Build this
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
