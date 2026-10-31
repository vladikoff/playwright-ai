import makeDebug from "debug";

const debug = makeDebug("playwright-ai:chat");

/**
 * Provider-agnostic multi-turn conversation. The provider only has to
 * implement `complete({ system, messages })` and return the assistant text;
 * history management, logging and usage accounting live here.
 */
export class Conversation {
  /**
   * @param {{ complete: (req: { system: string, messages: Array<{role: "user"|"assistant", content: string}> }) => Promise<{ text: string, usage?: { inputTokens?: number, outputTokens?: number } }> }} provider
   * @param {{ system: string }} options
   */
  constructor(provider, { system }) {
    if (!provider || typeof provider.complete !== "function") {
      throw new TypeError("Conversation requires a provider with a complete() method");
    }
    this.provider = provider;
    this.system = system;
    /** @type {Array<{role: "user"|"assistant", content: string}>} */
    this.messages = [];
    this.usage = { inputTokens: 0, outputTokens: 0, requests: 0 };
  }

  /**
   * Sends a user message and returns the assistant reply as text.
   * @param {string} content
   */
  async ask(content) {
    this.messages.push({ role: "user", content });
    debug(`>>> user (${content.length} chars): ${content.slice(0, 200)}…`);
    const result = await this.provider.complete({
      system: this.system,
      messages: this.messages,
    });
    const text = (result?.text ?? "").trim();
    this.messages.push({ role: "assistant", content: text });
    this.usage.requests += 1;
    this.usage.inputTokens += result?.usage?.inputTokens ?? 0;
    this.usage.outputTokens += result?.usage?.outputTokens ?? 0;
    debug(`<<< assistant (${text.length} chars): ${text.slice(0, 200)}…`);
    return text;
  }
}
