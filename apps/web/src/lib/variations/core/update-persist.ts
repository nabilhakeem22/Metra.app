import 'server-only';
// The two writes a variation draft save makes, inside the caller's transaction.
// Mirrors `proposals/core/draft-save-persist.ts`: the validation decided what is
// true, this decides nothing and only writes it down.
import { variationOrderLines, variationOrders, type MetraDb } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';
import { insertLinesInChunks } from '@/lib/lines/insert-chunked';
import { clean } from '@/lib/validation/text';
import type { PreparedVariationLine, SaveVariationDraftInput } from './types';

/** Replace the VO's lines wholesale: the draft the studio sent IS the line set. */
export async function persistVariationLines(
  tx: MetraDb,
  orgId: string,
  variationOrderId: string,
  lines: PreparedVariationLine[],
): Promise<void> {
  await tx
    .delete(variationOrderLines)
    .where(eq(variationOrderLines.variationOrderId, variationOrderId));
  if (!lines.length) return;
  await insertLinesInChunks(
    tx,
    variationOrderLines,
    lines.map((line) => ({ orgId, variationOrderId, ...line })),
  );
}

/**
 * Stamp the header and the recomputed netDelta, RE-ASSERTING the draft gate.
 *
 * If the VO left draft between the row lock and here (it cannot, since the caller
 * holds that lock — but stay defensive) the update affects 0 rows and fails
 * loudly, rather than reporting ok while the row is frozen.
 *
 * Each header field is applied only when the caller SENT it: `undefined` means
 * "not part of this edit" and `null` means "clear it", and collapsing the two
 * would let a lines-only save wipe the title.
 */
export async function persistVariationHeader(
  tx: MetraDb,
  variationOrderId: string,
  header: SaveVariationDraftInput['header'],
  netDelta: string,
): Promise<void> {
  const patch = header ?? {};
  const saved = await tx
    .update(variationOrders)
    .set({
      ...(patch.titleAr !== undefined ? { titleAr: clean(patch.titleAr) } : {}),
      ...(patch.titleEn !== undefined ? { titleEn: clean(patch.titleEn) } : {}),
      ...(patch.reasonAr !== undefined ? { reasonAr: clean(patch.reasonAr) } : {}),
      ...(patch.reasonEn !== undefined ? { reasonEn: clean(patch.reasonEn) } : {}),
      netDelta,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(variationOrders.id, variationOrderId),
        eq(variationOrders.status, 'draft'),
      ),
    )
    .returning({ id: variationOrders.id });
  if (!saved[0]) fail('variation_not_draft');
}
