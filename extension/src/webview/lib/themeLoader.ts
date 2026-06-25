import { saveUserThemeHost, deleteUserThemeHost } from "../bridge";

// Built-in theme raw YAML imports. esbuild's `text` loader (configured for
// `.yaml`) inlines each file's contents as a string — the VS Code equivalent of
// Vite's `?raw` suffix used by the desktop app.
import lightRaw from "../themes/light.yaml";
import darkRaw from "../themes/dark.yaml";
import spotifyLightRaw from "../themes/spotify_light.yaml";
import spotifyDarkRaw from "../themes/spotify_dark.yaml";
import githubLightRaw from "../themes/github_light.yaml";
import githubDarkRaw from "../themes/github_dark.yaml";
import ibmLightRaw from "../themes/ibm_light.yaml";
import ibmDarkRaw from "../themes/ibm_dark.yaml";
import materialLightRaw from "../themes/material_light.yaml";
import materialDarkRaw from "../themes/material_dark.yaml";
import atlassianLightRaw from "../themes/atlassian_light.yaml";
import atlassianDarkRaw from "../themes/atlassian_dark.yaml";
import microsoftLightRaw from "../themes/microsoft_light.yaml";
import microsoftDarkRaw from "../themes/microsoft_dark.yaml";
import appleLightRaw from "../themes/apple_light.yaml";
import appleDarkRaw from "../themes/apple_dark.yaml";
import mediumLightRaw from "../themes/medium_light.yaml";
import mediumDarkRaw from "../themes/medium_dark.yaml";
import twitterLightRaw from "../themes/twitter_light.yaml";
import twitterDarkRaw from "../themes/twitter_dark.yaml";
import antLightRaw from "../themes/ant_light.yaml";
import antDarkRaw from "../themes/ant_dark.yaml";
import ubuntuLightRaw from "../themes/ubuntu_light.yaml";
import ubuntuDarkRaw from "../themes/ubuntu_dark.yaml";
import nasaLightRaw from "../themes/nasa_light.yaml";
import nasaDarkRaw from "../themes/nasa_dark.yaml";
import audiLightRaw from "../themes/audi_light.yaml";
import audiDarkRaw from "../themes/audi_dark.yaml";
import bbcLightRaw from "../themes/bbc_light.yaml";
import bbcDarkRaw from "../themes/bbc_dark.yaml";
import mailchimpLightRaw from "../themes/mailchimp_light.yaml";
import mailchimpDarkRaw from "../themes/mailchimp_dark.yaml";

export type ThemeName = string;

export interface UserThemeEntry {
  filename: string;
  content: string;
}

function parseYaml(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const val = trimmed.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
    if (key && val) result[key] = val;
  }
  return result;
}

// Built-in themes: [id, raw yaml] pairs
export const BUILTIN_THEME_RAWS: [string, string][] = [
  ["light", lightRaw],
  ["dark", darkRaw],
  ["spotify_light", spotifyLightRaw],
  ["spotify_dark", spotifyDarkRaw],
  ["github_light", githubLightRaw],
  ["github_dark", githubDarkRaw],
  ["ibm_light", ibmLightRaw],
  ["ibm_dark", ibmDarkRaw],
  ["material_light", materialLightRaw],
  ["material_dark", materialDarkRaw],
  ["atlassian_light", atlassianLightRaw],
  ["atlassian_dark", atlassianDarkRaw],
  ["microsoft_light", microsoftLightRaw],
  ["microsoft_dark", microsoftDarkRaw],
  ["apple_light", appleLightRaw],
  ["apple_dark", appleDarkRaw],
  ["medium_light", mediumLightRaw],
  ["medium_dark", mediumDarkRaw],
  ["twitter_light", twitterLightRaw],
  ["twitter_dark", twitterDarkRaw],
  ["ant_light", antLightRaw],
  ["ant_dark", antDarkRaw],
  ["ubuntu_light", ubuntuLightRaw],
  ["ubuntu_dark", ubuntuDarkRaw],
  ["nasa_light", nasaLightRaw],
  ["nasa_dark", nasaDarkRaw],
  ["audi_light", audiLightRaw],
  ["audi_dark", audiDarkRaw],
  ["bbc_light", bbcLightRaw],
  ["bbc_dark", bbcDarkRaw],
  ["mailchimp_light", mailchimpLightRaw],
  ["mailchimp_dark", mailchimpDarkRaw],
];

export const builtinThemeConfigs: Record<string, Record<string, string>> = Object.fromEntries(
  BUILTIN_THEME_RAWS.map(([id, raw]) => [id, parseYaml(raw)])
);

/** A theme is "dark" if its id is "dark" or ends with "_dark". */
export function isDarkTheme(name: ThemeName): boolean {
  return name === "dark" || name.endsWith("_dark");
}

/** Apply theme vars to :root as CSS custom properties. */
export function applyTheme(name: ThemeName, vars: Record<string, string>): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", name);
  root.setAttribute("data-color-scheme", isDarkTheme(name) ? "dark" : "light");
  for (const [key, value] of Object.entries(vars)) {
    if (key === "name") continue;
    root.style.setProperty(`--${key}`, value);
  }
}

export function getThemeDisplayName(vars: Record<string, string>, fallback: string): string {
  return vars["name"] ?? fallback;
}

export function getThemeSwatches(vars: Record<string, string>): string[] {
  return [
    vars["bg-editor"] ?? "",
    vars["bg-toolbar"] ?? "",
    vars["accent"] ?? "",
    vars["text-primary"] ?? "",
  ];
}

export function parseUserThemeYaml(content: string): Record<string, string> {
  return parseYaml(content);
}

// User theme persistence is delegated to the extension host (VS Code global
// storage) via the message bridge. The initial set arrives in the `init`
// payload; subsequent saves/deletes round-trip a fresh `userThemes` message.
export function saveUserTheme(filename: string, content: string): void {
  saveUserThemeHost(filename, content);
}

export function deleteUserTheme(filename: string): void {
  deleteUserThemeHost(filename);
}
