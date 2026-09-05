import { useAppStore, type ProjectFilter } from "../store/useAppStore";
import { useT } from "../i18n";
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
  const projects = useAppStore((s) => s.projects);
  const showArchived = useAppStore((s) => s.settings?.display.showArchived ?? false);
  const t = useT();

  // Mirror useSortedProjects' visibility rule (minus search): each count is
  // what selecting that tab would show.
  const base = showArchived ? projects : projects.filter((p) => p.status !== "archived");
  const count = (f: ProjectFilter): number => {
    switch (f) {
      case "all":
        return base.length;
      case "favorites":
        return base.filter((p) => p.favorite).length;
      case "archived":
        return projects.filter((p) => p.status === "archived").length;
      default:
        return base.filter((p) => p.status === f).length;
    }
  };

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
          {t(f.label)}
          <span className={styles.count}>{count(f.value)}</span>
        </button>
      ))}
    </div>
  );
}
