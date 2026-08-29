import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

export function EmptyState(props: { title: string; children?: ReactNode }) {
  return (
    <div className={styles.wrap}>
      <div className={styles.title}>{props.title}</div>
      {props.children && <div className={styles.body}>{props.children}</div>}
    </div>
  );
}
