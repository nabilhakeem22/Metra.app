import 'server-only';
// The delivery as it stands on file, read back through the client's own token
// after a write saved nothing (a repeat, a closed review, an ended delivery),
// so the portal can confirm the decision that IS saved rather than the tap.
import { getDeliveryByToken, type PublicDelivery } from '../public';

/** The delivery behind the token, or null when it cannot be read right now. */
export async function savedDelivery(rawToken: string): Promise<PublicDelivery | null> {
  const read = await getDeliveryByToken(rawToken);
  return read.status === 'ok' ? read.delivery : null;
}
