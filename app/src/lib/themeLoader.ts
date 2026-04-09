import { invoke } from "@tauri-apps/api/core";

// Built-in theme raw YAML imports
import lightRaw from "../themes/light.yaml?raw";
import darkRaw from "../themes/dark.yaml?raw";
import spotifyLightRaw from "../themes/spotify_light.yaml?raw";
import spotifyDarkRaw from "../themes/spotify_dark.yaml?raw";
import githubLightRaw from "../themes/github_light.yaml?raw";
import githubDarkRaw from "../themes/github_dark.yaml?raw";
import ibmLightRaw from "../themes/ibm_light.yaml?raw";
import ibmDarkRaw from "../themes/ibm_dark.yaml?raw";
import materialLightRaw from "../themes/material_light.yaml?raw";
import materialDarkRaw from "../themes/material_dark.yaml?raw";
import atlassianLightRaw from "../themes/atlassian_light.yaml?raw";
import atlassianDarkRaw from "../themes/atlassian_dark.yaml?raw";
import microsoftLightRaw from "../themes/microsoft_light.yaml?raw";
import microsoftDarkRaw from "../themes/microsoft_dark.yaml?raw";
import appleLightRaw from "../themes/apple_light.yaml?raw";
import appleDarkRaw from "../themes/apple_dark.yaml?raw";
import mediumLightRaw from "../themes/medium_light.yaml?raw";
import mediumDarkRaw from "../themes/medium_dark.yaml?raw";
import twitterLightRaw from "../themes/twitter_light.yaml?raw";
import twitterDarkRaw from "../themes/twitter_dark.yaml?raw";
import antLightRaw from "../themes/ant_light.yaml?raw";
import antDarkRaw from "../themes/ant_dark.yaml?raw";
import ubuntuLightRaw from "../themes/ubuntu_light.yaml?raw";
import ubuntuDarkRaw from "../themes/ubuntu_dark.yaml?raw";
import nasaLightRaw from "../themes/nasa_light.yaml?raw";
import nasaDarkRaw from "../themes/nasa_dark.yaml?raw";
import audiLightRaw from "../themes/audi_light.yaml?raw";
import audiDarkRaw from "../themes/audi_dark.yaml?raw";
import bbcLightRaw from "../themes/bbc_light.yaml?raw";
import bbcDarkRaw from "../themes/bbc_dark.yaml?raw";
import mailchimpLightRaw from "../themes/mailchimp_light.yaml?raw";
import mailchimpDarkRaw from "../themes/mailchimp_dark.yaml?raw";

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

// Tauri IPC for user themes
export async function fetchUserThemes(): Promise<UserThemeEntry[]> {
  try {
    return await invoke<UserThemeEntry[]>("list_user_themes");
  } catch {
    return [];
  }
}

export async function saveUserTheme(filename: string, content: string): Promise<void> {
  await invoke("save_user_theme", { filename, content });
}

export async function deleteUserTheme(filename: string): Promise<void> {
  await invoke("delete_user_theme", { filename });
}
