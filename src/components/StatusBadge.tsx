import { STATUS_LABELS, type ProjectStatus } from "../models";
import styles from "./StatusBadge.module.css";

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={styles.chip} data-status={status}>
      {STATUS_LABELS[status]}
    </span>
  );
}
