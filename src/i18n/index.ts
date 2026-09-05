// Tiny, dependency-free localization. English strings are the keys; a
// language dictionary maps them to translations, and anything missing
// falls back to English so a partial dictionary never shows a blank.
//
// Usage: const t = useT(); t("Scan folders"); t("{n} projects", { n: 3 })

import { useAppStore } from "../store/useAppStore";
import { sv } from "./sv";

export type Lang = "en" | "sv";
export type LangSetting = "system" | Lang;

/** Keys that are not plain English text (looked up in every language). */
const en: Record<string, string> = {
  "status.idea": "Idea",
  "status.active": "Active",
  "status.paused": "Paused",
  "status.maintenance": "Maintenance",
  "status.done": "Done",
  "status.archived": "Archived",
};

const DICTS: Record<Lang, Record<string, string>> = { en, sv };

export const LANGUAGES: { value: LangSetting; label: string }[] = [
  { value: "system", label: "System" },
  { value: "en", label: "English" },
  { value: "sv", label: "Svenska" },
];

export function resolveLang(setting: LangSetting | undefined): Lang {
  if (setting === "en" || setting === "sv") return setting;
  const nav = (typeof navigator !== "undefined" ? navigator.language : "en").toLowerCase();
  return nav.startsWith("sv") ? "sv" : "en";
}

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let text = DICTS[lang][key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
  }
  return text;
}

export type T = (key: string, vars?: Record<string, string | number>) => string;

/** The translate function for the current language setting. */
export function useT(): T {
  const setting = useAppStore((s) => s.settings?.display.language as LangSetting | undefined);
  const lang = resolveLang(setting);
  return (key, vars) => translate(lang, key, vars);
}

/** Outside React (toasts from the store). */
export function tNow(key: string, vars?: Record<string, string | number>): string {
  const setting = useAppStore.getState().settings?.display.language as LangSetting | undefined;
  return translate(resolveLang(setting), key, vars);
}
