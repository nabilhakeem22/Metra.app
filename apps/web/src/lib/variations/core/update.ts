// Variation-order draft edits: saveVariationDraftCore. The server recomputes EVERY
// line total + the netDelta from the money engine and never trusts a client-supplied
// total (Money law). A VO line may be a NEGATIVE de-scope (negative qty), so
// netDelta may be negative.
//
// The 185-line original is now four named phases: validate the lines (pure,
// ./update-lines.ts), load-and-lock, validate the baseline references, persist
// (./update-persist.ts). The transaction boundary did not move and no SQL
// crossed between phases.
import { contractLines, variationOrders, type MetraDb } from '@metra/db';
import { and, eq, inArray } from 'drizzle-orm';
import { failFields, type FieldError } from '@/lib/actions/field-errors';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';
import { variationLinePath } from '../line-fields';
import type { PreparedVariationLine, SaveVariationDraftInput } from './types';
import { validateVariationLines } from './update-lines';
import { persistVariationHeader, persistVariationLines } from './update-persist';

/**
 * Lock the VO row FOR UPDATE before touching its lines.
 *
 * R1: an internal-approval also locks this row (to freeze net_delta), so the two
 * operations serialize HERE and neither can read a half-rewritten line set.
 */
async function loadDraftVariationForUpdate(
  tx: MetraDb,
  variationOrderId: string,
): Promise<{ contractId: string }> {
  const [variation] = await tx
    .select({
      status: variationOrders.status,
      contractId: variationOrders.contractId,
    })
    .from(variationOrders)
    .where(eq(variationOrders.id, variationOrderId))
    .for('update')
    .limit(1);
  if (!variation) fail('record_not_found');
  if (variation.status !== 'draft') fail('variation_not_draft');
  return { contractId: variation.contractId };
}

/**
 * Every baseline line id the studio referenced must belong to THIS VO's own
 * contract, refused before the composite FK would be, under the line's baseline
 * choice: a line the contract no longer has (or never had) says so there.
 */
async function validateBaselineLines(
  tx: MetraDb,
  lines: PreparedVariationLine[],
  contractId: string,
): Promise<void> {
  const baselineIds = [
    ...new Set(
      lines
        .map((line) => line.contractLineId)
        .filter((id): id is string => id !== null),
    ),
  ];
  if (!baselineIds.length) return;
  const found = await tx
    .select({ id: contractLines.id })
    .from(contractLines)
    .where(
      and(
        inArray(contractLines.id, baselineIds),
        eq(contractLines.contractId, contractId),
      ),
    );
  const known = new Set(found.map((row) => row.id));
  const errors: Record<string, FieldError> = {};
  lines.forEach((line, index) => {
    if (line.contractLineId !== null && !known.has(line.contractLineId)) {
      errors[variationLinePath(index, 'contractLineId')] = { code: 'no_longer_exists' };
    }
  });
  if (Object.keys(errors).length > 0) failFields(errors);
}

/**
 * Save a DRAFT VO's lines + header. The server recomputes every line total from
 * the money engine (client totals ignored) and the netDelta = Σ lineTotal (may be
 * negative). Rejects a non-draft VO with `variation_not_draft`. The DB child-draft
 * trigger is the second guard (frozen once the VO leaves draft).
 *
 * Everything the client sent is validated and recomputed BEFORE the transaction
 * opens: nothing persists on a bad input.
 */
export async function saveVariationDraftCore(
  ctx: OrgContext,
  input: SaveVariationDraftInput,
): Promise<ActionResult> {
  const id = input.id?.trim();
  if (!id || !isUuid(id)) return err('malformed');

  const validated = validateVariationLines(input.lines ?? []);
  if (!validated.ok) return validated.refusal;
  const { lines, netDelta } = validated;

  return mutateInOrg(
    ctx,
    { capability: 'variations_draft', action: 'update' },
    async (tx, audit) => {
      const { contractId } = await loadDraftVariationForUpdate(tx, id);
      await validateBaselineLines(tx, lines, contractId);
      await persistVariationLines(tx, ctx.orgId, id, lines);
      await persistVariationHeader(tx, id, input.header, netDelta);
      await audit({
        entity: 'variation_order',
        entityId: id,
        action: 'update',
        before: null,
        after: { lines: lines.length, net_delta: netDelta },
      });
    },
  );
}
