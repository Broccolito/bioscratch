import type { Plugin } from "vite";
import { readEmbeddedStylesheet } from "../scripts/embed-styles.cjs";

/** Import a stylesheet as text, embedding its fonts for standalone exports. */
export function exportStylesPlugin(): Plugin {
  const prefix = "\0bioscratch-export-css:";
  const files = new Map<string, string>();
  return {
    name: "bioscratch-export-css",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!source.endsWith("?embedded")) return null;
      const resolved = await this.resolve(source.slice(0, -9), importer, { skipSelf: true });
      if (!resolved) throw new Error(`Cannot resolve export stylesheet: ${source}`);
      const id = prefix + files.size + ".js";
      files.set(id, resolved.id);
      return id;
    },
    load(id) {
      const filename = files.get(id);
      if (!filename) return null;
      return `export default ${JSON.stringify(readEmbeddedStylesheet(filename))};`;
    },
  };
}
