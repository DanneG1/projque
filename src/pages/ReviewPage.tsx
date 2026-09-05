import { useEffect, useMemo } from "react";
import { useAppStore } from "../store/useAppStore";
import { Icon } from "../components/Icon";
import { HealthCheckButton, HealthCheckPanel } from "../components/HealthCheck";
import { computeActivity } from "../utils/activity";
import { suggestionsFor, isSnoozed, type Suggestion } from "../utils/suggestions";
import { formatElapsed } from "../utils/time";
import styles from "./ReviewPage.module.css";

const WEEK_KEY = "projque:lastReviewWeek";

/** ISO-ish week id: the Monday of the current week, as YYYY-MM-DD local. */
export function currentWeekId(now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function reviewSeenThisWeek(): boolean {
  try {
    return localStorage.getItem(WEEK_KEY) === currentWeekId();
  } catch {
    return true;
  }
}

export function markReviewSeen(): void {
  try {
    localStorage.setItem(WEEK_KEY, currentWeekId());
  } catch {
    // storage unavailable - the banner comes back next launch
  }
  window.dispatchEvent(new Event("projque:reviewseen"));
}

/** One page, once a week: what happened, what is waiting, what to do next -
 *  assembled from data the app already holds (git, activity, audits,
 *  suggestions) plus the health check. Nothing here runs by itself. */
export function ReviewPage() {
  const projects = useAppStore((s) => s.projects);
  const git = useAppStore((s) => s.git);
  const activity = useAppStore((s) => s.activity);
  const loadActivity = useAppStore((s) => s.loadActivity);
  const sweep = useAppStore((s) => s.sweep);
  const setRoute = useAppStore((s) => s.setRoute);
  const runAudit = useAppStore((s) => s.runAudit);
  const runTests = useAppStore((s) => s.runTests);
  const pushBranch = useAppStore((s) => s.pushBranch);
  const pullFf = useAppStore((s) => s.pullFf);
  const startAgentSession = useAppStore((s) => s.startAgentSession);
  const updateProject = useAppStore((s) => s.updateProject);
  const backupToGithub = useAppStore((s) => s.backupToGithub);

  useEffect(() => {
    void loadActivity({ force: true });
    markReviewSeen();
  }, [loadActivity]);

  const live = useMemo(() => projects.filter((p) => p.pathExists && p.status !== "archived"), [projects]);
  const name = (id: string) => projects.find((p) => p.id === id)?.name ?? id;

  const data = useMemo(
    () =>
      activity
        ? computeActivity(activity.summary, {
            doneProjects: projects.filter((p) => p.status === "done").length,
            liveProjects: projects.filter((p) => p.productionUrl).length,
          })
        : null,
    [activity, projects],
  );

  // What shipped: commits per project in the last 7 days.
  const shipped = useMemo(() => {
    if (!activity) return [];
    const cutoff = Date.now() / 1000 - 7 * 86400;
    return activity.summary.projects
      .map((p) => ({ projectId: p.projectId, commits: p.commitTimestamps.filter((t) => t >= cutoff).length }))
      .filter((p) => p.commits > 0)
      .sort((a, b) => b.commits - a.commits);
  }, [activity]);

  // Everything waiting, across projects, most urgent first.
  const waiting = useMemo(() => {
    const all: (Suggestion & { projectId: string })[] = [];
    for (const p of live) {
      for (const s of suggestionsFor(p, git[p.id])) {
        if (!isSnoozed(p.id, s.id)) all.push({ ...s, projectId: p.id });
      }
    }
    return all.sort((a, b) => a.priority - b.priority).slice(0, 12);
  }, [live, git]);

  const quiet = useMemo(() => {
    const now = Date.now() / 1000;
    return live
      .filter((p) => p.status === "active")
      .map((p) => ({ p, last: git[p.id]?.lastCommit?.timestamp ?? null }))
      .filter(({ last }) => last !== null && now - last > 21 * 86400)
      .sort((a, b) => (a.last ?? 0) - (b.last ?? 0))
      .slice(0, 5);
  }, [live, git]);

  const run = (s: Suggestion & { projectId: string }) => {
    const id = s.projectId;
    switch (s.action.kind) {
      case "detail":
        setRoute({ page: "detail", projectId: id });
        break;
      case "audit":
        void runAudit(id);
        break;
      case "tests":
        void runTests(id);
        break;
      case "push":
        void pushBranch(id);
        break;
      case "pull":
        void pullFf(id);
        break;
      case "agent":
        void startAgentSession(id, undefined, s.action.prompt);
        break;
      case "status":
        void updateProject(id, { status: s.action.status });
        break;
      case "backup":
        void backupToGithub(id);
        break;
    }
  };

  const weekLabel = new Date().toLocaleDateString(undefined, { day: "numeric", month: "long" });

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.heading}>Weekly review</h1>
        <span className={styles.sub}>Week of {currentWeekId()} · as of {weekLabel}</span>
        <div className={styles.spacer} />
        <button className="btn" onClick={() => setRoute({ page: "progress" })}>
          <Icon name="flame" size={13} /> Progress
        </button>
      </div>

      <div className={styles.cards}>
        <div className={styles.card}>
          <span className={styles.value}>{data?.weekCommits ?? "–"}</span>
          <span className={styles.label}>commits this week</span>
        </div>
        <div className={styles.card}>
          <span className={styles.value}>{shipped.length}</span>
          <span className={styles.label}>projects touched</span>
        </div>
        <div className={styles.card}>
          <span className={styles.value}>{data ? formatElapsed(data.timeWeekTotal) : "–"}</span>
          <span className={styles.label}>in sessions</span>
        </div>
        <div className={styles.card} data-hot={(data?.currentStreak ?? 0) > 0 || undefined}>
          <span className={styles.value}>
            <Icon name="flame" size={16} /> {data?.currentStreak ?? "–"}
          </span>
          <span className={styles.label}>day streak</span>
        </div>
      </div>

      <div className={styles.columns}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>What happened</h2>
          {shipped.length === 0 ? (
            <p className={styles.faint}>No commits in the last seven days. Pick one small thing below.</p>
          ) : (
            <ul className={styles.list}>
              {shipped.map((s) => (
                <li key={s.projectId} className={styles.item}>
                  <button className={styles.name} onClick={() => setRoute({ page: "detail", projectId: s.projectId })}>
                    {name(s.projectId)}
                  </button>
                  <span className={styles.muted}>
                    {s.commits} commit{s.commits === 1 ? "" : "s"}
                    {git[s.projectId]?.lastCommit ? ` · last: “${git[s.projectId]!.lastCommit!.subject}”` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {quiet.length > 0 && (
            <>
              <h3 className={styles.subTitle}>Gone quiet</h3>
              <ul className={styles.list}>
                {quiet.map(({ p, last }) => (
                  <li key={p.id} className={styles.item}>
                    <button className={styles.name} onClick={() => setRoute({ page: "detail", projectId: p.id })}>
                      {p.name}
                    </button>
                    <span className={styles.muted}>
                      {Math.floor((Date.now() / 1000 - (last ?? 0)) / 86400)} days without a commit
                    </span>
                    <button className={styles.link} onClick={() => void updateProject(p.id, { status: "paused" })}>
                      Mark paused
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Waiting for you</h2>
          {waiting.length === 0 ? (
            <p className={styles.faint}>
              <Icon name="check" size={13} /> Nothing - every project is in good shape.
            </p>
          ) : (
            <ul className={styles.list}>
              {waiting.map((s) => (
                <li key={`${s.projectId}:${s.id}`} className={styles.item} data-urgent={s.priority < 15 || undefined}>
                  <button className={styles.name} onClick={() => setRoute({ page: "detail", projectId: s.projectId })}>
                    {name(s.projectId)}
                  </button>
                  <span className={styles.itemTitle} title={s.detail}>
                    {s.title}
                  </span>
                  <button className="btn" onClick={() => run(s)}>
                    {s.action.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className={styles.section}>
        <div className={styles.rowHead}>
          <h2 className={styles.sectionTitle}>Health check</h2>
          <span className={styles.muted}>
            {sweep.status === "done"
              ? "Results below."
              : sweep.status === "running"
                ? "Running…"
                : "Fetch, packages and tests across every project - takes a few minutes."}
          </span>
          <div className={styles.spacer} />
          <HealthCheckButton />
        </div>
        <HealthCheckPanel />
      </section>
    </div>
  );
}
