'use server';

import { headers } from 'next/headers';
import {
  acknowledgeContractByToken,
  contractPayloadHash,
  getContractByToken,
  type AckError,
} from '@/lib/contracts/public';

/**
 * Public (no-session) electronic acknowledgement. Captures the client IP +
 * user agent from the request headers, and a content hash of the exact document
 * being acknowledged (the "PDF hash" per A5 — binding e-signature stays deferred).
 */
export async function acknowledgeContract(
  token: string,
  actorName?: string,
): Promise<{ ok: boolean; error?: AckError }> {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 45) || null;
  const ua = h.get('user-agent')?.slice(0, 512) || null;
  const name = actorName?.trim().slice(0, 120) || null;
  // Hash the exact document the client is acknowledging.
  const contract = await getContractByToken(token);
  const pdfHash = contract ? contractPayloadHash(contract) : null;
  return acknowledgeContractByToken(token, {
    actorName: name,
    ip,
    userAgent: ua,
    pdfHash,
  });
}
