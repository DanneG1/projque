// Applies the display settings to the document root. "system" is resolved
// here into an explicit data-theme so every style's token set only has to
// know about two states (light / dark), and so a scoped preview element can
// carry the same attributes as the root (see the style picker in Settings).
//
// Leaf module on purpose: index imports it at boot, so it must never pull in
// app code that reaches the terminal module (see terminal/manager).
import type { Style, Theme } from "../models/settings";

export type ResolvedTheme = "light" | "dark";

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "light" || theme === "dark") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(theme: Theme, style: Style) {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(theme);
  root.dataset.style = style;
  // Notify any open terminals to recolor (manager self-subscribes) without
  // importing the terminal module - that would recreate a circular chunk
  // dependency that leaves manager's bindings in the TDZ.
  window.dispatchEvent(new Event("projque:themechange"));
}

/** Apply the settings now and follow the OS while theme is "system".
 *  Returns the cleanup for the OS listener. */
export function applyAppearance(theme: Theme, style: Style): () => void {
  apply(theme, style);
  if (theme !== "system") return () => {};
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => apply(theme, style);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
