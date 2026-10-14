// "When should the client expect the next step?" (Round C, C8). PLAIN data
// entry, NOT a machine transition: it writes the three 0058 columns of ONE
// delivery, together, and moves nothing. The client page shows the date only
// while the delivery is still in the stage it was set in, no state move has
// been recorded since it was set, and it is today or later in Cairo
// (app_delivery_by_token); a stage move retires it without any write here.
import { designEngagements } from '@metra/db';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { fieldsFailed } from '@/lib/actions/field-errors';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';
import { readExpectedOn } from './client-expected-field-rules';
import { TERMINAL_STATES } from './states';

const TERMINAL_STATE_LIST = [...TERMINAL_STATES];

export interface SetClientExpectedDateInput {
  engagementId: string;
  /** `YYYY-MM-DD`, today to a year ahead in Cairo; null clears the date. */
  expectedOn: string | null;
}

/**
 * Set or clear the date the client page promises for the next step. Gated on
 * `engagements_design` update (owner, admin, PM, site engineer) and the
 * interior flow. ONE atomic UPDATE: the date, the stage it is set in (the
 * row's own state, read by the same statement, so it can never name a stage
 * the delivery already left) and when it was set, all three or none (0058's
 * CHECK); a terminal delivery is refused (`engagement_not_active`), a foreign
 * or unknown one reads as `engagement_not_found`. `updated_at` is NOT touched:
 * an annotation is not progress and must not reset the delivery's waiting age.
 */
export async function setClientExpectedDateCore(
  ctx: OrgContext,
  input: SetClientExpectedDateInput,
  now: Date = new Date(),
): Promise<ActionResult> {
  if (typeof input !== 'object' || input === null || !isUuid(input.engagementId)) return err('malformed');
  const read = readExpectedOn(input.expectedOn, now);
  if (!read.ok) return fieldsFailed({ expectedOn: read.error });
  const expectedOn = read.value;

  return mutateInOrg(
    ctx,
    { capability: 'engagements_design', action: 'update', flow: 'interior' },
    async (tx, audit) => {
      const [written] = await tx
        .update(designEngagements)
        .set({
          clientExpectedOn: expectedOn,
          clientExpectedState: expectedOn === null ? null : sql`${designEngagements.state}`,
          clientExpectedSetAt: expectedOn === null ? null : sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(designEngagements.id, input.engagementId),
            notInArray(designEngagements.state, TERMINAL_STATE_LIST),
          ),
        )
        .returning({ state: designEngagements.clientExpectedState });

      if (!written) {
        // Nothing admitted: tell a finished delivery from one RLS hides.
        const [exists] = await tx
          .select({ id: designEngagements.id })
          .from(designEngagements)
          .where(eq(designEngagements.id, input.engagementId))
          .limit(1);
        fail(exists ? 'engagement_not_active' : 'engagement_not_found');
      }

      await audit({
        entity: 'design_engagement',
        entityId: input.engagementId,
        action: 'update',
        after: { client_expected_on: expectedOn, client_expected_state: written.state },
      });
    },
  );
}
