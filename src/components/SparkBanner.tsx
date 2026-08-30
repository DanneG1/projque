import { useEffect, useMemo, useState } from "react";
import { api } from "../api/ipc";
import type { ProjectView } from "../models";
import { useAppStore } from "../store/useAppStore";
import { Icon } from "./Icon";
import { relativeTime } from "../utils/time";
import styles from "./SparkBanner.module.css";

const QUIET_AFTER_DAYS = 21;
const DISMISS_KEY = "projque:sparkDismissed";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === todayStr();
  } catch {
    return false;
  }
}

/** First unchecked task in a markdown document, without the trailing
 *  capture-date marker the idea dialog appends. */
function firstOpenItem(markdown: string): string | null {
  const m = markdown.match(/^\s*[-*] \[ \] +(.+)$/m);
  if (!m) return null;
  return m[1].replace(/\s*\*\([0-9-]+\)\*\s*$/, "").trim() || null;
}

/** A gentle daily nudge toward a project that has gone quiet: rotates per
 *  day, shuffles on demand, dismissible until tomorrow. */
export function SparkBanner() {
  const projects = useAppStore((s) => s.projects);
  const git = useAppStore((s) => s.git);
  const setRoute = useAppStore((s) => s.setRoute);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [shuffle, setShuffle] = useState(0);
  const [hint, setHint] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const now = Date.now() / 1000;
    return projects
      .map((p) => ({ p, last: git[p.id]?.lastCommit?.timestamp ?? null }))
      .filter(
        ({ p, last }) =>
          p.pathExists &&
          (p.status === "idea" || p.status === "active" || p.status === "paused") &&
          (last === null
            ? p.status === "idea" || p.status === "paused"
            : now - last > QUIET_AFTER_DAYS * 86400),
      )
      .sort((a, b) => (a.last ?? 0) - (b.last ?? 0));
  }, [projects, git]);

  const pick = useMemo(() => {
    if (candidates.length === 0) return null;
    const day = Math.floor(Date.now() / 86400000);
    return candidates[(day + shuffle) % candidates.length];
  }, [candidates, shuffle]);

  const pickId = pick?.p.id;
  const pickHasIdeas = pick?.p.hasIdeas ?? false;
  const pickHasRoadmap = pick?.p.hasRoadmap ?? false;
  useEffect(() => {
    setHint(null);
    if (!pickId || (!pickHasIdeas && !pickHasRoadmap)) return;
    let cancelled = false;
    api
      .projectDocument(pickId, pickHasIdeas ? "ideas" : "roadmap")
      .then((doc) => {
        if (!cancelled && doc) setHint(firstOpenItem(doc.markdown));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pickId, pickHasIdeas, pickHasRoadmap]);

  if (dismissed || !pick) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, todayStr());
    } catch {
      // storage unavailable — dismiss for this session only
    }
    setDismissed(true);
  };

  const quietFor = (p: ProjectView, last: number | null) =>
    last === null
      ? p.status === "idea"
        ? "still just an idea"
        : "quiet for a while"
      : `quiet for ${relativeTime(last).replace(/ ago$/, "")}`;

  return (
    <div className={styles.banner}>
      <Icon name="idea" size={15} className={styles.glyph} />
      <span className={styles.text}>
        <button
          className={styles.name}
          onClick={() => setRoute({ page: "detail", projectId: pick.p.id })}
        >
          {pick.p.name}
        </button>{" "}
        has been {quietFor(pick.p, pick.last)}
        {hint ? (
          <>
            {" — still on its list: "}
            <em className={styles.hint}>“{hint}”</em>
          </>
        ) : (
          "."
        )}
      </span>
      {candidates.length > 1 && (
        <button
          className={styles.action}
          title="Show another quiet project"
          onClick={() => setShuffle((n) => n + 1)}
        >
          <Icon name="refresh" size={13} />
        </button>
      )}
      <button className={styles.action} title="Hide until tomorrow" onClick={dismiss}>
        ✕
      </button>
    </div>
  );
}
