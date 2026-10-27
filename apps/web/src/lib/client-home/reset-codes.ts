// The studio's reset of ONE client's one-time codes on a delivery (client
// codes DB step D, H5 security S1, the re-check M1 answer). A holder of the
// client's link who only asks for codes can use up that delivery's 10 codes
// of the day, and the client then cannot say "I paid" online until the day
// rolls over. The studio, told by the client, resets it here: every code sent
// before now stops working, and the delivery's own limits count from now, so
// the client can ask for a code at once. The studio's 25 a day and the
// platform's 80 are unchanged (those emails left).
//
// ONE definer function does the write (app_client_codes_reset): metra_app may
// not write the reset column, and the function checks the caller is an owner
// or admin of the delivery's studio as this gate does. Audited on the
// delivery as an `update`, with how many codes it voided.
import { sql } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';

/** Who may reset a client's codes: whoever shares the delivery's link (owner and admin). */
export const RESET_CODES_GATE = { capability: 'engagements_issue', action: 'approve', flow: 'interior' } as const;

/** How many codes that could still have been typed the reset voided. */
export interface CodesReset {
  voided: number;
}

export async function resetClientCodesCore(ctx: OrgContext, engagementId: string): Promise<ActionResult & { data?: CodesReset }> {
  return mutateInOrg(ctx, RESET_CODES_GATE, async (tx, audit) => {
    if (!isUuid(engagementId)) fail('engagement_not_found');
    const id = engagementId.toLowerCase();
    const rows = (await tx.execute(sql`select public.app_client_codes_reset(${id}::uuid) as answer`)) as unknown as Array<{
      answer: { voided?: unknown } | null;
    }>;
    const answer = rows[0]?.answer;
    if (!answer || !Number.isInteger(answer.voided)) fail('engagement_not_found');
    const reset = { voided: answer.voided as number };
    await audit({
      entity: 'design_engagement',
      entityId: id,
      action: 'update',
      before: null,
      after: { client_codes_reset: true, voided_codes: reset.voided },
    });
    return reset;
  });
}
