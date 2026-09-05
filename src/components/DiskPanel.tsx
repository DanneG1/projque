import { useEffect, useState } from "react";
import { api } from "../api/ipc";
import type { DiskUsage } from "../models";
import { useAppStore } from "../store/useAppStore";
import { formatBytes } from "../utils/time";
import styles from "./DiskPanel.module.css";

/** One project's reclaimable folders (installed packages, build output,
 *  caches) with a confirm-then-delete. Everything listed can be recreated
 *  by installing or building again; nothing else is ever offered. */
export function DiskRow({ projectId }: { projectId: string }) {
  const reportError = useAppStore((s) => s.reportError);
  const notify = useAppStore((s) => s.notify);
  const [usage, setUsage] = useState<DiskUsage | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUsage(null);
    setConfirm(false);
    api.projectDiskUsage(projectId).then((u) => !cancelled && setUsage(u)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!usage || usage.entries.length === 0) return null;

  const clean = async () => {
    setBusy(true);
    try {
      const freed = await api.projectDiskClean(projectId, usage.entries.map((e) => e.rel));
      notify("Space reclaimed", `${formatBytes(freed)} freed. Run the project again to reinstall what it needs.`, {
        variant: "success",
      });
      setUsage(await api.projectDiskUsage(projectId));
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <div className={styles.row}>
      <span className={styles.label}>Disk</span>
      <span className={styles.text}>
        <strong>{formatBytes(usage.totalBytes)}</strong> of reinstallable files:{" "}
        {usage.entries
          .slice(0, 4)
          .map((e) => `${e.rel} (${formatBytes(e.bytes)})`)
          .join(", ")}
        {usage.entries.length > 4 ? ` and ${usage.entries.length - 4} more` : ""}
      </span>
      {confirm ? (
        <span className={styles.confirm}>
          Delete these folders? They come back when you run or build the project again.
          <button className="btn" disabled={busy} onClick={() => void clean()}>
            {busy ? "Cleaning…" : "Yes, free the space"}
          </button>
          <button className="btn btn-ghost" onClick={() => setConfirm(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <button
          className="btn"
          title="Delete installed packages, build output and caches - all regenerated the next time the project is installed or built"
          onClick={() => setConfirm(true)}
        >
          Clean up
        </button>
      )}
    </div>
  );
}

/** Settings: scan every project and reclaim from any of them. */
export function DiskOverview() {
  const projects = useAppStore((s) => s.projects);
  const reportError = useAppStore((s) => s.reportError);
  const notify = useAppStore((s) => s.notify);
  const [usage, setUsage] = useState<Record<string, DiskUsage>>({});
  const [scanning, setScanning] = useState<null | { done: number; total: number }>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [confirmAll, setConfirmAll] = useState(false);

  const live = projects.filter((p) => p.pathExists);

  const scan = async () => {
    setScanning({ done: 0, total: live.length });
    const next: Record<string, DiskUsage> = {};
    for (const p of live) {
      try {
        next[p.id] = await api.projectDiskUsage(p.id);
      } catch {
        // unreadable project - skip
      }
      setScanning((s) => (s ? { ...s, done: s.done + 1 } : s));
      setUsage({ ...next });
    }
    setScanning(null);
  };

  const cleanOne = async (id: string) => {
    const u = usage[id];
    if (!u) return;
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const freed = await api.projectDiskClean(id, u.entries.map((e) => e.rel));
      setUsage((all) => ({ ...all, [id]: { totalBytes: 0, entries: [] } }));
      return freed;
    } catch (err) {
      reportError(err);
      return 0;
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  const rows = live
    .map((p) => ({ p, u: usage[p.id] }))
    .filter((r) => r.u && r.u.totalBytes > 0)
    .sort((a, b) => b.u!.totalBytes - a.u!.totalBytes);
  const total = rows.reduce((n, r) => n + r.u!.totalBytes, 0);
  const scanned = Object.keys(usage).length;

  const cleanAll = async () => {
    setConfirmAll(false);
    let freed = 0;
    for (const r of rows) freed += (await cleanOne(r.p.id)) ?? 0;
    notify("Space reclaimed", `${formatBytes(freed)} freed across ${rows.length} project${rows.length === 1 ? "" : "s"}.`, {
      variant: "success",
    });
  };

  return (
    <div className={styles.overview}>
      <div className={styles.overviewHead}>
        <button className="btn" disabled={scanning !== null || live.length === 0} onClick={() => void scan()}>
          {scanning ? `Scanning ${scanning.done} of ${scanning.total}…` : scanned ? "Scan again" : "Scan projects"}
        </button>
        {scanned > 0 && !scanning && (
          <span className={styles.summary}>
            {rows.length === 0
              ? "Nothing to reclaim."
              : `${formatBytes(total)} reinstallable across ${rows.length} project${rows.length === 1 ? "" : "s"}`}
          </span>
        )}
        {rows.length > 1 &&
          (confirmAll ? (
            <>
              <span className={styles.summary}>Delete in all {rows.length} projects?</span>
              <button className="btn" onClick={() => void cleanAll()}>
                Yes, free {formatBytes(total)}
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirmAll(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => setConfirmAll(true)}>
              Clean all
            </button>
          ))}
      </div>
      {rows.length > 0 && (
        <ul className={styles.list}>
          {rows.map(({ p, u }) => (
            <li key={p.id} className={styles.item}>
              <span className={styles.name}>{p.name}</span>
              <span className={styles.size}>{formatBytes(u!.totalBytes)}</span>
              <span className={styles.detail}>
                {u!.entries
                  .slice(0, 3)
                  .map((e) => e.rel)
                  .join(", ")}
                {u!.entries.length > 3 ? ` +${u!.entries.length - 3}` : ""}
              </span>
              <button className="btn" disabled={busy[p.id]} onClick={() => void cleanOne(p.id)}>
                {busy[p.id] ? "Cleaning…" : "Clean"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
