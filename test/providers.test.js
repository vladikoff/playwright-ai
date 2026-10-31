import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createProvider,
  resolveModel,
  detectProvider,
  AnthropicProvider,
  OpenAIProvider,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
} from "../lib/providers/index.js";
import * as anthropic from "../lib/providers/anthropic.js";
import * as openai from "../lib/providers/openai.js";

describe("resolveModel", () => {
  test("defaults to the Anthropic model", () =>
    assert.equal(resolveModel(undefined), DEFAULT_ANTHROPIC_MODEL));
  test("maps aliases case-insensitively", () => {
    assert.equal(resolveModel("Claude"), DEFAULT_ANTHROPIC_MODEL);
    assert.equal(resolveModel("sonnet"), "claude-sonnet-5-5");
    assert.equal(resolveModel("haiku"), "claude-haiku-5-5");
    assert.equal(resolveModel("openai"), DEFAULT_OPENAI_MODEL);
  });
  test("maps 1.x aliases to current models", () => {
    assert.equal(resolveModel("gpt4"), DEFAULT_OPENAI_MODEL);
    assert.equal(resolveModel("gpt-3"), DEFAULT_OPENAI_MODEL);
  });
  test("passes unknown ids through", () => assert.equal(resolveModel("claude-opus-4-8"), "claude-opus-4-8"));
});

describe("detectProvider", () => {
  test("recognises claude and gpt ids", () => {
    assert.equal(detectProvider("claude-opus-5-5"), "anthropic");
    assert.equal(detectProvider("gpt-5.5"), "openai");
    assert.equal(detectProvider("o3-mini"), "openai");
  });
  test("returns null for unknown ids", () => assert.equal(detectProvider("llama-3"), null));
});

describe("createProvider", () => {
  test("builds an Anthropic provider from an alias", () => {
    const p = createProvider({ model: "claude", apiKey: "k" });
    assert.ok(p instanceof AnthropicProvider);
    assert.equal(p.model, DEFAULT_ANTHROPIC_MODEL);
    assert.equal(p.name, "anthropic");
  });
  test("builds an OpenAI provider from a gpt id", () => {
    const p = createProvider({ model: "gpt-5.5", apiKey: "k" });
    assert.ok(p instanceof OpenAIProvider);
    assert.equal(p.name, "openai");
  });
  test("honours an explicit provider for unknown ids", () => {
    const p = createProvider({ provider: "openai", model: "custom-model", apiKey: "k" });
    assert.ok(p instanceof OpenAIProvider);
    assert.equal(p.model, "custom-model");
  });
  test("throws when the provider cannot be inferred", () => {
    assert.throws(() => createProvider({ model: "llama-3" }), /Could not infer a provider/);
  });
  test("throws for an unknown provider", () => {
    assert.throws(() => createProvider({ provider: "foo", model: "x" }), /Unknown provider/);
  });
});

describe("AnthropicProvider", () => {
  test("buildRequest uses the Messages API shape with caching and fallbacks", () => {
    const req = anthropic.buildRequest({
      model: "claude-opus-5-5",
      maxTokens: 100,
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.deepEqual(req, {
      model: "claude-opus-5-5",
      max_tokens: 100,
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      cache_control: { type: "ephemeral" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  });
  test("omits fallbacks for models that do not support them", () => {
    const req = anthropic.buildRequest({ model: "claude-haiku-5-5", maxTokens: 1, system: "", messages: [] });
    assert.equal(req.fallbacks, undefined);
    assert.equal(req.betas, undefined);
  });
  test("extractText joins text blocks and ignores thinking", () => {
    const text = anthropic.extractText({
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
      stop_reason: "end_turn",
    });
    assert.equal(text, "a\nb");
  });
  test("extractText throws on refusal", () => {
    assert.throws(
      () =>
        anthropic.extractText({
          content: [],
          stop_reason: "refusal",
          stop_details: { category: "cyber", explanation: "no" },
        }),
      /declined to answer \(no\)/,
    );
  });
  test("complete() calls the beta messages endpoint and maps usage", async () => {
    let received;
    const client = {
      beta: {
        messages: {
          create: async (req) => {
            received = req;
            return {
              model: "claude-opus-5-5",
              stop_reason: "end_turn",
              content: [{ type: "text", text: "reply" }],
              usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 2 },
            };
          },
        },
      },
    };
    const provider = new AnthropicProvider({ client, model: "claude-opus-5-5" });
    const out = await provider.complete({ system: "s", messages: [{ role: "user", content: "q" }] });
    assert.equal(received.model, "claude-opus-5-5");
    assert.equal(received.messages[0].content, "q");
    assert.deepEqual(out, {
      text: "reply",
      usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 2 },
      model: "claude-opus-5-5",
    });
  });
});

describe("OpenAIProvider", () => {
  test("buildRequest puts the system prompt in a developer message", () => {
    const req = openai.buildRequest({
      model: "gpt-5.5",
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.deepEqual(req, {
      model: "gpt-5.5",
      messages: [
        { role: "developer", content: "sys" },
        { role: "user", content: "hi" },
      ],
    });
  });
  test("complete() maps the first choice and usage", async () => {
    const client = {
      chat: {
        completions: {
          create: async () => ({
            model: "gpt-5.5",
            choices: [{ finish_reason: "stop", message: { content: "reply" } }],
            usage: { prompt_tokens: 4, completion_tokens: 2 },
          }),
        },
      },
    };
    const provider = new OpenAIProvider({ client, model: "gpt-5.5" });
    const out = await provider.complete({ system: "s", messages: [] });
    assert.deepEqual(out, { text: "reply", usage: { inputTokens: 4, outputTokens: 2 }, model: "gpt-5.5" });
  });
  test("complete() rejects content-filtered replies", async () => {
    const client = {
      chat: {
        completions: {
          create: async () => ({ choices: [{ finish_reason: "content_filter", message: {} }] }),
        },
      },
    };
    await assert.rejects(
      new OpenAIProvider({ client }).complete({ system: "", messages: [] }),
      /content filter/,
    );
  });
  test("complete() rejects empty choices", async () => {
    const client = { chat: { completions: { create: async () => ({ choices: [] }) } } };
    await assert.rejects(new OpenAIProvider({ client }).complete({ system: "", messages: [] }), /no choices/);
  });
});
