// xterm lifecycle singleton, deliberately OUTSIDE React: one live Terminal
// per session, kept alive across tab switches by reparenting its host div.
// term.open() is deferred until the host is actually in the DOM — opening on
// a detached element renders a blank/black terminal in WKWebView.

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Channel } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";
import { api } from "../api/ipc";
import { useAppStore } from "../store/useAppStore";

interface Entry {
  term: Terminal;
  fit: FitAddon;
  channel: Channel<unknown>;
  hostDiv: HTMLDivElement;
  opened: boolean;
  attached: boolean;
}

const entries = new Map<string, Entry>();

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

function writeChunk(term: Terminal, message: unknown) {
  if (message instanceof ArrayBuffer) term.write(new Uint8Array(message));
  else if (typeof message === "string") term.write(message);
  else if (Array.isArray(message)) term.write(new Uint8Array(message));
}

function ensureEntry(sessionId: string): Entry {
  let entry = entries.get(sessionId);
  if (!entry) {
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

/** Reparent the terminal into a mount point, opening it (once) now that the
 *  host is in the DOM, then fit + attach + focus. */
export function mountTerminal(sessionId: string, parent: HTMLElement) {
  const entry = ensureEntry(sessionId);
  if (entry.hostDiv.parentElement !== parent) {
    parent.appendChild(entry.hostDiv);
  }
  if (!entry.opened) {
    entry.term.open(entry.hostDiv); // host is now connected to the document
    entry.opened = true;
  }
  // Fit after layout settles, then attach the output channel exactly once.
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

/** Initial size for agent_session_start, measured against a probe div. */
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
