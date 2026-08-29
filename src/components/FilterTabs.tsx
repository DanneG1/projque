import { useAppStore, type ProjectFilter } from "../store/useAppStore";
import styles from "./FilterTabs.module.css";

const FILTERS: { value: ProjectFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "favorites", label: "Favorites" },
  { value: "active", label: "Active" },
  { value: "idea", label: "Ideas" },
  { value: "paused", label: "Paused" },
  { value: "archived", label: "Archived" },
];

export function FilterTabs() {
  const filter = useAppStore((s) => s.filter);
  const setFilter = useAppStore((s) => s.setFilter);
  return (
    <div className={styles.tabs} role="tablist">
      {FILTERS.map((f) => (
        <button
          key={f.value}
          role="tab"
          aria-selected={filter === f.value}
          className={styles.tab}
          data-active={filter === f.value || undefined}
          onClick={() => setFilter(f.value)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
