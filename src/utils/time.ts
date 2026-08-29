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
