import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReport, writeReport, formatSummary } from "../lib/report.js";

const input = {
  endpoint: "https://site.test",
  provider: "anthropic",
  model: "claude-opus-5-5",
  cwd: "/proj",
  startedAt: Date.now() - 50,
  usage: { inputTokens: 100, outputTokens: 20, requests: 3 },
  html: { method: "rendered", rawLength: 1000, cleanedLength: 300 },
  tests: [
    { component: "nav", file: "/proj/tests/nav.spec.js", status: "passed", fixAttempts: 0 },
    { component: "footer", file: "/proj/tests/footer.spec.js", status: "passed", fixAttempts: 1 },
    {
      component: "login",
      file: "/proj/tests/login.spec.js",
      status: "failed",
      fixAttempts: 2,
      lastError: "boom",
    },
    { component: "search", file: "/proj/tests/search.spec.js", status: "written", fixAttempts: 0 },
  ],
};

describe("buildReport", () => {
  const report = buildReport(input);

  test("counts statuses", () => assert.deepEqual(report.summary, { passed: 2, failed: 1, written: 1 }));
  test("relativises file paths", () => assert.equal(report.tests[0].file, "tests/nav.spec.js"));
  test("keeps lastError only when present", () => {
    assert.equal(report.tests[2].lastError, "boom");
    assert.equal("lastError" in report.tests[0], false);
  });
  test("carries metadata", () => {
    assert.equal(report.version, 2);
    assert.equal(report.model, "claude-opus-5-5");
    assert.ok(report.durationMs >= 50);
    assert.ok(!Number.isNaN(Date.parse(report.generatedAt)));
  });
});

describe("formatSummary", () => {
  test("lists each test with status and attempts", () => {
    const text = formatSummary(buildReport(input));
    assert.ok(text.includes("✔ tests/nav.spec.js"));
    assert.ok(text.includes("✔ tests/footer.spec.js (passed after 1 fix attempt)"));
    assert.ok(text.includes("✖ tests/login.spec.js (failed after 2 fix attempts)"));
    assert.ok(text.includes("• tests/search.spec.js"));
    assert.ok(text.includes("2 passing, 1 failing, 1 written (not run)"));
    assert.ok(text.includes("3 model requests, 100 input / 20 output tokens"));
  });
  test("handles an empty run", () => {
    const text = formatSummary(buildReport({ ...input, tests: [], usage: { requests: 0 } }));
    assert.equal(text, "No tests were generated.");
  });
});

describe("writeReport", () => {
  test("writes pretty JSON and creates directories", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pwai-report-"));
    try {
      const file = path.join(dir, "out", "report.json");
      await writeReport(file, buildReport(input));
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      assert.equal(parsed.summary.passed, 2);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
