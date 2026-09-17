import { getDeliveryByToken } from '@/lib/engagements/public';
import type { PublicDelivery } from '@/lib/engagements/public';

/**
 * The delivery behind a raw share token, or null.
 *
 * `getDeliveryByToken` answers WHY there is none — `not_found` (permanent) or
 * `read_failed` (transient), which is the whole of W3-7 and is what the portal
 * page renders two different notices from. A database test asserting the READ
 * wants the delivery or nothing: it cannot make a live Postgres throw on demand,
 * so the `read_failed` arm is proven in `delivery.test.ts` against a mocked SDF.
 * This keeps the dbtests saying what they were always saying.
 */
export async function deliveryOrNull(
  rawToken: string,
): Promise<PublicDelivery | null> {
  const read = await getDeliveryByToken(rawToken);
  return read.status === 'ok' ? read.delivery : null;
}
