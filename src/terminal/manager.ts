// xterm lifecycle singleton, deliberately OUTSIDE React: one live Terminal
// per session, kept alive across tab switches by reparenting its host div.
// term.open() is deferred until the host is in the DOM (opening detached
// renders blank in WKWebView), and the xterm constructor is resolved lazily
// inside ensureEntry — resolving it at module load can throw under some
// bundler/webview interop and abort module init, which would leave module
// consts (e.g. `entries`) permanently in the temporal dead zone even though
// the hoisted functions stay callable.

import * as XtermMod from "@xterm/xterm";
import * as FitMod from "@xterm/addon-fit";
import { Channel } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";
import { api } from "../api/ipc";
import { useAppStore } from "../store/useAppStore";

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

// Declared first so it is always initialized before any function runs.
const entries = new Map<string, Entry>();

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
  const accent = val("--accent", "#4f8bf5");
  return {
    background: val("--bg-sunken", "#1c1c20"),
    foreground: val("--text", "#e7e9f0"),
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
  let entry = entries.get(sessionId);
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
      useAppStore.getState().clearSessionAttention(sessionId);
      void api.agentSessionWrite(sessionId, data).catch(() => {});
    });
    const channel = new Channel<unknown>();
    channel.onmessage = (message) => writeChunk(term, message);
    entry = { term, fit, channel, hostDiv, opened: false, attached: false };
    entries.set(sessionId, entry);
  }
  return entry;
}

export function mountTerminal(sessionId: string, parent: HTMLElement) {
  const entry = ensureEntry(sessionId);
  if (entry.hostDiv.parentElement !== parent) parent.appendChild(entry.hostDiv);
  if (!entry.opened) {
    entry.term.open(entry.hostDiv); // host is connected to the document now
    entry.opened = true;
  }
  requestAnimationFrame(() => {
    fitTerminal(sessionId);
    entry.term.focus();
    if (!entry.attached) {
      entry.attached = true;
      void api.agentSessionAttach(sessionId, entry.channel).catch(() => {
        entry.attached = false;
      });
    }
  });
}

export function unmountTerminal(sessionId: string) {
  const entry = entries.get(sessionId);
  entry?.hostDiv.parentElement?.removeChild(entry.hostDiv);
}

export function fitTerminal(sessionId: string) {
  const entry = entries.get(sessionId);
  if (!entry || !entry.opened || !entry.hostDiv.isConnected) return;
  try {
    entry.fit.fit();
  } catch {
    return;
  }
  const { rows, cols } = entry.term;
  if (rows > 0 && cols > 0) {
    void api.agentSessionResize(sessionId, rows, cols).catch(() => {});
  }
}

export function applyTheme() {
  const theme = themeFromTokens();
  for (const entry of entries.values()) entry.term.options.theme = theme;
}

export function probeSize(parent: HTMLElement | null): { rows: number; cols: number } {
  if (!parent || parent.clientHeight === 0) return { rows: 30, cols: 100 };
  return {
    rows: Math.max(10, Math.floor(parent.clientHeight / 17)),
    cols: Math.max(40, Math.floor(parent.clientWidth / 8)),
  };
}

export function disposeTerminal(sessionId: string) {
  const entry = entries.get(sessionId);
  if (entry) {
    entry.term.dispose();
    entry.hostDiv.remove();
    entries.delete(sessionId);
  }
}
