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
  {
    id: "cleanup",
    label: "Tidy up the code",
    hint: "Remove dead code and simplify - nothing the project does changes",
    placeholder: null,
    prompt: () => "", // handled by startCleanup (stamps the tidy-up baseline)
  },
  {
    id: "setup",
    label: "Set up this project",
    hint: "Get it installed and running on this computer, following its README",
    placeholder: null,
    prompt: () =>
      `Get this project running on this computer. Read the README and the project's manifest files to learn how it is installed and started, then install its dependencies and start it once to confirm it works. Before installing anything system-wide (a language runtime, a database, a global tool), stop and explain in plain language what it is, why the project needs it, and ask before proceeding. Do not change the project's code or configuration except where the README explicitly asks for a local setup step (like copying .env.example to .env - never invent secret values, ask for them). When it runs, tell the user in simple terms how to start it next time and what to open in the browser, if anything.`,
  },
];

// ---------------------------------------------------------------------------
// Roleplay testers: parallel agent sessions that each stay in character as a
// different kind of user and hunt for bugs and missing features.

interface Persona {
  id: string;
  label: string;
  hint: string;
  /** In-character description injected into the tester prompt. */
  character: string;
}

const PERSONAS: Persona[] = [
  {
    id: "first-timer",
    label: "First-time visitor",
    hint: "Zero context - can they figure out what this is and get started?",
    character:
      "someone who just landed on this project with zero context. You don't know what it is or does. You try to figure that out, get it started, and accomplish the most obvious basic task. Anything that needs prior knowledge is a problem worth noting.",
  },
  {
    id: "non-technical",
    label: "Non-technical user",
    hint: "Never reads docs, clicks around, confused by any jargon",
    character:
      "a non-technical user. You never read documentation - you click and type based on what the interface suggests. Technical jargon, error codes, and anything that assumes programming knowledge confuses you. If something goes wrong you don't debug it, you just get frustrated and note it.",
  },
  {
    id: "power-user",
    label: "Power user",
    hint: "Expert who pushes advanced features, shortcuts, and limits",
    character:
      "an expert power user. You want speed and depth: keyboard shortcuts, batch operations, advanced options, large amounts of data. You notice missing conveniences, inconsistencies between features, and workflows that take more steps than they should.",
  },
  {
    id: "impatient",
    label: "Impatient user",
    hint: "Rushes, skips instructions, does things in the wrong order",
    character:
      "an impatient user in a hurry. You skip instructions, click the first thing that looks right, submit forms half-filled, press buttons twice, and do steps out of order. If something takes more than a moment or isn't obvious, you note it and move on.",
  },
  {
    id: "breaker",
    label: "Edge-case hunter",
    hint: "Deliberately probes weird input, empty states, and boundaries",
    character:
      "a mischievous tester who probes the edges. You feed in weird input: empty values, very long text, special characters, zero and negative numbers, rapid repeated actions, unusual sequences. You check empty states and what happens when prerequisites are missing.",
  },
  {
    id: "returning",
    label: "Returning casual user",
    hint: "Used it once weeks ago, remembers little, works from memory",
    character:
      "a casual user coming back after weeks away. You vaguely remember what the project does but none of the details. You work from memory and expectation, not docs, and notice everything that is hard to rediscover or behaves differently than you expected.",
  },
];

const MAX_TESTERS = 4; // matches the terminal grid's 4-pane limit

function testerPrompt(persona: Persona, audience: string): string {
  return (
    `You are one of several roleplay testers exploring this project in parallel, each playing a different kind of user. Your character: ${persona.label} - you are ${persona.character}` +
    (audience ? `\n\nThe project's intended audience, per its owner: ${audience}` : "") +
    `\n\nWork like this:\n` +
    `1. Orient yourself just enough to know what the project is and how to start it. If it can be run, run it and interact with it for real; if not, walk through the flows your character would use by reading the interface text and code.\n` +
    `2. Stay in character the whole session: pursue the goals this person would have, the way they would - including their shortcuts, mistakes, and expectations.\n` +
    `3. Hunt for problems your character would hit: bugs, confusing wording, missing features, dead ends. Cover the main flows, not just the happy path.\n\n` +
    `Strict rules:\n` +
    `- Do NOT fix, change, or create any project files, with one exception: your report.\n` +
    `- Write your findings to a new file named roleplay-${persona.id}.md in the project root. That file is yours alone - other testers are working in this directory at the same time, so never touch their roleplay-*.md files, other files, or their running processes.\n` +
    `- Report format: one intro line about who you are, then sections "## Bugs", "## Missing features", and "## Confusions", each a markdown checklist (- [ ] item). One sentence per item, plus how to reproduce it when that helps.\n\n` +
    `When you have covered the main flows, save the report and end with a short in-character verdict on the project in the terminal.`
  );
}

/** Guided ways to start the agent - a well-formed prompt is composed from
 *  the user's plain-language description, so the first move is made for
 *  them. The prompt reaches the agent through the existing initial_prompt
 *  path (same trust as typing into the session). */
export function GuidedActions({ projectId }: { projectId: string }) {
  const startAgentSession = useAppStore((s) => s.startAgentSession);
  const startRoleplayTest = useAppStore((s) => s.startRoleplayTest);
  const startCleanup = useAppStore((s) => s.startCleanup);
  const [active, setActive] = useState<GuidedAction | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [roleplayOpen, setRoleplayOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([
    "first-timer",
    "non-technical",
    "power-user",
  ]);
  const [audience, setAudience] = useState("");

  const pick = (action: GuidedAction) => {
    setRoleplayOpen(false);
    if (action.id === "cleanup") {
      void startCleanup(projectId);
      return;
    }
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

  const togglePersona = (id: string) => {
    setPicked((prev) =>
      prev.includes(id)
        ? prev.filter((p) => p !== id)
        : prev.length >= MAX_TESTERS
          ? prev
          : [...prev, id],
    );
  };

  const startRoleplay = async () => {
    if (busy) return;
    const chosen = PERSONAS.filter((p) => picked.includes(p.id));
    if (chosen.length === 0) return;
    setBusy(true);
    await startRoleplayTest(
      projectId,
      chosen.map((p) => ({
        label: p.label,
        prompt: testerPrompt(p, audience.trim().slice(0, 500)),
      })),
    );
    setBusy(false);
    setRoleplayOpen(false);
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
        <button
          className={styles.action}
          data-active={roleplayOpen || undefined}
          title="Send in pretend users - each tests the project in character and reports what they hit"
          onClick={() => {
            setActive(null);
            setRoleplayOpen((v) => !v);
          }}
        >
          <Icon name="users" size={13} />
          Roleplay testers
        </button>
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
      {roleplayOpen && (
        <div className={styles.form}>
          <div className={styles.personaGrid}>
            {PERSONAS.map((p) => {
              const on = picked.includes(p.id);
              const full = !on && picked.length >= MAX_TESTERS;
              return (
                <button
                  key={p.id}
                  className={styles.persona}
                  data-on={on || undefined}
                  disabled={full}
                  title={full ? `Up to ${MAX_TESTERS} testers run side by side` : p.hint}
                  onClick={() => togglePersona(p.id)}
                >
                  <span className={styles.personaCheck}>
                    {on && <Icon name="check" size={11} />}
                  </span>
                  <span>
                    <span className={styles.personaLabel}>{p.label}</span>
                    <span className={styles.personaHint}>{p.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <input
            className={styles.input}
            type="text"
            placeholder="Who is this project for? (Optional - helps the testers act like your real users.)"
            value={audience}
            maxLength={500}
            onChange={(e) => setAudience(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setRoleplayOpen(false);
              if (e.key === "Enter") void startRoleplay();
            }}
          />
          <div className={styles.formActions}>
            <span className={styles.formHint}>
              Each tester is a separate Claude session, shown side by side. They
              explore in character and write findings to roleplay-*.md files in
              the project - they don't change your code.
            </span>
            <button className="btn" onClick={() => setRoleplayOpen(false)}>
              Cancel
            </button>
            <button
              className="btn"
              disabled={busy || picked.length === 0}
              onClick={() => void startRoleplay()}
            >
              {picked.length <= 1
                ? "Start tester"
                : `Start ${picked.length} testers`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
