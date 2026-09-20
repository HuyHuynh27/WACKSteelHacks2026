import "server-only";

import OpenAI from "openai";

import { requireEnv } from "@/lib/env";

/**
 * Nemotron over NVIDIA's OpenAI-compatible endpoint — the same model and key
 * the Python ingestion worker uses. There is no Anthropic key in the
 * environment any more, so nothing here may fall back to one.
 */

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

let cached: OpenAI | null = null;

export function llm(): OpenAI {
  if (!cached) {
    cached = new OpenAI({
      apiKey: requireEnv("NVIDIA_API_KEY"),
      baseURL: NVIDIA_BASE_URL,
    });
  }
  return cached;
}

export function llmModel(): string {
  return process.env.NVIDIA_MODEL ?? "nvidia/nemotron-3-super-120b-a12b";
}

/**
 * Thinking off. The alerts already contain the reasoning — this call only has
 * to read them and answer in the buyer's terms. Reasoning tokens would come
 * out of the same output budget while adding several seconds to what should
 * feel like a chat response.
 *
 * NVIDIA reads this as a top-level request field, which is not in the OpenAI
 * schema, so callers spread it into the params object and cast. The SDK
 * serialises whatever it is given.
 */
export const NO_REASONING = {
  chat_template_kwargs: { enable_thinking: false },
};