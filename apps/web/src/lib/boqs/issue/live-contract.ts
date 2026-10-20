import 'server-only';
import { boqs, contracts, type MetraDb } from '@metra/db';
import { and, eq, ne } from 'drizzle-orm';

/**
 * Whether a non-terminated contract stands on the project's issued BOQ. Such a
 * BOQ is never superseded (`boq_has_contract`): later changes are change orders.
 *
 * The EARLY read behind the refusal: it lets Issue stop before the PDF is
 * rendered and stored, and lets the BOQ tab disable Issue. It is not the rule
 * that holds, since a contract can be generated after this read; the locked
 * read in `freeze.ts` is the backstop.
 */
export async function projectHasLiveContractOnIssuedBoq(
  tx: MetraDb,
  projectId: string,
): Promise<boolean> {
  const [standing] = await tx
    .select({ id: contracts.id })
    .from(contracts)
    .innerJoin(boqs, eq(boqs.id, contracts.sourceBoqId))
    .where(
      and(
        eq(boqs.projectId, projectId),
        eq(boqs.status, 'issued'),
        ne(contracts.status, 'terminated'),
      ),
    )
    .limit(1);
  return standing !== undefined;
}
