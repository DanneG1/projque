import { useEffect, useMemo, useState } from "react";
import type { ProjectView } from "../models";
import { useAppStore } from "../store/useAppStore";
import {
  isSnoozed,
  snooze,
  suggestionsFor,
  SNOOZE_EVENT,
  type Suggestion,
  type SuggestionAction,
} from "../utils/suggestions";
import { Icon } from "./Icon";
import styles from "./Suggestions.module.css";

/** Re-render when a snooze happens anywhere (card or detail page). */
function useSnoozeVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((n) => n + 1);
    window.addEventListener(SNOOZE_EVENT, bump);
    return () => window.removeEventListener(SNOOZE_EVENT, bump);
  }, []);
  return v;
}

export function useSuggestions(project: ProjectView): Suggestion[] {
  const git = useAppStore((s) => s.git[project.id]);
  const version = useSnoozeVersion();
  return useMemo(
    () => suggestionsFor(project, git).filter((s) => !isSnoozed(project.id, s.id)),
    // version is a signal, not data
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, git, version],
  );
}

function useRunAction(projectId: string) {
  const setRoute = useAppStore((s) => s.setRoute);
  const runAudit = useAppStore((s) => s.runAudit);
  const runTests = useAppStore((s) => s.runTests);
  const pushBranch = useAppStore((s) => s.pushBranch);
  const pullFf = useAppStore((s) => s.pullFf);
  const startAgentSession = useAppStore((s) => s.startAgentSession);
  const updateProject = useAppStore((s) => s.updateProject);
  const backupToGithub = useAppStore((s) => s.backupToGithub);
  return (action: SuggestionAction) => {
    switch (action.kind) {
      case "detail":
        setRoute({ page: "detail", projectId });
        break;
      case "audit":
        void runAudit(projectId);
        break;
      case "tests":
        void runTests(projectId);
        break;
      case "push":
        void pushBranch(projectId);
        break;
      case "pull":
        void pullFf(projectId);
        break;
      case "agent":
        void startAgentSession(projectId, undefined, action.prompt);
        break;
      case "status":
        void updateProject(projectId, { status: action.status });
        break;
      case "backup":
        void backupToGithub(projectId);
        break;
    }
  };
}

/** One line on the project card: the most useful next thing to do here. */
export function SuggestionLine({ project }: { project: ProjectView }) {
  const suggestions = useSuggestions(project);
  const run = useRunAction(project.id);
  const top = suggestions[0];
  if (!top) return null;
  return (
    <div className={styles.line} data-urgent={top.priority < 15 || undefined}>
      <Icon name="idea" size={13} className={styles.glyph} />
      <span className={styles.lineTitle} title={top.detail}>
        {top.title}
      </span>
      <button className={styles.lineAction} onClick={() => run(top.action)}>
        {top.action.label}
      </button>
      {suggestions.length > 1 && (
        <span className={styles.more} title="More suggestions on the project page">
          +{suggestions.length - 1}
        </span>
      )}
      <button
        className={styles.snooze}
        title="Hide this suggestion for a week"
        aria-label="Hide this suggestion for a week"
        onClick={() => snooze(project.id, top.id)}
      >
        ✕
      </button>
    </div>
  );
}

/** The full list for the project page. */
export function SuggestionList({ project }: { project: ProjectView }) {
  const suggestions = useSuggestions(project);
  const run = useRunAction(project.id);
  if (suggestions.length === 0) {
    return (
      <p className={styles.empty}>
        <Icon name="check" size={13} /> Nothing waiting - this project is in good shape.
      </p>
    );
  }
  return (
    <ul className={styles.list}>
      {suggestions.map((s) => (
        <li key={s.id} className={styles.item} data-urgent={s.priority < 15 || undefined}>
          <Icon name="idea" size={14} className={styles.glyph} />
          <div className={styles.body}>
            <div className={styles.title}>{s.title}</div>
            {s.detail && <div className={styles.detail}>{s.detail}</div>}
          </div>
          <button className="btn" onClick={() => run(s.action)}>
            {s.action.label}
          </button>
          <button
            className={styles.snooze}
            title="Hide for a week"
            aria-label="Hide this suggestion for a week"
            onClick={() => snooze(project.id, s.id)}
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
