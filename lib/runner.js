import { execFile } from "node:child_process";
import path from "node:path";
import makeDebug from "debug";
import { summarizeFailure } from "./util.js";

const debug = makeDebug("playwright-ai:runner");

/**
 * Runs a single spec file with Playwright in the given project directory.
 * Resolves (never rejects) with the exit code and captured output so callers
 * can feed failures back to the model.
 *
 * @param {{ cwd: string, file: string, timeoutMs?: number, exec?: typeof execFile, project?: string }} options
 * @returns {Promise<{ passed: boolean, code: number, output: string, durationMs: number }>}
 */
export function runPlaywright({ cwd, file, timeoutMs = 180_000, exec = execFile, project }) {
  const relative = path.relative(cwd, file) || file;
  const args = ["playwright", "test", relative, "--reporter=line"];
  if (project) args.push(`--project=${project}`);
  debug(`npx ${args.join(" ")} (cwd ${cwd})`);
  const started = Date.now();

  return new Promise((resolve) => {
    exec(
      "npx",
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, CI: "1", FORCE_COLOR: "0", PWTEST_SKIP_TEST_OUTPUT: "1" },
        shell: process.platform === "win32",
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        const output = summarizeFailure(`${stdout ?? ""}\n${stderr ?? ""}`);
        const durationMs = Date.now() - started;
        debug(`exit ${code} in ${durationMs}ms`);
        resolve({ passed: code === 0, code, output, durationMs });
      },
    );
  });
}
