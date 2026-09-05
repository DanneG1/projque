import { STATUS_ORDER, type ProjectStatus } from "../models";
import { useT } from "../i18n";

export function StatusSelect(props: {
  value: ProjectStatus;
  onChange: (status: ProjectStatus) => void;
}) {
  const t = useT();
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as ProjectStatus)}
      aria-label="Project status"
    >
      {STATUS_ORDER.map((s) => (
        <option key={s} value={s}>
          {t(`status.${s}`)}
        </option>
      ))}
    </select>
  );
}
