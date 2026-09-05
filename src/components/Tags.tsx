import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import styles from "./Tags.module.css";

/** Small clickable chips; clicking filters the list by that tag. */
export function TagChips({ tags }: { tags: string[] }) {
  const tagFilter = useAppStore((s) => s.tagFilter);
  const setTagFilter = useAppStore((s) => s.setTagFilter);
  const setRoute = useAppStore((s) => s.setRoute);
  if (tags.length === 0) return null;
  return (
    <span className={styles.chips}>
      {tags.map((t) => (
        <button
          key={t}
          className={styles.chip}
          data-active={tagFilter === t || undefined}
          title={tagFilter === t ? "Show all projects" : `Show projects tagged “${t}”`}
          onClick={(e) => {
            e.stopPropagation();
            setTagFilter(t);
            setRoute({ page: "list" });
          }}
        >
          #{t}
        </button>
      ))}
    </span>
  );
}

/** Every tag in use, as a filter row under the toolbar. Hidden until a
 *  project has a tag, so new users never see an empty feature. */
export function TagBar() {
  const projects = useAppStore((s) => s.projects);
  const tagFilter = useAppStore((s) => s.tagFilter);
  const setTagFilter = useAppStore((s) => s.setTagFilter);
  const counts = new Map<string, number>();
  for (const p of projects) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  if (counts.size === 0) return null;
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return (
    <div className={styles.bar}>
      {tags.map(([t, n]) => (
        <button
          key={t}
          className={styles.chip}
          data-active={tagFilter === t || undefined}
          onClick={() => setTagFilter(t)}
        >
          #{t} <span className={styles.n}>{n}</span>
        </button>
      ))}
      {tagFilter && (
        <button className={styles.clear} onClick={() => setTagFilter(null)}>
          Clear
        </button>
      )}
    </div>
  );
}

/** Comma-separated editor for one project's tags. */
export function TagEditor({ projectId, tags }: { projectId: string; tags: string[] }) {
  const updateProject = useAppStore((s) => s.updateProject);
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const next = draft
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, "").trim())
      .filter(Boolean);
    setDraft(null);
    if (next.join(",") !== tags.join(",")) void updateProject(projectId, { tags: next });
  };

  if (draft !== null) {
    return (
      <input
        className={styles.input}
        autoFocus
        value={draft}
        placeholder="client, hobby, tool…"
        maxLength={300}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(null);
        }}
      />
    );
  }
  return (
    <span className={styles.editRow}>
      <TagChips tags={tags} />
      <button className={styles.add} onClick={() => setDraft(tags.join(", "))}>
        {tags.length === 0 ? "Add tags…" : "Edit"}
      </button>
    </span>
  );
}
