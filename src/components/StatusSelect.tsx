import { STATUS_LABELS, STATUS_ORDER, type ProjectStatus } from "../models";

export function StatusSelect(props: {
  value: ProjectStatus;
  onChange: (status: ProjectStatus) => void;
}) {
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as ProjectStatus)}
      aria-label="Project status"
    >
      {STATUS_ORDER.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}
