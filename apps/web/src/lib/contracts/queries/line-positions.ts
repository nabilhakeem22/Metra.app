import 'server-only';
// Whether a position a line read was asked from is real for the caller: the
// contract, the section and the cursor line all visible to it (row-level
// security) and belonging together. A read that comes back empty asks this, so
// "nothing more here" and "this is not yours or no longer exists" are told
// apart. The answer is the same for a foreign id and an unknown one: no oracle.
import { contractLines, contractSections, contracts, type MetraDb } from '@metra/db';
import { and, eq } from 'drizzle-orm';

async function lineIn(
  tx: MetraDb,
  lineId: string,
  where: { contractId: string } | { sectionId: string },
): Promise<boolean> {
  const owner =
    'sectionId' in where
      ? eq(contractLines.sectionId, where.sectionId)
      : eq(contractLines.contractId, where.contractId);
  const [line] = await tx
    .select({ id: contractLines.id })
    .from(contractLines)
    .where(and(eq(contractLines.id, lineId), owner))
    .limit(1);
  return Boolean(line);
}

/** The section is one of the contract's, and the cursor (if any) one of the section's lines. */
export async function isKnownSectionPosition(
  tx: MetraDb,
  position: { contractId: string; sectionId: string; afterLineId: string | null },
): Promise<boolean> {
  const [section] = await tx
    .select({ id: contractSections.id })
    .from(contractSections)
    .where(and(eq(contractSections.id, position.sectionId), eq(contractSections.contractId, position.contractId)))
    .limit(1);
  if (!section) return false;
  return position.afterLineId === null || lineIn(tx, position.afterLineId, { sectionId: position.sectionId });
}

/** The contract is visible, and the cursor (if any) one of its lines. */
export async function isKnownContractPosition(
  tx: MetraDb,
  position: { contractId: string; afterLineId: string | null },
): Promise<boolean> {
  const [contract] = await tx
    .select({ id: contracts.id })
    .from(contracts)
    .where(eq(contracts.id, position.contractId))
    .limit(1);
  if (!contract) return false;
  return position.afterLineId === null || lineIn(tx, position.afterLineId, { contractId: position.contractId });
}

/** The contract is visible, and the cursor section (if any) one of its sections. */
export async function isKnownSectionCursor(
  tx: MetraDb,
  position: { contractId: string; afterSectionId: string | null },
): Promise<boolean> {
  const [contract] = await tx
    .select({ id: contracts.id })
    .from(contracts)
    .where(eq(contracts.id, position.contractId))
    .limit(1);
  if (!contract || position.afterSectionId === null) return Boolean(contract);
  const [section] = await tx
    .select({ id: contractSections.id })
    .from(contractSections)
    .where(and(eq(contractSections.id, position.afterSectionId), eq(contractSections.contractId, position.contractId)))
    .limit(1);
  return Boolean(section);
}
