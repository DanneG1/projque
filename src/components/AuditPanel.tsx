import { useEffect, useState } from "react";
import { api } from "../api/ipc";
import type { AuditSupport, ProjectView } from "../models";
import { useAppStore } from "../store/useAppStore";
import { relativeTime } from "../utils/time";
import { Icon } from "./Icon";
import styles from "./AuditPanel.module.css";

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function vulns(n: number) {
  return `${n} known ${n === 1 ? "vulnerability" : "vulnerabilities"}`;
}

/** Dependency vulnerabilities in plain language. "Check packages" runs the
 *  package manager's audit (explicit click - it contacts the registry);
 *  "Update safely" runs `npm audit fix` as a visible run session (non-
 *  breaking updates only); anything needing a major upgrade is handed to
 *  the agent with the list. */
export function AuditPanel({ project }: { project: ProjectView }) {
  const startRunSession = useAppStore((s) => s.startRunSession);
  const startAgentSession = useAppStore((s) => s.startAgentSession);
  const runAudit = useAppStore((s) => s.runAudit);
  const sessions = useAppStore((s) => s.sessions);
  // Report and in-flight state live in the store so a check started from a
  // suggestion on the project card lands here too.
  const report = useAppStore((s) => s.audits[project.id] ?? null);
  const checking = useAppStore((s) => s.busy[project.id] === "Checking packages");

  const [support, setSupport] = useState<AuditSupport | null>(null);
  const [showList, setShowList] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSupport(null);
    api.projectAuditSupport(project.id).then((s) => !cancelled && setSupport(s)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const fixRunning = sessions.some(
    (s) => s.projectId === project.id && s.targetId === "audit:fix" && s.status.state === "running",
  );

  const check = () => runAudit(project.id);

  // When "Update safely" finishes, re-check so the numbers reflect reality.
  const [wasFixing, setWasFixing] = useState(false);
  useEffect(() => {
    if (fixRunning) setWasFixing(true);
    else if (wasFixing) {
      setWasFixing(false);
      void check();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixRunning]);

  const askAgent = () => {
    const stuck = (report?.items ?? []).filter((i) => i.fix !== "yes");
    const list = stuck
      .slice(0, 30)
      .map((i) => `- ${i.name} (${i.severity}${i.direct ? ", used directly" : ", pulled in by another package"})${i.title ? `: ${i.title}` : ""}${i.fix === "major" ? " - fix needs a major version upgrade" : " - no fixed version yet"}`)
      .join("\n");
    const prompt =
      `A dependency vulnerability check (${report?.manager ?? "npm"} audit) found packages that cannot be fixed automatically:\n\n${list}\n\n` +
      `Update this project so these are resolved, carefully: upgrade one package at a time, read what changed between versions, adjust the project's code where a major upgrade requires it, and run the project's build and tests after each step. If a vulnerability has no fixed version, say so and suggest what to do (replace the package, or explain why it does not matter here). Do not commit - ProjQue shows a review when you're done. Finish with a plain-language summary of what you updated and anything that still needs attention.`;
    void startAgentSession(project.id, undefined, prompt);
  };

  if (!support || support.manager === "none") return null;

  const stamp = project.lastAudit;
  const severityWord = (r: { critical: number; high: number; moderate: number; low: number }) => {
    const parts: string[] = [];
    if (r.critical) parts.push(`${r.critical} critical`);
    if (r.high) parts.push(`${r.high} high`);
    if (r.moderate) parts.push(`${r.moderate} moderate`);
    if (r.low) parts.push(`${r.low} low`);
    return parts.join(", ");
  };

  return (
    <div className={styles.row} data-alert={(report?.total ?? stamp?.total ?? 0) > 0 || undefined}>
      <span className={styles.label}>Packages</span>
      <div className={styles.body}>
        {!support.supported ? (
          <span className={styles.text}>{support.reason}</span>
        ) : report ? (
          report.total === 0 ? (
            <span className={styles.text} data-ok>
              <Icon name="check" size={12} /> No known vulnerabilities in {plural(report.dependencies, "package")}.
            </span>
          ) : (
            <span className={styles.text}>
              <strong>{vulns(report.total)}</strong>{" "}
              ({severityWord(report)}) in packages this project uses.{" "}
              {report.fixable > 0 && `${report.fixable} can be updated safely. `}
              {report.needsMajor > 0 && `${report.needsMajor} need${report.needsMajor === 1 ? "s" : ""} a bigger upgrade. `}
              {report.total - report.fixable - report.needsMajor > 0 &&
                `${report.total - report.fixable - report.needsMajor} ${report.total - report.fixable - report.needsMajor === 1 ? "has" : "have"} no fix yet. `}
              <button className={styles.inline} onClick={() => setShowList((v) => !v)}>
                {showList ? "Hide details" : "Show details"}
              </button>
            </span>
          )
        ) : stamp ? (
          <span className={styles.text} data-ok={stamp.total === 0 || undefined}>
            {stamp.total === 0 ? (
              <>
                <Icon name="check" size={12} /> No known vulnerabilities when last checked{" "}
                {relativeTime(stamp.at)}.
              </>
            ) : (
              <>
                {vulns(stamp.total)}
                {stamp.critical + stamp.high > 0 ? ` (${severityWord({ ...stamp, moderate: 0, low: 0 })})` : ""} when last
                checked {relativeTime(stamp.at)}.
              </>
            )}
          </span>
        ) : (
          <span className={styles.text}>
            Not checked yet - see whether any package this project depends on has a known security problem.
          </span>
        )}

        {showList && report && report.items.length > 0 && (
          <ul className={styles.list}>
            {report.items.map((i) => (
              <li key={i.name} className={styles.item}>
                <span className={styles.sev} data-sev={i.severity}>
                  {i.severity}
                </span>
                <code className={styles.pkg}>{i.name}</code>
                <span className={styles.title}>{i.title}</span>
                <span className={styles.fix} data-fix={i.fix}>
                  {i.fix === "yes" ? "safe update" : i.fix === "major" ? "bigger upgrade" : "no fix yet"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={styles.actions}>
        {support.supported ? (
          <button
            className="btn"
            disabled={checking || fixRunning}
            title={`${support.manager} audit - contacts the package registry to compare your dependencies against known advisories`}
            onClick={() => void check()}
          >
            {checking ? "Checking…" : report || stamp ? "Check again" : "Check packages"}
          </button>
        ) : (
          <button
            className="btn"
            title="Ask the agent to audit and update the dependencies"
            onClick={() =>
              void startAgentSession(
                project.id,
                undefined,
                `Check this project's dependencies for known security vulnerabilities using the project's own package manager, explain what you find in plain language, and update the affected packages carefully (one at a time, running the build and tests after each). Do not commit - ProjQue shows a review when you're done.`,
              )
            }
          >
            <Icon name="agent" size={12} /> Ask the agent
          </button>
        )}
        {report && report.canAutoFix && (
          <button
            className="btn"
            disabled={fixRunning}
            title="npm audit fix - updates vulnerable packages to fixed versions without breaking changes (never --force). You review and commit afterwards."
            onClick={() => void startRunSession(project.id, "audit:fix")}
          >
            <Icon name="run" size={12} /> {fixRunning ? "Updating…" : `Update safely (${report.fixable})`}
          </button>
        )}
        {report && report.total - report.fixable > 0 && (
          <button
            className="btn"
            title="Start the agent with the list of packages that need a bigger upgrade or have no fix yet"
            onClick={askAgent}
          >
            <Icon name="agent" size={12} /> Ask the agent to update the rest
          </button>
        )}
      </div>
    </div>
  );
}
