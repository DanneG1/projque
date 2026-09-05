import { useAppStore } from "../store/useAppStore";
import { auditAgentPrompt } from "../utils/prompts";
import { Icon } from "./Icon";
import styles from "./PackageSweep.module.css";

function vulns(n: number) {
  return `${n} ${n === 1 ? "vulnerability" : "vulnerabilities"}`;
}

/** "Check all projects" for package vulnerabilities: a real progress bar
 *  while the sweep runs, then one summary with Update safely / Commit /
 *  Ask the agent per affected project. Commit is only offered where the
 *  project was clean before the update, so it never bundles other work. */
export function PackageSweep() {
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
  const startAgentSession = useAppStore((s) => s.startAgentSession);
  const setRoute = useAppStore((s) => s.setRoute);

  if (sweep.status === "idle") return null;

  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
  const total = sweep.ids.length;

  if (sweep.status === "running") {
    const pct = total === 0 ? 0 : Math.round((sweep.done / total) * 100);
    return (
      <section className={styles.panel}>
        <div className={styles.head}>
          <span className={styles.title}>
            Checking packages in {total} project{total === 1 ? "" : "s"}
          </span>
          <span className={styles.progressText}>
            {sweep.done} of {total}
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

  // Done: build the per-project rows.
  const checked = sweep.ids.slice(0, sweep.done);
  const fixRunning = (id: string) =>
    sessions.some((v) => v.projectId === id && v.targetId === "audit:fix" && v.status.state === "running");
  const rows = checked
    .map((id) => ({ id, report: audits[id], error: sweep.errors[id] }))
    // Keep rows for projects the sweep touched even once their count hits
    // zero after an update - the commit step still lives here.
    .filter((r) => r.error || sweep.fixed[r.id] || (r.report && r.report.total > 0))
    .sort((a, b) => {
      const sev = (r: typeof a) => (r.report ? r.report.critical * 100 + r.report.high * 10 + r.report.total : -1);
      return sev(b) - sev(a);
    });
  const clean = checked.length - rows.length;

  // What is left to do, per project, from what actually happened.
  const state = (id: string, report: (typeof audits)[string] | undefined) => {
    const info = git[id];
    const dirty = info?.dirty ?? false;
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
      // The update ran but left nothing behind - npm had no safe fix after all.
      nothing: settled && !dirty && !committed,
      needsAgent: !!report && report.total - report.fixable > 0,
    };
  };

  const fixAll = rows.filter((r) => state(r.id, r.report).canFix).map((r) => r.id);
  const commitAll = rows.filter((r) => state(r.id, r.report).canCommit).map((r) => r.id);

  return (
    <section className={styles.panel} data-clean={rows.length === 0 || undefined}>
      <div className={styles.head}>
        <Icon name="check" size={15} className={styles.glyph} />
        <span className={styles.title}>
          {rows.length === 0
            ? `All ${checked.length} project${checked.length === 1 ? "" : "s"} clean`
            : `${rows.length} of ${checked.length} project${checked.length === 1 ? "" : "s"} need${rows.length === 1 ? "s" : ""} attention`}
        </span>
        {clean > 0 && rows.length > 0 && (
          <span className={styles.muted}>{clean} clean</span>
        )}
        {sweep.cancel && sweep.done < total && (
          <span className={styles.muted}>stopped after {sweep.done} of {total}</span>
        )}
        <div className={styles.spacer} />
        {fixAll.length > 1 && (
          <button
            className="btn btn-primary"
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
            className="btn btn-primary"
            title='Commit "Update vulnerable packages" in each updated project'
            onClick={() => {
              for (const id of commitAll) void sweepCommit(id);
            }}
          >
            Commit all ({commitAll.length})
          </button>
        )}
        <button className="btn" onClick={() => void auditAll()} title="Check every project again">
          <Icon name="refresh" size={13} />
        </button>
        <button className="btn btn-ghost" aria-label="Dismiss" onClick={dismissSweep}>
          ✕
        </button>
      </div>

      {rows.length > 0 && (
        <ul className={styles.rows}>
          {rows.map(({ id, report, error }) => {
            const st = state(id, report);
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
                      {report.total - report.fixable > 0 && ` · ${report.total - report.fixable} need${report.total - report.fixable === 1 ? "s" : ""} the agent`}
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
                  {st.committed && <span className={styles.status} data-ok>✓ updated & committed</span>}
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
      )}
    </section>
  );
}
