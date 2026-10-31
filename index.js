#!/usr/bin/env node

import { createRequire } from "node:module";
import path from "node:path";
import { Listr } from "listr2";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { fetchHTML } from "./lib/html.js";
import { generateTests } from "./lib/generator.js";
import { inspectProject } from "./lib/project.js";
import {
  createProvider,
  resolveModel,
  detectProvider,
  PROVIDERS,
  LEGACY_ALIASES,
} from "./lib/providers/index.js";
import { buildReport, writeReport, formatSummary } from "./lib/report.js";

const require = createRequire(import.meta.url);
const { version } = require("./package.json");

/**
 * Parses CLI arguments. Exported so the option surface is testable.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  return yargs(argv)
    .scriptName("playwright-ai")
    .usage("$0 --endpoint <url> [options]")
    .option("endpoint", {
      alias: "e",
      type: "string",
      describe: "URL of the page to generate tests for",
      demandOption: true,
    })
    .option("tests", {
      alias: ["t", "components"],
      type: "number",
      describe: "Number of components to generate tests for",
      default: 1,
    })
    .option("model", {
      alias: "m",
      type: "string",
      describe: "Model id or alias (claude, opus, sonnet, haiku, openai, gpt-5.5, ...)",
      default: "claude",
    })
    .option("provider", {
      alias: "p",
      type: "string",
      choices: PROVIDERS,
      describe: "Force a provider instead of inferring it from the model",
    })
    .option("fix-attempts", {
      alias: "f",
      type: "number",
      describe: "How many times to ask the model to repair a failing test",
      default: 2,
    })
    .option("run", {
      type: "boolean",
      describe: "Run each generated test with Playwright (use --no-run to only write files)",
      default: true,
    })
    .option("render", {
      type: "boolean",
      describe:
        "Render the page with headless Chromium before reading its HTML (use --no-render for a plain HTTP fetch)",
      default: true,
    })
    .option("language", {
      alias: "l",
      type: "string",
      choices: ["js", "ts"],
      describe: "Spec file language; detected from playwright.config / tsconfig when omitted",
    })
    .option("test-dir", {
      type: "string",
      describe: "Directory for spec files; detected from playwright.config when omitted",
    })
    .option("focus", {
      type: "array",
      string: true,
      describe: "Component hints, e.g. --focus 'login form' 'navigation'",
      default: [],
    })
    .option("project", {
      type: "string",
      describe: "Playwright project name to run tests with",
    })
    .option("overwrite", {
      type: "boolean",
      describe: "Replace existing spec files with the same name",
      default: false,
    })
    .option("max-html", {
      type: "number",
      describe: "Maximum characters of cleaned HTML sent to the model",
      default: 60000,
    })
    .option("report", {
      alias: "r",
      type: "string",
      describe: "Write a JSON report to this path",
    })
    .option("dry-run", {
      type: "boolean",
      describe: "Fetch and clean the page, then print what would be sent without calling the model",
      default: false,
    })
    .option("verbose", {
      alias: "v",
      type: "boolean",
      describe: "Plain-text progress output (also enabled when not attached to a TTY)",
      default: false,
    })
    .check((args) => {
      if (!/^https?:\/\//i.test(args.endpoint)) {
        throw new Error("--endpoint must be an http(s) URL");
      }
      if (!Number.isInteger(args.tests) || args.tests < 1) {
        throw new Error("--tests must be a positive integer");
      }
      if (!Number.isInteger(args.fixAttempts) || args.fixAttempts < 0) {
        throw new Error("--fix-attempts must be zero or a positive integer");
      }
      return true;
    })
    .version(version)
    .help()
    .strict()
    .parse();
}

export async function main(argv = hideBin(process.argv)) {
  const args = parseArgs(argv);
  const cwd = process.cwd();
  const startedAt = Date.now();

  if (LEGACY_ALIASES.has(String(args.model).toLowerCase())) {
    console.error(`Note: --model ${args.model} is a 1.x alias and now maps to ${resolveModel(args.model)}.`);
  }

  const model = resolveModel(args.model);
  const providerName = args.provider || detectProvider(model);
  const ctx = {};

  const tasks = new Listr(
    [
      {
        title: "Inspecting project",
        task: async (c, task) => {
          c.project = await inspectProject(cwd);
          if (args.testDir) c.project.testDir = args.testDir;
          if (args.language) c.project.language = args.language;
          task.title = `Project: ${c.project.language === "ts" ? "TypeScript" : "JavaScript"} specs in ./${c.project.testDir}${c.project.hasPlaywright ? "" : " (Playwright not installed here)"}`;
          if (args.run && !c.project.hasPlaywright && !args.dryRun) {
            throw new Error(
              "@playwright/test is not installed in this directory. Run `npm init playwright@latest` first, or pass --no-run to only write files.",
            );
          }
        },
      },
      {
        title: `Fetching ${args.endpoint}`,
        task: async (c, task) => {
          c.page = await fetchHTML(args.endpoint, {
            render: args.render,
            maxChars: args.maxHtml,
          });
          task.title = `Fetched ${args.endpoint} (${c.page.method}, ${c.page.rawLength.toLocaleString()} → ${c.page.html.length.toLocaleString()} chars)`;
        },
      },
      {
        title: `Connecting to ${providerName ?? "model"} (${model})`,
        skip: () => args.dryRun && "dry run",
        task: async (c) => {
          c.provider = createProvider({ provider: args.provider, model: args.model });
        },
      },
      {
        title: "Generating tests",
        skip: () => args.dryRun && "dry run",
        task: async (c, task) => {
          c.result = await generateTests({
            endpoint: args.endpoint,
            html: c.page.html,
            provider: c.provider,
            cwd,
            testDir: c.project.testDir,
            language: c.project.language,
            count: args.tests,
            maxFixAttempts: args.fixAttempts,
            run: args.run,
            overwrite: args.overwrite,
            focus: args.focus,
            project: args.project,
            onProgress: (event) => {
              task.output = describeProgress(event, cwd);
            },
          });
        },
      },
    ],
    {
      ctx,
      concurrent: false,
      exitOnError: true,
      renderer: args.verbose ? "simple" : "default",
      fallbackRenderer: "simple",
      rendererOptions: { collapseSubtasks: false, persistentOutput: true },
    },
  );

  try {
    await tasks.run();
  } catch (error) {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (args.dryRun) {
    console.log(
      `\nDry run. ${ctx.page.html.length.toLocaleString()} characters of cleaned HTML would be sent to ${model}.`,
    );
    console.log(`Specs would be written as ${ctx.project.language} files in ./${ctx.project.testDir}.\n`);
    console.log(ctx.page.html);
    return;
  }

  const report = buildReport({
    endpoint: args.endpoint,
    provider: ctx.provider.name,
    model: ctx.provider.model,
    tests: ctx.result.tests,
    usage: ctx.result.usage,
    html: {
      method: ctx.page.method,
      rawLength: ctx.page.rawLength,
      cleanedLength: ctx.page.html.length,
    },
    startedAt,
    cwd,
  });

  console.log(`\n${formatSummary(report)}`);

  if (args.report) {
    const file = path.resolve(cwd, args.report);
    await writeReport(file, report);
    console.log(`Report written to ${path.relative(cwd, file)}`);
  }

  if (report.summary.failed > 0) process.exitCode = 2;
}

function describeProgress(event, cwd) {
  switch (event.type) {
    case "component:start":
      return `Component ${event.index + 1} of ${event.count}: asking the model…`;
    case "component:written":
      return `Component ${event.index + 1}: wrote ${path.relative(cwd, event.file)}, running…`;
    case "component:fixing":
      return `Component ${event.index + 1} (${event.component}): failed, fix attempt ${event.attempt} of ${event.maxFixAttempts}…`;
    case "component:skipped":
      return `Component ${event.index + 1}: the model returned no code, skipping`;
    case "component:done":
      return `Component ${event.index + 1} (${event.test.component}): ${event.test.status}`;
    default:
      return "";
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
