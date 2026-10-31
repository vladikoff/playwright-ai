/**
 * End-to-end check that drives the real pipeline with a scripted model:
 * a local HTTP server serves a small page, the page is rendered with the
 * Playwright installed in tests/sample, specs are written into that project,
 * and `npx playwright test` runs them for real. The first spec is written to
 * fail so the repair loop is exercised too.
 *
 * Run with `npm run test:e2e`. Requires `npm install && npx playwright install chromium`
 * inside tests/sample.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { fetchHTML } from "../lib/html.js";
import { generateTests } from "../lib/generator.js";
import { inspectProject } from "../lib/project.js";
import { buildReport } from "../lib/report.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sample = path.join(root, "tests", "sample");
const specDir = path.join(sample, "tests");

/** Loads the Playwright that lives inside the sample project, not the repo root. */
async function samplePlaywright() {
  const req = createRequire(path.join(sample, "package.json"));
  return import(pathToFileURL(req.resolve("playwright")).href);
}

const PAGE = `<!doctype html><html><head><title>Demo Shop</title>
<script>document.addEventListener("DOMContentLoaded",()=>{document.querySelector("#rendered").textContent="Rendered by JS"})</script>
</head><body>
<nav aria-label="Main"><a href="/">Home</a><a href="/about">About</a></nav>
<h1>Welcome to Demo Shop</h1>
<p id="rendered">placeholder</p>
<form><label for="q">Search</label><input id="q" name="q" placeholder="Search products"><button type="submit">Go</button></form>
</body></html>`;

let server;
let base;

before(async () => {
  server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(PAGE);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await fs.rm(specDir, { recursive: true, force: true });
  await fs.mkdir(specDir, { recursive: true });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(specDir, { recursive: true, force: true });
  await fs.mkdir(specDir, { recursive: true });
  await fs.writeFile(path.join(specDir, ".gitkeep"), "");
});

const spec = (title, body) =>
  `import { test, expect } from '@playwright/test';\n\ntest('${title}', async ({ page }) => {\n${body}\n});\n`;

test(
  "renders the page, writes specs and repairs a failing one with real Playwright",
  { timeout: 240_000 },
  async () => {
    const project = await inspectProject(sample);
    assert.equal(project.hasPlaywright, true, "run `npm install` inside tests/sample first");

    const page = await fetchHTML(`${base}/`, { playwright: await samplePlaywright() });
    assert.equal(page.method, "rendered");
    assert.ok(page.html.includes("Rendered by JS"), "client-side DOM changes should be visible");
    assert.ok(!page.html.includes("<script"), "scripts should be stripped");

    const prompts = [];
    const replies = [
      // component 1: deliberately wrong heading text so the run fails
      `$$ Page Heading $$\n\`\`\`ts\n${spec(
        "heading",
        `  await page.goto('${base}/');\n  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wrong Text');`,
      )}\`\`\``,
      // fix for component 1
      `\`\`\`ts\n${spec(
        "heading",
        `  await page.goto('${base}/');\n  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome to Demo Shop');`,
      )}\`\`\``,
      // component 2: passes first time
      `$$ Search Form $$\n\`\`\`ts\n${spec(
        "search form",
        `  await page.goto('${base}/');\n  await page.getByLabel('Search').fill('shoes');\n  await expect(page.getByPlaceholder('Search products')).toHaveValue('shoes');`,
      )}\`\`\``,
    ];
    const provider = {
      name: "scripted",
      model: "scripted-model",
      complete: async ({ messages }) => {
        prompts.push(messages.at(-1).content);
        return { text: replies.shift() ?? "", usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };

    const result = await generateTests({
      endpoint: `${base}/`,
      html: page.html,
      provider,
      cwd: sample,
      testDir: project.testDir,
      language: "js",
      count: 2,
      maxFixAttempts: 1,
      project: "chromium",
    });

    assert.equal(result.tests.length, 2);
    const [heading, search] = result.tests;
    assert.equal(heading.component, "page_heading");
    assert.equal(heading.status, "passed");
    assert.equal(heading.fixAttempts, 1, "the heading spec needed one repair");
    assert.equal(search.component, "search_form");
    assert.equal(search.status, "passed");
    assert.equal(search.fixAttempts, 0);

    assert.ok(
      prompts[1].includes("Wrong Text") || prompts[1].includes("toHaveText"),
      "fix prompt carries the Playwright error",
    );

    const written = (await fs.readdir(specDir)).filter((f) => f.endsWith(".spec.js")).sort();
    assert.deepEqual(written, ["page_heading.spec.js", "search_form.spec.js"]);
    const headingSource = await fs.readFile(path.join(specDir, "page_heading.spec.js"), "utf8");
    assert.ok(headingSource.includes("Welcome to Demo Shop"), "repaired code replaced the original");

    const report = buildReport({
      endpoint: base,
      provider: provider.name,
      model: provider.model,
      tests: result.tests,
      usage: result.usage,
      html: { method: page.method, rawLength: page.rawLength, cleanedLength: page.html.length },
      startedAt: Date.now(),
      cwd: sample,
    });
    assert.deepEqual(report.summary, { passed: 2, failed: 0, written: 0 });
    assert.equal(report.usage.requests, 3);
  },
);
