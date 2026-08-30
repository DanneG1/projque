// Progress computations. Timestamps are bucketed into LOCAL days here (the
// backend deliberately ships raw unix seconds — timezones live with the UI).
//
// Design principle: motivate, never punish. Streaks come with automatic
// rest days (earned by activity, spent silently on a missed day), an empty
// today never breaks anything, and a lost streak leaves the longest streak
// behind as a record rather than a scolding.

import type { ActivitySummary } from "../models";

export interface DayCell {
  key: string; // YYYY-MM-DD, local
  date: Date;
  count: number;
  /** 0..4 intensity for the heatmap */
  level: number;
}

export interface Achievement {
  id: string;
  label: string;
  description: string;
  unlocked: boolean;
}

/** Rest-day rules: start with one in the bank, earn one per 5 active days,
 *  keep at most 3. A missed day consumes one automatically. */
const REST_START = 1;
const REST_EVERY = 5;
const REST_CAP = 3;

export const LEVEL_TITLES = [
  "Spark",
  "Tinkerer",
  "Maker",
  "Builder",
  "Crafter",
  "Shipwright",
  "Architect",
  "Pathfinder",
  "Trailblazer",
  "Virtuoso",
  "Luminary",
  "Legend",
];

/** Points needed to reach 1-indexed level L: 0, 100, 300, 600, 1000, … */
export function levelThreshold(level: number): number {
  return 50 * (level - 1) * level;
}

export interface Activity {
  /** 53 columns × 7 rows (Mon–Sun), oldest week first. */
  weeks: DayCell[][];
  currentStreak: number;
  longestStreak: number;
  todayCount: number;
  restDaysBanked: number;
  restDaysUsed: number; // within the current streak
  weekCommits: number;
  monthCommits: number;
  yearCommits: number;
  totalCommits: number;
  activeProjects7d: number;
  activeProjects30d: number;
  /** projectId -> commits in the last 30 days, sorted desc, top 5. */
  topProjects: { projectId: string; commits: number }[];
  ideasOpen: number;
  ideasDone: number;
  weekPoints: number;
  totalPoints: number;
  level: number;
  levelTitle: string;
  /** Points into the current level and the size of the level. */
  levelProgress: { have: number; need: number };
  recordDay: number;
  recordWeek: number;
  achievements: Achievement[];
}

export function dayKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function level(count: number): number {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

export function computeActivity(
  summary: ActivitySummary,
  opts?: { doneProjects?: number },
): Activity {
  const dayCounts = new Map<string, number>();
  const now = Date.now() / 1000;
  const cutoff7 = now - 7 * 86400;
  const cutoff30 = now - 30 * 86400;
  let yearCommits = 0;
  let totalCommits = 0;
  let activeProjects7d = 0;
  let activeProjects30d = 0;
  const per30: { projectId: string; commits: number }[] = [];

  for (const p of summary.projects) {
    totalCommits += p.totalCommits;
    let in7 = 0;
    let in30 = 0;
    for (const ts of p.commitTimestamps) {
      yearCommits += 1;
      if (ts >= cutoff7) in7 += 1;
      if (ts >= cutoff30) in30 += 1;
      const key = dayKey(new Date(ts * 1000));
      dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
    }
    if (in7 > 0) activeProjects7d += 1;
    if (in30 > 0) activeProjects30d += 1;
    if (in30 > 0) per30.push({ projectId: p.projectId, commits: in30 });
  }
  per30.sort((a, b) => b.commits - a.commits);

  // Streak walk, oldest to newest, with automatic rest days. Deterministic
  // from history alone, so nothing needs to be stored. Today never counts
  // against the streak — it is still winnable.
  const todayCount = dayCounts.get(dayKey(new Date())) ?? 0;
  let streak = 0;
  let longestStreak = 0;
  let bank = REST_START;
  let earned = 0;
  let restUsed = 0;
  for (let i = 371; i >= 1; i--) {
    const active = (dayCounts.get(dayKey(daysAgo(i))) ?? 0) > 0;
    if (active) {
      streak += 1;
      earned += 1;
      if (earned % REST_EVERY === 0) bank = Math.min(bank + 1, REST_CAP);
      longestStreak = Math.max(longestStreak, streak);
    } else if (streak > 0 && bank > 0) {
      bank -= 1;
      restUsed += 1; // streak survives — a rest day, not a failure
    } else if (streak > 0) {
      streak = 0;
      restUsed = 0;
      bank = REST_START;
      earned = 0;
    }
  }
  if (todayCount > 0) {
    streak += 1;
    earned += 1;
    if (earned % REST_EVERY === 0) bank = Math.min(bank + 1, REST_CAP);
    longestStreak = Math.max(longestStreak, streak);
  }

  let weekCommits = 0;
  for (let i = 0; i < 7; i++) weekCommits += dayCounts.get(dayKey(daysAgo(i))) ?? 0;
  let monthCommits = 0;
  for (let i = 0; i < 30; i++) monthCommits += dayCounts.get(dayKey(daysAgo(i))) ?? 0;

  // Personal records within the year window.
  let recordDay = 0;
  for (const count of dayCounts.values()) recordDay = Math.max(recordDay, count);
  let recordWeek = 0;
  for (let start = 371; start >= 0; start--) {
    let sum = 0;
    for (let d = 0; d < 7 && start - d >= 0; d++) {
      sum += dayCounts.get(dayKey(daysAgo(start - d))) ?? 0;
    }
    recordWeek = Math.max(recordWeek, sum);
  }

  // Heatmap grid: end on the current week (Mon-start), 53 columns.
  const today = daysAgo(0);
  const weekday = (today.getDay() + 6) % 7; // 0 = Monday
  const weeks: DayCell[][] = [];
  for (let w = 52; w >= 0; w--) {
    const col: DayCell[] = [];
    for (let d = 0; d < 7; d++) {
      const offset = w * 7 + (weekday - d);
      if (offset < 0) continue; // future days in the current week
      const date = daysAgo(offset);
      const key = dayKey(date);
      const count = dayCounts.get(key) ?? 0;
      col.push({ key, date, count, level: level(count) });
    }
    weeks.push(col);
  }

  // Points: commits carry the habit, shipped ideas carry the meaning.
  const weekPoints = weekCommits * 3 + activeProjects7d * 5;
  const totalPoints = totalCommits * 2 + summary.ideasDone * 10;

  let lvl = 1;
  while (levelThreshold(lvl + 1) <= totalPoints) lvl += 1;
  const levelTitle =
    lvl <= LEVEL_TITLES.length
      ? LEVEL_TITLES[lvl - 1]
      : `${LEVEL_TITLES[LEVEL_TITLES.length - 1]} ${lvl - LEVEL_TITLES.length + 1}`;
  const have = totalPoints - levelThreshold(lvl);
  const need = levelThreshold(lvl + 1) - levelThreshold(lvl);

  const done = opts?.doneProjects ?? 0;
  const achievements: Achievement[] = [
    { id: "first", label: "First commit", description: "Every project starts somewhere.", unlocked: totalCommits >= 1 },
    { id: "streak3", label: "On a roll", description: "A 3-day commit streak.", unlocked: longestStreak >= 3 },
    { id: "streak7", label: "Full week", description: "A 7-day commit streak.", unlocked: longestStreak >= 7 },
    { id: "streak30", label: "Habit formed", description: "A 30-day commit streak.", unlocked: longestStreak >= 30 },
    { id: "c100", label: "Century", description: "100 commits across your projects.", unlocked: totalCommits >= 100 },
    { id: "c1000", label: "Force of nature", description: "1,000 commits across your projects.", unlocked: totalCommits >= 1000 },
    { id: "idea1", label: "Idea shipped", description: "Completed an idea from an IDEAS list.", unlocked: summary.ideasDone >= 1 },
    { id: "idea10", label: "Idea factory", description: "Completed 10 ideas.", unlocked: summary.ideasDone >= 10 },
    { id: "multi", label: "Juggler", description: "5 projects active in the same month.", unlocked: activeProjects30d >= 5 },
    { id: "done1", label: "Finisher", description: "Marked a project as Done.", unlocked: done >= 1 },
    { id: "done3", label: "Curator", description: "Three finished projects on the shelf.", unlocked: done >= 3 },
  ];

  return {
    weeks,
    currentStreak: streak,
    longestStreak,
    todayCount,
    restDaysBanked: bank,
    restDaysUsed: restUsed,
    weekCommits,
    monthCommits,
    yearCommits,
    totalCommits,
    activeProjects7d,
    activeProjects30d,
    topProjects: per30.slice(0, 5),
    ideasOpen: summary.ideasOpen,
    ideasDone: summary.ideasDone,
    weekPoints,
    totalPoints,
    level: lvl,
    levelTitle,
    levelProgress: { have, need },
    recordDay,
    recordWeek,
    achievements,
  };
}
