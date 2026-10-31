import OpenAI from "openai";

export const DEFAULT_OPENAI_MODEL = "gpt-5.5";

/**
 * Builds a Chat Completions request. Exported for tests.
 * @param {{ model: string, system: string, messages: Array<{role: string, content: string}> }} req
 */
export function buildRequest({ model, system, messages }) {
  return {
    model,
    messages: [
      { role: "developer", content: system },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  };
}

/**
 * OpenAI provider using the official SDK's Chat Completions API.
 */
export class OpenAIProvider {
  /**
   * @param {{ apiKey?: string, model?: string, client?: object }} [options]
   */
  constructor(options = {}) {
    this.model = options.model || DEFAULT_OPENAI_MODEL;
    this.client = options.client ?? new OpenAI(options.apiKey ? { apiKey: options.apiKey } : {});
  }

  get name() {
    return "openai";
  }

  async complete({ system, messages }) {
    let completion;
    try {
      completion = await this.client.chat.completions.create(
        buildRequest({ model: this.model, system, messages }),
      );
    } catch (error) {
      throw describeError(error);
    }
    const choice = completion.choices?.[0];
    if (!choice) throw new Error("OpenAI returned no choices");
    if (choice.finish_reason === "content_filter") {
      throw new Error("OpenAI declined to answer (content filter)");
    }
    return {
      text: choice.message?.content ?? "",
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      },
      model: completion.model,
    };
  }
}

function describeError(error) {
  if (error instanceof OpenAI.AuthenticationError) {
    return new Error("OpenAI rejected the API key. Set OPENAI_API_KEY.");
  }
  if (error instanceof OpenAI.NotFoundError) {
    return new Error(`OpenAI model not found: ${error.message}`);
  }
  if (error instanceof OpenAI.RateLimitError) {
    return new Error("OpenAI rate limit reached; try again shortly.");
  }
  if (error instanceof OpenAI.APIError) {
    return new Error(`OpenAI API error ${error.status}: ${error.message}`);
  }
  return error;
}
