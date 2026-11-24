import type { AiRuntimeConfig } from "./config";
import { ProviderPreResultError } from "./errors";
import { RECEIPT_SYSTEM_PROMPT, parseReceiptDraft, type ReceiptDraft } from "./receipt";
import {
  createChatCompletion,
  type ChatCompletionResult,
  type ChatMessage,
  type FetchLike,
  type ToolDefinition,
} from "./transport";

export const RECEIPT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ReceiptMimeType = (typeof RECEIPT_MIME_TYPES)[number];

export interface ChatInput {
  readonly messages: readonly ChatMessage[];
}

/** docs/07 interface. Implementations never return a fabricated success. */
export interface AIProvider {
  chatWithTools(input: ChatInput, tools: readonly ToolDefinition[]): Promise<ChatCompletionResult>;
  extractReceipt(input: { image: Uint8Array; mimeType: ReceiptMimeType; now: Date }): Promise<ReceiptDraft>;
  checkCapabilities(): Promise<{ tools: boolean; vision: boolean }>;
}

// 1x1 transparent PNG used only by the manual capability probe.
const PROBE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const PROBE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "probe_echo",
    description: "Capability probe. Call it with value set to 'ok'.",
    parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false },
  },
};

export function createProvider(config: AiRuntimeConfig, fetchImpl: FetchLike = fetch): AIProvider {
  return {
    chatWithTools(input, tools) {
      return createChatCompletion(config, { model: config.model, messages: input.messages, tools }, fetchImpl);
    },

    async extractReceipt({ image, mimeType, now }) {
      const dataUrl = `data:${mimeType};base64,${Buffer.from(image).toString("base64")}`;
      const result = await createChatCompletion(
        config,
        {
          model: config.visionModel,
          responseFormatJson: true,
          maxTokens: 2_048,
          messages: [
            { role: "system", content: RECEIPT_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: "Extract the receipt fields as JSON." },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
        },
        fetchImpl,
      );
      return parseReceiptDraft(result.content, now);
    },

    async checkCapabilities() {
      let tools = false;
      let vision = false;
      try {
        const r = await createChatCompletion(
          config,
          {
            model: config.model,
            tools: [PROBE_TOOL],
            maxTokens: 1_024,
            messages: [{ role: "user", content: "Call the probe_echo tool with value 'ok'." }],
          },
          fetchImpl,
        );
        tools = r.toolCalls.some((c) => c.function.name === "probe_echo");
      } catch (error) {
        if (!(error instanceof ProviderPreResultError) || error.reason === "invalid_config") throw error;
      }
      try {
        await createChatCompletion(
          config,
          {
            model: config.visionModel,
            maxTokens: 512,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: "Reply with the single word: image." },
                  { type: "image_url", image_url: { url: `data:image/png;base64,${PROBE_PNG}` } },
                ],
              },
            ],
          },
          fetchImpl,
        );
        vision = true;
      } catch (error) {
        if (!(error instanceof ProviderPreResultError) || error.reason === "invalid_config") throw error;
      }
      return { tools, vision };
    },
  };
}
