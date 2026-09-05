const SUGGESTION_MARKER = "SUGGESTED COMMIT MESSAGE:";
const ACTION_MARKER = "WHAT TO DO:";

/** Split Claude's change summary into the prose and the suggested message. */
export function parseSummary(raw: string): { summary: string; suggestion: string | null } {
  return splitMarker(raw, SUGGESTION_MARKER);
}

/** Split an error explanation into the prose and the "what to do" line. */
export function parseExplanation(raw: string): { summary: string; suggestion: string | null } {
  return splitMarker(raw, ACTION_MARKER);
}

function splitMarker(raw: string, marker: string) {
  const idx = raw.lastIndexOf(marker);
  if (idx === -1) return { summary: raw.trim(), suggestion: null };
  const suggestion = raw.slice(idx + marker.length).split("\n")[0].trim();
  return { summary: raw.slice(0, idx).trim(), suggestion: suggestion || null };
}
