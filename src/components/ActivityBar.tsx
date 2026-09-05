import type { AgentSessionView, SessionPulse } from "../models";
import { useAppStore } from "../store/useAppStore";
import { formatElapsed } from "../utils/time";
import styles from "./ActivityBar.module.css";

type ActivityState = "working" | "quiet" | "waiting" | "run" | "busy";

interface Activity {
  key: string;
  state: ActivityState;
  label: string;
  /** Seconds this has been going, when known. */
  elapsedSecs: number | null;
  onClick?: () => void;
}

/** What a session is doing right now, from the backend's liveness pulse. */
function sessionActivity(
  view: AgentSessionView,
  pulse: SessionPulse | undefined,
  now: number,
  open: () => void,
): Activity {
  const elapsedSecs = Math.max(0, Math.floor(now / 1000 - view.startedAt));
  if (view.kind === "run") {
    const isTest = view.targetId?.startsWith("test:") ?? false;
    const isFix = view.targetId === "audit:fix";
    const port = view.detectedUrl?.match(/:(\d+)/)?.[1];
    return {
      key: view.sessionId,
      state: "run",
      label: isTest
        ? "Running tests"
        : isFix
          ? "Updating packages"
          : port
            ? `Running · localhost:${port}`
            : `Running ${view.agentLabel}`,
      elapsedSecs,
      onClick: open,
    };
  }
  if (view.needsAttention) {
    return {
      key: view.sessionId,
      state: "waiting",
      label: `${view.agentLabel} is waiting for you`,
      elapsedSecs,
      onClick: open,
    };
  }
  // Before the first pulse arrives a fresh session is assumed to be working.
  const working = pulse ? pulse.working : true;
  return {
    key: view.sessionId,
    state: working ? "working" : "quiet",
    label: working ? `${view.agentLabel} is working` : `${view.agentLabel} is quiet`,
    elapsedSecs,
    onClick: open,
  };
}

/** Animated indicators for everything currently happening in a project:
 *  agent sessions (working / quiet / waiting), run sessions, git
 *  operations, and labeled background work like a package check. Renders
 *  nothing when the project is idle. */
export function ActivityBar({
  projectId,
  compact,
  framed,
}: {
  projectId: string;
  compact?: boolean;
  /** Draw as its own card (detail page) instead of inline (project card). */
  framed?: boolean;
}) {
  // Stable references only - derive in the component (see store notes).
  const sessions = useAppStore((s) => s.sessions);
  const pulses = useAppStore((s) => s.pulses);
  const gitBusy = useAppStore((s) => s.gitBusy[projectId] ?? false);
  const busyLabel = useAppStore((s) => s.busy[projectId]);
  const setRoute = useAppStore((s) => s.setRoute);

  const now = Date.now();
  const items: Activity[] = sessions
    .filter((v) => v.projectId === projectId && v.status.state === "running")
    .map((v) =>
      sessionActivity(v, pulses[v.sessionId], now, () =>
        setRoute({ page: "agents", sessionId: v.sessionId }),
      ),
    );
  if (busyLabel) {
    items.push({ key: "busy", state: "busy", label: `${busyLabel}…`, elapsedSecs: null });
  }
  if (gitBusy) {
    items.push({ key: "git", state: "busy", label: "Talking to git…", elapsedSecs: null });
  }
  if (items.length === 0) return null;

  // Waiting first: it is the one that needs a person.
  const order: Record<ActivityState, number> = { waiting: 0, working: 1, quiet: 2, run: 3, busy: 4 };
  items.sort((a, b) => order[a.state] - order[b.state]);

  return (
    <div className={styles.stack} data-compact={compact || undefined} data-framed={framed || undefined}>
      {items.map((a) => (
        <div
          key={a.key}
          className={styles.item}
          data-state={a.state}
          data-clickable={a.onClick ? true : undefined}
          role={a.onClick ? "button" : undefined}
          title={a.onClick ? "Open this session" : undefined}
          onClick={a.onClick}
        >
          <div className={styles.row}>
            <span className={styles.label}>{a.label}</span>
            {a.elapsedSecs !== null && (
              <span className={styles.elapsed}>{formatElapsed(a.elapsedSecs)}</span>
            )}
          </div>
          <div className={styles.track}>
            <div className={styles.fill} />
          </div>
        </div>
      ))}
    </div>
  );
}
