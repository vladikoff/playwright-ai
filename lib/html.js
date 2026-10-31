import makeDebug from "debug";
import { truncate } from "./util.js";

const debug = makeDebug("playwright-ai:html");

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Reduces a page's HTML to the parts that matter for writing a UI test.
 * Scripts, styles, SVG paths, comments, inline handlers and base64 blobs
 * carry no selector information and burn tokens, so they are removed.
 *
 * @param {string} html
 * @param {{ maxChars?: number }} [options]
 * @returns {string}
 */
export function cleanHTML(html, options = {}) {
  if (!html) return "";
  const maxChars = options.maxChars ?? 60_000;

  let out = String(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, "")
    // keep the <svg> tag so icons are still visible as elements, drop their guts
    .replace(/(<svg\b[^>]*>)[\s\S]*?(<\/svg>)/gi, "$1$2")
    .replace(/<(link|meta)\b[^>]*>/gi, "")
    // inline event handlers and styles never help a test
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+style\s*=\s*("[^"]*"|'[^']*')/gi, "")
    // base64 payloads
    .replace(/(src|href)\s*=\s*"data:[^"]*"/gi, '$1="data:…"')
    .replace(/(src|href)\s*=\s*'data:[^']*'/gi, "$1='data:…'")
    // collapse whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/>\s+</g, "><")
    .trim();

  return truncate(out, maxChars);
}

/**
 * Fetches the raw HTML of a URL using the global `fetch`.
 * @param {string} url
 * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch }} [options]
 */
export async function fetchStaticHTML(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "playwright-ai/2.0 (+https://github.com/vladikoff/playwright-ai)",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(`Request to ${url} failed with status ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tries to load Playwright from the user's project (where the CLI runs)
 * so single-page apps can be rendered before we read their DOM.
 * Returns `null` when Playwright is not installed.
 */
export async function loadPlaywright(importer = (s) => import(s)) {
  for (const spec of ["playwright", "@playwright/test", "playwright-core"]) {
    try {
      const mod = await importer(spec);
      if (mod?.chromium) return mod;
      if (mod?.default?.chromium) return mod.default;
    } catch (error) {
      debug(`could not import ${spec}: ${error.message}`);
    }
  }
  return null;
}

/** Accepts either an ESM namespace or a CommonJS default export of Playwright. */
function normalizePlaywright(mod) {
  if (!mod) return null;
  if (mod.chromium) return mod;
  if (mod.default?.chromium) return mod.default;
  return null;
}

/**
 * Renders a URL in headless Chromium and returns the resulting DOM.
 * @param {string} url
 * @param {{ playwright?: object, timeoutMs?: number }} [options]
 */
export async function fetchRenderedHTML(url, options = {}) {
  const playwright = normalizePlaywright(options.playwright) ?? (await loadPlaywright());
  if (!playwright) {
    throw new Error("Playwright is not installed; cannot render the page");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    return await page.content();
  } finally {
    await browser.close();
  }
}

/**
 * Fetches HTML for an endpoint, rendering with Playwright when requested
 * and available and falling back to a plain HTTP request otherwise.
 *
 * @param {string} url
 * @param {{ render?: boolean, maxChars?: number, timeoutMs?: number, playwright?: object, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ html: string, rawLength: number, method: "rendered"|"static" }>}
 */
export async function fetchHTML(url, options = {}) {
  const wantsRender = options.render !== false;
  let raw = null;
  let method = "static";

  if (wantsRender) {
    const playwright = normalizePlaywright(options.playwright) ?? (await loadPlaywright());
    if (playwright) {
      try {
        raw = await fetchRenderedHTML(url, { ...options, playwright });
        method = "rendered";
      } catch (error) {
        debug(`render failed, falling back to static fetch: ${error.message}`);
      }
    } else {
      debug("playwright not available in this project; using static fetch");
    }
  }

  if (raw === null) {
    raw = await fetchStaticHTML(url, options);
  }

  return {
    html: cleanHTML(raw, { maxChars: options.maxChars }),
    rawLength: raw.length,
    method,
  };
}
