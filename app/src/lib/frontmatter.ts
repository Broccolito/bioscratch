// Frontmatter banner renderer.
//
// Parses a leading YAML frontmatter block and renders it as a generic,
// unlabelled "banner": every property becomes a bullet line, recursively, with
// no special-casing of particular keys (no icons, no chips, no titles). It just
// renders the data — much like a Mermaid block only renders its diagram without
// announcing that it is one.
//
// SECURITY: CSP is disabled app-wide, so every user-derived string is inserted
// with `textContent` only — never innerHTML.

import { parse as parseYaml } from "yaml";

export interface ParsedFrontmatter {
  /** Ordered entries as they appear in the source. */
  entries: Array<[string, unknown]>;
  /** True when the strict YAML parse failed and we fell back to line parsing. */
  malformed: boolean;
}

/**
 * Parse the YAML. Falls back to a forgiving line-based parser when the content
 * isn't valid YAML (common with Templater `<% %>` expressions, stray colons,
 * etc.) so the banner still shows something useful instead of an error.
 */
export function parseFrontmatter(yamlText: string): ParsedFrontmatter {
  const text = yamlText.replace(/^﻿/, "");
  if (!text.trim()) return { entries: [], malformed: false };
  try {
    const data = parseYaml(text, { strict: false });
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return { entries: Object.entries(data as Record<string, unknown>), malformed: false };
    }
    if (data !== null && data !== undefined) {
      return { entries: [["", data]], malformed: false };
    }
    return { entries: [], malformed: false };
  } catch {
    return { entries: lineParse(text), malformed: true };
  }
}

// Minimal "key: value" + "- item" line parser for malformed YAML.
function lineParse(text: string): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    if (trimmed.startsWith("- ") || trimmed === "-") {
      const item = trimmed.replace(/^-\s?/, "");
      if (out.length) {
        const last = out[out.length - 1];
        if (Array.isArray(last[1])) (last[1] as unknown[]).push(item);
        else last[1] = last[1] ? [last[1], item] : [item];
      }
      continue;
    }
    const m = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (m && indent === 0) {
      const key = m[1].trim();
      const val = stripQuotes(m[2].trim());
      out.push([key, val === "" ? null : val]);
    }
  }
  return out;
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

// ---- Value formatting ------------------------------------------------------

function scalarText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
}

// ---- DOM builders ----------------------------------------------------------

// Render an ordered set of [key, value] entries as a bullet list.
function renderEntries(entries: Array<[string, unknown]>): HTMLElement {
  const ul = document.createElement("ul");
  ul.className = "fm-list";
  for (const [key, value] of entries) {
    ul.appendChild(renderItem(key, value));
  }
  return ul;
}

// Render a single property as a bullet line. Scalars render inline as
// "key: value"; containers render "key:" with a nested list beneath.
function renderItem(key: string, value: unknown): HTMLElement {
  const li = document.createElement("li");
  li.className = "fm-item";

  const head = document.createElement("div");
  head.className = "fm-line";

  if (key !== "") {
    const k = document.createElement("span");
    k.className = "fm-key";
    k.textContent = key;
    head.appendChild(k);
  }

  const isArray = Array.isArray(value);
  const isObject = isPlainObject(value);
  const isContainer = (isArray && (value as unknown[]).length > 0) || (isObject && Object.keys(value as object).length > 0);

  if (!isContainer) {
    // Scalar (or empty container) — render the value inline next to the key.
    const v = document.createElement("span");
    v.className = "fm-val";
    v.textContent = scalarText(value);
    head.appendChild(v);
    li.appendChild(head);
    return li;
  }

  li.appendChild(head);

  if (isArray) {
    const ul = document.createElement("ul");
    ul.className = "fm-list fm-nested";
    for (const item of value as unknown[]) {
      if (isPlainObject(item) || Array.isArray(item)) {
        const sub = document.createElement("li");
        sub.className = "fm-item";
        sub.appendChild(
          isPlainObject(item)
            ? renderEntries(Object.entries(item))
            : renderEntries((item as unknown[]).map((x, i) => [String(i), x]))
        );
        ul.appendChild(sub);
      } else {
        const sub = document.createElement("li");
        sub.className = "fm-item";
        const line = document.createElement("div");
        line.className = "fm-line";
        const v = document.createElement("span");
        v.className = "fm-val";
        v.textContent = scalarText(item);
        line.appendChild(v);
        sub.appendChild(line);
        ul.appendChild(sub);
      }
    }
    li.appendChild(ul);
  } else {
    // Nested map.
    li.appendChild(renderEntries(Object.entries(value as Record<string, unknown>)));
  }

  return li;
}

/**
 * Build the banner element from raw YAML text. Empty frontmatter yields an
 * empty banner card with no placeholder text.
 */
export function renderFrontmatterBanner(yamlText: string): HTMLElement {
  const { entries } = parseFrontmatter(yamlText);

  const banner = document.createElement("div");
  banner.className = "fm-banner";
  if (entries.length) {
    banner.appendChild(renderEntries(entries));
  }
  return banner;
}
