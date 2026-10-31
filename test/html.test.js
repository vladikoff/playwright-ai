import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { cleanHTML, fetchStaticHTML, fetchHTML, loadPlaywright } from "../lib/html.js";

const page = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Shop</title>
  <link rel="stylesheet" href="a.css">
  <style>body { color: red }</style>
  <script>window.x = 1;</script>
</head>
<body>
  <!-- a comment -->
  <nav onclick="go()" style="color:blue">
    <a href="/">Home</a>
    <svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>
  </nav>
  <img src="data:image/png;base64,AAAA">
  <form>   <input   name="q"   placeholder="Search">  </form>
  <noscript>enable js</noscript>
</body>
</html>`;

describe("cleanHTML", () => {
  const out = cleanHTML(page);

  test("removes scripts, styles, comments, noscript, link and meta", () => {
    for (const bad of ["<script", "<style", "a comment", "<noscript", "<link", "<meta"]) {
      assert.ok(!out.includes(bad), `should not include ${bad}`);
    }
  });
  test("keeps structural elements and attributes", () => {
    assert.ok(out.includes("<title>Shop</title>"));
    assert.ok(out.includes('<a href="/">Home</a>'));
    assert.ok(out.includes('placeholder="Search"'));
  });
  test("strips inline handlers and styles", () => {
    assert.ok(!out.includes("onclick"));
    assert.ok(!out.includes("style="));
    assert.ok(out.includes("<nav>"));
  });
  test("hollows out svg but keeps the tag", () => {
    assert.ok(out.includes("<svg"));
    assert.ok(!out.includes("<path"));
  });
  test("shortens data URIs", () => assert.ok(out.includes('src="data:…"')));
  test("collapses whitespace", () =>
    assert.ok(out.includes('<form><input name="q" placeholder="Search"></form>')));
  test("truncates to maxChars", () => {
    const short = cleanHTML(page, { maxChars: 50 });
    assert.ok(short.length < page.length);
    assert.match(short, /truncated \d+ characters/);
  });
  test("handles empty input", () => assert.equal(cleanHTML(""), ""));
});

describe("fetchStaticHTML", () => {
  test("returns the body text on success", async () => {
    const fetchImpl = async (url, init) => {
      assert.equal(url, "https://example.com");
      assert.match(init.headers["user-agent"], /playwright-ai/);
      return { ok: true, status: 200, text: async () => "<p>hi</p>" };
    };
    assert.equal(await fetchStaticHTML("https://example.com", { fetchImpl }), "<p>hi</p>");
  });
  test("throws on non-2xx", async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, text: async () => "" });
    await assert.rejects(fetchStaticHTML("https://example.com", { fetchImpl }), /status 500/);
  });
});

describe("loadPlaywright", () => {
  test("returns null when nothing can be imported", async () => {
    const importer = async () => {
      throw new Error("nope");
    };
    assert.equal(await loadPlaywright(importer), null);
  });
  test("returns the module exposing chromium", async () => {
    const fake = { chromium: {} };
    const importer = async (spec) => (spec === "playwright" ? fake : Promise.reject(new Error("x")));
    assert.equal(await loadPlaywright(importer), fake);
  });
});

describe("fetchHTML", () => {
  const fakePlaywright = (content, { fail = false } = {}) => ({
    chromium: {
      launch: async () => ({
        newPage: async () => ({
          goto: async () => {
            if (fail) throw new Error("timeout");
          },
          content: async () => content,
        }),
        close: async () => {},
      }),
    },
  });

  test("renders with playwright when available", async () => {
    const result = await fetchHTML("https://example.com", {
      playwright: fakePlaywright("<main><script>x</script><p>rendered</p></main>"),
      fetchImpl: async () => {
        throw new Error("should not be called");
      },
    });
    assert.equal(result.method, "rendered");
    assert.equal(result.html, "<main><p>rendered</p></main>");
    assert.ok(result.rawLength > result.html.length);
  });

  test("falls back to static fetch when rendering fails", async () => {
    const result = await fetchHTML("https://example.com", {
      playwright: fakePlaywright("", { fail: true }),
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => "<p>static</p>" }),
    });
    assert.equal(result.method, "static");
    assert.equal(result.html, "<p>static</p>");
  });

  test("accepts a CommonJS-style module with chromium under default", async () => {
    const cjs = { default: fakePlaywright("<p>cjs</p>") };
    const result = await fetchHTML("https://example.com", {
      playwright: cjs,
      fetchImpl: async () => {
        throw new Error("should not be called");
      },
    });
    assert.equal(result.method, "rendered");
    assert.equal(result.html, "<p>cjs</p>");
  });

  test("skips rendering when render is false", async () => {
    let launched = false;
    const pw = {
      chromium: { launch: async () => ((launched = true), fakePlaywright("x").chromium.launch()) },
    };
    const result = await fetchHTML("https://example.com", {
      render: false,
      playwright: pw,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => "<p>static</p>" }),
    });
    assert.equal(launched, false);
    assert.equal(result.method, "static");
  });
});
