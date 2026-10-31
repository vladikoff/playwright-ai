import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Builds the JSON report object. Pure so it can be snapshot-tested.
 * @param {{ endpoint: string, provider: string, model: string, tests: Array<object>, usage: object, html: { method: string, rawLength: number, cleanedLength: number }, startedAt: number, cwd: string }} input
 */
export function buildReport(input) {
  const { tests, cwd } = input;
  const summary = { passed: 0, failed: 0, written: 0 };
  for (const t of tests) summary[t.status] = (summary[t.status] ?? 0) + 1;
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - input.startedAt,
    endpoint: input.endpoint,
    provider: input.provider,
    model: input.model,
    html: input.html,
    usage: input.usage,
    summary,
    tests: tests.map((t) => ({
      component: t.component,
      file: path.relative(cwd, t.file),
      status: t.status,
      fixAttempts: t.fixAttempts,
      ...(t.lastError ? { lastError: t.lastError } : {}),
    })),
  };
}

/**
 * @param {string} file
 * @param {object} report
 */
export async function writeReport(file, report) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return file;
}

/**
 * Human-readable summary printed at the end of a run.
 * @param {ReturnType<typeof buildReport>} report
 */
export function formatSummary(report) {
  const lines = [];
  const icons = { passed: "✔", failed: "✖", written: "•" };
  if (report.tests.length === 0) {
    lines.push("No tests were generated.");
  } else {
    lines.push("Generated tests:");
    for (const t of report.tests) {
      const note =
        t.status === "failed"
          ? ` (failed after ${t.fixAttempts} fix attempt${t.fixAttempts === 1 ? "" : "s"})`
          : t.status === "passed" && t.fixAttempts > 0
            ? ` (passed after ${t.fixAttempts} fix attempt${t.fixAttempts === 1 ? "" : "s"})`
            : "";
      lines.push(`  ${icons[t.status] ?? "?"} ${t.file}${note}`);
    }
  }
  const { passed, failed, written } = report.summary;
  const parts = [];
  if (passed) parts.push(`${passed} passing`);
  if (failed) parts.push(`${failed} failing`);
  if (written) parts.push(`${written} written (not run)`);
  if (parts.length) lines.push(parts.join(", "));
  const u = report.usage ?? {};
  if (u.requests) {
    lines.push(
      `${u.requests} model request${u.requests === 1 ? "" : "s"}, ${u.inputTokens ?? 0} input / ${u.outputTokens ?? 0} output tokens`,
    );
  }
  return lines.join("\n");
}
