'use server';

import { getHomeContract, getHomeContractSectionLines, getHomeContractSections } from '@/lib/client-home/contract';
import type { ContractSectionLinesAnswer, ContractSectionsAnswer } from '@/lib/contracts/public';
import type { ContractDocument } from '@/lib/contracts/public-types';
import { answered, type PortalFailure } from '@/lib/share/portal-act-failure';
import { portalReadAllowed } from '@/lib/share/portal-rate-limit';

// The Execution tab's contract document (H6.2, the read): opening it, and the
// sections and lines after its opening, each read when the client asks and
// never with the page (the tab's render stays one call). Every read spends the
// link's READ budget (lib/share/portal-rate-limit.ts) and, past it, answers
// `too_many` unread. NOTHING THROWS TO THE CLIENT: each runs through
// `answered`, so a failure underneath is `generic` with its reference.

/** The document opened; `gone`, uniformly, when the link no longer shows THIS contract. */
export type HomeContractAnswer =
  | { ok: true; contract: ContractDocument }
  | { ok: false; error: 'gone' }
  | { ok: false; error: 'too_many' }
  | ({ ok: false } & PortalFailure);

const failed = (failure: PortalFailure) => ({ ok: false as const, ...failure });

/**
 * Public (no-session): the home's contract document, as /c opens it. The
 * card names the contract it shows (`contractId`); a home whose contract has
 * changed since the page was read answers `gone` rather than show another.
 */
export async function openHomeContract(token: string, contractId: string): Promise<HomeContractAnswer> {
  return answered('openHomeContract', failed, async () => {
    if (!(await portalReadAllowed(token))) return { ok: false as const, error: 'too_many' as const };
    const contract = await getHomeContract(token);
    const isShown = contract !== null && typeof contractId === 'string' && contract.id === contractId.toLowerCase();
    return isShown ? { ok: true as const, contract } : { ok: false as const, error: 'gone' as const };
  });
}

/**
 * Public (no-session): the next 50 sections of the contract the document was
 * opened on (`contractId`), collapsed; `gone` once the home's contract is
 * another one, so an open document never takes on another contract's sections.
 */
export async function loadHomeContractSections(token: string, contractId: string, offset: number): Promise<ContractSectionsAnswer> {
  return answered('loadHomeContractSections', failed, async () => {
    if (!(await portalReadAllowed(token))) return { ok: false as const, error: 'too_many' as const };
    const page = await getHomeContractSections(token, contractId, offset);
    return page ? { ok: true as const, page } : { ok: false as const, error: 'gone' as const };
  });
}

/** Public (no-session): the next 100 lines of one section of the contract the document was opened on; `gone` as for the sections. */
export async function loadHomeContractSectionLines(
  token: string,
  contractId: string,
  sectionId: string,
  offset: number,
): Promise<ContractSectionLinesAnswer> {
  return answered('loadHomeContractSectionLines', failed, async () => {
    if (!(await portalReadAllowed(token))) return { ok: false as const, error: 'too_many' as const };
    const page = await getHomeContractSectionLines(token, contractId, sectionId, offset);
    return page ? { ok: true as const, page } : { ok: false as const, error: 'gone' as const };
  });
}
