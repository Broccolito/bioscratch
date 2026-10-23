const { readFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");

// Exported documents cannot resolve a bundle's font asset paths. Keep the
// installed stylesheet and embed its WOFF2 faces so math also works offline.
exports.readEmbeddedStylesheet = function readEmbeddedStylesheet(filename) {
  return readFileSync(filename, "utf8").replace(/src\s*:\s*([^;}]+)(?=;|})/g, (rule, sources) => {
    const font = sources.match(/url\(["']?([^\s"')]+\.woff2)["']?\)/);
    if (!font) return rule;
    const bytes = readFileSync(resolve(dirname(filename), font[1]));
    return `src:url(data:font/woff2;base64,${bytes.toString("base64")}) format("woff2")`;
  });
};
