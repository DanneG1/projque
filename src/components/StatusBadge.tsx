import type { ProjectStatus } from "../models";
import { useT } from "../i18n";
import styles from "./StatusBadge.module.css";

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={styles.chip} data-status={status}>
      {useT()(`status.${status}`)}
    </span>
  );
}
