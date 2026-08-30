// Celebration tracking: remembers what has already been cheered for (in
// localStorage) so achievement unlocks, level-ups, and new personal records
// each get exactly one moment. First run stores a silent baseline - nobody
// wants nine toasts for their existing history.

import type { Activity } from "./activity";

const KEY = "projque.progress.seen.v1";

interface Seen {
  achievements: string[];
  level: number;
  recordDay: number;
  recordWeek: number;
}

function load(): Seen | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Seen) : null;
  } catch {
    return null;
  }
}

function save(seen: Seen) {
  try {
    localStorage.setItem(KEY, JSON.stringify(seen));
  } catch {
    // Storage unavailable - celebrations just repeat; harmless.
  }
}

export interface CelebrationMessage {
  title: string;
  detail?: string;
}

/** Diff the freshly computed activity against what was already celebrated;
 *  returns the messages to show (empty on the silent first run). */
export function collectCelebrations(activity: Activity): CelebrationMessage[] {
  const unlockedIds = activity.achievements.filter((a) => a.unlocked).map((a) => a.id);
  const current: Seen = {
    achievements: unlockedIds,
    level: activity.level,
    recordDay: activity.recordDay,
    recordWeek: activity.recordWeek,
  };
  const seen = load();
  save(current);
  if (seen === null) return []; // baseline run

  const messages: CelebrationMessage[] = [];
  for (const a of activity.achievements) {
    if (a.unlocked && !seen.achievements.includes(a.id)) {
      messages.push({ title: `Achievement unlocked: ${a.label} 🎉`, detail: a.description });
    }
  }
  if (activity.level > seen.level) {
    messages.push({
      title: `Level ${activity.level} - ${activity.levelTitle} 🎉`,
      detail: "Your contribution score keeps climbing.",
    });
  }
  if (activity.recordDay > seen.recordDay && seen.recordDay > 0) {
    messages.push({
      title: `New record: ${activity.recordDay} commits in a day!`,
    });
  }
  if (activity.recordWeek > seen.recordWeek && seen.recordWeek > 0) {
    messages.push({
      title: `New record: ${activity.recordWeek} commits in a week!`,
    });
  }
  return messages;
}
