import makeDebug from "debug";
import _ from "lodash";
const debug = makeDebug("playwright-ai");
import util from "node:util";
import child_process from "node:child_process";

const exec = util.promisify(child_process.exec);
import { ChatGPTAPI } from "chatgpt";
import writeToFile from "../util/write-to-file.js";
import Claude from "../models/claude.js";
import axios from "axios";
import {
  snakeCase,
  fallbackComponentName,
  extractCode,
  extractName,
} from "./util.js";

async function runPlayWright(test) {
  let stdout, stderr, code, result;
  try {
    result = await exec(`npx playwright test ${test} --reporter=dot`, {
      stdio: ["pipe", "pipe", "ignore"],
    });
    stdout = result.stdout;
    stderr = result.stderr;
    code = result.code;
  } catch (ex) {
    return {
      code: ex.code,
      stdout: ex.stdout,
      stderr: ex.stderr,
    };
  }

  return {
    code: code,
    stdout,
    stderr,
  };
}

let api = null;

const delay = (time) => new Promise((res) => setTimeout(res, time));

let testsFailed = [];
let testsPassing = [];
let conversationId = null;
const SKIP_AI = false;
let PROMPTS = {};

async function getHTML(endpoint) {
  await delay(1000);
  try {
    const response = await axios.get(endpoint);
    return response.data;
  } catch (error) {
    console.error(`Error: ${error}`);
  }
}

async function initialPrompt() {
  PROMPTS = {
    start: `For this conversation, assume the role of the most experience JavaScript developer in the world. We are going to be generating a series of PlayWright interactive end-to-end JavaScript tests, use ESM syntax. I will provide you with HTML in the next message. As part of this conversation, do not generate duplicate tests for the same components, instead find new ones in the given HTML."
      You need to create a passing test case with several assertions for that HTML structure, one component at a time. To import the PlayWright interface use the following code: "import { test, expect } from '@playwright/test'". Your task is to create a passing test case for one component at a time. Please do not add any additional text in the response, just return the code!`,
    fixTest: `I got an error running the test, please try to fix the code to make the test pass. You likely need to update the assertions to match the expected and please output all of the code for the test file fixed, so I copy it and run it. Don't forget to include PlayWright with "import { test, expect } from '@playwright/test'"`,
    giveHTML: `Here is the HTML for a website hosted at ${process.endpoint}, generate comprehensive a PlayWright test file for the first component on this web page, make sure to navigate to the provided url in the test. Include a short name of the component in a few words in the response wrapped in "$$" characters, use snake case format inside of test with a JavaScript comment. If a component is a form, try to interact with the form. If the component includes links, then try to interact with the links.`,
    moreComponents: `This is great, let us proceed with an interactive test with several assertions for component that you have not generated a test for already. For example, components could be the navigation bar, the search bar, footer links, the login form. Include a short name of the component in a few words in the response wrapped in "$$" characters, use snake case format inside of test with a JavaScript comment. The HTML is the same as before for a website hosted at ${process.endpoint}:`,
  };
  let model = process.model;
  if (model === "gpt3") {
    model = "gpt-3.5-turbo-0613";
  }

  api = new ChatGPTAPI({
    apiKey: process.env["OPENAI_API_KEY"],
    completionParams: {
      model: model,
    },
  });
  if (model === "claude") {
    api = new Claude({
      apiKey: process.env["ANTHROPIC_API_KEY"],
    });
  }

  await askAi(PROMPTS.start, true);
}

async function attemptToGetCodeAndComponent(message, name) {
  let result = extractCode(message);
  if (!result) {
    debug("AI returned matched code, :(");
    if (message.includes("@playwright/test")) {
      result = message;
      debug("Trying direct code mode");
    }
  }
  const code = result;
  const componentName =
    name || extractName(message) || fallbackComponentName(code) || "unknown";
  return {
    code,
    componentName: snakeCase(componentName),
  };
}

async function attemptTestFix(error, componentName) {
  let codeFixResult = await askAi(`${PROMPTS.fixTest} ${error}`);
  let result = await attemptToGetCodeAndComponent(codeFixResult, componentName);
  await writeToFile(componentName, result.code);
  return await runPlayWright(componentName);
}

async function askAi(message, initial) {
  debug(`-----`);
  debug(`>>>> Asking ${conversationId}: ${message}`);
  // send a message and wait for the response
  if (SKIP_AI) {
    debug(`Skipping AI ask: ${message}`);
    return;
  }
  //debug("conversationId", conversationId);
  let res = await api.sendMessage(message, {
    parentMessageId: conversationId,
  });
  if (initial) {
    conversationId = res.id;
  }
  debug("<<<<< AI Response:", res.text);
  debug("------");
  return res.text;
}

async function start(observer, ctx, endpoint, numberOfComponents = 1) {
  const html = ctx.html;
  observer.next("Starting...");
  await delay(1000);

  for (let c = 0; c < numberOfComponents; c++) {
    observer.next(`Working on component ${c + 1}`);

    let ask = `${PROMPTS.giveHTML} ${html}`;

    if (c > 0) {
      ask = `This is great, let us proceed with an interactive test for component that you have not generated a test for already.
       For example, components could be the navigation bar, the search bar, footer links, the login form. 
       Include a short name of the component in a few words in the response wrapped in "$$" characters, use snake case format inside of test with a JavaScript comment. 
       Components that I already have are ${testsPassing}.
       The HTML is the same as before for a website hosted at ${process.endpoint}: ${html}`;
    }

    let attempts = 0;
    let result =
      (await attemptToGetCodeAndComponent(await askAi(ask))) || "test";
    await writeToFile(result.componentName, result.code);
    let testResult = await runPlayWright(result.componentName);
    let currentComponentName = result.componentName;
    let failure = testResult.code > 0;
    while (failure && attempts <= 1) {
      observer.next(
        `Fixing tests for component ${c + 1}, attempt ${
          attempts + 1
        }: ${currentComponentName}`
      );
      debug("Fix Attempt", attempts);
      let error = testResult.stdout;
      testResult = await attemptTestFix(error, currentComponentName);
      await delay(2000);
      failure = testResult.code > 0;
      attempts++;
    }
    if (failure) {
      // test failed
      debug("Could not fix test", testResult.stdout);
      testsFailed.push(`tests/${result.componentName}.spec.js`);
      testsFailed = _.uniq(testsFailed);
    } else {
      testsPassing.push(`tests/${result.componentName}.spec.js`);
      testsPassing = _.uniq(testsPassing);
      debug("Test Passed!");
    }
  }

  ctx.testsPassing = testsPassing;
  ctx.testsFailed = testsFailed;
  observer.complete();
  // done
}

export { start, getHTML, initialPrompt };
