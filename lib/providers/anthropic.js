import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

/**
 * Models that support the server-side refusal fallback parameter. Sending it
 * to other models would be rejected, so it is gated here.
 * @param {string} model
 */
export function supportsFallbacks(model) {
  return /^claude-(opus-5|sonnet-5-5|fable-5)/.test(model);
}

/**
 * Builds the request body for a Messages API call. Exported so tests can
 * verify the exact shape without touching the network.
 * @param {{ model: string, maxTokens: number, system: string, messages: Array<{role: string, content: string}> }} req
 */
export function buildRequest({ model, maxTokens, system, messages }) {
  const request = {
    model,
    max_tokens: maxTokens,
    system,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    // caches the growing prefix (system prompt + page HTML) between turns
    cache_control: { type: "ephemeral" },
  };
  if (supportsFallbacks(model)) {
    request.betas = ["server-side-fallback-2026-07-01"];
    request.fallbacks = "default";
  }
  return request;
}

/**
 * Pulls the assistant text out of a Messages API response.
 * @param {{ content: Array<{type: string, text?: string}>, stop_reason?: string, stop_details?: { category?: string|null, explanation?: string } }} response
 */
export function extractText(response) {
  if (response.stop_reason === "refusal") {
    const detail = response.stop_details?.explanation || response.stop_details?.category || "no details";
    throw new Error(`The model declined to answer (${detail})`);
  }
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/**
 * Anthropic provider using the Messages API.
 */
export class AnthropicProvider {
  /**
   * @param {{ apiKey?: string, model?: string, maxTokens?: number, client?: object }} [options]
   */
  constructor(options = {}) {
    this.model = options.model || DEFAULT_ANTHROPIC_MODEL;
    this.maxTokens = options.maxTokens ?? 16_000;
    // The SDK resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth login`
    // profile itself, so an explicit key is optional.
    this.client = options.client ?? new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
  }

  get name() {
    return "anthropic";
  }

  async complete({ system, messages }) {
    const request = buildRequest({
      model: this.model,
      maxTokens: this.maxTokens,
      system,
      messages,
    });
    let response;
    try {
      response = await this.client.beta.messages.create(request);
    } catch (error) {
      throw describeError(error);
    }
    return {
      text: extractText(response),
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        cacheReadTokens: response.usage?.cache_read_input_tokens ?? 0,
      },
      model: response.model,
    };
  }
}

function describeError(error) {
  if (error instanceof Anthropic.AuthenticationError) {
    return new Error("Anthropic rejected the API key. Set ANTHROPIC_API_KEY or run `ant auth login`.");
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new Error(`Anthropic model not found: ${error.message}`);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new Error("Anthropic rate limit reached; try again shortly.");
  }
  if (error instanceof Anthropic.APIError) {
    return new Error(`Anthropic API error ${error.status}: ${error.message}`);
  }
  return error;
}
