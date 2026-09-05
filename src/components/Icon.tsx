// Inline SVG icon set. One stroke-based family (currentColor) so icons take
// their color from context and stay crisp at 14–16px, matching the app's
// circa-2010 Mac look.
import type { CSSProperties, ReactElement } from "react";

export type IconName =
  | "bell"
  | "idea"
  | "split"
  | "stop"
  | "close"
  | "folder"
  | "editor"
  | "agent"
  | "run"
  | "terminal"
  | "branch"
  | "repo"
  | "more"
  | "chevron"
  | "search"
  | "refresh"
  | "plus"
  | "settings"
  | "fetch"
  | "external"
  | "check"
  | "clock"
  | "trash"
  | "star"
  | "flame"
  | "locate"
  | "users";

const PATHS: Record<IconName, ReactElement> = {
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  editor: <path d="m8 6-6 6 6 6M16 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />,
  agent: <path d="M13 2 4.5 13H11l-1 9 8.5-11H12z" strokeLinecap="round" strokeLinejoin="round" />,
  run: <path d="M7 5v14l11-7z" fill="currentColor" stroke="none" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 3-5.6 6.5-5.6s6.5 2 6.5 5.6" strokeLinecap="round" />
      <path d="M15.5 5.2a3.5 3.5 0 0 1 0 5.6M17 14.9c2.6.7 4.5 2.4 4.5 5.1" strokeLinecap="round" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3M13 15h4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  branch: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <path d="M18 10.5c0 4-6 2.5-6 7.5M6 8.5v7" />
    </>
  ),
  repo: (
    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.5 1.3a12 12 0 0 0-6 0C7 .7 6 1 6 1a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 4.5 7.5c0 4.6 2.7 5.7 5.5 6-.4.4-.5.8-.5 2V19" />
  ),
  more: (
    <g fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </g>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" strokeLinecap="round" />
    </>
  ),
  refresh: <path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />,
  plus: <path d="M12 5v14M5 12h14" strokeLinecap="round" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  fetch: <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" strokeLinecap="round" strokeLinejoin="round" />,
  external: <path d="M10 14 21 3m0 0h-6m6 0v6M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" strokeLinecap="round" strokeLinejoin="round" />,
  check: <path d="m5 12 5 5 9-11" strokeLinecap="round" strokeLinejoin="round" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4l3 2" strokeLinecap="round" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7" strokeLinecap="round" strokeLinejoin="round" />,
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z" strokeLinejoin="round" />,
  flame: (
    <path
      d="M12 2.8c.7 3.2-3.5 4.9-3.5 8.7a4.5 4.5 0 0 0 9 0c0-2.6-1.5-4.3-2.6-5.9-.2 1.3-.8 2.2-1.7 2.7.3-1.8-.1-3.9-1.2-5.5zM10 16.5a2 2 0 0 0 4 0c0-1.2-.9-1.9-2-3-1.1 1.1-2 1.8-2 3z"
      fill="currentColor"
      stroke="none"
    />
  ),
  idea: (
    <path
      d="M9.5 17.5h5M10 20.5h4M12 3a6 6 0 0 0-3.9 10.6c.8.7 1.2 1.6 1.4 2.6l.1.8h4.8l.1-.8c.2-1 .6-1.9 1.4-2.6A6 6 0 0 0 12 3z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  split: (
    <path
      d="M4 5.5h16v13H4zM12 5.5v13M4 12h16"
      strokeLinejoin="round"
    />
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />,
  close: <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />,
  bell: (
    <>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z" strokeLinejoin="round" />
      <path d="M10 20a2 2 0 0 0 4 0" strokeLinecap="round" />
    </>
  ),
  locate: (
    <>
      <circle cx="12" cy="10" r="3" />
      <path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11z" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={className}
      style={style}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
