import type { GraphCommit } from "../models";
import { relativeTime } from "../utils/time";
import styles from "./CommitGraph.module.css";

const ROW_H = 30;
const LANE_W = 14;
const PAD = 10;

const LANE_COLORS = [
  "#d6215f",
  "#3d92c4",
  "#37a24a",
  "#d38a1a",
  "#8d62d1",
  "#c4533d",
  "#2ba393",
];

interface Layout {
  lane: Map<string, number>;
  row: Map<string, number>;
  maxLane: number;
}

/** Assign a lane to every commit. Input is newest-first topo order, so a
 *  commit always appears before its parents; each lane tracks the next hash
 *  expected in it (its most recent commit's first parent). */
function layout(commits: GraphCommit[]): Layout {
  const lane = new Map<string, number>();
  const row = new Map<string, number>();
  const lanes: (string | null)[] = [];
  let maxLane = 0;

  const freeLane = () => {
    const idx = lanes.indexOf(null);
    if (idx !== -1) return idx;
    lanes.push(null);
    return lanes.length - 1;
  };

  commits.forEach((c, r) => {
    row.set(c.hash, r);
    let myLane = lanes.indexOf(c.hash);
    if (myLane === -1) {
      myLane = freeLane();
    }
    // Other lanes waiting for this same commit converge here and free up.
    for (let i = 0; i < lanes.length; i++) {
      if (i !== myLane && lanes[i] === c.hash) lanes[i] = null;
    }
    lane.set(c.hash, myLane);
    maxLane = Math.max(maxLane, myLane);

    const [first, ...rest] = c.parents;
    lanes[myLane] = first ?? null;
    for (const p of rest) {
      if (!lanes.includes(p)) {
        const l = freeLane();
        lanes[l] = p;
        maxLane = Math.max(maxLane, l);
      }
    }
  });
  return { lane, row, maxLane };
}

const x = (l: number) => PAD + l * LANE_W;
const y = (r: number) => r * ROW_H + ROW_H / 2;

export function CommitGraph({
  commits,
  selected,
  onSelect,
}: {
  commits: GraphCommit[];
  selected: string | null;
  onSelect: (hash: string) => void;
}) {
  if (commits.length === 0) {
    return <p className={styles.empty}>No commits yet.</p>;
  }
  const { lane, row, maxLane } = layout(commits);
  const svgW = PAD * 2 + maxLane * LANE_W;
  const svgH = commits.length * ROW_H;

  const edges: { d: string; color: string }[] = [];
  for (const c of commits) {
    const r0 = row.get(c.hash)!;
    const l0 = lane.get(c.hash)!;
    for (const p of c.parents) {
      const rp = row.get(p);
      const color = LANE_COLORS[(lane.get(p) ?? l0) % LANE_COLORS.length];
      if (rp === undefined) {
        // Parent beyond the loaded window: stub downward.
        edges.push({
          d: `M ${x(l0)} ${y(r0)} L ${x(l0)} ${svgH}`,
          color: LANE_COLORS[l0 % LANE_COLORS.length],
        });
        continue;
      }
      const lp = lane.get(p)!;
      const mid = y(rp) - ROW_H / 2;
      edges.push({
        d:
          l0 === lp
            ? `M ${x(l0)} ${y(r0)} L ${x(lp)} ${y(rp)}`
            : `M ${x(l0)} ${y(r0)} C ${x(l0)} ${mid}, ${x(lp)} ${mid}, ${x(lp)} ${y(rp)}`,
        color,
      });
    }
  }

  return (
    <div className={styles.wrap}>
      <svg className={styles.svg} width={svgW} height={svgH} aria-hidden="true">
        {edges.map((e, i) => (
          <path key={i} d={e.d} stroke={e.color} strokeWidth="1.6" fill="none" opacity="0.8" />
        ))}
        {commits.map((c) => {
          const l = lane.get(c.hash)!;
          const r = row.get(c.hash)!;
          return (
            <circle
              key={c.hash}
              cx={x(l)}
              cy={y(r)}
              r={c.isHead ? 5 : 3.6}
              fill={LANE_COLORS[l % LANE_COLORS.length]}
              stroke="var(--bg-raised)"
              strokeWidth="1.5"
            />
          );
        })}
      </svg>
      <ul className={styles.rows} style={{ height: svgH }}>
        {commits.map((c) => (
          <li key={c.hash} style={{ height: ROW_H }}>
            <button
              className={styles.rowBtn}
              data-selected={selected === c.hash || undefined}
              onClick={() => onSelect(c.hash)}
              title={`${c.subject}\n${c.author} · ${c.shortHash}`}
            >
              {c.refs.map((ref) => (
                <span key={ref} className={styles.ref} data-remote={ref.includes("/") || undefined}>
                  {ref}
                </span>
              ))}
              <span className={styles.subject}>{c.subject}</span>
              <span className={styles.meta}>
                {c.author} · {c.shortHash} · {relativeTime(c.timestamp)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
