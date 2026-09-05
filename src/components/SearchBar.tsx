import { forwardRef } from "react";
import { Icon } from "./Icon";
import { useAppStore } from "../store/useAppStore";
import { useT } from "../i18n";
import styles from "./SearchBar.module.css";

export const SearchBar = forwardRef<HTMLInputElement>(function SearchBar(_props, ref) {
  const query = useAppStore((s) => s.query);
  const setQuery = useAppStore((s) => s.setQuery);
  const t = useT();
  return (
    <div className={styles.wrap}>
      <Icon name="search" size={13} />
      <input
        ref={ref}
        className={styles.input}
        type="search"
        placeholder={t("Search projects")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setQuery("");
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <span className={styles.kbd}>/</span>
    </div>
  );
});
