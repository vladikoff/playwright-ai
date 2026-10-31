import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTestDir, inspectProject, specPath, uniqueSpecPath, writeSpec } from "../lib/project.js";

let dir;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "pwai-project-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("parseTestDir", () => {
  test("reads single, double and backtick quoted values", () => {
    assert.equal(parseTestDir("testDir: './e2e',"), "./e2e");
    assert.equal(parseTestDir('testDir: "tests"'), "tests");
    assert.equal(parseTestDir("testDir:`specs`"), "specs");
  });
  test("returns null when absent", () => assert.equal(parseTestDir("export default {}"), null));
});

describe("inspectProject", () => {
  test("uses defaults for an empty directory", async () => {
    assert.deepEqual(await inspectProject(dir), {
      configFile: null,
      testDir: "tests",
      language: "js",
      hasPlaywright: false,
    });
  });
  test("reads a JS config", async () => {
    await fs.writeFile(path.join(dir, "playwright.config.js"), "export default { testDir: './e2e' }");
    const p = await inspectProject(dir);
    assert.equal(p.configFile, path.join(dir, "playwright.config.js"));
    assert.equal(p.testDir, "./e2e");
    assert.equal(p.language, "js");
  });
  test("prefers a TS config and marks language ts", async () => {
    await fs.writeFile(path.join(dir, "playwright.config.ts"), "export default { testDir: 'specs' }");
    await fs.writeFile(path.join(dir, "playwright.config.js"), "export default { testDir: 'other' }");
    const p = await inspectProject(dir);
    assert.equal(p.testDir, "specs");
    assert.equal(p.language, "ts");
  });
  test("treats tsconfig as a TypeScript hint", async () => {
    await fs.writeFile(path.join(dir, "tsconfig.json"), "{}");
    assert.equal((await inspectProject(dir)).language, "ts");
  });
  test("detects an installed @playwright/test", async () => {
    await fs.mkdir(path.join(dir, "node_modules", "@playwright", "test"), { recursive: true });
    assert.equal((await inspectProject(dir)).hasPlaywright, true);
  });
});

describe("specPath / uniqueSpecPath / writeSpec", () => {
  test("builds js and ts paths", () => {
    assert.equal(
      specPath({ cwd: "/p", testDir: "tests", component: "nav", language: "js" }),
      "/p/tests/nav.spec.js",
    );
    assert.equal(
      specPath({ cwd: "/p", testDir: "./e2e", component: "nav", language: "ts" }),
      "/p/e2e/nav.spec.ts",
    );
  });
  test("returns the plain path when free", async () => {
    const file = await uniqueSpecPath({ cwd: dir, testDir: "tests", component: "nav", language: "js" });
    assert.equal(file, path.join(dir, "tests", "nav.spec.js"));
  });
  test("adds a numeric suffix when the file exists", async () => {
    await writeSpec(path.join(dir, "tests", "nav.spec.js"), "a");
    await writeSpec(path.join(dir, "tests", "nav_2.spec.js"), "b");
    const file = await uniqueSpecPath({ cwd: dir, testDir: "tests", component: "nav", language: "js" });
    assert.equal(file, path.join(dir, "tests", "nav_3.spec.js"));
  });
  test("overwrite returns the plain path even when it exists", async () => {
    await writeSpec(path.join(dir, "tests", "nav.spec.js"), "a");
    const file = await uniqueSpecPath({
      cwd: dir,
      testDir: "tests",
      component: "nav",
      language: "js",
      overwrite: true,
    });
    assert.equal(file, path.join(dir, "tests", "nav.spec.js"));
  });
  test("writeSpec creates directories and ensures a trailing newline", async () => {
    const file = path.join(dir, "deep", "er", "x.spec.js");
    await writeSpec(file, "code");
    assert.equal(await fs.readFile(file, "utf8"), "code\n");
    await writeSpec(file, "code\n");
    assert.equal(await fs.readFile(file, "utf8"), "code\n");
  });
});
