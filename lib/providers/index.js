import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "./anthropic.js";
import { OpenAIProvider, DEFAULT_OPENAI_MODEL } from "./openai.js";

export const PROVIDERS = ["anthropic", "openai"];

/**
 * Friendly names accepted by `--model` that map onto a concrete model id.
 * The 1.x aliases are kept so existing scripts continue to work.
 */
export const MODEL_ALIASES = {
  claude: DEFAULT_ANTHROPIC_MODEL,
  anthropic: DEFAULT_ANTHROPIC_MODEL,
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
  openai: DEFAULT_OPENAI_MODEL,
  gpt: DEFAULT_OPENAI_MODEL,
  // legacy 1.x values
  gpt4: DEFAULT_OPENAI_MODEL,
  "gpt-4": DEFAULT_OPENAI_MODEL,
  "gpt-3": DEFAULT_OPENAI_MODEL,
};

export const LEGACY_ALIASES = new Set(["gpt4", "gpt-4", "gpt-3"]);

/**
 * @param {string} model
 * @returns {string}
 */
export function resolveModel(model) {
  if (!model) return DEFAULT_ANTHROPIC_MODEL;
  const key = String(model).trim().toLowerCase();
  return MODEL_ALIASES[key] ?? model;
}

/**
 * Guesses the provider from a model id.
 * @param {string} model
 * @returns {"anthropic"|"openai"|null}
 */
export function detectProvider(model) {
  if (!model) return null;
  const id = String(model).toLowerCase();
  if (id.startsWith("claude")) return "anthropic";
  if (/^(gpt|o\d|chatgpt|text-)/.test(id)) return "openai";
  return null;
}

/**
 * @param {{ provider?: string, model?: string, apiKey?: string, maxTokens?: number, client?: object }} options
 */
export function createProvider(options = {}) {
  const model = resolveModel(options.model);
  const provider = options.provider || detectProvider(model);
  if (!provider) {
    throw new Error(
      `Could not infer a provider from model "${options.model}". Pass --provider anthropic|openai.`,
    );
  }
  switch (provider) {
    case "anthropic":
      return new AnthropicProvider({ ...options, model });
    case "openai":
      return new OpenAIProvider({ ...options, model });
    default:
      throw new Error(`Unknown provider "${provider}". Expected one of: ${PROVIDERS.join(", ")}`);
  }
}

export { AnthropicProvider, OpenAIProvider, DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL };
