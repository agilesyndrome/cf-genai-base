import test from "node:test";
import assert from "node:assert/strict";
import { compareVersions, formatVersionOutput, localVersion, PACKAGE_NAME } from "../src/cli/version.js";
import { targetArgs } from "@agilesyndrome/cf-genai-base/cli/d1";

test("CLI version identity is the base package", () => {
  assert.equal(PACKAGE_NAME, "@agilesyndrome/cf-genai-base");
  assert.match(localVersion(), /^\d+\.\d+\.\d+/);
  assert.deepEqual(targetArgs("local"), ["--local"]);
});

test("version comparison handles releases and prereleases", () => {
  assert.equal(compareVersions("1.2.4", "1.2.3") > 0, true);
  assert.equal(compareVersions("1.2.3", "1.2.3-beta.1") > 0, true);
  assert.equal(compareVersions("1.2.3-beta.2", "1.2.3-beta.10") < 0, true);
});

test("version output includes upgrade instructions only when npm is newer", () => {
  const upgrade = formatVersionOutput({ local: "0.1.3", latest: "0.1.4" });
  assert.match(upgrade, /local: 0\.1\.3/);
  assert.match(upgrade, /latest: 0\.1\.4/);
  assert.match(upgrade, /npm i -g @agilesyndrome\/cf-genai-base/);

  const current = formatVersionOutput({ local: "0.1.4", latest: "0.1.4" });
  assert.doesNotMatch(current, /Upgrade available/);
});
