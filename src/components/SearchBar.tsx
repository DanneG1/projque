import { forwardRef } from "react";
import { useAppStore } from "../store/useAppStore";
import styles from "./SearchBar.module.css";

export const SearchBar = forwardRef<HTMLInputElement>(function SearchBar(_props, ref) {
  const query = useAppStore((s) => s.query);
  const setQuery = useAppStore((s) => s.setQuery);
  return (
    <input
      ref={ref}
      className={styles.input}
      type="search"
      placeholder="Search projects…  ( / )"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setQuery("");
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
});
