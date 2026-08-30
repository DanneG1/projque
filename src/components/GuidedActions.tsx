import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { Icon } from "./Icon";
import styles from "./GuidedActions.module.css";

interface GuidedAction {
  id: string;
  label: string;
  hint: string;
  placeholder: string | null; // null = no input needed
  prompt: (input: string) => string;
}

const ACTIONS: GuidedAction[] = [
  {
    id: "fix",
    label: "Fix a problem",
    hint: "Describe what's broken; the agent finds and fixes it",
    placeholder:
      "What isn't working? Describe what you did, what happened, and what you expected - paste any error message you saw.",
    prompt: (input) =>
      `Something in this project isn't working. Here is what the user observed:\n\n${input}\n\nFind the cause and fix it. When you're done, explain what was wrong and what you changed in simple, non-technical language.`,
  },
  {
    id: "feature",
    label: "Add a feature",
    hint: "Describe what you want; the agent builds it",
    placeholder:
      "Describe what you want to add, as if explaining it to a friend. Example: “a contact page where visitors can send me a message”.",
    prompt: (input) =>
      `Add the following to this project:\n\n${input}\n\nImplement it completely and make sure it works with the rest of the project. When you're done, briefly explain what you added in simple, non-technical language.`,
  },
  {
    id: "style",
    label: "Improve the look",
    hint: "Polish the design, layout, and colors",
    placeholder:
      "Anything specific? (Optional - e.g. “make it feel more modern”, “bigger text”, “calmer colors”.)",
    prompt: (input) =>
      `Improve the visual design of this project${input ? ` with this direction from the user:\n\n${input}` : ""}.\n\nKeep changes tasteful and consistent - spacing, typography, colors, and layout. Do not change how the project works. Afterwards, summarize what you improved in simple terms.`,
  },
  {
    id: "explain",
    label: "Explain this project",
    hint: "Get a plain-language tour - nothing is changed",
    placeholder: null,
    prompt: () =>
      `Explain this project to someone who is not a programmer: what it does, how it is organized, what state it is in, and what might be worth doing next. Use simple language. Do not change any files.`,
  },
];

/** Guided ways to start the agent - a well-formed prompt is composed from
 *  the user's plain-language description, so the first move is made for
 *  them. The prompt reaches the agent through the existing initial_prompt
 *  path (same trust as typing into the session). */
export function GuidedActions({ projectId }: { projectId: string }) {
  const startAgentSession = useAppStore((s) => s.startAgentSession);
  const [active, setActive] = useState<GuidedAction | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const pick = (action: GuidedAction) => {
    if (action.placeholder === null) {
      void startAgentSession(projectId, undefined, action.prompt(""));
      return;
    }
    setActive(action);
    setInput("");
  };

  const start = async () => {
    if (!active || busy) return;
    const text = input.trim();
    if (active.id !== "style" && text === "") return;
    setBusy(true);
    await startAgentSession(projectId, undefined, active.prompt(text.slice(0, 3000)));
    setBusy(false);
    setActive(null);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.buttons}>
        {ACTIONS.map((a) => (
          <button
            key={a.id}
            className={styles.action}
            data-active={active?.id === a.id || undefined}
            title={a.hint}
            onClick={() => pick(a)}
          >
            <Icon name="agent" size={13} />
            {a.label}
          </button>
        ))}
      </div>
      {active && (
        <div className={styles.form}>
          <textarea
            className={styles.input}
            autoFocus
            rows={3}
            placeholder={active.placeholder ?? ""}
            value={input}
            maxLength={3000}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setActive(null);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void start();
            }}
          />
          <div className={styles.formActions}>
            <span className={styles.formHint}>
              Starts a Claude session in this project with your description.
            </span>
            <button className="btn" onClick={() => setActive(null)}>
              Cancel
            </button>
            <button
              className="btn"
              disabled={busy || (active.id !== "style" && input.trim() === "")}
              onClick={() => void start()}
            >
              Start agent
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
