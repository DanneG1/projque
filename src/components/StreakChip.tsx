import { useEffect, useMemo } from "react";
import { useAppStore } from "../store/useAppStore";
import { computeActivity } from "../utils/activity";
import { Icon } from "./Icon";
import styles from "./StreakChip.module.css";

/** Compact daily-loop reminder on the Projects page: current streak and this
 *  week's points, linking to the full Progress page. */
export function StreakChip() {
  const activity = useAppStore((s) => s.activity);
  const loadActivity = useAppStore((s) => s.loadActivity);
  const setRoute = useAppStore((s) => s.setRoute);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  const projects = useAppStore((s) => s.projects);
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

  if (!data) return null;

  return (
    <button
      className={styles.chip}
      data-hot={data.currentStreak > 0 || undefined}
      title={
        data.currentStreak > 0
          ? data.todayCount > 0
            ? `${data.currentStreak}-day streak - today already counts. ${data.restDaysBanked} rest day${data.restDaysBanked === 1 ? "" : "s"} banked. See your progress`
            : `${data.currentStreak}-day streak - a commit today keeps it going (a banked rest day covers a single day off: ${data.restDaysBanked} available). See your progress`
          : "See your progress - streaks, points, and achievements"
      }
      onClick={() => setRoute({ page: "progress" })}
    >
      <Icon name="flame" size={13} />
      {data.currentStreak > 0 ? `${data.currentStreak} day${data.currentStreak === 1 ? "" : "s"}` : "Progress"}
      {data.weekPoints > 0 && <span className={styles.points}>{data.weekPoints} pts</span>}
      <span className={styles.points}>Lv {data.level}</span>
    </button>
  );
}
