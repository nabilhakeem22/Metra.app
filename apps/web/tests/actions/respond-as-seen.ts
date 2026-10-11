// TEST-ONLY. The portal's respond write as a client who has the CURRENT page
// open: the issuance the verb names (rom.issuedAt for acknowledge_rom,
// rendersIssuedAt for the design verbs, none for the rest) is read off the
// delivery exactly as the page receives it, then echoed into the
// seven-argument write. The dbtests that predate Round D use it, so they keep
// testing what they always tested. Tests of the consent guard itself call
// recordDeliveryActionByToken with the instant they mean.
//
// NEVER a pattern for app code: the server must not fill the instant from a
// fresh read, or the guard checks nothing (D2 security review).
import { recordDeliveryActionByToken, type DeliveryActionResult } from '@/lib/engagements/public';
import { isDesignVerb } from '@/lib/engagements/review-outcome';
import { deliveryOrNull } from './delivery-read';

type RespondInput = Omit<Parameters<typeof recordDeliveryActionByToken>[1], 'expectedIssueAt'>;

/** The issuance the current page shows for `action`, or null. */
export async function issuanceShownFor(rawToken: string, action: string): Promise<string | null> {
  if (action !== 'acknowledge_rom' && !isDesignVerb(action)) return null;
  const delivery = await deliveryOrNull(rawToken);
  if (!delivery) return null;
  return action === 'acknowledge_rom' ? (delivery.rom?.issuedAt ?? null) : delivery.rendersIssuedAt;
}

export async function respondAsSeen(rawToken: string, input: RespondInput): Promise<DeliveryActionResult> {
  return recordDeliveryActionByToken(rawToken, {
    ...input,
    expectedIssueAt: await issuanceShownFor(rawToken, input.action),
  });
}
