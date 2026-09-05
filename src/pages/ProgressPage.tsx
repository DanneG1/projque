import { useEffect, useMemo } from "react";
import { useAppStore } from "../store/useAppStore";
import { Icon } from "../components/Icon";
import { computeActivity } from "../utils/activity";
import { formatElapsed } from "../utils/time";
import styles from "./ProgressPage.module.css";

const CELL = 11;
const GAP = 3;

/** The Progress page: streaks, a year of contributions, points, and
 *  achievements - all computed from the user's own local git history and
 *  IDEAS lists. Nothing is tracked or sent anywhere; delete nothing,
 *  celebrate everything. */
export function ProgressPage() {
  const activity = useAppStore((s) => s.activity);
  const loadActivity = useAppStore((s) => s.loadActivity);
  const projects = useAppStore((s) => s.projects);
  const setRoute = useAppStore((s) => s.setRoute);

  useEffect(() => {
    void loadActivity({ force: true });
  }, [loadActivity]);

  const celebratedAt = useAppStore((s) => s.celebratedAt);
  const doneProjects = useMemo(() => projects.filter((p) => p.status === "done"), [projects]);
  const liveCount = useMemo(
    () => projects.filter((p) => p.productionUrl).length,
    [projects],
  );
  const data = useMemo(
    () =>
      activity
        ? computeActivity(activity.summary, {
            doneProjects: doneProjects.length,
            liveProjects: liveCount,
          })
        : null,
    [activity, doneProjects.length, liveCount],
  );
  const confetti = celebratedAt !== null && Date.now() - celebratedAt < 8000;

  if (!data) {
    return <div className={styles.page}>Reading your project history…</div>;
  }

  const name = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
  const allTimeTop = activity
    ? [...activity.summary.projects]
        .filter((p) => p.totalCommits > 0)
        .sort((a, b) => b.totalCommits - a.totalCommits)
        .slice(0, 8)
    : [];
  const unlocked = data.achievements.filter((a) => a.unlocked);
  const streakAlive = data.currentStreak > 0;
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return (
    <div className={styles.page}>
      {confetti && (
        <div className={styles.confetti} aria-hidden="true">
          {Array.from({ length: 28 }, (_, i) => (
            <span
              key={i}
              className={styles.confettiBit}
              style={{
                left: `${(i * 37) % 100}%`,
                animationDelay: `${(i % 7) * 0.14}s`,
                background: ["#d6215f", "#fc5a1e", "#fcc000", "#37a24a", "#3d92c4"][i % 5],
              }}
            />
          ))}
        </div>
      )}
      <div className={styles.headRow}>
        <h1 className={styles.heading}>Your progress</h1>
        <button className="btn" onClick={() => setRoute({ page: "review" })}>
          <Icon name="clock" size={13} /> Weekly review
        </button>
      </div>

      <div className={styles.cards}>
        <div className={styles.card} data-hot={streakAlive || undefined}>
          <span className={styles.cardValue}>
            <Icon name="flame" size={20} /> {data.currentStreak}
          </span>
          <span className={styles.cardLabel}>
            day streak
            {streakAlive && data.todayCount === 0 && (
              <em className={styles.nudge}> - commit today to keep it</em>
            )}
            {!streakAlive && <em className={styles.nudge}> - one commit starts one</em>}
          </span>
          <span className={styles.rest} title="Every 5 active days banks a rest day (up to 3). A single day off spends one automatically and the streak keeps going; two days in a row starts a fresh streak.">
            {data.restDaysBanked} rest day{data.restDaysBanked === 1 ? "" : "s"} banked
            {data.restDaysUsed > 0 && ` · ${data.restDaysUsed} used this streak`}
          </span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardValue}>{data.longestStreak}</span>
          <span className={styles.cardLabel}>longest streak (year)</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardValue}>
            Lv {data.level}
            <span className={styles.levelTitle}>{data.levelTitle}</span>
          </span>
          <span className={styles.levelBar}>
            <span
              className={styles.levelFill}
              style={{ width: `${Math.min(100, (data.levelProgress.have / data.levelProgress.need) * 100)}%` }}
            />
          </span>
          <span className={styles.cardLabel}>
            {data.levelProgress.need - data.levelProgress.have} pts to level {data.level + 1}
          </span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardValue}>{data.weekPoints}</span>
          <span className={styles.cardLabel}>points this week</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardValue}>{data.totalPoints.toLocaleString()}</span>
          <span className={styles.cardLabel}>contribution score</span>
        </div>
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>The last year</h2>
        <div className={styles.heatmapWrap}>
          <svg
            className={styles.heatmap}
            width={data.weeks.length * (CELL + GAP)}
            height={7 * (CELL + GAP) + 14}
          >
            {data.weeks.map((week, x) => {
              const first = week[week.length - 1]?.date;
              const showMonth =
                first && first.getDate() <= 7 && x < data.weeks.length - 1;
              return (
                <g key={x}>
                  {showMonth && (
                    <text className={styles.monthLabel} x={x * (CELL + GAP)} y={10}>
                      {monthNames[first.getMonth()]}
                    </text>
                  )}
                  {week.map((cell) => {
                    const row = (cell.date.getDay() + 6) % 7;
                    return (
                      <rect
                        key={cell.key}
                        className={styles.cell}
                        data-level={cell.level}
                        x={x * (CELL + GAP)}
                        y={14 + row * (CELL + GAP)}
                        width={CELL}
                        height={CELL}
                        rx={2.5}
                      >
                        <title>
                          {cell.count === 0
                            ? `No commits on ${cell.key}`
                            : `${cell.count} commit${cell.count === 1 ? "" : "s"} on ${cell.key}`}
                        </title>
                      </rect>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>
        <p className={styles.statLine}>
          {data.weekCommits} commits this week · {data.monthCommits} this month ·{" "}
          {data.yearCommits} this year · {data.totalCommits.toLocaleString()} all time
        </p>
        <p className={styles.statLine}>
          Personal records: {data.recordDay} commits in a day · {data.recordWeek} in a week
        </p>
      </section>

      <div className={styles.columns}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            Achievements ({unlocked.length}/{data.achievements.length})
          </h2>
          <ul className={styles.achievements}>
            {data.achievements.map((a) => (
              <li key={a.id} className={styles.achievement} data-unlocked={a.unlocked || undefined}>
                <span className={styles.badge}>
                  <Icon name={a.unlocked ? "star" : "clock"} size={15} />
                </span>
                <span className={styles.achText}>
                  <strong>{a.label}</strong>
                  <span>{a.description}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {data.timeWeek.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              Time this week{" "}
              <span className={styles.faint}>
                {formatElapsed(data.timeWeekTotal)} in sessions · {formatElapsed(data.timeAllTotal)} all time
              </span>
            </h2>
            <ul className={styles.topList}>
              {data.timeWeek.map((t) => (
                <li key={t.projectId}>
                  <button
                    className={styles.topBtn}
                    onClick={() => setRoute({ page: "detail", projectId: t.projectId })}
                  >
                    <span className={styles.topName}>{name(t.projectId)}</span>
                    <span className={styles.topBar}>
                      <span
                        className={styles.topFill}
                        style={{ width: `${(t.seconds / data.timeWeek[0].seconds) * 100}%` }}
                      />
                    </span>
                    <span className={styles.topCount}>{formatElapsed(t.seconds)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className={styles.faint}>Counted from agent and run sessions inside ProjQue; a session is capped at four hours.</p>
          </section>
        )}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Most active this month</h2>
          {data.topProjects.length === 0 ? (
            <p className={styles.faint}>
              No commits in the last 30 days - pick a project and make one small
              change today.
            </p>
          ) : (
            <ul className={styles.topList}>
              {data.topProjects.map((t) => (
                <li key={t.projectId}>
                  <button
                    className={styles.topBtn}
                    onClick={() => setRoute({ page: "detail", projectId: t.projectId })}
                  >
                    <span className={styles.topName}>{name(t.projectId)}</span>
                    <span className={styles.topBar}>
                      <span
                        className={styles.topFill}
                        style={{
                          width: `${(t.commits / data.topProjects[0].commits) * 100}%`,
                        }}
                      />
                    </span>
                    <span className={styles.topCount}>{t.commits}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {allTimeTop.length > 0 && (
            <>
              <h2 className={styles.sectionTitle}>Most active all time</h2>
              <ul className={styles.topList}>
                {allTimeTop.map((t, i) => (
                  <li key={t.projectId}>
                    <button
                      className={styles.topBtn}
                      onClick={() => setRoute({ page: "detail", projectId: t.projectId })}
                    >
                      <span className={styles.rank} data-top={i === 0 || undefined}>
                        {i + 1}
                      </span>
                      <span className={styles.topName}>{name(t.projectId)}</span>
                      <span className={styles.topBar}>
                        <span
                          className={styles.topFill}
                          style={{
                            width: `${(t.totalCommits / allTimeTop[0].totalCommits) * 100}%`,
                          }}
                        />
                      </span>
                      <span className={styles.topCount}>
                        {t.totalCommits.toLocaleString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h2 className={styles.sectionTitle}>Ideas</h2>
          <p className={styles.statLine}>
            {data.ideasDone} shipped · {data.ideasOpen} waiting
            {data.ideasOpen > 0 && " - each one shipped is worth 10 points"}
          </p>
          {doneProjects.length > 0 && (
            <>
              <h2 className={styles.sectionTitle}>Hall of Fame</h2>
              <ul className={styles.hall}>
                {doneProjects.map((p) => {
                  const commits =
                    activity?.summary.projects.find((a) => a.projectId === p.id)
                      ?.totalCommits ?? 0;
                  return (
                    <li key={p.id}>
                      <button
                        className={styles.hallBtn}
                        onClick={() => setRoute({ page: "detail", projectId: p.id })}
                      >
                        <span className={styles.trophy}>🏆</span>
                        <span className={styles.hallName}>{p.name}</span>
                        {commits > 0 && (
                          <span className={styles.hallMeta}>
                            {commits.toLocaleString()} commits
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className={styles.faint}>
                Finished projects live here forever. Mark a project as Done to
                add it to the shelf.
              </p>
            </>
          )}
          <p className={styles.faint}>
            How points work: 2 per commit, 10 per shipped idea, and 50 per
            project live in production (lifetime); the weekly score adds 3
            per commit and 5 per project you touched.
            Computed from your own git history on this machine - nothing is
            tracked or uploaded.
          </p>
        </section>
      </div>
    </div>
  );
}
