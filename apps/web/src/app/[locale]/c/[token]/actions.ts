'use server';

import { headers } from 'next/headers';
import {
  acknowledgeContractByToken,
  contractPayloadHash,
  getContractByToken,
  type AckError,
} from '@/lib/contracts/public';
import { answered, type PortalFailure } from '@/lib/share/portal-act-failure';

/** The client's acknowledgement: its outcome, or an act that never landed. */
export type ContractAnswer = { ok: boolean; error?: AckError } | ({ ok: false } & PortalFailure);

/**
 * Public (no-session) electronic acknowledgement. Captures the client IP +
 * user agent from the request headers, and a content hash of the exact document
 * being acknowledged (the "PDF hash" per A5; binding e-signature stays deferred).
 * Nothing throws to the client: a failure underneath answers `uncertain` or
 * `generic` with a reference (answered), never "this link is not valid".
 */
export async function acknowledgeContract(token: string, actorName?: string): Promise<ContractAnswer> {
  return answered('acknowledgeContract', (failure) => ({ ok: false as const, ...failure }), async () => {
    const h = await headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 45) || null;
    const ua = h.get('user-agent')?.slice(0, 512) || null;
    // Directly invokable: a non-string name is no name, never a throw.
    const name = (typeof actorName === 'string' ? actorName.trim().slice(0, 120) : '') || null;
    // Hash the exact document the client is acknowledging.
    const contract = await getContractByToken(token);
    const pdfHash = contract ? contractPayloadHash(contract) : null;
    return acknowledgeContractByToken(token, { actorName: name, ip, userAgent: ua, pdfHash });
  });
}
