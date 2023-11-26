import Anthropic from "@anthropic-ai/sdk";

const constraints =
  " Constraints: Do not include pretext or context, only return the answer.";

class Claude {
  constructor(options = {}) {
    if (!options.apiKey) {
      throw new Error("Missing Claude apiKey");
    }
    this.anthropic = new Anthropic({
      apiKey: options.apiKey,
    });
    this.prompt = Anthropic.HUMAN_PROMPT;
  }
  async sendMessage(message) {
    // Note: options has messageId
    this.prompt += message + constraints;
    this.prompt += Anthropic.AI_PROMPT;

    try {
      const { completion: answer } = await this.anthropic.completions.create({
        model: "claude-2",
        stop_sequences: [Anthropic.HUMAN_PROMPT],
        max_tokens_to_sample: 300,
        prompt: this.prompt,
      });

      this.prompt += answer;
      this.prompt += Anthropic.HUMAN_PROMPT;

      return {
        id: "claude",
        text: answer,
      };
    } catch (error) {
      console.error(`Error occurred while processing question: ${error}`);
      console.error(error);
    }
  }
}

export default Claude;
