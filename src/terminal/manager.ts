// xterm lifecycle singleton, deliberately OUTSIDE React: one live Terminal
// per session, kept alive across tab switches and route changes by
// reparenting its host div. Backend scrollback replay only happens on a
// fresh attach (webview reload), so tab switching is instant and lossless.
// Idempotent create/attach guards make React 19 StrictMode double-mounts
// harmless, and keeping the Channel referenced here prevents its callback
// from being garbage collected.

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
  attached: boolean;
}

const entries = new Map<string, Entry>();

function themeFromTokens() {
  const tokens = getComputedStyle(document.documentElement);
  const value = (name: string) => tokens.getPropertyValue(name).trim();
  return {
    background: value("--bg-sunken"),
    foreground: value("--text"),
    cursor: value("--accent"),
    selectionBackground: value("--accent") + "55",
  };
}

function writeChunk(term: Terminal, message: unknown) {
  if (message instanceof ArrayBuffer) {
    term.write(new Uint8Array(message));
  } else if (typeof message === "string") {
    term.write(message);
  } else if (Array.isArray(message)) {
    term.write(new Uint8Array(message));
  }
}

/** Create (or return) the live terminal for a session and attach the output
 *  channel exactly once. */
export function ensureTerminal(sessionId: string): Entry {
  let entry = entries.get(sessionId);
  if (!entry) {
    const term = new Terminal({
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 13,
      scrollback: 5000,
      theme: themeFromTokens(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const hostDiv = document.createElement("div");
    hostDiv.style.width = "100%";
    hostDiv.style.height = "100%";
    term.open(hostDiv);
    term.onData((data) => {
      useAppStore.getState().clearSessionAttention(sessionId);
      void api.agentSessionWrite(sessionId, data).catch(() => {
        /* exited session: keystrokes are simply dropped */
      });
    });
    const channel = new Channel<unknown>();
    channel.onmessage = (message) => writeChunk(term, message);
    entry = { term, fit, channel, hostDiv, attached: false };
    entries.set(sessionId, entry);
  }
  if (!entry.attached) {
    entry.attached = true;
    void api.agentSessionAttach(sessionId, entry.channel).catch(() => {
      entry.attached = false;
    });
  }
  return entry;
}

/** Reparent the terminal into a mount point (idempotent). */
export function mountTerminal(sessionId: string, parent: HTMLElement) {
  const entry = ensureTerminal(sessionId);
  if (entry.hostDiv.parentElement !== parent) {
    parent.appendChild(entry.hostDiv);
  }
  fitTerminal(sessionId);
  entry.term.focus();
}

export function unmountTerminal(sessionId: string) {
  const entry = entries.get(sessionId);
  entry?.hostDiv.parentElement?.removeChild(entry.hostDiv);
}

export function fitTerminal(sessionId: string) {
  const entry = entries.get(sessionId);
  if (!entry || !entry.hostDiv.isConnected) return;
  entry.fit.fit();
  const { rows, cols } = entry.term;
  void api.agentSessionResize(sessionId, rows, cols).catch(() => {});
}

export function applyTheme() {
  const theme = themeFromTokens();
  for (const entry of entries.values()) {
    entry.term.options.theme = theme;
  }
}

/** Initial size for agent_session_start, measured against a probe div. */
export function probeSize(parent: HTMLElement | null): { rows: number; cols: number } {
  if (!parent) return { rows: 30, cols: 100 };
  // ~8px per column / ~17px per row at fontSize 13; the exact fit() follows
  // right after mount, this only avoids a tiny first-paint resize.
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
