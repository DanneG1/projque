import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { markReviewSeen, reviewSeenThisWeek } from "../pages/ReviewPage";
import { Icon } from "./Icon";
import styles from "./SparkBanner.module.css";

/** First open of a new week: point at the weekly review once. */
export function ReviewBanner() {
  const setRoute = useAppStore((s) => s.setRoute);
  const projects = useAppStore((s) => s.projects);
  const [seen, setSeen] = useState(reviewSeenThisWeek);
  useEffect(() => {
    const on = () => setSeen(true);
    window.addEventListener("projque:reviewseen", on);
    return () => window.removeEventListener("projque:reviewseen", on);
  }, []);
  if (seen || projects.length < 2) return null;
  return (
    <div className={styles.banner}>
      <Icon name="clock" size={15} className={styles.glyph} />
      <span className={styles.text}>
        New week - your <strong>weekly review</strong> is ready: what happened, what is waiting, and one
        health check for everything.
      </span>
      <button className="btn btn-primary" onClick={() => setRoute({ page: "review" })}>
        Open review
      </button>
      <button
        className={styles.action}
        title="Not now"
        onClick={markReviewSeen}
      >
        ✕
      </button>
    </div>
  );
}
