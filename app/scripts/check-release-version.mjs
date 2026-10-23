import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const json = (path) => JSON.parse(read(path));
const version = json("app/package.json").version;

for (const path of ["app/src-tauri/tauri.conf.json", "extension/package.json"]) {
  assert.equal(json(path).version, version, `${path}: version`);
}
for (const path of ["app/package-lock.json", "extension/package-lock.json"]) {
  const lock = json(path);
  assert.equal(lock.version, version, `${path}: root version`);
  assert.equal(lock.packages[""].version, version, `${path}: package version`);
}
assert.equal(
  read("app/src-tauri/Cargo.toml").match(/^version = "([^"]+)"/m)?.[1],
  version,
  "Cargo.toml: package version",
);
assert.equal(
  read("app/src-tauri/Cargo.lock").match(/name = "bioscratch"\nversion = "([^"]+)"/)?.[1],
  version,
  "Cargo.lock: bioscratch version",
);
for (const key of ["CFBundleShortVersionString", "CFBundleVersion"]) {
  const match = read("app/src-tauri/quicklook/Info.plist").match(
    new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`),
  );
  assert.equal(match?.[1], version, `Quick Look: ${key}`);
}
for (const path of ["landing/index.html", "landing/README.md"]) {
  const content = read(path);
  for (const arch of ["aarch64", "x64"]) {
    assert.ok(
      content.includes(`/v${version}/Bioscratch_${version}_${arch}.dmg`),
      `${path}: ${arch} download`,
    );
  }
}
assert.ok(read(`release-notes/v${version}.md`).startsWith(`# Bioscratch ${version}`));
assert.ok(read("extension/CHANGELOG.md").includes(`## ${version}\n`));
console.log(`Release metadata agrees on Bioscratch ${version}.`);
