import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import styles from "./IconButton.module.css";

export function IconButton({
  icon,
  tip,
  accent,
  disabled,
  onClick,
  children,
}: {
  icon?: IconName;
  tip: string;
  accent?: boolean;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  children?: ReactNode;
}) {
  return (
    <button
      className={styles.btn}
      data-accent={accent || undefined}
      data-tip={tip}
      aria-label={tip}
      disabled={disabled}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} size={15} /> : children}
    </button>
  );
}
