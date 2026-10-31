import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { systemPrompt, firstComponentPrompt, nextComponentPrompt, fixPrompt } from "../lib/prompts.js";

describe("systemPrompt", () => {
  test("mentions the import line and response format", () => {
    const p = systemPrompt();
    assert.ok(p.includes("import { test, expect } from '@playwright/test';"));
    assert.ok(p.includes("$$"));
    assert.ok(p.includes("JavaScript"));
  });
  test("switches to TypeScript", () => assert.ok(systemPrompt({ language: "ts" }).includes("TypeScript")));
});

describe("firstComponentPrompt", () => {
  test("embeds endpoint and html", () => {
    const p = firstComponentPrompt({ endpoint: "https://a.test", html: "<p>x</p>" });
    assert.ok(p.includes("https://a.test"));
    assert.ok(p.includes("<html>\n<p>x</p>\n</html>"));
    assert.ok(p.includes("most prominent"));
  });
  test("lists focus hints", () => {
    const p = firstComponentPrompt({ endpoint: "u", html: "", focus: ["login form", "nav"] });
    assert.ok(p.includes("login form, nav"));
  });
});

describe("nextComponentPrompt", () => {
  test("lists covered components", () => {
    const p = nextComponentPrompt({ endpoint: "u", done: ["nav", "footer"] });
    assert.ok(p.includes("Already covered: nav, footer"));
    assert.ok(p.includes("Candidates include"));
  });
  test("says none when nothing covered", () =>
    assert.ok(nextComponentPrompt({ endpoint: "u", done: [] }).includes("Already covered: none")));
  test("drops focus hints that are already done", () => {
    const p = nextComponentPrompt({
      endpoint: "u",
      done: ["login_form"],
      focus: ["login form", "search bar"],
    });
    assert.ok(p.includes("Prefer one of these next: search bar"));
    assert.ok(!p.includes("next: login form"));
  });
});

describe("fixPrompt", () => {
  test("includes the error and attempt counter", () => {
    const p = fixPrompt({ error: "Expected x", attempt: 1, maxAttempts: 3 });
    assert.ok(p.includes("attempt 1 of 3"));
    assert.ok(p.includes("<playwright-output>\nExpected x\n</playwright-output>"));
  });
});
