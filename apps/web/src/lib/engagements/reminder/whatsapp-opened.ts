import 'server-only';
// "Open WhatsApp" in the reminder dialog was CLICKED (lead ruling, Oct 20). The
// dialog's 'prepared' row is written whenever it opens, so it proves nothing;
// this row is the studio's act, and the rescue ledger's R2 reads it as the
// WhatsApp reminder. Metra cannot see the send itself (the studio presses send
// in its own WhatsApp), so the click is the closest true record.
//
// Owner/admin only (the dialog's own gate), on a delivery of this workspace;
// one audit row per click, through the shared audit pattern. Never throws.
import { mutateInOrg, fail } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';
import { designEngagements } from '@metra/db';
import { eq } from 'drizzle-orm';
import { DELIVERY_LINK_GATE } from '../share-reveal';

/** The audit `after.reminder` value of a click on "Open WhatsApp". */
export const REMINDER_WHATSAPP_OPENED = 'whatsapp_opened';

export async function recordWhatsappOpenedCore(ctx: OrgContext, engagementId: unknown): Promise<ActionResult> {
  if (!isUuid(engagementId)) return err('malformed');
  return mutateInOrg(ctx, DELIVERY_LINK_GATE, async (tx, audit) => {
    const [delivery] = await tx.select({ id: designEngagements.id }).from(designEngagements).where(eq(designEngagements.id, engagementId));
    if (!delivery) fail('engagement_not_found');
    await audit({
      entity: 'design_engagement',
      entityId: engagementId,
      action: 'issue',
      before: null,
      after: { reminder: REMINDER_WHATSAPP_OPENED },
    });
  });
}
