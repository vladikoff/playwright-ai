import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "index.js");

async function run(args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], { cwd: root });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

describe("cli", () => {
  test("--version prints the package version", async () => {
    const { code, stdout } = await run(["--version"]);
    assert.equal(code, 0);
    assert.equal(stdout.trim(), "2.0.0");
  });

  test("--help lists the main options", async () => {
    const { code, stdout } = await run(["--help"]);
    assert.equal(code, 0);
    for (const flag of [
      "--endpoint",
      "--tests",
      "--model",
      "--provider",
      "--fix-attempts",
      "--no-run",
      "--dry-run",
      "--report",
      "--focus",
    ]) {
      assert.ok(stdout.includes(flag), `help should mention ${flag}`);
    }
  });

  test("requires --endpoint", async () => {
    const { code, stderr } = await run([]);
    assert.notEqual(code, 0);
    assert.match(stderr, /Missing required argument: endpoint/);
  });

  test("rejects non-http endpoints", async () => {
    const { code, stderr } = await run(["-e", "ftp://x"]);
    assert.notEqual(code, 0);
    assert.match(stderr, /must be an http\(s\) URL/);
  });

  test("rejects a non-positive test count", async () => {
    const { code, stderr } = await run(["-e", "https://x.test", "-t", "0"]);
    assert.notEqual(code, 0);
    assert.match(stderr, /--tests must be a positive integer/);
  });

  test("rejects unknown options", async () => {
    const { code, stderr } = await run(["-e", "https://x.test", "--bogus"]);
    assert.notEqual(code, 0);
    assert.match(stderr, /Unknown argument/);
  });

  test("rejects an unknown provider", async () => {
    const { code, stderr } = await run(["-e", "https://x.test", "-p", "nope"]);
    assert.notEqual(code, 0);
    assert.match(stderr, /Invalid values/);
  });
});

describe("parseArgs", () => {
  test("applies defaults and aliases", async () => {
    const { parseArgs } = await import("../index.js");
    const args = parseArgs([
      "-e",
      "https://x.test",
      "-t",
      "3",
      "-m",
      "sonnet",
      "--no-run",
      "--focus",
      "nav",
      "footer",
    ]);
    assert.equal(args.endpoint, "https://x.test");
    assert.equal(args.tests, 3);
    assert.equal(args.components, 3);
    assert.equal(args.model, "sonnet");
    assert.equal(args.run, false);
    assert.equal(args.render, true);
    assert.equal(args.fixAttempts, 2);
    assert.deepEqual(args.focus, ["nav", "footer"]);
  });
});
