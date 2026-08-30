// xterm lifecycle singleton, deliberately OUTSIDE React: one live Terminal
// per session, kept alive across tab switches by reparenting its host div.
// term.open() is deferred until the host is in the DOM (opening detached
// renders blank in WKWebView), and the xterm constructor is resolved lazily
// inside ensureEntry - resolving it at module load can throw under some
// bundler/webview interop and abort module init, which would leave module
// consts (e.g. `entries`) permanently in the temporal dead zone even though
// the hoisted functions stay callable.

import * as XtermMod from "@xterm/xterm";
import * as FitMod from "@xterm/addon-fit";
import { invoke, Channel } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";

type XtermModule = typeof import("@xterm/xterm");
type XtermTerminal = InstanceType<XtermModule["Terminal"]>;

interface Entry {
  term: XtermTerminal;
  fit: InstanceType<typeof import("@xterm/addon-fit")["FitAddon"]>;
  channel: Channel<unknown>;
  hostDiv: HTMLDivElement;
  opened: boolean;
  attached: boolean;
}

// A hoisted `var` (initialised to undefined, never in the temporal dead
// zone) plus a lazy accessor makes the registry immune to circular-chunk
// initialisation ordering - the failure mode that left `entries` in the TDZ.
// eslint-disable-next-line no-var
var entriesMap: Map<string, Entry> | undefined;
function reg(): Map<string, Entry> {
  return (entriesMap ??= new Map<string, Entry>());
}

/** Resolve a constructor from a module namespace across interop shapes
 *  (named export, default export, or default-wrapped). Never called at
 *  module load. */
function resolveCtor<T>(mod: unknown, name: string): T {
  const m = mod as Record<string, unknown> & { default?: Record<string, unknown> };
  const ctor = m[name] ?? m.default?.[name] ?? m.default;
  if (typeof ctor !== "function") {
    throw new Error(
      `xterm: '${name}' constructor not found. Module keys: [${Object.keys(m).join(", ")}]` +
        (m.default ? `; default keys: [${Object.keys(m.default).join(", ")}]` : ""),
    );
  }
  return ctor as T;
}

function themeFromTokens() {
  const tokens = getComputedStyle(document.documentElement);
  const val = (name: string, fallback: string) =>
    tokens.getPropertyValue(name).trim() || fallback;
  const accent = val("--accent", "#f2467e");
  return {
    background: val("--bg-sunken", "#251e24"),
    foreground: val("--text", "#efeaee"),
    cursor: accent,
    selectionBackground: accent + "55",
  };
}

function writeChunk(term: XtermTerminal, message: unknown) {
  if (message instanceof ArrayBuffer) term.write(new Uint8Array(message));
  else if (typeof message === "string") term.write(message);
  else if (Array.isArray(message)) term.write(new Uint8Array(message));
}

function ensureEntry(sessionId: string): Entry {
  let entry = reg().get(sessionId);
  if (!entry) {
    const Terminal = resolveCtor<XtermModule["Terminal"]>(XtermMod, "Terminal");
    const FitAddon = resolveCtor<typeof import("@xterm/addon-fit")["FitAddon"]>(FitMod, "FitAddon");
    const term = new Terminal({
      fontFamily: "Menlo, Monaco, ui-monospace, SFMono-Regular, Consolas, monospace",
      fontSize: 13,
      scrollback: 5000,
      theme: themeFromTokens(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const hostDiv = document.createElement("div");
    hostDiv.style.width = "100%";
    hostDiv.style.height = "100%";
    term.onData((data) => {
      // The backend resets attention on write; no store call needed here.
      void invoke("agent_session_write", { sessionId, data }).catch(() => {});
    });
    const channel = new Channel<unknown>();
    channel.onmessage = (message) => writeChunk(term, message);
    entry = { term, fit, channel, hostDiv, opened: false, attached: false };
    reg().set(sessionId, entry);
  }
  return entry;
}

export function mountTerminal(sessionId: string, parent: HTMLElement, focus = true) {
  const entry = ensureEntry(sessionId);
  if (entry.hostDiv.parentElement !== parent) parent.appendChild(entry.hostDiv);
  if (!entry.opened) {
    entry.term.open(entry.hostDiv); // host is connected to the document now
    entry.opened = true;
  }
  requestAnimationFrame(() => {
    fitTerminal(sessionId);
    if (focus) entry.term.focus();
    if (!entry.attached) {
      entry.attached = true;
      void invoke("agent_session_attach", { sessionId, channel: entry.channel }).catch(() => {
        entry.attached = false;
      });
    }
  });
}

export function unmountTerminal(sessionId: string) {
  const entry = reg().get(sessionId);
  entry?.hostDiv.parentElement?.removeChild(entry.hostDiv);
}

export function fitTerminal(sessionId: string) {
  const entry = reg().get(sessionId);
  if (!entry || !entry.opened || !entry.hostDiv.isConnected) return;
  try {
    entry.fit.fit();
  } catch {
    return;
  }
  const { rows, cols } = entry.term;
  if (rows > 0 && cols > 0) {
    void invoke("agent_session_resize", { sessionId, rows, cols }).catch(() => {});
  }
}

export function applyTheme() {
  const theme = themeFromTokens();
  for (const entry of reg().values()) entry.term.options.theme = theme;
}

export function probeSize(parent: HTMLElement | null): { rows: number; cols: number } {
  if (!parent || parent.clientHeight === 0) return { rows: 30, cols: 100 };
  return {
    rows: Math.max(10, Math.floor(parent.clientHeight / 17)),
    cols: Math.max(40, Math.floor(parent.clientWidth / 8)),
  };
}

export function disposeTerminal(sessionId: string) {
  const entry = reg().get(sessionId);
  if (entry) {
    entry.term.dispose();
    entry.hostDiv.remove();
    reg().delete(sessionId);
  }
}

// Recolor open terminals when the app theme changes, without index needing
// to import this module (which would recreate the manager<->index cycle).
if (typeof window !== "undefined") {
  window.addEventListener("projque:themechange", () => applyTheme());
}
