import "server-only";

import type OpenAI from "openai";

import type {
  Alert,
  Material,
  MaterialPriceStats,
  PricePoint,
} from "@/lib/database.types";
import { NO_REASONING, llm, llmModel } from "@/lib/llm";

export type Citation = {
  driver: string;
  detail: string;
  source: string | null;
};

const SYSTEM = `You answer questions from small manufacturers about the raw materials they buy.

You are given that material's recent price history and the alerts already raised on it. Each alert carries drivers: specific causes with concrete detail and, where one was verified, a source.

Rules:
- Ground every claim in the price history or the alerts. If they do not cover the question, say so plainly instead of reasoning from general knowledge about commodities.
- Refer to drivers by name when you use them, so the reader can match your answer to the sources listed alongside it.
- Prices are already in the unit the shop buys by. Use that unit and do not convert anything.
- Any cost or timing figure you give is an estimate from the data in front of you. Say so, and never state one as a certainty.
- You are giving the reader information to decide with, not telling them what to do. No recommendations to buy, hold, hedge or wait.
- Under 180 words. Plain sentences, no headings, no bullet lists unless the answer is genuinely a list.`;

function priceContext(
  material: Material,
  history: PricePoint[],
  stats: MaterialPriceStats | null,
): string {
  const lines: string[] = [];

  if (material.price_is_index) {
    lines.push(
      `Quoted as an index (${material.price_native_unit ?? "index"}), so the level is relative and is not a cash price.`,
    );
  } else {
    lines.push(`Priced in: ${material.currency} per ${material.unit}`);
  }

  if (stats) {
    if (stats.latest_price !== null) {
      lines.push(
        `Latest: ${stats.latest_price} on ${stats.latest_observed_on ?? "an unknown date"}`,
      );
    }
    if (stats.change_7d_pct !== null) {
      lines.push(`7-day change: ${stats.change_7d_pct.toFixed(1)}%`);
    }
    if (stats.change_30d_pct !== null) {
      lines.push(`30-day change: ${stats.change_30d_pct.toFixed(1)}%`);
    }
  }

  // A trailing slice is enough to show the shape of the move; the full series
  // is what the chart is for.
  const recent = history.slice(-12);
  if (recent.length > 0) {
    lines.push(
      "Recent observations: " +
        recent.map((point) => `${point.observed_on}: ${point.price}`).join(", "),
    );
  }

  return lines.join("\n");
}

function alertContext(alerts: Alert[]): string {
  if (alerts.length === 0) {
    return "No alerts have been raised on this material yet.";
  }

  return alerts
    .map((alert, index) => {
      const drivers = alert.drivers
        .map(
          (driver) =>
            `  - ${driver.driver}: ${driver.detail}${
              driver.source ? ` (source: ${driver.source})` : ""
            }`,
        )
        .join("\n");

      return [
        `[Alert ${index + 1}] ${alert.headline}`,
        `  ${alert.body}`,
        `  Move: ${alert.pct_change.toFixed(1)}% over ${alert.window_days} days (${alert.price_before} -> ${alert.price_after})`,
        drivers,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

export async function synthesizeAnswer(
  material: Material,
  question: string,
  alerts: Alert[],
  history: PricePoint[],
  stats: MaterialPriceStats | null,
): Promise<{ answer: string; citations: Citation[] }> {
  const prompt = [
    `Material: ${material.name}`,
    material.supplier ? `Supplier: ${material.supplier}` : null,
    "",
    priceContext(material, history, stats),
    "",
    "Alerts:",
    alertContext(alerts),
    "",
    `Question: ${question}`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  // chat_template_kwargs is an NVIDIA extension rather than part of the
  // OpenAI schema, so the params object is built loosely and cast. The SDK
  // serialises the whole object, so the extra key reaches the endpoint.
  const params = {
    model: llmModel(),
    max_tokens: 1024,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: prompt },
    ],
    ...NO_REASONING,
  };

  const response = await llm().chat.completions.create(
    params as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  );

  const raw = response.choices[0]?.message?.content ?? "";
  // Some NIM deployments inline reasoning into content even with thinking off.
  const answer = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  // De-duplicate: the same driver often recurs across a 7-day and 30-day
  // alert on the same material.
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const alert of alerts) {
    for (const driver of alert.drivers) {
      const key = `${driver.driver}|${driver.source ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push({
        driver: driver.driver,
        detail: driver.detail,
        source: driver.source ?? null,
      });
    }
  }

  return { answer, citations };
}