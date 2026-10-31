# 2.0.0 - October 31, 2026

Rewrite of the generator around current model APIs, with a real test suite.

## Breaking

- Requires Node.js 22.13 or newer.
- `--model` defaults to `claude` (Claude Opus 5.5) instead of `gpt4`. The 1.x values `gpt4`, `gpt-4` and `gpt-3` still work and map to `gpt-5.5` with a notice.
- The Claude integration now uses the Messages API; the retired `claude-2` text-completions path is gone.
- OpenAI calls go through the official `openai` SDK; the unofficial `chatgpt` package is removed.
- Generated specs are written to the `testDir` from `playwright.config.*` rather than always `./tests`, and existing files are no longer silently overwritten (see `--overwrite`).
- Exit code is `2` when any generated test still fails after repair attempts.

## Added

- Page rendering: when Playwright is installed, the endpoint is loaded in headless Chromium so client-rendered apps produce real markup. `--no-render` falls back to a plain HTTP fetch.
- HTML cleaning: scripts, styles, comments, SVG paths, inline handlers and data URIs are stripped and the result capped by `--max-html`, which cuts token usage substantially.
- TypeScript output, detected from `playwright.config.ts` or `tsconfig.json`, or forced with `--language`.
- `--fix-attempts` to control repair rounds, `--no-run` to only write files, `--focus` to steer which components are covered, `--project` to pick a Playwright project, `--test-dir` to override the output directory.
- `--report <file>` writes a JSON summary with per-test status, fix attempts, last error, token usage and timing.
- `--dry-run` prints the cleaned HTML and detected settings without calling a model.
- Model aliases: `opus`, `sonnet`, `haiku`, `openai`, `gpt`, plus any explicit `claude-*` or `gpt-*` id. `--provider` forces a provider for unknown ids.
- Anthropic requests use prompt caching for the page HTML and opt into server-side refusal fallbacks where supported.
- A programmatic API (`lib/html.js`, `lib/generator.js`, `lib/providers/index.js`).
- 119 unit tests under `npm test` using `node --test`, plus an end-to-end test that drives a real Playwright run.

## Fixed

- Component names like `Footer - Links!` produced file names with a trailing underscore (`footer_links_.spec.js`).
- A reply containing several fenced blocks picked the first one even when it was a shell snippet; the block that imports `@playwright/test` is now preferred.
- `$$ name $$` markers that leaked inside the code fence ended up in the spec file.
- The README documented `--tests` while the CLI only accepted `--components`; both now work.
- Dependency audit: 9 reported vulnerabilities in 1.1.0 (axios, lodash, form-data, cross-spawn and others) are gone with the new dependency set.

# 1.1.0 - December 7, 2023.

- Updated model options

# 1.0.1 - November 26, 2023.

- Open-source release

# 1.0.0 - July, 2023.

- Private release
