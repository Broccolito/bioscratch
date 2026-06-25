// Two-target build:
//   1. Extension host  — Node/CommonJS, `vscode` external           → dist/extension.js
//   2. Webview app     — browser/IIFE, bundles React + ProseMirror  → dist/webview.js (+ webview.css)
const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: "info",
};

const hostBuild = {
  ...common,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
};

const webviewBuild = {
  ...common,
  entryPoints: ["src/webview/index.tsx"],
  outfile: "dist/webview.js",
  platform: "browser",
  format: "iife",
  target: "es2020",
  jsx: "automatic",
  // The webview runs in a browser context with no Node globals. React and some
  // unified/remark internals read `process.env.NODE_ENV`; define it (and map
  // `global` → `globalThis`) so the bundle doesn't throw at load time.
  define: {
    "process.env.NODE_ENV": production ? '"production"' : '"development"',
    global: "globalThis",
  },
  // Safety shim: a few unified/vfile internals reference `process.cwd()` /
  // `process.platform` in rarely-hit code paths. Provide a no-op stand-in so a
  // stray reference can never crash the webview at runtime.
  banner: {
    js: "globalThis.process = globalThis.process || { env: {}, platform: 'browser', cwd: function(){ return '/'; }, version: '' };",
  },
  loader: {
    ".css": "css",
    ".yaml": "text",
    ".woff": "file",
    ".woff2": "file",
    ".ttf": "file",
    ".eot": "file",
    ".svg": "dataurl",
    ".png": "dataurl",
  },
};

async function run() {
  if (watch) {
    const [hostCtx, webviewCtx] = await Promise.all([
      esbuild.context(hostBuild),
      esbuild.context(webviewBuild),
    ]);
    await Promise.all([hostCtx.watch(), webviewCtx.watch()]);
    console.log("[esbuild] watching…");
  } else {
    await Promise.all([esbuild.build(hostBuild), esbuild.build(webviewBuild)]);
    console.log("[esbuild] build complete");
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
