/**
 * Prompt builders. Pure functions so the wording can be unit-tested and
 * tweaked without touching the orchestration code.
 */

const IMPORT_LINE = `import { test, expect } from '@playwright/test';`;

/**
 * @param {{ language?: "js"|"ts" }} options
 */
export function systemPrompt({ language = "js" } = {}) {
  const lang = language === "ts" ? "TypeScript" : "JavaScript";
  return [
    `You are an expert ${lang} engineer who writes reliable Playwright end-to-end tests.`,
    `You will be given the HTML of a web page and asked to write tests for one UI component at a time.`,
    ``,
    `Rules for every test file you produce:`,
    `- Use ESM syntax and start the file with: ${IMPORT_LINE}`,
    `- Navigate to the provided URL with page.goto() at the start of each test.`,
    `- Prefer resilient locators: getByRole, getByLabel, getByPlaceholder, getByText, then data-testid, then CSS.`,
    `- Use web-first assertions (await expect(locator).toBeVisible(), toHaveText, toHaveAttribute, ...).`,
    `- Never use fixed waits (page.waitForTimeout). Never assert on text that is not present in the HTML.`,
    `- Interact with forms and links where the component has them; cover at least two meaningful assertions.`,
    `- Keep each file focused on a single component. Do not repeat a component you already covered.`,
    ``,
    `Response format:`,
    `- First line: the component name in two to four words wrapped in $$ markers, e.g. $$ Navigation Bar $$`,
    `- Then exactly one fenced code block containing the complete test file. No commentary outside the fence.`,
  ].join("\n");
}

/**
 * @param {{ endpoint: string, html: string, focus?: string[] }} options
 */
export function firstComponentPrompt({ endpoint, html, focus = [] }) {
  const focusLine = focus.length
    ? `Focus on these components, in order, where present: ${focus.join(", ")}.`
    : `Start with the most prominent interactive component on the page.`;
  return [
    `Here is the cleaned HTML of the page at ${endpoint}.`,
    focusLine,
    `Write a Playwright test file for the first component.`,
    ``,
    `<html>`,
    html,
    `</html>`,
  ].join("\n");
}

/**
 * @param {{ endpoint: string, done: string[], focus?: string[] }} options
 */
export function nextComponentPrompt({ endpoint, done, focus = [] }) {
  const remaining = focus.filter(
    (f) => !done.some((d) => d.toLowerCase().includes(f.toLowerCase().replace(/\s+/g, "_"))),
  );
  const hint = remaining.length
    ? `Prefer one of these next: ${remaining.join(", ")}.`
    : `Candidates include navigation, search, forms, footer links, cards, modals or tables.`;
  return [
    `Great. Using the same HTML for ${endpoint}, write a test file for a different component that you have not covered yet.`,
    `Already covered: ${done.length ? done.join(", ") : "none"}.`,
    hint,
    `Remember the response format: the $$ name $$ line followed by one fenced code block.`,
  ].join("\n");
}

/**
 * @param {{ error: string, attempt: number, maxAttempts: number }} options
 */
export function fixPrompt({ error, attempt, maxAttempts }) {
  return [
    `The test failed when run with Playwright (fix attempt ${attempt} of ${maxAttempts}).`,
    `Update the test so it passes against the real page: adjust locators and expected values to match the HTML you were given, and remove assertions that cannot be verified.`,
    `Return the complete, corrected test file in one fenced code block, keeping the same component name.`,
    ``,
    `<playwright-output>`,
    error,
    `</playwright-output>`,
  ].join("\n");
}
