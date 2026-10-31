import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateTests } from "../lib/generator.js";

const CODE = "import { test, expect } from '@playwright/test';\ntest('x', async () => {});";
const reply = (name, code = CODE) => `$$ ${name} $$\n\`\`\`js\n${code}\n\`\`\``;

/** Builds a fake provider that answers in order and records prompts. */
function provider(replies) {
  const prompts = [];
  return {
    prompts,
    complete: async ({ messages }) => {
      prompts.push(messages.at(-1).content);
      const next = replies.shift();
      if (next === undefined) throw new Error("provider ran out of replies");
      return { text: next, usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
}

/** Records writes in memory instead of touching disk. */
function fakeFs() {
  const files = new Map();
  return {
    files,
    write: async (file, content) => {
      files.set(file, content);
      return file;
    },
    pickPath: async ({ cwd, testDir, component, language }) =>
      `${cwd}/${testDir}/${component}.spec.${language}`,
  };
}

function runner(results) {
  const runs = [];
  return {
    runs,
    runTest: async ({ file }) => {
      runs.push(file);
      const next = results.shift();
      return next ?? { passed: true, code: 0, output: "", durationMs: 1 };
    },
  };
}

const base = (overrides) => ({
  endpoint: "https://site.test",
  html: "<nav>hi</nav>",
  cwd: "/proj",
  testDir: "tests",
  language: "js",
  ...overrides,
});

describe("generateTests", () => {
  test("writes and runs a single passing component", async () => {
    const p = provider([reply("Nav Bar")]);
    const fs = fakeFs();
    const r = runner([]);
    const events = [];
    const out = await generateTests(
      base({ provider: p, ...fs, ...r, onProgress: (e) => events.push(e.type) }),
    );
    assert.equal(out.tests.length, 1);
    assert.deepEqual(out.tests[0], {
      component: "nav_bar",
      file: "/proj/tests/nav_bar.spec.js",
      status: "passed",
      fixAttempts: 0,
    });
    assert.equal(fs.files.get("/proj/tests/nav_bar.spec.js"), CODE);
    assert.deepEqual(r.runs, ["/proj/tests/nav_bar.spec.js"]);
    assert.deepEqual(events, ["component:start", "component:written", "component:done"]);
    assert.deepEqual(out.usage, { inputTokens: 1, outputTokens: 1, requests: 1 });
    assert.ok(p.prompts[0].includes("<nav>hi</nav>"));
  });

  test("asks for different components and reports what is already covered", async () => {
    const p = provider([reply("Nav"), reply("Footer"), reply("Search")]);
    const out = await generateTests(base({ provider: p, ...fakeFs(), ...runner([]), count: 3 }));
    assert.deepEqual(
      out.tests.map((t) => t.component),
      ["nav", "footer", "search"],
    );
    assert.ok(p.prompts[1].includes("Already covered: nav"));
    assert.ok(p.prompts[2].includes("Already covered: nav, footer"));
    assert.ok(!p.prompts[1].includes("<nav>hi</nav>"), "html is not resent on later turns");
  });

  test("repairs a failing test and records the attempt count", async () => {
    const fixed = CODE.replace("'x'", "'fixed'");
    const p = provider([reply("Nav"), `\`\`\`js\n${fixed}\n\`\`\``]);
    const fs = fakeFs();
    const r = runner([{ passed: false, code: 1, output: "Error: locator not found" }]);
    const events = [];
    const out = await generateTests(base({ provider: p, ...fs, ...r, onProgress: (e) => events.push(e) }));
    assert.equal(out.tests[0].status, "passed");
    assert.equal(out.tests[0].fixAttempts, 1);
    assert.equal(fs.files.get("/proj/tests/nav.spec.js"), fixed);
    assert.equal(r.runs.length, 2);
    assert.ok(p.prompts[1].includes("locator not found"));
    const fixing = events.find((e) => e.type === "component:fixing");
    assert.deepEqual(fixing, {
      type: "component:fixing",
      index: 0,
      component: "nav",
      attempt: 1,
      maxFixAttempts: 2,
    });
  });

  test("gives up after maxFixAttempts and keeps the last error", async () => {
    const p = provider([reply("Nav"), reply("Nav"), reply("Nav")]);
    const fail = { passed: false, code: 1, output: "still broken" };
    const r = runner([fail, fail, fail]);
    const out = await generateTests(base({ provider: p, ...fakeFs(), ...r, maxFixAttempts: 2 }));
    assert.equal(out.tests[0].status, "failed");
    assert.equal(out.tests[0].fixAttempts, 2);
    assert.equal(out.tests[0].lastError, "still broken");
    assert.equal(r.runs.length, 3);
    assert.equal(p.prompts.length, 3);
  });

  test("zero fix attempts means failures are reported immediately", async () => {
    const p = provider([reply("Nav")]);
    const r = runner([{ passed: false, code: 1, output: "nope" }]);
    const out = await generateTests(base({ provider: p, ...fakeFs(), ...r, maxFixAttempts: 0 }));
    assert.equal(out.tests[0].status, "failed");
    assert.equal(p.prompts.length, 1);
  });

  test("does not run tests when run is false", async () => {
    const r = runner([]);
    const out = await generateTests(
      base({ provider: provider([reply("Nav")]), ...fakeFs(), ...r, run: false }),
    );
    assert.equal(out.tests[0].status, "written");
    assert.equal(r.runs.length, 0);
  });

  test("retries once when the model returns no code, then skips", async () => {
    const p = provider(["I cannot do that.", "Still no code.", reply("Footer")]);
    const events = [];
    const out = await generateTests(
      base({ provider: p, ...fakeFs(), ...runner([]), count: 2, onProgress: (e) => events.push(e.type) }),
    );
    assert.equal(out.tests.length, 1);
    assert.equal(out.tests[0].component, "footer");
    assert.ok(events.includes("component:skipped"));
    assert.ok(p.prompts[1].includes("could not find a code block"));
  });

  test("keeps the component name when a fix reply has no marker", async () => {
    const p = provider([reply("Login Form"), `\`\`\`js\n${CODE}\n\`\`\``]);
    const fs = fakeFs();
    const out = await generateTests(
      base({ provider: p, ...fs, ...runner([{ passed: false, code: 1, output: "x" }]) }),
    );
    assert.equal(out.tests[0].component, "login_form");
    assert.deepEqual([...fs.files.keys()], ["/proj/tests/login_form.spec.js"]);
  });

  test("ignores a fix reply without code and tries again", async () => {
    const p = provider([reply("Nav"), "no code here", `\`\`\`js\n${CODE}\n\`\`\``]);
    const r = runner([{ passed: false, code: 1, output: "x" }]);
    const out = await generateTests(base({ provider: p, ...fakeFs(), ...r, maxFixAttempts: 2 }));
    assert.equal(out.tests[0].status, "passed");
    assert.equal(out.tests[0].fixAttempts, 2);
    assert.equal(r.runs.length, 2, "the empty reply did not trigger a run");
  });

  test("passes focus hints and the Playwright project through", async () => {
    const p = provider([reply("Login Form")]);
    let seenProject;
    const out = await generateTests(
      base({
        provider: p,
        ...fakeFs(),
        runTest: async ({ project }) => ((seenProject = project), { passed: true, output: "" }),
        focus: ["login form"],
        project: "chromium",
      }),
    );
    assert.ok(p.prompts[0].includes("login form"));
    assert.equal(seenProject, "chromium");
    assert.equal(out.tests[0].status, "passed");
  });

  test("uses TypeScript paths when language is ts", async () => {
    const fs = fakeFs();
    await generateTests(base({ provider: provider([reply("Nav")]), ...fs, ...runner([]), language: "ts" }));
    assert.deepEqual([...fs.files.keys()], ["/proj/tests/nav.spec.ts"]);
  });
});
