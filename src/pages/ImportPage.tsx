import { useAppStore } from "../store/useAppStore";
import { EmptyState } from "../components/EmptyState";
import styles from "./ImportPage.module.css";

export function ImportPage() {
  const scan = useAppStore((s) => s.scan);
  const runScan = useAppStore((s) => s.runScan);
  const toggleCandidate = useAppStore((s) => s.toggleCandidate);
  const setAllCandidates = useAppStore((s) => s.setAllCandidates);
  const importSelected = useAppStore((s) => s.importSelected);
  const setRoute = useAppStore((s) => s.setRoute);

  if (scan.scanning) {
    return <EmptyState title="Scanning for repositories…" />;
  }

  if (!scan.result) {
    return (
      <EmptyState title="Scan project folders">
        <p>Search your configured project folders for Git repositories.</p>
        <button className="btn btn-primary" onClick={() => void runScan()}>
          Scan now
        </button>
      </EmptyState>
    );
  }

  const { candidates, errors, truncated } = scan.result;
  const selectable = candidates.filter((c) => !c.alreadyImported);

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>
        Found {candidates.length} {candidates.length === 1 ? "repository" : "repositories"}
      </h1>

      {truncated && (
        <p className={styles.notice}>
          The scan stopped early — too many repositories. Narrow your project
          folders or reduce the scan depth.
        </p>
      )}

      <div className={styles.actions}>
        <button className="btn" onClick={() => setAllCandidates(true)}>
          Select all
        </button>
        <button className="btn" onClick={() => setAllCandidates(false)}>
          Select none
        </button>
        <button className="btn" onClick={() => void runScan()}>
          Rescan
        </button>
      </div>

      <div className={styles.list}>
        {candidates.map((c) => (
          <label
            key={c.candidateId}
            className={styles.row}
            data-disabled={c.alreadyImported || undefined}
          >
            <input
              type="checkbox"
              disabled={c.alreadyImported}
              checked={c.alreadyImported || scan.selected.has(c.candidateId)}
              onChange={() => toggleCandidate(c.candidateId)}
            />
            <span className={styles.name}>
              {c.name}
              {!c.isGit && <span className={styles.tag}>no git</span>}
              {c.alreadyImported && <span className={styles.tag}>imported</span>}
            </span>
            <code className={styles.path}>{c.displayPath}</code>
          </label>
        ))}
      </div>

      {errors.length > 0 && (
        <details className={styles.errors}>
          <summary>{errors.length} folder(s) could not be scanned</summary>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>
                <code>{e.path}</code> — {e.detail}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className={styles.footer}>
        <button className="btn" onClick={() => setRoute({ page: "list" })}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={scan.selected.size === 0 || scan.importing || selectable.length === 0}
          onClick={() => void importSelected()}
        >
          {scan.importing ? "Importing…" : `Import selected (${scan.selected.size})`}
        </button>
      </div>
    </div>
  );
}
