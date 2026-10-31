import makeDebug from "debug";
import { Conversation } from "./conversation.js";
import { parseTestReply } from "./util.js";
import { firstComponentPrompt, nextComponentPrompt, fixPrompt, systemPrompt } from "./prompts.js";
import { uniqueSpecPath, writeSpec } from "./project.js";
import { runPlaywright } from "./runner.js";

const debug = makeDebug("playwright-ai:generator");

/**
 * @typedef {object} GeneratedTest
 * @property {string} component snake_case component name
 * @property {string} file absolute spec path
 * @property {"passed"|"failed"|"written"} status `written` when tests were not executed
 * @property {number} fixAttempts
 * @property {string} [lastError] trimmed Playwright output for failed tests
 */

/**
 * @typedef {object} GenerateOptions
 * @property {string} endpoint
 * @property {string} html cleaned HTML
 * @property {object} provider object with complete()
 * @property {string} cwd
 * @property {string} testDir
 * @property {"js"|"ts"} language
 * @property {number} [count] number of components, default 1
 * @property {number} [maxFixAttempts] default 2
 * @property {boolean} [run] execute tests with Playwright, default true
 * @property {boolean} [overwrite] replace existing spec files, default false
 * @property {string[]} [focus] component hints
 * @property {string} [project] Playwright project name to run
 * @property {(event: { type: string, [k: string]: any }) => void} [onProgress]
 * @property {typeof runPlaywright} [runTest] injectable for tests
 * @property {typeof writeSpec} [write] injectable for tests
 * @property {typeof uniqueSpecPath} [pickPath] injectable for tests
 */

/**
 * Generates tests for `count` components, writing each to disk and
 * optionally running and repairing them.
 *
 * @param {GenerateOptions} options
 * @returns {Promise<{ tests: GeneratedTest[], usage: { inputTokens: number, outputTokens: number, requests: number } }>}
 */
export async function generateTests(options) {
  const {
    endpoint,
    html,
    provider,
    cwd,
    testDir,
    language,
    count = 1,
    maxFixAttempts = 2,
    run = true,
    overwrite = false,
    focus = [],
    project,
    onProgress = () => {},
    runTest = runPlaywright,
    write = writeSpec,
    pickPath = uniqueSpecPath,
  } = options;

  const chat = new Conversation(provider, { system: systemPrompt({ language }) });
  const tests = [];
  const covered = [];

  for (let index = 0; index < count; index++) {
    onProgress({ type: "component:start", index, count });

    const ask =
      index === 0
        ? firstComponentPrompt({ endpoint, html, focus })
        : nextComponentPrompt({ endpoint, done: covered, focus });

    let parsed = parseTestReply(await chat.ask(ask));
    if (!parsed) {
      // one retry with an explicit nudge before giving up on this slot
      parsed = parseTestReply(
        await chat.ask(
          "I could not find a code block in your reply. Respond with the $$ name $$ line and one fenced code block containing the full test file.",
        ),
      );
    }
    if (!parsed) {
      debug("model returned no usable code for component %d", index + 1);
      onProgress({ type: "component:skipped", index });
      continue;
    }

    const file = await pickPath({
      cwd,
      testDir,
      component: parsed.componentName,
      language,
      overwrite,
    });
    await write(file, parsed.code);
    covered.push(parsed.componentName);
    onProgress({ type: "component:written", index, component: parsed.componentName, file });

    const entry = {
      component: parsed.componentName,
      file,
      status: "written",
      fixAttempts: 0,
    };

    if (run) {
      let result = await runTest({ cwd, file, project });
      let attempt = 0;
      while (!result.passed && attempt < maxFixAttempts) {
        attempt += 1;
        onProgress({
          type: "component:fixing",
          index,
          component: parsed.componentName,
          attempt,
          maxFixAttempts,
        });
        const reply = await chat.ask(
          fixPrompt({ error: result.output, attempt, maxAttempts: maxFixAttempts }),
        );
        const fixed = parseTestReply(reply, parsed.componentName);
        if (!fixed) {
          debug("fix attempt %d returned no code", attempt);
          continue;
        }
        await write(file, fixed.code);
        result = await runTest({ cwd, file, project });
      }
      entry.fixAttempts = attempt;
      entry.status = result.passed ? "passed" : "failed";
      if (!result.passed) entry.lastError = result.output;
    }

    tests.push(entry);
    onProgress({ type: "component:done", index, test: entry });
  }

  return { tests, usage: chat.usage };
}
