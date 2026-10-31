/**
 * Pure string helpers used to turn LLM responses into test files.
 * No I/O lives here so everything is trivially unit-testable.
 */

/**
 * Extracts the component name wrapped in `$$ ... $$` markers from an LLM reply.
 * @param {string} input
 * @returns {string|null}
 */
export function extractName(input) {
  if (!input) return null;
  const match = input.match(/\$\$\s*([^$]+?)\s*\$\$/);
  return match ? match[1].trim() : null;
}

/**
 * Extracts the most relevant fenced code block from an LLM reply.
 * When several blocks are present, the one that imports `@playwright/test`
 * wins; otherwise the longest block is returned.
 * @param {string} input
 * @returns {string|null}
 */
export function extractCode(input) {
  if (!input) return null;
  const regex = /```[a-zA-Z0-9_-]*[ \t]*\r?\n?([\s\S]*?)```/g;
  const blocks = [];
  let match;
  while ((match = regex.exec(input)) !== null) {
    const body = match[1].trim();
    if (body) blocks.push(body);
  }
  if (blocks.length === 0) return null;
  const withImport = blocks.find((b) => b.includes("@playwright/test"));
  if (withImport) return withImport;
  return blocks.reduce((a, b) => (b.length > a.length ? b : a));
}

/**
 * Converts an arbitrary label into a filesystem-friendly snake_case slug.
 * Leading/trailing separators are trimmed and runs collapsed.
 * @param {string} input
 * @returns {string|null}
 */
export function snakeCase(input) {
  if (!input) return null;
  const slug = input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
    .join("_");
  return slug || null;
}

/**
 * Falls back to the first `test('...')` title when the model forgot to
 * wrap a component name in `$$`.
 * @param {string} code
 * @returns {string|null}
 */
export function fallbackComponentName(code) {
  if (!code) return null;
  const match = code.match(/test(?:\.describe)?\(\s*(['"`])(.*?)\1\s*,/);
  return match ? match[2].trim() : null;
}

/**
 * Strips the `$$name$$` marker lines out of code so they never end up in
 * a spec file (models occasionally emit them inside the fence).
 * @param {string} code
 * @returns {string}
 */
export function stripNameMarker(code) {
  if (!code) return code;
  return code
    .replace(/^[ \t]*\/\/[ \t]*\$\$[^\n]*\$\$[ \t]*\r?\n?/gm, "")
    .replace(/^[ \t]*\$\$[^\n]*\$\$[ \t]*\r?\n?/gm, "")
    .trim();
}

/**
 * Turns an LLM reply into `{ code, componentName }`. Returns `null` when no
 * usable code was found.
 * @param {string} reply
 * @param {string} [knownName] name to keep when fixing an existing test
 */
export function parseTestReply(reply, knownName) {
  let code = extractCode(reply);
  if (!code && reply && reply.includes("@playwright/test")) {
    code = reply.trim();
  }
  if (!code) return null;
  code = stripNameMarker(code);
  const rawName = knownName || extractName(reply) || fallbackComponentName(code) || "component";
  return { code, componentName: snakeCase(rawName) || "component" };
}

/**
 * Trims Playwright output down to the portion that is useful for the model
 * when asking it to fix a failing test.
 * @param {string} output
 * @param {number} [maxChars]
 */
export function summarizeFailure(output, maxChars = 6000) {
  if (!output) return "";
  const text = output
    // strip ANSI colour codes
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\r\n/g, "\n");
  if (text.length <= maxChars) return text.trim();
  // keep the tail - Playwright prints the error summary last
  return `…${text.slice(text.length - maxChars)}`.trim();
}

export function truncate(text, max) {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max)}\n<!-- truncated ${text.length - max} characters -->`;
}
