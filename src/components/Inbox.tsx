import { useEffect, useRef } from "react";
import { useAppStore } from "../store/useAppStore";
import { Icon } from "./Icon";
import styles from "./Inbox.module.css";

function when(at: number): string {
  const s = Math.floor((Date.now() - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(at).toLocaleDateString();
}

/** Bell in the header + the dropdown list of everything that happened:
 *  finished sessions, things waiting for you, check results, errors. Toasts
 *  disappear; this does not, until you clear it. */
export function InboxButton() {
  const inbox = useAppStore((s) => s.inbox);
  const open = useAppStore((s) => s.inboxOpen);
  const setOpen = useAppStore((s) => s.setInboxOpen);
  const unread = inbox.filter((i) => !i.read).length;
  return (
    <button
      className="btn"
      data-active={open || undefined}
      data-attn={unread > 0 || undefined}
      title={unread > 0 ? `${unread} new notification${unread === 1 ? "" : "s"}` : "Notifications"}
      aria-label="Notifications"
      onClick={() => setOpen(!open)}
    >
      <Icon name="bell" size={15} />
      {unread > 0 && <span className={styles.count}>{unread}</span>}
    </button>
  );
}

export function InboxPanel() {
  const inbox = useAppStore((s) => s.inbox);
  const open = useAppStore((s) => s.inboxOpen);
  const setOpen = useAppStore((s) => s.setInboxOpen);
  const markRead = useAppStore((s) => s.markInboxRead);
  const clear = useAppStore((s) => s.clearInbox);
  const ref = useRef<HTMLDivElement>(null);

  // Click outside or Escape closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Defer so the opening click itself does not close it.
    const t = setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  if (!open) return null;
  const unread = inbox.filter((i) => !i.read).length;

  return (
    <div className={styles.panel} ref={ref} role="dialog" aria-label="Notifications">
      <div className={styles.head}>
        <span className={styles.title}>Notifications</span>
        <div className={styles.spacer} />
        {unread > 0 && (
          <button className={styles.link} onClick={() => markRead("all")}>
            Mark all read
          </button>
        )}
        {inbox.length > 0 && (
          <button className={styles.link} onClick={clear}>
            Clear
          </button>
        )}
      </div>
      {inbox.length === 0 ? (
        <p className={styles.empty}>Nothing yet. Finished sessions, things waiting for you, and check results show up here.</p>
      ) : (
        <ul className={styles.list}>
          {inbox.map((i) => (
            <li
              key={i.id}
              className={styles.item}
              data-variant={i.variant}
              data-unread={!i.read || undefined}
              data-clickable={i.onClick ? true : undefined}
              onClick={() => {
                markRead(i.id);
                if (i.onClick) {
                  setOpen(false);
                  i.onClick();
                }
              }}
            >
              <div className={styles.itemTitle}>{i.title}</div>
              {i.detail && <div className={styles.itemDetail}>{i.detail}</div>}
              <div className={styles.itemTime}>{when(i.at)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
