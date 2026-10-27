'use server';

import { LINK_BRAKE_REFUSAL, type SignContractAnswer } from '@/lib/client-home/code-answers';
import { signContractWithCodeByToken } from '@/lib/client-home/code-acts';
import { getHomeContract, getHomeContractSectionLines, getHomeContractSections } from '@/lib/client-home/contract';
import type { ContractSectionLinesAnswer, ContractSectionsAnswer } from '@/lib/contracts/public';
import type { ContractDocument } from '@/lib/contracts/public-types';
import { answered, type PortalFailure } from '@/lib/share/portal-act-failure';
import { portalActAllowed, portalReadAllowed } from '@/lib/share/portal-rate-limit';
import { requestProvenance } from '@/lib/share/request-provenance';

// The Execution tab's contract: its document (H6.2, the read) and signing it
// with a one-time code (H6.2, the act). The document opens, and its sections
// and lines after its opening are read, when the client asks; only a page
// awaiting the client's signature reads the document with it (./home-read.ts).
// Every read spends the link's READ budget, the signing its ACT budget
// (lib/share/portal-rate-limit.ts); past either, nothing is read or written
// and the answer is `too_many`. NOTHING THROWS TO THE CLIENT: each runs
// through `answered`, so a failure underneath is `uncertain` (the signing may
// still commit) or `generic` with its reference.

/** The document opened; `gone`, uniformly, when the link no longer shows THIS contract. */
export type HomeContractAnswer =
  | { ok: true; contract: ContractDocument }
  | { ok: false; error: 'gone' }
  | { ok: false; error: 'too_many' }
  | ({ ok: false } & PortalFailure);

const failed = (failure: PortalFailure) => ({ ok: false as const, ...failure });

/**
 * Public (no-session): the client signs the home's execution contract
 * `contractId` with the name they typed and the code emailed to them for it
 * (./code-actions.ts). The hash of what is signed is the server's own, over
 * the contract /c shows; the browser never sends one. The database signs,
 * uses the code up and tells the studio in one transaction. Captures the
 * client IP and user agent for the signature's provenance. That read comes
 * first, so a link that shows no contract to sign any more (revoked, expired,
 * no longer at execution) answers `contract_inactive`, as a replaced or ended
 * contract does, never the link's own refusal (functional F2).
 */
export async function signContractInHome(
  token: string,
  input: { contractId: string; name: string; code: string },
): Promise<SignContractAnswer> {
  return answered('signContractInHome', failed, async (): Promise<SignContractAnswer> => {
    if (!(await portalActAllowed(token))) return LINK_BRAKE_REFUSAL;
    return signContractWithCodeByToken(token, {
      contractId: input?.contractId,
      name: input?.name,
      code: input?.code,
      ...(await requestProvenance()),
    });
  });
}

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
