import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  snakeCase,
  extractName,
  extractCode,
  fallbackComponentName,
  stripNameMarker,
  parseTestReply,
  summarizeFailure,
  truncate,
} from "../lib/util.js";

describe("snakeCase", () => {
  test("converts spaces", () => assert.equal(snakeCase("Navigation Bar"), "navigation_bar"));
  test("splits camelCase", () => assert.equal(snakeCase("loginForm"), "login_form"));
  test("drops punctuation without trailing underscores", () =>
    assert.equal(snakeCase("Footer - Links!"), "footer_links"));
  test("collapses runs of separators", () => assert.equal(snakeCase("  a---b  "), "a_b"));
  test("keeps digits", () => assert.equal(snakeCase("Hero section 2"), "hero_section_2"));
  test("returns null for empty input", () => {
    assert.equal(snakeCase(""), null);
    assert.equal(snakeCase(null), null);
    assert.equal(snakeCase("!!!"), null);
  });
});

describe("extractName", () => {
  test("reads a $$ name $$ marker", () => assert.equal(extractName("blah $$ Nav Bar $$ more"), "Nav Bar"));
  test("tolerates no inner whitespace", () => assert.equal(extractName("$$Footer$$"), "Footer"));
  test("returns null when absent", () => assert.equal(extractName("nothing here"), null));
  test("returns null for empty input", () => assert.equal(extractName(""), null));
});

describe("extractCode", () => {
  test("extracts a language-tagged fence", () =>
    assert.equal(extractCode("text\n```javascript\nconst a = 1;\n```\ntrailing"), "const a = 1;"));
  test("extracts a bare fence", () => assert.equal(extractCode("```\nx\n```"), "x"));
  test("prefers the block that imports playwright", () => {
    const reply = [
      "```bash",
      "npx playwright test",
      "```",
      "```ts",
      "import { test, expect } from '@playwright/test';",
      "test('a', async () => {});",
      "```",
    ].join("\n");
    assert.match(extractCode(reply), /^import \{ test, expect \}/);
  });
  test("falls back to the longest block", () => {
    const reply = "```\nshort\n```\n\n```\nmuch longer content here\n```";
    assert.equal(extractCode(reply), "much longer content here");
  });
  test("handles CRLF line endings", () =>
    assert.equal(extractCode("```js\r\nconst b = 2;\r\n```"), "const b = 2;"));
  test("returns null without a fence", () => assert.equal(extractCode("plain"), null));
});

describe("fallbackComponentName", () => {
  test("reads the first test title", () =>
    assert.equal(fallbackComponentName("test('header renders', async () => {})"), "header renders"));
  test("reads describe titles and double quotes", () =>
    assert.equal(fallbackComponentName('test.describe("Login", () => {})'), "Login"));
  test("returns null when no test call", () => assert.equal(fallbackComponentName("nothing"), null));
});

describe("stripNameMarker", () => {
  test("removes comment markers", () =>
    assert.equal(stripNameMarker("// $$ nav $$\nimport x;"), "import x;"));
  test("removes bare markers", () => assert.equal(stripNameMarker("$$ nav $$\nimport x;"), "import x;"));
  test("leaves code without markers alone", () => assert.equal(stripNameMarker("import x;"), "import x;"));
});

describe("parseTestReply", () => {
  const code = "import { test, expect } from '@playwright/test';\ntest('nav works', async () => {});";

  test("returns code and a snake_case name", () => {
    const parsed = parseTestReply(`$$ Navigation Bar $$\n\`\`\`js\n${code}\n\`\`\``);
    assert.deepEqual(parsed, { code, componentName: "navigation_bar" });
  });
  test("prefers the known name when fixing", () => {
    const parsed = parseTestReply(`$$ Other $$\n\`\`\`js\n${code}\n\`\`\``, "login_form");
    assert.equal(parsed.componentName, "login_form");
  });
  test("falls back to the test title", () => {
    const parsed = parseTestReply(`\`\`\`js\n${code}\n\`\`\``);
    assert.equal(parsed.componentName, "nav_works");
  });
  test("accepts unfenced code that imports playwright", () => {
    const parsed = parseTestReply(code);
    assert.equal(parsed.code, code);
  });
  test("strips a marker that leaked inside the fence", () => {
    const parsed = parseTestReply(`\`\`\`js\n// $$ Footer $$\n${code}\n\`\`\``);
    assert.equal(parsed.code, code);
    assert.equal(parsed.componentName, "footer");
  });
  test("returns null when there is no code", () => {
    assert.equal(parseTestReply("Sorry, I cannot help."), null);
    assert.equal(parseTestReply(""), null);
  });
});

describe("summarizeFailure", () => {
  test("strips ANSI codes", () => assert.equal(summarizeFailure("\u001b[31mred\u001b[0m"), "red"));
  test("keeps the tail when too long", () => {
    const out = summarizeFailure(`${"a".repeat(100)}END`, 10);
    assert.ok(out.endsWith("END"));
    assert.ok(out.length <= 12);
  });
  test("returns empty string for empty input", () => assert.equal(summarizeFailure(""), ""));
});

describe("truncate", () => {
  test("leaves short text alone", () => assert.equal(truncate("abc", 10), "abc"));
  test("annotates truncation", () => {
    const out = truncate("abcdef", 3);
    assert.ok(out.startsWith("abc"));
    assert.match(out, /truncated 3 characters/);
  });
});
