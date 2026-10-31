import { promises as fs } from "node:fs";
import path from "node:path";
import makeDebug from "debug";

const debug = makeDebug("playwright-ai:project");

const CONFIG_NAMES = [
  "playwright.config.ts",
  "playwright.config.js",
  "playwright.config.mjs",
  "playwright.config.cjs",
  "playwright.config.mts",
];

/**
 * Reads `testDir` out of a Playwright config without executing it.
 * Covers the common `testDir: './tests'` / `testDir: "e2e"` forms.
 * @param {string} source
 * @returns {string|null}
 */
export function parseTestDir(source) {
  if (!source) return null;
  const match = source.match(/testDir\s*:\s*(['"`])([^'"`]+)\1/);
  return match ? match[2] : null;
}

/**
 * Inspects the directory the CLI runs in and reports how tests should be
 * written there.
 *
 * @param {string} cwd
 * @returns {Promise<{ configFile: string|null, testDir: string, language: "js"|"ts", hasPlaywright: boolean }>}
 */
export async function inspectProject(cwd) {
  let configFile = null;
  let testDir = "tests";
  let language = "js";

  for (const name of CONFIG_NAMES) {
    const candidate = path.join(cwd, name);
    try {
      const source = await fs.readFile(candidate, "utf8");
      configFile = candidate;
      testDir = parseTestDir(source) ?? "tests";
      if (/\.(ts|mts)$/.test(name)) language = "ts";
      break;
    } catch {
      // keep looking
    }
  }

  let hasPlaywright = false;
  try {
    await fs.access(path.join(cwd, "node_modules", "@playwright", "test"));
    hasPlaywright = true;
  } catch {
    hasPlaywright = false;
  }

  // a tsconfig is a strong hint even when the config file is JS
  if (language === "js") {
    try {
      await fs.access(path.join(cwd, "tsconfig.json"));
      language = "ts";
    } catch {
      // stay on JS
    }
  }

  debug({ configFile, testDir, language, hasPlaywright });
  return { configFile, testDir, language, hasPlaywright };
}

/**
 * @param {{ cwd: string, testDir: string, component: string, language: "js"|"ts" }} options
 * @returns {string} absolute spec file path
 */
export function specPath({ cwd, testDir, component, language }) {
  const ext = language === "ts" ? "spec.ts" : "spec.js";
  return path.resolve(cwd, testDir, `${component}.${ext}`);
}

/**
 * Picks a spec path that does not collide with an existing file unless
 * overwriting is allowed.
 * @param {{ cwd: string, testDir: string, component: string, language: "js"|"ts", overwrite?: boolean }} options
 */
export async function uniqueSpecPath(options) {
  const first = specPath(options);
  if (options.overwrite) return first;
  if (!(await exists(first))) return first;
  for (let i = 2; i < 100; i++) {
    const candidate = specPath({ ...options, component: `${options.component}_${i}` });
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`Too many spec files named ${options.component}`);
}

/**
 * Writes a spec file, creating the test directory when needed.
 * @param {string} file absolute path
 * @param {string} content
 */
export async function writeSpec(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const body = content.endsWith("\n") ? content : `${content}\n`;
  await fs.writeFile(file, body, "utf8");
  return file;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
