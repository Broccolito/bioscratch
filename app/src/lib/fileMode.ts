export type FileMode = "markdown" | "plaintext" | "code";

const MARKDOWN_EXT = new Set(["md", "markdown"]);
const PLAINTEXT_EXT = new Set(["txt", "text"]);

// Maps extension → highlight.js language id
const CODE_LANG_MAP: Record<string, string> = {
  // Web
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript",
  html: "html", htm: "html",
  css: "css", scss: "scss", sass: "scss", less: "less",
  vue: "html", svelte: "html",
  // Systems / compiled
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hxx: "cpp",
  cs: "csharp",
  java: "java",
  kt: "kotlin", kts: "kotlin",
  swift: "swift",
  rs: "rust",
  go: "go",
  zig: "zig",
  scala: "scala",
  m: "matlab", mat: "matlab",
  // Scripting
  py: "python", pyw: "python",
  rb: "ruby",
  lua: "lua",
  pl: "perl", pm: "perl",
  php: "php",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  ps1: "powershell",
  bat: "dos", cmd: "dos",
  // Scientific / data science
  r: "r", rmd: "r",
  jl: "julia",
  f: "fortran", f90: "fortran", f95: "fortran", for: "fortran",
  // Functional
  ex: "elixir", exs: "elixir",
  erl: "erlang", hrl: "erlang",
  hs: "haskell", lhs: "haskell",
  ml: "ocaml", mli: "ocaml",
  fs: "fsharp", fsx: "fsharp", fsi: "fsharp",
  clj: "clojure", cljs: "clojure",
  lisp: "lisp", el: "lisp",
  // Data / config with syntax support
  json: "json", json5: "json",
  yaml: "yaml", yml: "yaml",
  toml: "toml",
  xml: "xml", plist: "xml",
  ini: "ini", cfg: "ini", conf: "ini", env: "ini",
  sql: "sql",
  graphql: "graphql", gql: "graphql",
  proto: "protobuf",
  // DevOps / infra
  tf: "hcl", tfvars: "hcl", hcl: "hcl",
  dockerfile: "dockerfile",
  makefile: "makefile",
  cmake: "cmake",
  gradle: "groovy",
  // Markup / docs
  tex: "latex",
  rst: "restructuredtext",
  // Diff / misc
  diff: "diff", patch: "diff",
  vim: "vim",
  ipynb: "json",
};

/** Determine how to render a file based on its extension. */
export function getFileMode(path: string | null): FileMode {
  if (!path) return "markdown";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (MARKDOWN_EXT.has(ext)) return "markdown";
  if (PLAINTEXT_EXT.has(ext)) return "plaintext";
  if (ext in CODE_LANG_MAP) return "code";
  return "plaintext"; // unknown extension → attempt plain text
}

/** Returns the highlight.js language id for a file, or "" if none. */
export function getCodeLanguage(path: string | null): string {
  if (!path) return "";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return CODE_LANG_MAP[ext] ?? "";
}

// Extensions Bioscratch opens as text (drag-drop, sidebar, quick switcher).
const TEXT_EXTENSIONS = new Set([
  // Markdown / text / data
  "md","markdown","txt","text","csv","tsv","xml","json","json5","yaml","yml","toml","ini","env","cfg","conf","config",
  // Web
  "html","htm","css","scss","sass","less","js","jsx","ts","tsx","mjs","cjs","vue","svelte","astro",
  // Systems / compiled
  "c","h","cpp","cc","cxx","hpp","hxx","cs","java","kt","kts","scala","swift","m","mm","zig","v",
  // Scripting
  "py","pyw","rb","rbw","lua","pl","pm","php","sh","bash","zsh","fish","ps1","psm1","bat","cmd",
  // Scientific / data science
  "r","rmd","jl","ipynb","m","mat","f","f90","f95","for",
  // Systems / DevOps
  "rs","go","ex","exs","erl","hrl","hs","lhs","ml","mli","fs","fsx","fsi","clj","cljs","cljc","lisp","el","vim","lua",
  // Config / infra
  "dockerfile","makefile","cmake","gradle","properties","plist","tf","tfvars","hcl","nix","cabal",
  // Docs / markup
  "tex","rst","adoc","org","wiki",
  // Misc
  "sql","graphql","gql","proto","thrift","avsc","log","diff","patch",
]);

/** True for files Bioscratch can open in a tab. Extensionless names such as
 *  `Makefile` match on the whole name. */
export function isOpenableTextFile(path: string): boolean {
  const name = path.split("/").pop() ?? "";
  return TEXT_EXTENSIONS.has(name.split(".").pop()?.toLowerCase() ?? "");
}
