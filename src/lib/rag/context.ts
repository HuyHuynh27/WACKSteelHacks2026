import "server-only";

import type { Alert } from "@/lib/database.types";
import { getAlertsForMaterial } from "@/lib/queries";

/**
 * "Retrieval" here is deliberately cheap. The expensive work — searching the
 * web, weighing sources, writing the explanation — already happened once, in
 * the ingestion worker, and is sitting on the alert row along with its drivers
 * and their verified sources. This step only has to pick which of a material's
 * handful of alerts are relevant to the question, so there is nothing to embed
 * and no vector index to keep in sync.
 */

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "and", "or", "but", "if", "then", "than", "so", "as", "of", "to", "in",
  "on", "at", "for", "with", "by", "from", "about", "into", "my", "our",
  "i", "we", "it", "this", "that", "these", "those", "what", "why", "how",
  "when", "should", "would", "could", "do", "does", "did", "will", "can",
]);

function keywords(question: string): string[] {
  return question
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function score(alert: Alert, words: string[]): number {
  const haystack = [
    alert.headline,
    alert.body,
    ...alert.drivers.flatMap((driver) => [driver.driver, driver.detail]),
  ]
    .join(" ")
    .toLowerCase();

  const overlap = words.filter((word) => haystack.includes(word)).length;

  // Recency is a tiebreaker only: with no keyword overlap at all, the newest
  // alert is still the most useful thing to ground on.
  const ageDays =
    (Date.now() - new Date(alert.created_at).getTime()) / 86_400_000;
  const recency = 1 / (1 + Math.max(ageDays, 0));

  return overlap + recency;
}

export async function getRelevantAlerts(
  materialId: string,
  question: string,
  topK = 3,
): Promise<Alert[]> {
  const alerts = await getAlertsForMaterial(materialId);
  if (alerts.length === 0) return [];

  const words = keywords(question);
  return alerts
    .map((alert) => ({ alert, value: score(alert, words) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, topK)
    .map((entry) => entry.alert);
}