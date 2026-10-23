import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const privateSentinel = "SYNTHETIC_PRIVATE_CREDENTIAL_SENTINEL";
const accepted = JSON.stringify({ status: "Accepted" });
const source = new URL("./", import.meta.url);

// Exercise the real shell script without invoking a build, Apple tools, or real
// credentials. Stubs record only operation names, never their argument values.
function release(overrides = {}, replies = [accepted, accepted]) {
  const root = mkdtempSync(join(tmpdir(), "bioscratch-release-test-"));
  const app = join(root, "app");
  const scripts = join(app, "scripts");
  const bin = join(root, "bin");
  const temporary = join(root, "private");
  for (const path of [scripts, bin, temporary, join(root, "notarization"), join(app, "build/release")]) {
    mkdirSync(path, { recursive: true });
  }
  for (const script of ["release-macos.sh", "check-notarization-result.mjs"]) {
    copyFileSync(new URL(script, source), join(scripts, script));
  }
  writeFileSync(join(app, "package.json"), JSON.stringify({ version: "0.6.0" }));
  writeFileSync(join(scripts, "check-release-version.mjs"), "process.exit(Number(process.env.RELEASE_TEST_PREFLIGHT_EXIT || 0));\n");
  writeFileSync(join(scripts, "build-quicklook.sh"), 'printf "quicklook\\n" >> "$RELEASE_TEST_EVENTS"\nprintf "%s\\n" "$SIGNING_IDENTITY"\n');
  writeFileSync(join(root, "notarization/notarization_entitlements.plist"), "fixture");
  const published = join(app, "build/release/Bioscratch_0.6.0_aarch64.dmg");
  if (overrides.RELEASE_TEST_DESTINATION === "directory") {
    mkdirSync(published);
  } else if (overrides.RELEASE_TEST_DESTINATION === "symlink") {
    symlinkSync(temporary, published);
  } else {
    writeFileSync(published, "previous release");
  }
  const stub = join(bin, "command.cjs");
  writeFileSync(stub, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const event = (name) => fs.appendFileSync(process.env.RELEASE_TEST_EVENTS, name + "\\n");
if (command === "npm") {
  event("build");
  process.exit(Number(process.env.RELEASE_TEST_BUILD_EXIT || 0));
} else if (command === "ditto" || command === "hdiutil") {
  event(command);
  fs.writeFileSync(args.at(-1), command === "ditto" ? "zip" : "new dmg");
} else if (command === "codesign") {
  event(args.includes("--sign") ? "sign-dmg" : "verify-signature");
  if (args.includes("--sign")) process.stderr.write(${JSON.stringify(privateSentinel)});
} else if (command === "xcrun" && args[0] === "notarytool") {
  const countPath = process.env.RELEASE_TEST_EVENTS + ".count";
  const count = fs.existsSync(countPath) ? Number(fs.readFileSync(countPath, "utf8")) : 0;
  fs.writeFileSync(countPath, String(count + 1));
  event("notarize:" + (count + 1));
  if (!args.includes("--wait") || args[args.indexOf("--output-format") + 1] !== "json") process.exit(9);
  if ((fs.statSync(path.dirname(args[2])).mode & 0o077) !== 0 || (fs.fstatSync(1).mode & 0o077) !== 0) process.exit(10);
  const replies = JSON.parse(process.env.RELEASE_TEST_REPLIES);
  process.stdout.write(replies[count] || replies.at(-1));
  process.stderr.write(${JSON.stringify(privateSentinel)});
  process.exit(Number(process.env.RELEASE_TEST_NOTARY_EXIT || 0));
} else if (command === "xcrun" && args[0] === "stapler") {
  event(args[1] + ":" + (args[2].endsWith(".dmg") ? "dmg" : "app"));
  process.exit(Number(process.env.RELEASE_TEST_STAPLER_EXIT || 0));
} else {
  process.exit(11);
}
`, { mode: 0o755 });
  for (const command of ["npm", "ditto", "hdiutil", "codesign", "xcrun"]) {
    symlinkSync(stub, join(bin, command));
  }
  const eventsPath = join(root, "events");
  const env = {
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: root,
    TMPDIR: temporary,
    ARCHES: "aarch64",
    APPLE_ID: privateSentinel,
    APPLE_APP_SPECIFIC_PASSWORD: privateSentinel,
    APPLE_TEAM_ID: privateSentinel,
    SIGNING_IDENTITY: privateSentinel,
    RELEASE_TEST_EVENTS: eventsPath,
    RELEASE_TEST_REPLIES: JSON.stringify(replies),
    ...overrides,
  };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }
  try {
    // -x verifies the script disables inherited tracing before credential use.
    const result = spawnSync("/bin/bash", ["-x", join(scripts, "release-macos.sh")], { env, encoding: "utf8" });
    assert.ifError(result.error);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(privateSentinel), "private data leaked to output");
    assert.deepEqual(readdirSync(temporary), [], "private temporary files were not removed");
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      events: existsSync(eventsPath) ? readFileSync(eventsPath, "utf8").trim().split("\n") : [],
      published: statSync(published).isFile() ? readFileSync(published, "utf8") : null,
      intelPublished: existsSync(join(app, "build/release/Bioscratch_0.6.0_x64.dmg")),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("publishes only after Accepted results and successful staple validation", () => {
  const result = release();
  assert.equal(result.status, 0, result.output);
  assert.equal(result.published, "new dmg");
  assert.deepEqual(result.events, [
    "build", "quicklook", "verify-signature", "ditto", "notarize:1",
    "staple:app", "validate:app", "hdiutil", "sign-dmg", "verify-signature",
    "notarize:2", "staple:dmg", "validate:dmg",
  ]);
});

for (const reply of [
  "not JSON " + privateSentinel,
  JSON.stringify({ status: "Invalid", message: privateSentinel }),
  JSON.stringify({ status: "Rejected" }),
  JSON.stringify({ status: "In Progress" }),
  JSON.stringify({ status: "accepted" }),
  "{}", "null", "[]",
]) {
  test(`refuses to staple an unaccepted result (${reply.slice(0, 35)})`, () => {
    const result = release({}, [reply]);
    assert.notEqual(result.status, 0);
    assert.ok(!result.events.some((event) => event.startsWith("staple:")));
    assert.equal(result.published, "previous release");
  });
}

test("a failed command cannot pass even with an Accepted response", () => {
  const result = release({ RELEASE_TEST_NOTARY_EXIT: "7" });
  assert.notEqual(result.status, 0);
  assert.ok(!result.events.some((event) => event.startsWith("staple:")));
  assert.equal(result.published, "previous release");
});

test("a rejected DMG never replaces the existing release artifact", () => {
  const result = release({}, [accepted, JSON.stringify({ status: "Invalid" })]);
  assert.notEqual(result.status, 0);
  assert.ok(result.events.includes("staple:app"));
  assert.ok(!result.events.includes("staple:dmg"));
  assert.equal(result.published, "previous release");
});

test("a stapler failure never publishes the artifact", () => {
  const result = release({ RELEASE_TEST_STAPLER_EXIT: "1" });
  assert.notEqual(result.status, 0);
  assert.equal(result.published, "previous release");
});

for (const destination of ["directory", "symlink"]) {
  test(`rejects an existing ${destination} as the release destination`, () => {
    const result = release({ RELEASE_TEST_DESTINATION: destination });
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.events, []);
    assert.equal(result.published, null);
  });
}

for (const name of ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID", "SIGNING_IDENTITY"]) {
  for (const value of [undefined, ""]) {
    test(`rejects ${value === undefined ? "unset" : "empty"} ${name} before building`, () => {
      const result = release({ [name]: value });
      assert.notEqual(result.status, 0);
      assert.deepEqual(result.events, []);
      assert.ok(result.output.includes(`${name} must be set and nonempty.`));
    });
  }
}

for (const arches of ["", " ", "arm64", "../aarch64", "aarch64 aarch64", "aarch64\nx86_64", "*"]) {
  test(`rejects invalid ARCHES ${JSON.stringify(arches)} before building`, () => {
    const result = release({ ARCHES: arches });
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.events, []);
  });
}

test("version mismatches and metadata preflight failures stop before building", () => {
  for (const overrides of [{ VERSION: "0.5.0" }, { VERSION: "" }, { RELEASE_TEST_PREFLIGHT_EXIT: "1" }]) {
    const result = release(overrides);
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.events, []);
  }
});

test("the default architecture list publishes both named assets", () => {
  const result = release({ ARCHES: undefined });
  assert.equal(result.status, 0, result.output);
  assert.equal(result.events.filter((event) => event === "build").length, 2);
  assert.equal(result.published, "new dmg");
  assert.equal(result.intelPublished, true);
});
