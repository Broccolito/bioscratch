// @vitest-environment jsdom
import { expect, it } from "vitest";
import { parse } from "yaml";
import syntaxCss from "../src/styles/syntax.css?embedded";
import darkTheme from "../src/themes/biorouter_dark.yaml?raw";
import lightTheme from "../src/themes/light.yaml?raw";

function contrast(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => {
      const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

it.each([
  { name: "Biorouter Dark", yaml: darkTheme },
  { name: "Light", yaml: lightTheme },
])("keeps highlighted strings readable in $name", ({ yaml }) => {
  const style = document.createElement("style");
  style.textContent = syntaxCss;
  document.head.appendChild(style);
  try {
    // Strings inherit this rule rather than a hardcoded navy light-theme color.
    const rules = [...style.sheet!.cssRules] as CSSStyleRule[];
    const string = document.createElement("span");
    string.className = "hljs-string";
    const stringRule = rules.find((rule) => string.matches(rule.selectorText));
    expect(stringRule?.style.getPropertyValue("color")).toBe("var(--text-primary, #2b2620)");
    const theme = parse(yaml) as Record<string, string>;
    expect(contrast(theme["text-primary"], theme["code-bg"])).toBeGreaterThanOrEqual(4.5);
  } finally {
    style.remove();
  }
});
