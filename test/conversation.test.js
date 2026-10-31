import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Conversation } from "../lib/conversation.js";

function scriptedProvider(replies) {
  const calls = [];
  return {
    calls,
    complete: async (req) => {
      calls.push(structuredClone(req));
      const reply = replies.shift();
      return typeof reply === "string" ? { text: reply } : reply;
    },
  };
}

describe("Conversation", () => {
  test("requires a provider with complete()", () => {
    assert.throws(() => new Conversation({}, { system: "s" }), TypeError);
  });

  test("keeps the full history and system prompt", async () => {
    const provider = scriptedProvider(["one", "two"]);
    const chat = new Conversation(provider, { system: "sys" });
    assert.equal(await chat.ask("a"), "one");
    assert.equal(await chat.ask("b"), "two");
    assert.deepEqual(provider.calls[1], {
      system: "sys",
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "one" },
        { role: "user", content: "b" },
      ],
    });
  });

  test("trims replies and accumulates usage", async () => {
    const provider = scriptedProvider([
      { text: "  padded  ", usage: { inputTokens: 10, outputTokens: 5 } },
      { text: "x", usage: { inputTokens: 20, outputTokens: 1 } },
    ]);
    const chat = new Conversation(provider, { system: "sys" });
    assert.equal(await chat.ask("a"), "padded");
    await chat.ask("b");
    assert.deepEqual(chat.usage, { inputTokens: 30, outputTokens: 6, requests: 2 });
  });

  test("tolerates providers that return no usage", async () => {
    const chat = new Conversation(scriptedProvider(["ok"]), { system: "sys" });
    await chat.ask("a");
    assert.deepEqual(chat.usage, { inputTokens: 0, outputTokens: 0, requests: 1 });
  });

  test("propagates provider errors", async () => {
    const provider = {
      complete: async () => {
        throw new Error("boom");
      },
    };
    const chat = new Conversation(provider, { system: "sys" });
    await assert.rejects(chat.ask("a"), /boom/);
  });
});
