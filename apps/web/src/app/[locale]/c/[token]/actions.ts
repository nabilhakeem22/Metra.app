'use server';

import { signsInClientHome } from '@/lib/contracts/home-signing';
import {
  acknowledgeContractByToken,
  contractPayloadHash,
  getContractByToken,
  getContractSectionLinesByToken,
  getContractSectionsByToken,
  type AckError,
  type ContractSectionLinesAnswer,
  type ContractSectionsAnswer,
} from '@/lib/contracts/public';
import { answered, type PortalFailure } from '@/lib/share/portal-act-failure';
import { portalReadAllowed } from '@/lib/share/portal-rate-limit';
import { requestProvenance } from '@/lib/share/request-provenance';

/** The client's acknowledgement: its outcome, or an act that never landed. */
export type ContractAnswer = { ok: boolean; error?: AckError | 'moved' } | ({ ok: false } & PortalFailure);

/**
 * Public (no-session) electronic acknowledgement. Captures the client IP (the
 * edge's `cf-connecting-ip` first, lib/share/request-provenance.ts) and user
 * agent, and a content hash of the exact document being acknowledged (the "PDF
 * hash" per A5; binding e-signature stays deferred). Nothing throws to the
 * client: a failure underneath answers `uncertain` or `generic` with a
 * reference (answered), never "this link is not valid". A BOQ contract is
 * signed in the client home with a code (H6.3): it answers `moved`, and
 * nothing is sent to the database's acknowledgement.
 */
export async function acknowledgeContract(token: string, actorName?: string): Promise<ContractAnswer> {
  return answered('acknowledgeContract', (failure) => ({ ok: false as const, ...failure }), async () => {
    // The exact document the client is acknowledging: what it is hashed over, and where it is signed.
    const contract = await getContractByToken(token);
    if (contract !== null && signsInClientHome(contract)) return { ok: false, error: 'moved' as const };
    const { ip, userAgent } = await requestProvenance();
    // Directly invokable: a non-string name is no name, never a throw.
    const name = (typeof actorName === 'string' ? actorName.trim().slice(0, 120) : '') || null;
    const pdfHash = contract ? contractPayloadHash(contract) : null;
    return acknowledgeContractByToken(token, { actorName: name, ip, userAgent, pdfHash });
  });
}

/**
 * Public (no-session) read of the next lines of ONE section, 100 at a time,
 * when the client asks for them (plan A20). It spends the link's READ budget
 * (lib/share/portal-rate-limit.ts) and, past it, answers `too_many`.
 */
export async function loadContractSectionLines(
  token: string,
  sectionId: string,
  offset: number,
): Promise<ContractSectionLinesAnswer> {
  return answered('loadContractSectionLines', (failure) => ({ ok: false as const, ...failure }), async () => {
    if (!(await portalReadAllowed(token))) return { ok: false as const, error: 'too_many' as const };
    const page = await getContractSectionLinesByToken(token, sectionId, offset);
    return page ? { ok: true as const, page } : { ok: false as const, error: 'gone' as const };
  });
}

/**
 * Public (no-session) read of the next 50 sections, collapsed, when the client
 * asks for them (A3 reliability R1). It spends the link's READ budget and,
 * past it, answers `too_many`.
 */
export async function loadContractSections(token: string, offset: number): Promise<ContractSectionsAnswer> {
  return answered('loadContractSections', (failure) => ({ ok: false as const, ...failure }), async () => {
    if (!(await portalReadAllowed(token))) return { ok: false as const, error: 'too_many' as const };
    const page = await getContractSectionsByToken(token, offset);
    return page ? { ok: true as const, page } : { ok: false as const, error: 'gone' as const };
  });
}
