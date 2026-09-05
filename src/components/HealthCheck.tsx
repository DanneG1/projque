import { useEffect, useRef, useState } from "react";
import { useAppStore, type HealthSteps } from "../store/useAppStore";
import { auditAgentPrompt } from "../utils/prompts";
import { Icon } from "./Icon";
import styles from "./HealthCheck.module.css";

const STEPS_KEY = "projque:healthSteps";

function readSteps(): HealthSteps {
  try {
    const raw = localStorage.getItem(STEPS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<HealthSteps>;
      return { fetch: p.fetch ?? true, packages: p.packages ?? true, tests: p.tests ?? true };
    }
  } catch {
    // fall through
  }
  return { fetch: true, packages: true, tests: true };
}

function vulns(n: number) {
  return `${n} ${n === 1 ? "vulnerability" : "vulnerabilities"}`;
}

const FIX_TESTS_PROMPT =
  "The project's tests were just run and some failed. Run the test command yourself to see the failures, find the causes and fix them - fix the code, not the tests, unless a test is clearly wrong. Run the tests again until they pass. Do not commit - ProjQue shows a review when you're done. Finish with a plain-language summary of what was broken and what you changed.";

/** Toolbar button + popover: which steps to run, then Run. */
export function HealthCheckButton() {
  const running = useAppStore((s) => s.sweep.status === "running");
  const auditAll = useAppStore((s) => s.auditAll);
  const projects = useAppStore((s) => s.projects);
  const git = useAppStore((s) => s.git);
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<HealthSteps>(readSteps);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const t = setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const live = projects.filter((p) => p.pathExists && p.status !== "archived");
  const counts = {
    fetch: live.filter((p) => p.isGitRepo && git[p.id]?.remoteUrl).length,
    packages: live.filter((p) => p.auditable).length,
    tests: live.filter((p) => p.hasRunTargets).length,
  };
  if (counts.fetch + counts.packages + counts.tests === 0) return null;

  const toggle = (key: keyof HealthSteps) => {
    const next = { ...steps, [key]: !steps[key] };
    setSteps(next);
    try {
      localStorage.setItem(STEPS_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable - remembered for this session only
    }
  };
  const run = () => {
    setOpen(false);
    void auditAll(steps);
  };
  const anyOn = steps.fetch || steps.packages || steps.tests;

  return (
    <div className={styles.menuWrap} ref={ref}>
      <button
        className="btn"
        disabled={running}
        data-active={open || undefined}
        title="Check every project: fetch from remotes, package vulnerabilities, tests"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="check" size={14} /> {running ? "Checking…" : "Health check"}
      </button>
      {open && (
        <div className={styles.menu} role="dialog" aria-label="Health check options">
          <label className={styles.option} data-off={counts.fetch === 0 || undefined}>
            <input type="checkbox" checked={steps.fetch} disabled={counts.fetch === 0} onChange={() => toggle("fetch")} />
            <span>
              <strong>Fetch from remotes</strong>
              <small>{counts.fetch} project{counts.fetch === 1 ? "" : "s"} · learns what is behind or ahead (network)</small>
            </span>
          </label>
          <label className={styles.option} data-off={counts.packages === 0 || undefined}>
            <input type="checkbox" checked={steps.packages} disabled={counts.packages === 0} onChange={() => toggle("packages")} />
            <span>
              <strong>Check packages</strong>
              <small>{counts.packages} project{counts.packages === 1 ? "" : "s"} · npm/pnpm audit (network)</small>
            </span>
          </label>
          <label className={styles.option} data-off={counts.tests === 0 || undefined}>
            <input type="checkbox" checked={steps.tests} disabled={counts.tests === 0} onChange={() => toggle("tests")} />
            <span>
              <strong>Run tests</strong>
              <small>{counts.tests} project{counts.tests === 1 ? "" : "s"} · one at a time, output kept in Sessions</small>
            </span>
          </label>
          <button className="btn btn-primary" disabled={!anyOn} onClick={run}>
            Run health check
          </button>
        </div>
      )}
    </div>
  );
}

/** Progress while the check runs, then one summary with actions per
 *  project: Pull / Push / Commit for git, Update safely / Commit / Ask the
 *  agent for packages, Open output / Ask the agent to fix for tests.
 *  Commit after a package update is only offered where the project was
 *  clean before the update, so it never bundles other work. */
export function HealthCheckPanel() {
  const sweep = useAppStore((s) => s.sweep);
  const projects = useAppStore((s) => s.projects);
  const audits = useAppStore((s) => s.audits);
  const git = useAppStore((s) => s.git);
  const gitBusy = useAppStore((s) => s.gitBusy);
  const sessions = useAppStore((s) => s.sessions);
  const cancelSweep = useAppStore((s) => s.cancelSweep);
  const dismissSweep = useAppStore((s) => s.dismissSweep);
  const auditAll = useAppStore((s) => s.auditAll);
  const sweepFix = useAppStore((s) => s.sweepFix);
  const sweepCommit = useAppStore((s) => s.sweepCommit);
  const pullFf = useAppStore((s) => s.pullFf);
  const pushBranch = useAppStore((s) => s.pushBranch);
  const startAgentSession = useAppStore((s) => s.startAgentSession);
  const setRoute = useAppStore((s) => s.setRoute);

  if (sweep.status === "idle") return null;

  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
  const phaseLabel: Record<keyof HealthSteps, string> = {
    fetch: "Fetching",
    packages: "Checking packages",
    tests: "Running tests",
  };

  if (sweep.status === "running") {
    const pct = sweep.total === 0 ? 0 : Math.round((sweep.done / sweep.total) * 100);
    return (
      <section className={styles.panel}>
        <div className={styles.head}>
          <span className={styles.title}>Health check</span>
          <span className={styles.progressText}>
            {sweep.done} of {sweep.total}
            {sweep.phase ? ` · ${phaseLabel[sweep.phase]}` : ""}
            {sweep.current ? ` · ${nameOf(sweep.current)}` : ""}
          </span>
          <div className={styles.spacer} />
          <button className="btn" disabled={sweep.cancel} onClick={cancelSweep}>
            {sweep.cancel ? "Stopping…" : "Stop"}
          </button>
        </div>
        <div className={styles.track} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={styles.fill} style={{ width: `${pct}%` }} />
        </div>
      </section>
    );
  }

  // ---- Git rows: behind / ahead / uncommitted (from fresh git info).
  const gitRows = sweep.fetchIds
    .map((id) => ({ id, info: git[id], error: sweep.fetchErrors[id] }))
    .filter(
      (r) =>
        r.error ||
        (r.info && ((r.info.behind ?? 0) > 0 || (r.info.ahead ?? 0) > 0 || r.info.dirty)),
    );
  const pullAll = gitRows.filter((r) => r.info && (r.info.behind ?? 0) > 0 && !r.info.dirty).map((r) => r.id);

  // ---- Package rows.
  const fixRunning = (id: string) =>
    sessions.some((v) => v.projectId === id && v.targetId === "audit:fix" && v.status.state === "running");
  const pkgRows = sweep.ids
    .map((id) => ({ id, report: audits[id], error: sweep.errors[id] }))
    // Keep rows for projects the sweep touched even once their count hits
    // zero after an update - the commit step still lives here.
    .filter((r) => r.error || sweep.fixed[r.id] || (r.report && r.report.total > 0))
    .sort((a, b) => {
      const sev = (r: typeof a) => (r.report ? r.report.critical * 100 + r.report.high * 10 + r.report.total : -1);
      return sev(b) - sev(a);
    });
  const pkgState = (id: string, report: (typeof audits)[string] | undefined) => {
    const dirty = git[id]?.dirty ?? false;
    const wasClean = sweep.cleanBefore[id] ?? false;
    const fixed = sweep.fixed[id] ?? false;
    const committed = sweep.committed[id] ?? false;
    const settled = fixed && !fixRunning(id);
    return {
      canFix: !!report && report.canAutoFix && report.fixable > 0 && !fixed,
      fixing: fixRunning(id),
      canCommit: settled && dirty && wasClean && !committed,
      mixed: settled && dirty && !wasClean,
      committed,
      nothing: settled && !dirty && !committed,
      needsAgent: !!report && report.total - report.fixable > 0,
    };
  };
  const fixAll = pkgRows.filter((r) => pkgState(r.id, r.report).canFix).map((r) => r.id);
  const commitAll = pkgRows.filter((r) => pkgState(r.id, r.report).canCommit).map((r) => r.id);

  // ---- Test rows.
  const testRows = sweep.testIds
    .map((id) => ({ id, result: sweep.testResults[id], error: sweep.errors[id], sessionId: sweep.testSessions[id] }))
    .filter((r) => r.result === "failed" || (r.error && !sweep.ids.includes(r.id)));
  const passed = Object.values(sweep.testResults).filter((r) => r === "passed").length;
  const untested = Object.values(sweep.testResults).filter((r) => r === "none").length;

  const problems = gitRows.length + pkgRows.length + testRows.length;
  const stopped = sweep.cancel && sweep.done < sweep.total;

  return (
    <section className={styles.panel} data-clean={problems === 0 || undefined}>
      <div className={styles.head}>
        <Icon name="check" size={15} className={styles.glyph} />
        <span className={styles.title}>
          {problems === 0
            ? "Health check: everything looks good"
            : `Health check: ${problems} thing${problems === 1 ? "" : "s"} to look at`}
        </span>
        <span className={styles.muted}>
          {sweep.done} check{sweep.done === 1 ? "" : "s"}
          {stopped ? ` (stopped early, ${sweep.total - sweep.done} skipped)` : ""}
        </span>
        <div className={styles.spacer} />
        <button className="btn" onClick={() => void auditAll(sweep.steps)} title="Run the same check again">
          <Icon name="refresh" size={13} />
        </button>
        <button className="btn btn-ghost" aria-label="Dismiss" onClick={dismissSweep}>
          ✕
        </button>
      </div>

      {gitRows.length > 0 && (
        <div className={styles.group}>
          <div className={styles.groupHead}>
            <span className={styles.groupTitle}>Git</span>
            {pullAll.length > 1 && (
              <button
                className="btn"
                title="git pull --ff-only in each project that is behind and has no local changes"
                onClick={() => {
                  for (const id of pullAll) void pullFf(id);
                }}
              >
                Pull all ({pullAll.length})
              </button>
            )}
          </div>
          <ul className={styles.rows}>
            {gitRows.map(({ id, info, error }) => (
              <li key={id} className={styles.row} data-error={error ? true : undefined}>
                <button className={styles.name} onClick={() => setRoute({ page: "detail", projectId: id })}>
                  {nameOf(id)}
                </button>
                <span className={styles.summary}>
                  {error ? (
                    <>Could not fetch: {error}</>
                  ) : (
                    [
                      (info?.behind ?? 0) > 0 && `${info!.behind} newer commit${info!.behind === 1 ? "" : "s"} online`,
                      (info?.ahead ?? 0) > 0 && `${info!.ahead} commit${info!.ahead === 1 ? "" : "s"} not pushed`,
                      info?.dirty && `${info.changedFiles} changed file${info.changedFiles === 1 ? "" : "s"} not committed`,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  )}
                </span>
                <span className={styles.actions}>
                  {info && (info.behind ?? 0) > 0 && !info.dirty && (
                    <button className="btn" disabled={gitBusy[id]} onClick={() => void pullFf(id)}>
                      {gitBusy[id] ? "Working…" : "Pull"}
                    </button>
                  )}
                  {info && (info.ahead ?? 0) > 0 && (info.behind ?? 0) === 0 && !info.dirty && (
                    <button className="btn" disabled={gitBusy[id]} onClick={() => void pushBranch(id)}>
                      {gitBusy[id] ? "Working…" : "Push"}
                    </button>
                  )}
                  {info?.dirty && (
                    <button className="btn" onClick={() => setRoute({ page: "detail", projectId: id })}>
                      Commit
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pkgRows.length > 0 && (
        <div className={styles.group}>
          <div className={styles.groupHead}>
            <span className={styles.groupTitle}>Packages</span>
            {fixAll.length > 1 && (
              <button
                className="btn"
                title="Run npm audit fix in each of these projects (non-breaking updates only, never --force)"
                onClick={() => {
                  for (const id of fixAll) void sweepFix(id);
                }}
              >
                <Icon name="run" size={12} /> Update all safely ({fixAll.length})
              </button>
            )}
            {commitAll.length > 1 && (
              <button
                className="btn"
                title='Commit "Update vulnerable packages" in each updated project'
                onClick={() => {
                  for (const id of commitAll) void sweepCommit(id);
                }}
              >
                Commit all ({commitAll.length})
              </button>
            )}
          </div>
          <ul className={styles.rows}>
            {pkgRows.map(({ id, report, error }) => {
              const st = pkgState(id, report);
              return (
                <li key={id} className={styles.row} data-error={error ? true : undefined}>
                  <button className={styles.name} onClick={() => setRoute({ page: "detail", projectId: id })}>
                    {nameOf(id)}
                  </button>
                  <span className={styles.summary}>
                    {error ? (
                      <>Could not check: {error}</>
                    ) : report && report.total === 0 ? (
                      <span className={styles.ok}>No known vulnerabilities left</span>
                    ) : report ? (
                      <>
                        <strong>{vulns(report.total)}</strong>
                        {report.critical + report.high > 0 && (
                          <span className={styles.sev}>
                            {" "}
                            ({[report.critical && `${report.critical} critical`, report.high && `${report.high} high`]
                              .filter(Boolean)
                              .join(", ")})
                          </span>
                        )}
                        {report.fixable > 0 && ` · ${report.fixable} safe to update`}
                        {report.total - report.fixable > 0 &&
                          ` · ${report.total - report.fixable} need${report.total - report.fixable === 1 ? "s" : ""} the agent`}
                      </>
                    ) : null}
                  </span>
                  <span className={styles.actions}>
                    {st.fixing && <span className={styles.status}>Updating…</span>}
                    {st.canFix && (
                      <button
                        className="btn"
                        title="npm audit fix - non-breaking updates only, never --force"
                        onClick={() => void sweepFix(id)}
                      >
                        <Icon name="run" size={12} /> Update safely
                      </button>
                    )}
                    {st.canCommit && (
                      <button
                        className="btn btn-primary"
                        disabled={gitBusy[id]}
                        title='Commit "Update vulnerable packages"'
                        onClick={() => void sweepCommit(id)}
                      >
                        {gitBusy[id] ? "Committing…" : "Commit"}
                      </button>
                    )}
                    {st.mixed && (
                      <button
                        className="btn"
                        title="This project also has other uncommitted changes - review and commit them on the project page"
                        onClick={() => setRoute({ page: "detail", projectId: id })}
                      >
                        Review & commit
                      </button>
                    )}
                    {st.committed && (
                      <span className={styles.status} data-ok>
                        ✓ updated & committed
                      </span>
                    )}
                    {st.nothing && (
                      <span className={styles.status} title="npm audit fix found nothing it could change without a breaking upgrade">
                        nothing to update safely
                      </span>
                    )}
                    {report && st.needsAgent && !st.fixing && (
                      <button
                        className="btn"
                        title="Start the agent with the list of packages that need a bigger upgrade or have no fix yet"
                        onClick={() => void startAgentSession(id, undefined, auditAgentPrompt(report))}
                      >
                        <Icon name="agent" size={12} /> Ask the agent
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {sweep.testIds.length > 0 && (
        <div className={styles.group}>
          <div className={styles.groupHead}>
            <span className={styles.groupTitle}>Tests</span>
            <span className={styles.muted}>
              {passed} passed
              {testRows.length > 0 ? ` · ${testRows.length} failed` : ""}
              {untested > 0 ? ` · ${untested} without a test command` : ""}
            </span>
          </div>
          {testRows.length > 0 && (
            <ul className={styles.rows}>
              {testRows.map(({ id, error, sessionId }) => (
                <li key={id} className={styles.row} data-error={error ? true : undefined}>
                  <button className={styles.name} onClick={() => setRoute({ page: "detail", projectId: id })}>
                    {nameOf(id)}
                  </button>
                  <span className={styles.summary}>{error ? <>Could not run: {error}</> : "Some checks failed"}</span>
                  <span className={styles.actions}>
                    {sessionId && (
                      <button className="btn" onClick={() => setRoute({ page: "agents", sessionId })}>
                        Open output
                      </button>
                    )}
                    <button
                      className="btn"
                      title="Start the agent with instructions to find and fix the failing tests"
                      onClick={() => void startAgentSession(id, undefined, FIX_TESTS_PROMPT)}
                    >
                      <Icon name="agent" size={12} /> Ask the agent to fix
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
