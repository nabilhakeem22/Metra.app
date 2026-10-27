import 'server-only';
// The client home's contract reads for SIGNING, both over the home's whole
// snapshot (/c's own JSON, ./contract.ts), so what is signed is what /c signs:
// - with the page awaiting the client's signature, the document shown above
//   the signing (never longer than a short wait, never a thrown page);
// - before the sign act, what signing covers: contractPayloadHash, the very
//   hash /c's acknowledgement computes, or that the contract is signed already.
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { settledWithin } from '@/lib/async/settled-within';
import { contractPayloadHash } from '@/lib/contracts/public';
import type { ContractDocument, PublicContract } from '@/lib/contracts/public-types';
import { contractDocumentOf, readNamedContractSnapshot } from './contract';

/** How long the page waits for its signing document before it says it could not show it (reliability R-L2). */
export const SIGNING_DOCUMENT_WAIT_MS = 5_000;

/**
 * What signing `contractId` would come to, read before the act:
 * - `issued`: the hash the act binds (the browser never supplies it);
 * - `signed`: signed already (from another tab, or on paper), so the act is not sent;
 * - `not_this`: the home's contract is not that one, or there is none to sign
 *   (a dead link, a delivery no longer at execution): the act is not sent;
 * - `read_failed`: the read failed, so nothing was sent (the caller answers busy).
 */
export type ContractToSign =
  | { kind: 'issued'; pdfHash: string }
  | { kind: 'signed' }
  | { kind: 'not_this' }
  | { kind: 'read_failed' };

/** What signing `contractId` would come to; one redacted log line when the read failed. */
export async function readContractToSign(rawToken: string, contractId: string): Promise<ContractToSign> {
  let contract: PublicContract | null;
  try {
    contract = await readNamedContractSnapshot(rawToken, contractId);
  } catch (error) {
    console.error('client home signing hash read failed:', loggableFailure(error));
    return { kind: 'read_failed' };
  }
  if (contract === null) return { kind: 'not_this' };
  return contract.status === 'signed' ? { kind: 'signed' } : { kind: 'issued', pdfHash: contractPayloadHash(contract) };
}

/** The sections the signing page opens with; "show more sections" reads the rest, 50 at a time. */
export const SIGNING_SECTIONS_SHOWN = 10;

/**
 * The document as the signing page shows it, so the page costs no more Worker
 * CPU than /c's (reliability R-L3, measured): the figures and the payment
 * schedule in full, and the first SIGNING_SECTIONS_SHOWN sections by their
 * title and total. A section's lines are read when the client opens it, and
 * the other sections with "show more sections", as on /c past its opening.
 */
function signingDocumentOf(contract: PublicContract): ContractDocument {
  const document = contractDocumentOf(contract);
  const opening = document.sections.slice(0, SIGNING_SECTIONS_SHOWN);
  return { ...document, sections: opening.map((section) => ({ ...section, lines: [] })) };
}

/**
 * The document the page awaiting the client's signature shows, read with the
 * page. A read that failed, or took longer than SIGNING_DOCUMENT_WAIT_MS, must
 * not hold or take the page down: it is logged once, redacted, and answers
 * null (the section then says it could not show the contract, and offers no
 * signing). Null too when the home's contract is no longer `contractId`.
 */
export async function readSigningDocument(rawToken: string, contractId: string): Promise<ContractDocument | null> {
  const read = readNamedContractSnapshot(rawToken, contractId);
  try {
    if (!(await settledWithin(read, SIGNING_DOCUMENT_WAIT_MS))) {
      console.error('client home signing document read failed:', { name: 'SigningDocumentWait', waitedMs: SIGNING_DOCUMENT_WAIT_MS });
      return null;
    }
    const contract = await read;
    return contract && signingDocumentOf(contract);
  } catch (error) {
    console.error('client home signing document read failed:', loggableFailure(error));
    return null;
  }
}
