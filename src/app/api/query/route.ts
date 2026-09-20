import { NextRequest, NextResponse } from "next/server";

import { getRelevantAlerts } from "@/lib/rag/context";
import { synthesizeAnswer } from "@/lib/rag/synthesize";
import {
  getMaterial,
  getMaterialStats,
  getPriceHistory,
} from "@/lib/queries";

export async function POST(req: NextRequest) {
  let body: { material_id?: string; question?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const materialId = body.material_id?.trim();
  const question = body.question?.trim();

  if (!materialId || !question) {
    return NextResponse.json(
      { error: "material_id and question are required" },
      { status: 400 }
    );
  }

  try {
    // RLS scopes this to the signed-in business, so a material belonging to
    // someone else comes back null and is indistinguishable from one that
    // doesn't exist. That's the intended behaviour.
    const material = await getMaterial(materialId);
    if (!material) {
      return NextResponse.json({ error: "Material not found" }, { status: 404 });
    }

    const [history, stats, alerts] = await Promise.all([
      getPriceHistory(materialId),
      getMaterialStats(materialId),
      getRelevantAlerts(materialId, question)
    ]);

    if (history.length === 0) {
      return NextResponse.json(
        {
          error:
            "No price history for this material yet. It may still be waiting on a sync.",
        },
        { status: 409 }
      );
    }

    const { answer, citations } = await synthesizeAnswer(
      material,
      question,
      alerts,
      history,
      stats
    );

    return NextResponse.json({
      answer,
      citations,
      price_trend: history,
      stats,
      priced_in: material.price_is_index
        ? { unit: material.price_native_unit ?? "index", is_index: true }
        : { unit: material.unit, currency: material.currency, is_index: false },
    });
  } catch (error) {
    console.error("query route error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}