import { useEffect, useState } from "react";
import { api } from "../api/ipc";
import type { OutdatedReport, ProjectView } from "../models";
import { useAppStore } from "../store/useAppStore";
import { Icon } from "./Icon";
import styles from "./AuditPanel.module.css";

function majorPrompt(report: OutdatedReport): string {
  const list = report.items
    .filter((i) => i.kind === "major")
    .slice(0, 30)
    .map((i) => `- ${i.name}: ${i.current} → ${i.latest}`)
    .join("\n");
  return (
    `These packages have a newer major version available (a bigger upgrade that may contain breaking changes):\n\n${list}\n\n` +
    `Upgrade them carefully, one at a time: read what changed between the versions, update the project's code where the new version requires it, and run the project's build and tests after each one. If an upgrade is not worth it or too risky, say so and leave that package. Do not commit - ProjQue shows a review when you're done. Finish with a plain-language summary of what you upgraded and anything that still needs attention.`
  );
}

/** Newer versions available (not security - that is the Packages row):
 *  "Update within allowed versions" runs the package manager's own update,
 *  which never crosses a major version; majors go to the agent. */
export function OutdatedPanel({ project }: { project: ProjectView }) {
  const startRunSession = useAppStore((s) => s.startRunSession);
  const startAgentSession = useAppStore((s) => s.startAgentSession);
  const reportError = useAppStore((s) => s.reportError);
  const sessions = useAppStore((s) => s.sessions);
  const [report, setReport] = useState<OutdatedReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [showList, setShowList] = useState(false);

  useEffect(() => {
    setReport(null);
    setShowList(false);
  }, [project.id]);

  const updating = sessions.some(
    (s) => s.projectId === project.id && s.targetId?.startsWith("update:") && s.status.state === "running",
  );

  const check = async () => {
    setChecking(true);
    try {
      setReport(await api.projectOutdated(project.id));
    } catch (err) {
      reportError(err);
    } finally {
      setChecking(false);
    }
  };

  if (!project.auditable) return null;

  return (
    <div className={styles.row}>
      <span className={styles.label}>Updates</span>
      <div className={styles.body}>
        {report ? (
          report.total === 0 ? (
            <span className={styles.text} data-ok>
              <Icon name="check" size={12} /> Every package is on its newest version.
            </span>
          ) : (
            <span className={styles.text}>
              <strong>{report.total} package{report.total === 1 ? " has" : "s have"} newer versions.</strong>{" "}
              {report.withinRange > 0 && `${report.withinRange} can be updated within the versions this project allows. `}
              {report.major > 0 && `${report.major} need${report.major === 1 ? "s" : ""} a bigger (major) upgrade. `}
              <button className={styles.inline} onClick={() => setShowList((v) => !v)}>
                {showList ? "Hide details" : "Show details"}
              </button>
            </span>
          )
        ) : (
          <span className={styles.text}>See whether newer versions of this project's packages exist.</span>
        )}
        {showList && report && (
          <ul className={styles.list}>
            {report.items.map((i) => (
              <li key={i.name} className={styles.item}>
                <span className={styles.sev} data-sev={i.kind === "major" ? "high" : i.kind === "minor" ? "moderate" : "low"}>
                  {i.kind}
                </span>
                <code className={styles.pkg}>{i.name}</code>
                <span className={styles.title}>
                  {i.current} → {i.latest}
                </span>
                <span className={styles.fix} data-fix={i.kind === "major" ? "major" : "yes"}>
                  {i.kind === "major" ? "bigger upgrade" : i.wanted !== i.current ? "safe update" : "range change needed"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={styles.actions}>
        <button
          className="btn"
          disabled={checking || updating}
          title={`${report?.manager ?? "npm"} outdated - contacts the package registry`}
          onClick={() => void check()}
        >
          {checking ? "Checking…" : report ? "Check again" : "Check for updates"}
        </button>
        {report && report.withinRange > 0 && (
          <button
            className="btn"
            disabled={updating}
            title={`${report.manager} update - stays within each package's allowed version range, never a major upgrade`}
            onClick={() => void startRunSession(project.id, `update:${report.manager}`)}
          >
            <Icon name="run" size={12} /> {updating ? "Updating…" : `Update safely (${report.withinRange})`}
          </button>
        )}
        {report && report.major > 0 && (
          <button
            className="btn"
            title="Start the agent with the list of packages that need a major upgrade"
            onClick={() => void startAgentSession(project.id, undefined, majorPrompt(report))}
          >
            <Icon name="agent" size={12} /> Ask the agent about the {report.major} bigger one{report.major === 1 ? "" : "s"}
          </button>
        )}
      </div>
    </div>
  );
}
