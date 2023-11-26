#!/usr/bin/env node

import Listr from "listr";
import yargs from "yargs/yargs";
import { Observable } from "rxjs";
import { getHTML, initialPrompt, start } from "./lib/prompts.js";

const result = yargs(process.argv.slice(2))
  .options({
    endpoint: {
      alias: "e",
      describe: "endpoint",
      demandOption: true,
    },
    components: {
      alias: "t",
      describe: "tests",
      default: "1",
    },
    model: {
      alias: "m",
      describe: "model",
      default: "gpt4",
    },
  })
  .help().argv;

process.endpoint = result.endpoint;
process.model = result.model || "gpt4";

const tasks = new Listr([
  {
    title: "Fetching endpoint...",
    task: async (ctx) => {
      const html = await getHTML(result.endpoint);
      ctx.html = html;
      return html;
    },
  },
  {
    title: `Connecting to AI (${process.model.toLocaleString()}) ...`,
    task: async () => {
      return await initialPrompt();
    },
  },
  {
    title: "Writing tests...",
    task: async (ctx) => {
      return new Observable((observer) => {
        start(observer, ctx, result.endpoint, result.components);
      });
    },
  },
]);

tasks
  .run()
  .then((ctx) => {
    console.log(`Generated the following tests:`);
    ctx.testsPassing.forEach((test) => {
      console.log("✔", test);
    });

    ctx.testsFailed.forEach((test) => {
      console.log("⚠️", test);
    });
  })
  .catch((err) => {
    console.error(err);
  });
