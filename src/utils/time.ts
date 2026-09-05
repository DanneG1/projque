const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "today", "yesterday", "18 days ago", "3 months ago" from a unix timestamp. */
export function relativeTime(unixSeconds: number): string {
  const deltaSeconds = unixSeconds - Date.now() / 1000;
  const abs = Math.abs(deltaSeconds);
  if (abs < 3600 * 22) {
    return "today";
  }
  const days = deltaSeconds / 86400;
  if (Math.abs(days) < 30) {
    return rtf.format(Math.round(days), "day");
  }
  if (Math.abs(days) < 365) {
    return rtf.format(Math.round(days / 30), "month");
  }
  return rtf.format(Math.round(days / 365), "year");
}

/** "12s", "4m", "1h 05m" for a duration in seconds. */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

/** "1.2 GB", "340 MB", "12 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
