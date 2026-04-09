import { useState, useLayoutEffect } from "react";
import {
  ThemeName,
  applyTheme,
  builtinThemeConfigs,
  parseUserThemeYaml,
} from "../lib/themeLoader";

export type { ThemeName };

/** Resolve CSS vars for a theme id, given optional user-theme map. */
function resolveVars(
  name: ThemeName,
  userThemeVars: Record<string, Record<string, string>>
): Record<string, string> {
  return builtinThemeConfigs[name] ?? userThemeVars[name] ?? builtinThemeConfigs["light"];
}

export function useTheme(userThemeVars: Record<string, Record<string, string>> = {}) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    const stored = localStorage.getItem("bioscratch-theme");
    if (stored) return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  // useLayoutEffect applies before browser paint – no flash.
  useLayoutEffect(() => {
    const vars = resolveVars(theme, userThemeVars);
    applyTheme(theme, vars);
    localStorage.setItem("bioscratch-theme", theme);
  }, [theme, userThemeVars]);

  const setTheme = (t: ThemeName) => setThemeState(t);

  return { theme, setTheme };
}

/** Parse a user-imported YAML content string into vars. */
export { parseUserThemeYaml };
