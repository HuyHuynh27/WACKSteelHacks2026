/**
 * Says what a material's price is actually measuring.
 *
 * Two cases need disclosing, and the numbers look plausible in both, which is
 * why they need saying out loud:
 *
 *  - A proxy series. 304 stainless is tracked against nickel, one of its
 *    inputs, because no stainless-sheet series exists. Nickel moves roughly
 *    ten times as far as the sheet does, so an unqualified "-5.4%" overstates
 *    what the buyer will see on an invoice.
 *  - An index series. Lumber and corrugated only have producer price indexes,
 *    so the level is relative and 286.6 is not 286.60 of anything.
 */
export function TrackedVia({
  materialName,
  seriesTitle,
  confidence,
  isIndex,
}: {
  materialName: string;
  seriesTitle: string | null;
  confidence: number | null;
  isIndex: boolean;
}) {
  // The mapper lowers its confidence when it settles for a related series
  // rather than the commodity itself, so the threshold doubles as a proxy flag.
  const isProxy = confidence !== null && confidence < 0.9;

  if (!isIndex && !isProxy) return null;

  return (
    <p className="max-w-prose text-sm text-muted-foreground">
      {isIndex
        ? "This series is an index, so it shows how prices are moving rather than what you would pay. It is left out of product cost totals."
        : `${seriesTitle ?? "That series"} measures an input to ${materialName} rather than the material itself, so it moves further and faster than your invoice will.`}
    </p>
  );
}