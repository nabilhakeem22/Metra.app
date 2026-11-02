import { designEngagements, engagementMilestones, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';
import { failFields } from '@/lib/actions/field-errors';
import { fail } from '@/lib/actions/mutate';
import type { OrgContext } from '@/lib/db/context';
import { validateFeeSchedule } from './validate';

/**
 * The executor-only side-effect. MUST be called with the executor's `tx` so the
 * fee update + milestone inserts are atomic with the state move. Rolls back the
 * whole transition on any validation failure via `fail()`.
 */
export async function generateFeeSchedule(
  tx: MetraDb,
  ctx: OrgContext,
  engagementId: string,
  payload: unknown,
): Promise<void> {
  const result = validateFeeSchedule(payload);
  if (!result.ok) {
    if (result.field) failFields({ [result.field]: result.error });
    fail(result.code);
  }
  const { designFee, milestones } = result.schedule;

  await tx
    .update(designEngagements)
    .set({ designFee, updatedAt: new Date() })
    .where(eq(designEngagements.id, engagementId));

  await tx.insert(engagementMilestones).values(
    milestones.map((m) => ({
      orgId: ctx.orgId,
      engagementId,
      kind: m.kind,
      basis: m.basis,
      value: m.value,
      sortOrder: m.sortOrder,
    })),
  );
}
