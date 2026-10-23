import { readFileSync } from "node:fs";

// Never include the source JSON or a parser exception in diagnostics: errors
// from the notarization service may contain private account information.
let result;
try {
  if (process.argv.length !== 3) throw new Error();
  result = JSON.parse(readFileSync(process.argv[2], "utf8"));
} catch {
  console.error("Notarization did not return a readable JSON result.");
  process.exit(1);
}

if (!result || Array.isArray(result) || typeof result !== "object" || result.status !== "Accepted") {
  console.error("Notarization result is not Accepted.");
  process.exit(1);
}
